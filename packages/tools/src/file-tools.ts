import { readdir } from "node:fs/promises";
import path from "node:path";
import { KernelErrorCode, RpcError, type ModelImage } from "@nuum/protocol";
import type { SandboxPort } from "@nuum/sandbox";
import { formatMutation } from "./diff.js";
import type { Tool } from "./types.js";
import { booleanField, integerField, stringField } from "./validation.js";

const MAX_READ_CHARS = 30_000;
const MAX_TREE_CHARS = 20_000;
const IMAGE_MIME_TYPES = new Map<string, ModelImage["mimeType"]>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"]
]);

export const readTool: Tool = {
  definition: {
    name: "read",
    description: "Read a UTF-8 file, optionally by one-based line range and with line numbers.",
    mutating: false,
    action: "read-file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1 },
        include_line_numbers: { type: "boolean" }
      },
      required: ["path"]
    }
  },
  execute: async (input, ctx) => {
    const filePath = stringField(input, "path")!;
    const offset = integerField(input, "offset", { min: 1 }) ?? 1;
    const limit = integerField(input, "limit", { min: 1 });
    const includeLineNumbers = booleanField(input, "include_line_numbers") ?? false;
    const mimeType = IMAGE_MIME_TYPES.get(path.extname(filePath).toLowerCase());
    if (mimeType) {
      if (input.offset !== undefined || input.limit !== undefined) {
        throw new RpcError(KernelErrorCode.INVALID, "offset and limit are not supported for image files.");
      }
      const image = await ctx.sandbox.readBinary(filePath);
      return {
        text: `Read image file: ${image.path}`,
        images: [{ mimeType, data: Buffer.from(image.data).toString("base64") }]
      };
    }
    const content = await ctx.sandbox.readFile(filePath);
    if (content.length === 0) return "File is empty.";
    if (content.includes("\0")) {
      throw new RpcError(KernelErrorCode.TOOL, `Cannot read binary file as UTF-8 text: ${filePath}`);
    }
    const all = content.split("\n");
    if (offset > all.length) {
      return `[Offset ${offset} is beyond the end of ${filePath} (${all.length} lines).]`;
    }
    const requestedEnd = Math.min(all.length, offset - 1 + (limit ?? all.length));
    const selected = all.slice(offset - 1, requestedEnd);
    const rendered = selected.map((line, index) => includeLineNumbers ? `${offset + index}|${line}` : line);
    const kept: string[] = [];
    let characters = 0;
    for (const line of rendered) {
      const next = line.length + (kept.length > 0 ? 1 : 0);
      if (characters + next > MAX_READ_CHARS) break;
      kept.push(line);
      characters += next;
    }
    if (kept.length === 0) {
      return `${rendered[0]!.slice(0, MAX_READ_CHARS)}\n\n[Line ${offset} was truncated because it alone exceeds the read budget. Use grep to narrow the content.]`;
    }
    const actualEnd = offset + kept.length - 1;
    if (kept.length < rendered.length) {
      return `${kept.join("\n")}\n\n[Output truncated at line ${actualEnd} of ${all.length}. Call read again with offset=${actualEnd + 1}.]`;
    }
    if (offset !== 1 || requestedEnd !== all.length) {
      const remaining = all.length - requestedEnd;
      const shown = offset === requestedEnd ? `line ${offset}` : `lines ${offset}-${requestedEnd}`;
      const remainder = remaining === 1 ? "1 line remains" : `${remaining} lines remain`;
      return `${kept.join("\n")}\n\n[Showing ${shown} of ${all.length}. ${remainder}.]`;
    }
    return kept.join("\n");
  }
};

export const writeTool: Tool = {
  definition: {
    name: "write",
    description: "Create or overwrite a UTF-8 file and return a compact diff.",
    mutating: true,
    action: "write-file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"]
    }
  },
  execute: async (input, ctx) => {
    const mutation = await ctx.sandbox.writeFile(
      stringField(input, "path")!,
      stringField(input, "content", { allowEmpty: true })!
    );
    return formatMutation(mutation);
  }
};

export const strReplaceTool: Tool = {
  definition: {
    name: "str_replace",
    description: "Replace exact text in a file; the match must be unique unless replace_all is true.",
    mutating: true,
    action: "write-file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" }
      },
      required: ["path", "old_string", "new_string"]
    }
  },
  execute: async (input, ctx) => {
    const filePath = stringField(input, "path")!;
    const oldString = stringField(input, "old_string")!;
    const newString = stringField(input, "new_string", { allowEmpty: true })!;
    const replaceAll = booleanField(input, "replace_all") ?? false;
    let replaced = 0;
    const mutation = await ctx.sandbox.mutateFile(filePath, (current) => {
      replaced = occurrenceCount(current, oldString);
      assertReplaceable(filePath, replaced, replaceAll);
      return replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
    });
    return `Replaced ${replaced} ${replaced === 1 ? "occurrence" : "occurrences"}.\n${formatMutation(mutation)}`;
  }
};

