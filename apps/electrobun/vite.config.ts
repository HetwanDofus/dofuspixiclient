import { readFile, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { lingui } from "@lingui/vite-plugin";
import react from "@vitejs/plugin-react";
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

/**
 * Vite plugin that composes character spritesheets on-the-fly.
 *
 * When a sprite atlas SVG is requested with a `look` query parameter,
 * the middleware:
 * 1. Reads the atlas SVG (which has __ACC_SLOT__ and __COLOR_STYLE__ placeholders)
 * 2. Injects accessory SVG content at the correct depth positions
 * 3. Injects CSS color variables for player color zones
 * 4. Replaces __RESOLUTION__ placeholders
 * 5. Caches the result by look+resolution key
 */
function svgCompositionPlugin(): Plugin {
  const publicDir = resolve(__dirname, "public");
  // Always cache composed results — keyed by pathname+look+resolution so
  // different looks produce different entries. Safe even during dev because
  // the look string fully determines the output.
  const composedCache = new Map<string, string>();

  // Direction suffix from the animation name (last char: R/L/F/B/S)
  function getDirection(animName: string): string {
    const last = animName.slice(-1);
    return "RLFBS".includes(last) ? last : "S";
  }

  // Load and cache metadata.json for a sprite (permanent — static data)
  const metadataCache = new Map<string, Record<string, unknown> | null>();
  function loadMetadata(gfxId: string): Record<string, unknown> | null {
    if (metadataCache.has(gfxId)) return metadataCache.get(gfxId)!;
    const metaPath = join(publicDir, "assets", "spritesheets", "sprites", gfxId, "metadata.json");
    try {
      if (!existsSync(metaPath)) { metadataCache.set(gfxId, null); return null; }
      const data = JSON.parse(readFileSync(metaPath, "utf-8"));
      metadataCache.set(gfxId, data);
      return data;
    } catch {
      metadataCache.set(gfxId, null);
      return null;
    }
  }

  // Direction fallback chain: if requested direction doesn't exist, try alternatives
  const DIRECTION_FALLBACKS: Record<string, string[]> = {
    S: ["R", "F"],
    R: ["S", "F"],
    L: ["S", "F"],
    F: ["S", "R"],
    B: ["S", "L"],
  };

  // Accessory SVG cache — permanent, keyed by "symbolName/direction"
  const accSvgCache = new Map<string, { svg: string; offsetX: number; offsetY: number } | null>();

  function loadAccessorySvg(symbolName: string, direction: string): { svg: string; offsetX: number; offsetY: number } | null {
    const dirs = [direction, ...(DIRECTION_FALLBACKS[direction] ?? [])];
    for (const dir of dirs) {
      const key = `${symbolName}/${dir}`;
      if (accSvgCache.has(key)) {
        const cached = accSvgCache.get(key);
        if (cached) return { ...cached }; // clone so callers can mutate .svg
        continue; // null = not found, try next fallback
      }
      const result = tryLoadAccessorySvg(symbolName, dir);
      accSvgCache.set(key, result);
      if (result) return { ...result };
    }
    return null;
  }

  function tryLoadAccessorySvg(symbolName: string, direction: string): { svg: string; offsetX: number; offsetY: number } | null {
    const accDir = join(publicDir, "assets", "spritesheets", "accessories", symbolName, direction);
    const atlasPath = join(accDir, "atlas.json");
    try {
      if (!existsSync(atlasPath)) return null;
      const atlas = JSON.parse(readFileSync(atlasPath, "utf-8"));
      const frame = atlas.frames?.[0];
      if (!frame?.file) return null;
      const svgPath = join(accDir, frame.file);
      if (!existsSync(svgPath)) return null;
      let svg = readFileSync(svgPath, "utf-8");
      svg = svg.replace(/<\?xml[^>]*\?>/, "");
      return {
        svg,
        offsetX: frame.offsetX ?? 0,
        offsetY: frame.offsetY ?? 0,
      };
    } catch {
      return null;
    }
  }

  // Base SVG file cache — avoids re-reading atlas SVGs from disk
  const baseSvgCache = new Map<string, string>();

  // Color replacement map cache — keyed by "gfxId:c1:c2:c3"
  const colorReplacementCache = new Map<string, Map<string, string>>();

  // Parse look string: "gfxId|color1|color2|color3|acc1,acc2,acc3,acc4,acc5"
  function parseLook(look: string) {
    const parts = look.split("|");
    const gfxId = parts[0] || "0";
    const colors = [
      parts[1] ? parseInt(parts[1], 10) : -1,
      parts[2] ? parseInt(parts[2], 10) : -1,
      parts[3] ? parseInt(parts[3], 10) : -1,
    ];
    const accessories: Array<{ type: number; gfxId: number } | null> = [];
    if (parts[4]) {
      for (const acc of parts[4].split(",")) {
        if (!acc) { accessories.push(null); continue; }
        const [t, g] = acc.split("_");
        accessories.push({ type: parseInt(t, 10) || 0, gfxId: parseInt(g, 10) || 0 });
      }
    }
    return { gfxId, colors, accessories };
  }

  // Accessory slot mapping: index in accessories array → slot number
  const SLOT_MAP = [0, 1, 2, 3, 4]; // [weapon, hat, cape, pet, shield]

  // --- Color replacement helpers ---

  function hexToHsl(hex: string): [number, number, number] {
    const h6 = hex.replace("#", "");
    const r = parseInt(h6.substring(0, 2), 16) / 255;
    const g = parseInt(h6.substring(2, 4), 16) / 255;
    const b = parseInt(h6.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let hue = 0;
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
    return [hue, s, l];
  }

  function hslToHex(h: number, s: number, l: number): string {
    if (s === 0) {
      const v = Math.round(l * 255);
      return `#${v.toString(16).padStart(2, "0").repeat(3)}`;
    }
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  /** Normalize hex: expand 3-char to 6-char, lowercase */
  function normHex(hex: string): string {
    let h = hex.replace("#", "").toLowerCase();
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return `#${h}`;
  }

  /**
   * Build a fill replacement map for color zones.
   * For each zone color, compute a new color that keeps the original lightness
   * but uses the player color's hue and saturation.
   * Shared colors are assigned to the first zone that claims them.
   */
  function buildColorReplacements(
    colorZones: Record<string, string[]>,
    colorMapping: Record<string, number>,
    playerColors: number[]
  ): Map<string, string> {
    const replacements = new Map<string, string>();
    const claimed = new Set<string>(); // colors already assigned to a zone

    // Process zones in order — first zone claims shared colors
    const zoneKeys = Object.keys(colorZones).sort();
    for (const zone of zoneKeys) {
      const colors = colorZones[zone];
      const playerIdx = colorMapping[zone];
      if (playerIdx == null) continue;
      const playerColor = playerColors[playerIdx - 1];
      if (playerColor == null || playerColor < 0) continue;
      const playerHex = `#${playerColor.toString(16).padStart(6, "0")}`;
      const [targetH, targetS] = hexToHsl(playerHex);

      for (const origHex of colors) {
        const nc = normHex(origHex);
        if (claimed.has(nc)) continue; // already assigned to an earlier zone
        claimed.add(nc);
        const [, , origL] = hexToHsl(nc);
        const newHex = hslToHex(targetH, targetS, origL);
        replacements.set(nc, newHex);
      }
    }
    return replacements;
  }

  // Cache manifest reads (permanent — static data)
  const manifestCache = new Map<string, Record<string, unknown> | null>();
  function loadManifest(gfxId: string): Record<string, unknown> | null {
    if (manifestCache.has(gfxId)) return manifestCache.get(gfxId)!;
    const p = join(publicDir, "assets", "spritesheets", "sprites", gfxId, "manifest.json");
    try {
      if (!existsSync(p)) { manifestCache.set(gfxId, null); return null; }
      const data = JSON.parse(readFileSync(p, "utf-8"));
      manifestCache.set(gfxId, data);
      return data;
    } catch {
      manifestCache.set(gfxId, null);
      return null;
    }
  }

  function composeAccessory(accData: { svg: string; offsetX: number; offsetY: number }, slot: number, tx: string, ty: string, matrixStr: string | undefined): string {
    // Namespace ids
    const prefix = `acc${slot}_`;
    let svg = accData.svg
      .replace(/id="([^"]*)"/g, `id="${prefix}$1"`)
      .replace(/href="#([^"]*)"/g, `href="#${prefix}$1"`)
      .replace(/url\(#([^)]*)\)/g, `url(#${prefix}$1)`);

    if (matrixStr) {
      const [a, b, c, d, mtx, mty] = matrixStr.split(",").map(Number);
      const scaleTransform = (a === 1 && b === 0 && c === 0 && d === 1)
        ? ""
        : ` transform="matrix(${a},${b},${c},${d},0,0)"`;
      const posX = mtx + accData.offsetX;
      const posY = mty + accData.offsetY;
      svg = svg.replace(/<svg\b/, `<svg x="${posX}" y="${posY}" overflow="visible"`);
      if (scaleTransform) {
        const pivotX = -accData.offsetX;
        const pivotY = -accData.offsetY;
        svg = svg.replace(
          /(<svg[^>]*>)/,
          `$1<g transform="translate(${pivotX},${pivotY})"><g${scaleTransform}><g transform="translate(${-pivotX},${-pivotY})">`
        ).replace(/<\/svg>\s*$/, "</g></g></g></svg>");
      }
      return svg;
    }
    const posX = parseFloat(tx) + accData.offsetX;
    const posY = parseFloat(ty) + accData.offsetY;
    return svg.replace(/<svg\b/, `<svg x="${posX}" y="${posY}" overflow="visible"`);
  }

  return {
    name: "vite-plugin-svg-composition",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.includes(".svg") || !url.includes("look=")) {
          next();
          return;
        }

        const parsed = new URL(url, "http://localhost");
        const look = parsed.searchParams.get("look");
        const resolution = parseFloat(parsed.searchParams.get("r") || "2");
        if (!look) { next(); return; }

        const cacheKey = `${parsed.pathname}:${look}:${resolution}`;
        const cached = composedCache.get(cacheKey);
        if (cached) {
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.end(cached);
          return;
        }

        // Read base SVG (cached after first read)
        const filePath = resolve(publicDir, `.${parsed.pathname}`);
        let svgContent = baseSvgCache.get(filePath);
        if (!svgContent) {
          try {
            svgContent = readFileSync(filePath, "utf-8");
            baseSvgCache.set(filePath, svgContent);
          } catch {
            next();
            return;
          }
        }

        if (!svgContent.includes("data-acc-slot") && !svgContent.includes("__COLOR_STYLE__")) {
          next();
          return;
        }

        const lookData = parseLook(look);
        let composed = svgContent;

        const pathParts = parsed.pathname.split("/");
        const animIdx = pathParts.indexOf("sprites");
        const animName = animIdx >= 0 ? pathParts[animIdx + 2] : "";
        const direction = getDirection(animName);

        // 1. Replace accessory placeholders
        composed = composed.replace(
          /<rect[^>]*?data-acc-slot="(\d+)"[^>]*?data-tx="([^"]*)"[^>]*?data-ty="([^"]*)"[^>]*?data-depth="[^"]*"(?:\s+data-matrix="([^"]*)")?[^>]*?\/>/g,
          (_match, slotStr, tx, ty, matrixStr) => {
            const slot = parseInt(slotStr, 10);
            const accIdx = SLOT_MAP.indexOf(slot);
            const acc = accIdx >= 0 ? lookData.accessories[accIdx] : null;
            if (!acc || !acc.type || !acc.gfxId) return "";
            const accData = loadAccessorySvg(`${acc.type}_${acc.gfxId}`, direction);
            if (!accData) return "";
            return composeAccessory(accData, slot, tx, ty, matrixStr);
          }
        );

        // 2. Replace fill colors per color zone
        const metadata = loadMetadata(lookData.gfxId);
        if (metadata) {
          const colorMapping = (metadata as { colorMapping?: Record<string, number> }).colorMapping ?? {};
          const colorZones = (metadata as { colorZones?: Record<string, string[]> }).colorZones ?? {};

          // Cache color replacement map per gfx+colors combo
          const colorKey = `${lookData.gfxId}:${lookData.colors.join(":")}`;
          let replacements = colorReplacementCache.get(colorKey);
          if (!replacements) {
            replacements = buildColorReplacements(colorZones, colorMapping, lookData.colors);
            colorReplacementCache.set(colorKey, replacements);
          }

          if (replacements.size > 0) {
            composed = composed.replace(
              /fill="(#[0-9a-fA-F]{3,6})"/g,
              (match, hex) => {
                const nc = normHex(hex);
                const replacement = replacements!.get(nc);
                return replacement ? `fill="${replacement}"` : match;
              }
            );
          }
        }

        // Hair toggle
        const cssRules: string[] = [];
        const manifest = loadManifest(lookData.gfxId);
        if (manifest && (manifest as { hairToggle?: { triggerSlot: number; cssClass: string } }).hairToggle) {
          const ht = (manifest as { hairToggle: { triggerSlot: number; cssClass: string } }).hairToggle;
          const hatIdx = SLOT_MAP.indexOf(ht.triggerSlot);
          if (hatIdx >= 0 && lookData.accessories[hatIdx]?.type) {
            cssRules.push(`.${ht.cssClass}{display:none}`);
          }
        }
        if (cssRules.length > 0) {
          composed = composed.replace(/\/\* __COLOR_STYLE__ \*\//, cssRules.join(""));
        }

        // 3. Replace __RESOLUTION__ placeholders
        if (resolution > 0) {
          composed = composed.replace(/__RESOLUTION__/g, (1 / resolution).toString());
        }

        // Cache the result (LRU eviction at 5000 entries)
        composedCache.set(cacheKey, composed);
        if (composedCache.size > 5000) {
          const firstKey = composedCache.keys().next().value;
          if (firstKey) composedCache.delete(firstKey);
        }

        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(composed);
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    svgCompositionPlugin(),
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
  root: "src/mainview",
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src/lib"),
      "vello-wasm": resolve(__dirname, "../../../dofus-vello-custom-format/packages/vello-wasm/pkg"),
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
      // Allow serving files from the vello-wasm pkg directory (outside project root)
      allow: [
        resolve(__dirname, ".."),
        resolve(__dirname, "../../../dofus-vello-custom-format/packages/vello-wasm/pkg"),
      ],
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
