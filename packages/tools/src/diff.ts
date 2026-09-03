import type { FileMutation } from "@nuum/sandbox";

const MAX_DIFF_CHARS = 12_000;

export function formatMutation(mutation: FileMutation): string {
  const before = lines(mutation.before ?? "");
  const after = lines(mutation.after);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1;

  const removed = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  const verb = mutation.before === null ? "Created" : removed.length === 0 && added.length === 0 ? "Unchanged" : "Updated";
  const headline = `${verb} ${mutation.path} (+${added.length}/-${removed.length})`;
  if (removed.length === 0 && added.length === 0) return headline;

  const preview = [
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...(prefix > 0 ? [` ${before[prefix - 1]}`] : []),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...(suffix > 0 ? [` ${before[before.length - suffix]}`] : [])
  ].join("\n");
  const output = `${headline}\n${preview}`;
  if (output.length <= MAX_DIFF_CHARS) return output;
  return `${output.slice(0, MAX_DIFF_CHARS)}\n[Diff truncated; read ${mutation.path} to inspect the complete result.]`;
}

function lines(content: string): string[] {
  return content.length === 0 ? [] : content.split("\n");
}
