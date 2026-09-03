import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { KernelErrorCode, RpcError } from "@nuum/protocol";
import { authorizedPath } from "./file-tools.js";
import type { Tool } from "./types.js";
import { booleanField, enumField, integerField, stringField } from "./validation.js";

const MAX_GLOB_RESULTS = 500;
const MAX_GREP_OUTPUT = 500_000;

export const globTool: Tool = {
  definition: {
    name: "glob",
    description: "Find files recursively with a glob pattern and return newest matches first.",
    mutating: false,
    action: "list-directory",
    inputSchema: {
      type: "object",
      properties: {
        glob_pattern: { type: "string" },
        target_directory: { type: "string" }
      },
      required: ["glob_pattern"]
    }
  },
  execute: async (input, ctx) => {
    const pattern = stringField(input, "glob_pattern")!;
    const target = stringField(input, "target_directory", { optional: true }) ?? ".";
    const root = await authorizedPath(ctx.sandbox, "list-directory", target);
    const effective = pattern.startsWith("**/") ? pattern : `**/${pattern}`;
    const matches: Array<{ path: string; mtimeMs: number }> = [];

    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relative = path.relative(root, fullPath).split(path.sep).join("/");
          if (path.matchesGlob(relative, effective)) {
            matches.push({ path: fullPath, mtimeMs: (await stat(fullPath)).mtimeMs });
          }
        }
      }
    }

    await walk(root);
    matches.sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path));
    if (matches.length === 0) return "No files matched.";
    const shown = matches.slice(0, MAX_GLOB_RESULTS).map((item) => item.path);
    if (matches.length > shown.length) shown.push(`[${matches.length - shown.length} more matches omitted.]`);
    return shown.join("\n");
  }
};

export const grepTool: Tool = {
  definition: {
    name: "grep",
    description: "Search file contents with ripgrep.",
    mutating: false,
    action: "read-file",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        type: { type: "string" },
        output_mode: { enum: ["content", "files_with_matches", "count"] },
        "-i": { type: "boolean" },
        "-A": { type: "integer", minimum: 0 },
        "-B": { type: "integer", minimum: 0 },
        "-C": { type: "integer", minimum: 0 },
        head_limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        multiline: { type: "boolean" }
      },
      required: ["pattern"]
    }
  },
  execute: async (input, ctx) => {
    const pattern = stringField(input, "pattern")!;
    const requested = stringField(input, "path", { optional: true }) ?? ".";
    const root = await authorizedPath(ctx.sandbox, "read-file", requested);
    const mode = enumField(input, "output_mode", ["content", "files_with_matches", "count"] as const, "content");
    const args = ["--color", "never"];
    if (mode === "content") args.push("--line-number", "--with-filename");
    if (mode === "files_with_matches") args.push("--files-with-matches");
    if (mode === "count") args.push("--count", "--with-filename");
    if (booleanField(input, "-i")) args.push("--ignore-case");
    if (booleanField(input, "multiline")) args.push("--multiline");
    appendPair(args, "--glob", stringField(input, "glob", { optional: true }));
    appendPair(args, "--type", stringField(input, "type", { optional: true }));
    appendPair(args, "--after-context", numericOption(input, "-A"));
    appendPair(args, "--before-context", numericOption(input, "-B"));
    appendPair(args, "--context", numericOption(input, "-C"));
    args.push("--regexp", pattern, root);

    const result = await runRipgrep(args, ctx.abortSignal);
    if (result.exitCode === 1) return "No matches found.";
    if (result.exitCode !== 0) {
      throw new RpcError(KernelErrorCode.TOOL, `ripgrep failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    }
    const lines = result.stdout.trimEnd().split("\n");
    const offset = integerField(input, "offset", { min: 0 }) ?? 0;
    const headLimit = integerField(input, "head_limit", { min: 1 });
    const shown = lines.slice(offset, headLimit === undefined ? undefined : offset + headLimit);
    if (shown.length === 0) return "No matches in the requested result range.";
    return shown.join("\n");
  }
};

function numericOption(input: Record<string, unknown>, key: string): string | undefined {
  const value = integerField(input, key, { min: 0 });
  return value === undefined ? undefined : String(value);
}

function appendPair(args: string[], flag: string, value: string | undefined): void {
  if (value !== undefined) args.push(flag, value);
}

function runRipgrep(args: string[], signal: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const command = process.env.NUUM_RG_PATH || "rg";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const append = (current: string, chunk: Buffer) => {
      if (current.length >= MAX_GREP_OUTPUT) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length > MAX_GREP_OUTPUT) truncated = true;
      return next.slice(0, MAX_GREP_OUTPUT);
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new RpcError(KernelErrorCode.TOOL, `ripgrep executable not found: ${command}`));
      } else {
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (truncated) stdout += "\n[rg output truncated; narrow the pattern, glob, or result range.]";
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    const abort = () => child.kill("SIGTERM");
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    child.once("close", () => signal.removeEventListener("abort", abort));
  });
}
