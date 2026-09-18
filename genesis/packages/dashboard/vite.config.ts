import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@genesis/protocol": path.resolve(here, "../protocol/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(here, "../..")] },
    proxy: {
      "/api": { target: "http://127.0.0.1:7777", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:7777", ws: true },
    },
  },
  optimizeDeps: { exclude: ["@genesis/protocol"] },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
