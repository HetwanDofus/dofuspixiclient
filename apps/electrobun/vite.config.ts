import { readFile } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";
import { lingui } from "@lingui/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import compression from "compression";
import { defineConfig } from "vite";
import babel from "vite-plugin-babel";

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
        }) as never
      );
    },
  };
}

/**
 * Vite plugin that replaces __RESOLUTION__ placeholders in SVG files
 * server-side based on the `?r=` query parameter.
 *
 * This allows workers to fetch the final SVG by URL without DOM APIs,
 * since the replacement is done before the response reaches the client.
 */
function svgResolutionPlugin(): Plugin {
  const publicDir = resolve(__dirname, "public");

  return {
    name: "vite-plugin-svg-resolution",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.includes(".svg") || !url.includes("r=")) {
          next();
          return;
        }

        const parsed = new URL(url, "http://localhost");
        const resolution = parseFloat(parsed.searchParams.get("r") || "");

        if (!resolution || resolution <= 0) {
          next();

          return;
        }

        const filePath = resolve(publicDir, `.${parsed.pathname}`);

        readFile(filePath, "utf-8", (err, svgContent) => {
          if (err) {
            next();
            return;
          }

          if (!svgContent.includes("__RESOLUTION__")) {
            next();
            return;
          }

          const strokeScale = (1 / resolution).toString();
          const replaced = svgContent.replace(/__RESOLUTION__/g, strokeScale);

          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.end(replaced);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    svgResolutionPlugin(),
    compressionPlugin(),
    babel({
      babelConfig: {
        plugins: [
          [
            "@babel/plugin-transform-typescript",
            { isTSX: false, allowDeclareFields: true },
          ],
          "@lingui/babel-plugin-lingui-macro",
        ],
      },
      filter: /\.messages\.ts$/,
    }) as never,
    svelte(),
    lingui(),
  ],
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
