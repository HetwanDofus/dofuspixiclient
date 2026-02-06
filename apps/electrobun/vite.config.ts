import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import compression from "compression";
import { defineConfig } from "vite";

const __dirname = import.meta.dirname;

function compressionPlugin(): Plugin {
  return {
    name: "vite-plugin-compression-dev",
    configureServer(server) {
      server.middlewares.use(
        compression({
          filter: (req) => {
            const url = req.url || "";
            // Compress SVG and JSON files
            return url.endsWith(".svg") || url.endsWith(".json");
          },
          level: 6, // Compression level (1-9, 6 is default)
          threshold: 1024, // Only compress files > 1KB
        })
      );
    },
  };
}

export default defineConfig({
  plugins: [compressionPlugin(), svelte()],
  root: "src/mainview",
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src/lib"),
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    target: "esnext",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["brotli-dec-wasm"],
  },
  worker: {
    format: "es",
  },
});
