import type { LocalToolAction, ToolPermission } from "@nuum/protocol";
import type { PersistentShellRequest, PersistentShellResult } from "./persistent-shell.js";

export interface FileMutation {
  path: string;
  before: string | null;
  after: string;
}

export interface DeleteResult {
  path: string;
  kind: "file" | "directory";
}

export interface SandboxPort {
  readonly cwd: string;
  authorize(action: LocalToolAction, target: string): Promise<PermissionVerdict>;
  grantOnce(action: LocalToolAction, target: string): void;
  refuse(action: LocalToolAction, target: string): void;
  setPermission(permission: ToolPermission): void;
  resolvePath(input: string): Promise<string>;
  readFile(path: string): Promise<string>;
  readBinary(path: string): Promise<{ path: string; data: Uint8Array }>;
  writeFile(path: string, content: string): Promise<FileMutation>;
  mutateFile(path: string, transform: (current: string) => string): Promise<FileMutation>;
  deletePath(path: string): Promise<DeleteResult>;
  shell(request: PersistentShellRequest): Promise<PersistentShellResult>;
  disposeShell(): Promise<void>;
}

export type ShellRequest = PersistentShellRequest;
export type ShellResult = PersistentShellResult;

export interface SandboxAuditEvent {
  at: number;
  permission: ToolPermission;
  action: LocalToolAction | "resolve";
  path?: string;
  command?: string;
  ok: boolean;
  detail?: string;
}

export type SandboxAuditor = (event: SandboxAuditEvent) => void;

export interface PermissionVerdict {
  decision: "allow" | "ask" | "deny";
  /** canonical path，或 run-command 的首 token。 */
  target: string;
  reason?: string;
}
