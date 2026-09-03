import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopMethods, JsonRpcPeer, createStdioDuplex, type SecretsState } from "./host-bridge.js";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot find monorepo root from ${start}`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
const dataDir = path.join(app.getPath("userData"), "data");
mkdirSync(dataDir, { recursive: true });

let host: ChildProcessWithoutNullStreams | null = null;
let peer: JsonRpcPeer | null = null;
let window: BrowserWindow | null = null;

function sendToRenderer(method: string, params: unknown): void {
  if (!window || window.isDestroyed()) return;
  try {
    window.webContents.send("host:event", method, params);
  } catch {
    // Window can disappear between the check and send while quitting.
  }
}

function secretsPath(): string {
  return path.join(app.getPath("userData"), "secrets.bin");
}

function readSecrets(): SecretsState {
  try {
    const raw = readFileSync(secretsPath());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString("utf8");
    return JSON.parse(json) as SecretsState;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: SecretsState): void {
  const json = JSON.stringify(secrets);
  const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  writeFileSync(secretsPath(), payload);
}

function startHost(): JsonRpcPeer {
  const hostEntry = path.join(repoRoot, "packages/host/dist/main.js");
  const kernelEntry = path.join(repoRoot, "packages/kernel/dist/main.js");
  const child = spawn("node", [hostEntry, "--data-dir", dataDir, "--kernel-entry", kernelEntry], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  host = child;
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("exit", () => {
    host = null;
    peer = null;
    sendToRenderer("host.kernel.down", { reason: "host-exit" });
  });
  const next = new JsonRpcPeer(createStdioDuplex(child.stdout, child.stdin));
  next.onEvent((method, params) => {
    sendToRenderer(method, params);
  });
  peer = next;
  return next;
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(here, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  window.on("closed", () => {
    window = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(here, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const hostPeer = startHost();
  await hostPeer.request("sys.hello");
  const secrets = readSecrets();
  if (secrets.openaiApiKey || secrets.anthropicApiKey || secrets.deepseekApiKey) {
    await hostPeer.request("settings.set", {
      openaiApiKey: secrets.openaiApiKey,
      anthropicApiKey: secrets.anthropicApiKey,
      deepseekApiKey: secrets.deepseekApiKey
    });
  }
  createWindow();
});

ipcMain.handle("host:request", async (_event, method: string, params: unknown) => {
  if (!peer) throw new Error("Host is not running");
  try {
    return await peer.request(method, params);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle(DesktopMethods.windowMinimize, () => window?.minimize());
ipcMain.handle(DesktopMethods.windowToggleMaximize, () => {
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});
ipcMain.handle(DesktopMethods.windowClose, () => window?.close());
ipcMain.handle(DesktopMethods.windowGetState, () => ({
  isMaximized: window?.isMaximized() ?? false,
  isFullscreen: window?.isFullScreen() ?? false
}));
ipcMain.handle(DesktopMethods.themeGet, () => ({ theme: "system" }));
ipcMain.handle(DesktopMethods.workspacePick, async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle(DesktopMethods.secretsGet, () => readSecrets());
ipcMain.handle(DesktopMethods.secretsSet, (_event, secrets: SecretsState) => {
  writeSecrets(secrets);
  return { ok: true };
});
ipcMain.handle(DesktopMethods.shellOpenExternal, (_event, url: string) => shell.openExternal(url));

function stopHost(): void {
  const child = host;
  host = null;
  peer = null;
  child?.kill("SIGTERM");
}

app.on("window-all-closed", () => {
  stopHost();
  app.quit();
});

// Cmd+Q 不经过 window-all-closed。父进程被强杀的情况由 Host 自己的 stdin 关闭兜底。
app.on("before-quit", stopHost);
