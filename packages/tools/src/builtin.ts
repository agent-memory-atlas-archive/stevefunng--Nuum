import type { Tool } from "./types.js";
import {
  deleteTool,
  lsTool,
  multiStrReplaceTool,
  readTool,
  strReplaceTool,
  writeTool
} from "./file-tools.js";
import { globTool, grepTool } from "./search-tools.js";
import { shellTool } from "./shell-tool.js";

export const builtinTools: Tool[] = [
  readTool,
  writeTool,
  strReplaceTool,
  multiStrReplaceTool,
  deleteTool,
  lsTool,
  globTool,
  grepTool,
  shellTool
];

export {
  deleteTool,
  globTool,
  grepTool,
  lsTool,
  multiStrReplaceTool,
  readTool,
  shellTool,
  strReplaceTool,
  writeTool
};
