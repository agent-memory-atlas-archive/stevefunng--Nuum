#!/usr/bin/env node
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostServer } from "./server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dataDir = readFlag("--data-dir") ?? path.join(homedir(), ".nuum");
const kernelCommand = readFlag("--kernel-command") ?? process.execPath;
const defaultKernel = path.resolve(here, "..", "..", "kernel", "dist", "main.js");
const kernelEntry = readFlag("--kernel-entry") ?? defaultKernel;

const runtime = await createHostServer({
  dataDir,
  kernelCommand,
  kernelArgs: kernelCommand === process.execPath ? [kernelEntry] : []
});
process.stdin.resume();

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  void runtime.dispose().finally(() => process.exit(0));
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.once(signal, shutdown);
}

// stdin 关闭说明父进程没了。不退出就会变成孤儿：一直持着 dataDir 锁，把下一次
// 启动挡在门外，还带着自己那个 Kernel 子进程一起漏。
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);

function readFlag(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}
