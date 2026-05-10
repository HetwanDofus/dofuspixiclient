import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
import compression from "compression";
import { defineConfig } from "vite";
import babel from "vite-plugin-babel";

const __dirname = import.meta.dirname;

/**
 * Serves raw SWF files from `assets/sources/clips/` under the `/swf/...` URL.
 * Replaces the dofasset bake — the frontend fetches SWFs and parses them via
 * the swf-spike WASM at runtime.
 *
 * Production: serve `/swf/*` from a copy of `assets/sources/clips/` (same
 * paths) via the CDN/static host. No build-time copy here; the dev plugin
 * does not run in production.
 */
function swfPlugin(): Plugin {
  const sourceRoot = resolve(__dirname, "../../assets/sources/clips");

  return {
    name: "vite-plugin-swf",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/swf/")) {
          next();
          return;
        }

        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
        } catch {
          res.statusCode = 400;
          res.end();
          return;
        }

        if (pathname.includes("..")) {
          res.statusCode = 400;
          res.end();
          return;
        }

        const relPath = pathname.slice("/swf/".length);
        const filePath = resolve(sourceRoot, relPath);
        if (!filePath.startsWith(sourceRoot + "/") && filePath !== sourceRoot) {
          res.statusCode = 403;
          res.end();
          return;
        }

        stat(filePath).then(
          (s) => {
            if (!s.isFile()) {
              next();
              return;
            }
            res.setHeader("Content-Type", "application/x-shockwave-flash");
            res.setHeader("Content-Length", String(s.size));
            res.setHeader(
              "Cache-Control",
              "public, max-age=31536000, immutable"
            );
            createReadStream(filePath).pipe(res);
          },
          () => {
            next();
          }
        );
      });
    },
  };
}

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


export default defineConfig({
  plugins: [
    tailwindcss(),
    swfPlugin(),
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
    react({
      babel: {
        plugins: [
          "@lingui/babel-plugin-lingui-macro",
        ],
      },
      // Exclude ECS files that use TypeScript decorators + declare fields
      // — they don't contain JSX and would break Babel's class transform
      exclude: [/\/ecs\//, /\.messages\.ts$/],
    }),
    lingui(),
  ],
  root: "src/window/mainview",
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "vello-wasm": resolve(__dirname, "../../packages/vello-wasm/pkg"),
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
    fs: {
      // Allow serving files from the in-repo vello-wasm pkg directory.
      allow: [resolve(__dirname, "../..")],
    },
  },
  optimizeDeps: {
    exclude: ["brotli-dec-wasm", "vello-wasm"],
  },
  assetsInclude: ["**/*.wasm", "**/*.dofasset"],
  worker: {
    format: "es",
  },
});
