import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative base so the static build works on GitHub Pages or any sub-path.
  base: "./",
  server: { port: 5173, fs: { allow: ["../.."] } },
  build: { chunkSizeWarningLimit: 1500 },
});
