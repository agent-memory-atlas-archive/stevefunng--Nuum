#!/usr/bin/env node
import { createKernelServer } from "./server.js";
import { disposeAllShells } from "@nuum/sandbox";

createKernelServer();
process.stdin.resume();

// 与 Host 同理：stdin 关闭即父进程已消失，不退出就变成孤儿。
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  void disposeAllShells().finally(() => process.exit(0));
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.once(signal, shutdown);
}
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
