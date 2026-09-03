import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@nuum/ui": resolve(__dirname, "../../packages/ui/src/index.ts"),
        "@nuum/protocol": resolve(__dirname, "../../packages/protocol/src/index.ts")
      }
    }
  }
});
