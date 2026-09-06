import { BrowserWindow, Menu, Tray, nativeImage, screen, type NativeImage } from "electron";
import path from "node:path";
import { HostMethods, type ProactiveSnapshot } from "@nuum/protocol";

// A monochrome Nu-nu face; template rendering follows macOS menu-bar contrast.
function trayImage(here: string, active: boolean): NativeImage {
  const name = active ? "proactive-onTemplate.png" : "proactive-offTemplate.png";
  const image = nativeImage.createFromPath(path.join(here, "../../resources", name));
  if (image.isEmpty()) throw new Error("Proactive menu-bar image is missing");
  image.setTemplateImage(true);
  return image;
}

export class ProactiveTray {
  private tray: Tray;
  private panel: BrowserWindow;
  private language = "zh-CN";
  private snapshot: ProactiveSnapshot | null = null;
  private refreshing = false;
  private refreshAgain = false;
  constructor(private here: string, private request: (method: string) => Promise<unknown>, private showMain: () => void, private quit: () => void) {
    this.tray = new Tray(trayImage(here, false));
    this.panel = new BrowserWindow({ width: 368, height: 560, show: false, frame: false, resizable: false, maximizable: false,
      minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, roundedCorners: true,
      backgroundColor: "#fafafa", title: "Nuum · Proactive mode", webPreferences: {
        preload: path.join(here, "../preload/index.mjs"), contextIsolation: true, nodeIntegration: false, sandbox: false
      } });
    this.panel.on("blur", () => this.panel.hide());
    this.panel.webContents.on("before-input-event", (event, input) => { if (input.key === "Escape") { event.preventDefault(); this.panel.hide(); } });
    if (process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL); url.searchParams.set("surface", "proactive");
      void this.panel.loadURL(url.toString());
    } else void this.panel.loadFile(path.join(here, "../renderer/index.html"), { query: { surface: "proactive" } });
    this.tray.on("click", () => this.panel.isVisible() ? this.panel.hide() : this.show());
    this.tray.on("right-click", () => this.tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: "Proactive mode", click: () => this.show() },
      { label: this.language === "en" ? "Open Nuum" : "打开 Nuum", click: showMain },
      { type: "separator" }, { label: this.language === "en" ? "Quit Nuum" : "退出 Nuum", click: quit }
    ])));
    void this.refresh();
  }
  setLanguage(language: string): void { this.language = language; this.renderStatus(); }
  show(): void {
    const bounds = this.tray.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = 368, height = Math.min(560, area.height - 16);
    this.panel.setBounds({ width, height,
      x: Math.round(Math.max(area.x + 8, Math.min(bounds.x + bounds.width / 2 - width / 2, area.x + area.width - width - 8))),
      y: Math.round(Math.max(area.y + 6, Math.min(bounds.y + bounds.height + 6, area.y + area.height - height - 8))) });
    this.panel.show(); this.panel.focus(); void this.refresh();
  }
  hide(): void { this.panel.hide(); }
  send(method: string, params: unknown): void {
    if (!this.panel.isDestroyed()) this.panel.webContents.send("host:event", method, params);
  }
  async refresh(): Promise<void> {
    if (this.refreshing) { this.refreshAgain = true; return; }
    this.refreshing = true;
    try { this.snapshot = await this.request(HostMethods.proactiveGet) as ProactiveSnapshot; }
    catch { this.snapshot = null; }
    finally {
      this.refreshing = false;
      this.renderStatus();
      if (this.refreshAgain) { this.refreshAgain = false; void this.refresh(); }
    }
  }
  private renderStatus(): void {
    if (this.tray.isDestroyed()) return;
    const agents = this.snapshot?.agents ?? [];
    const enabled = agents.some((agent) => !["disabled", "paused"].includes(agent.state));
    this.tray.setImage(trayImage(this.here, enabled));
    const state = !this.snapshot ? (this.language === "en" ? "Unavailable" : "服务未连接")
      : enabled ? (this.language === "en" ? "Enabled" : "已开启")
      : agents.some((agent) => agent.state === "paused") ? (this.language === "en" ? "Paused" : "已暂停")
      : (this.language === "en" ? "Off" : "未开启");
    this.tray.setToolTip(`Nuum · Proactive mode · ${state}`);
  }
  destroy(): void { this.panel.destroy(); this.tray.destroy(); }
}
