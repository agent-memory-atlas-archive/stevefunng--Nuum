import type { ToolDefinition } from "@nuum/protocol";
import { builtinTools } from "./builtin.js";
import type { Tool } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: readonly Tool[] = builtinTools) {
    for (const tool of tools) this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 不给 names 是「全都要」，给空数组是「一个都不要」。这两者必须分开：混同的话
   * 「这个 run 不许用本地工具」会被静默解释成「本地工具全放开」。
   */
  list(names?: readonly string[]): ToolDefinition[] {
    const all = [...this.tools.values()].map((tool) => tool.definition);
    if (!names) return all;
    return all.filter((tool) => names.includes(tool.name));
  }
}
