import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Incremental Web client workspace. The current production PWA remains served
 * from ./public until the migrated flows pass parity and regression gates.
 */
export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: [".e2b.app"],
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    allowedHosts: [".e2b.app"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