export const multiStrReplaceTool: Tool = {
  definition: {
    name: "multi_str_replace",
    description: "Apply several exact replacements to one file in a single atomic write.",
    mutating: true,
    action: "write-file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" }
            },
            required: ["old_string", "new_string"]
          }
        }
      },
      required: ["path", "edits"]
    }
  },
  execute: async (input, ctx) => {
    const filePath = stringField(input, "path")!;
    const edits = parseEdits(input.edits);
    const mutation = await ctx.sandbox.mutateFile(filePath, (original) => {
      let next = original;
      for (const [index, edit] of edits.entries()) {
        const matches = occurrenceCount(next, edit.oldString);
        try {
          assertReplaceable(filePath, matches, edit.replaceAll);
        } catch (error) {
          if (error instanceof Error) error.message = `Edit ${index + 1}: ${error.message}`;
          throw error;
        }
        next = edit.replaceAll
          ? next.split(edit.oldString).join(edit.newString)
          : next.replace(edit.oldString, edit.newString);
      }
      return next;
    });
    return `Applied ${edits.length} edits.\n${formatMutation(mutation)}`;
  }
};

export const deleteTool: Tool = {
  definition: {
    name: "delete",
    description: "Delete a file or directory tree.",
    mutating: true,
    action: "write-file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    }
  },
  execute: async (input, ctx) => {
    const result = await ctx.sandbox.deletePath(stringField(input, "path")!);
    return `Deleted ${result.kind}: ${result.path}`;
  }
};

export const lsTool: Tool = {
  definition: {
    name: "ls",
    description: "Render a directory tree within a bounded output budget.",
    mutating: false,
    action: "list-directory",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } }
    }
  },
  execute: async (input, ctx) => {
    const requested = stringField(input, "path", { optional: true }) ?? ".";
    const root = await authorizedPath(ctx.sandbox, "list-directory", requested);
    const output = [`${path.basename(root) || root}/`];
    let used = output[0]!.length;
    let truncated = false;

    async function visit(directory: string, prefix: string): Promise<void> {
      if (truncated) return;
      const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
      for (const [index, entry] of entries.entries()) {
        const last = index === entries.length - 1;
        const suffix = entry.isDirectory() ? "/" : entry.isSymbolicLink() ? "@" : "";
        const line = `${prefix}${last ? "└── " : "├── "}${entry.name}${suffix}`;
        if (used + line.length + 1 > MAX_TREE_CHARS) {
          truncated = true;
          return;
        }
        output.push(line);
        used += line.length + 1;
        if (entry.isDirectory()) {
          await visit(path.join(directory, entry.name), `${prefix}${last ? "    " : "│   "}`);
        }
      }
    }

    await visit(root, "");
    if (truncated) output.push(`[Directory tree truncated at ${MAX_TREE_CHARS} characters.]`);
    return output.join("\n");
  }
};

export async function authorizedPath(
  sandbox: SandboxPort,
  action: "read-file" | "list-directory",
  requested: string
): Promise<string> {
  const verdict = await sandbox.authorize(action, requested);
  if (verdict.decision === "allow") return verdict.target;
  throw new RpcError(
    KernelErrorCode.SANDBOX,
    verdict.reason ?? `Approval is required for ${action} ${verdict.target}.`
  );
}

function occurrenceCount(content: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while ((cursor = content.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function assertReplaceable(filePath: string, matches: number, replaceAll: boolean): void {
  if (matches === 0) {
    throw new RpcError(
      KernelErrorCode.TOOL,
      `old_string matched 0 times in ${filePath}. Read the file again and copy the exact text before retrying.`
    );
  }
  if (!replaceAll && matches !== 1) {
    throw new RpcError(
      KernelErrorCode.TOOL,
      `old_string matched ${matches} times in ${filePath}. Include more surrounding context to make it unique, or set replace_all=true.`
    );
  }
}

function parseEdits(raw: unknown): Array<{ oldString: string; newString: string; replaceAll: boolean }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RpcError(KernelErrorCode.INVALID, "edits must be a non-empty array.");
  }
  return raw.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RpcError(KernelErrorCode.INVALID, `edits[${index}] must be an object.`);
    }
    const edit = value as Record<string, unknown>;
    return {
      oldString: stringField(edit, "old_string")!,
      newString: stringField(edit, "new_string", { allowEmpty: true })!,
      replaceAll: booleanField(edit, "replace_all") ?? false
    };
  });
}
