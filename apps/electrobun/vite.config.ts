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
 * Serves raw SWF files under the `/swf/...` URL. The frontend fetches SWFs
 * and parses them via the swf-spike WASM at runtime (no dofasset bake).
 *
 * Lookup order — first hit wins:
 *   1. `assets/sources/clips/<rel>` — gfx, sprites, items, maps, artworks
 *      (the bulk of asset SWFs, organized in subdirs).
 *   2. `assets/sources/<rel>` — top-level SWFs that aren't under clips/
 *      (e.g. `/swf/core.swf` → `assets/sources/core.swf`). core.swf holds
 *      the banner views (Clock, Compass, Helper, MiniMap, UI_Banner*).
 *
 * Production: mirror both roots into a single `/swf/<rel>` tree on the
 * static host. The dev plugin doesn't run in production.
 */
function swfPlugin(): Plugin {
  const clipsRoot = resolve(__dirname, "../../assets/sources/clips");
  const sourcesRoot = resolve(__dirname, "../../assets/sources");
  const roots = [clipsRoot, sourcesRoot];

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

        const tryNext = (idx: number) => {
          if (idx >= roots.length) {
            next();
            return;
          }
          const root = roots[idx];
          const filePath = resolve(root, relPath);
          if (!filePath.startsWith(root + "/") && filePath !== root) {
            tryNext(idx + 1);
            return;
          }
          stat(filePath).then(
            (s) => {
              if (!s.isFile()) {
                tryNext(idx + 1);
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
              tryNext(idx + 1);
            }
          );
        };

        tryNext(0);
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
      // — they don't contain JSX and would break Babel's class transform.
      // Also exclude `@dofus/dofus1-net` (also decorator-heavy) — the
      // package is consumed as raw TS via the workspace symlink and
      // doesn't need React's transform.
      exclude: [
        /\/ecs\//,
        /\.messages\.ts$/,
        /\/packages\/dofus1-net\//,
      ],
    }),
    lingui(),
  ],
  root: "src/window/mainview",
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "vello-wasm": resolve(__dirname, "../../rust/vello-wasm/pkg"),
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
