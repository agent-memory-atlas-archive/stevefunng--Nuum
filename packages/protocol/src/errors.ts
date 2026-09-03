export const KernelErrorCode = {
  INTERNAL: 1000,
  TURN_BUSY: 1002,
  CANCELLED: 1003,
  MODEL: 1004,
  TOOL: 1005,
  SANDBOX: 1006,
  INVALID: 1007
} as const;

export const HostErrorCode = {
  AGENT_NOT_FOUND: 2001,
  AGENT_BUSY: 2002,
  NO_WORKSPACE: 2003,
  NO_API_KEY: 2004,
  KERNEL_DOWN: 2008,
  DATA_DIR_LOCKED: 2009
} as const;

export const DesktopErrorCode = {
  SECRET_STORE: 3001,
  FOLDER_PICK: 3002,
  WINDOW: 3003
} as const;

export type KernelErrorCode = (typeof KernelErrorCode)[keyof typeof KernelErrorCode];
export type HostErrorCode = (typeof HostErrorCode)[keyof typeof HostErrorCode];
export type DesktopErrorCode = (typeof DesktopErrorCode)[keyof typeof DesktopErrorCode];

export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}
