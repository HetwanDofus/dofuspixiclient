#!/usr/bin/env bun
//
// Per-scene FFDec asset extractor.
//
// FFDec already exports every SWF character (sprite, shape, button, image)
// as its own standalone file in `assets/cache/ffdec/`. This script does
// nothing more than:
//
//   1. Walk the scene root's character graph, copying every reachable file
//      from the FFDec dump into `<out>/parts/` (sprites, shapes, buttons),
//      `<out>/bitmaps/` (images), and `<out>/scripts/` (AS3 source).
//   2. Build a `manifest.json` indexing every reachable character and every
//      named placement (`<use id="_xxx">`) in the scene's sprite tree, with
//      its char id, class name, slot dimensions, transform, parent sprite,
//      and the parsed `on(construct){…}` AS-init properties (best-effort
//      paired with the script file via document-order matching).
//
// There is NO SVG manipulation here. To visualise any named instance you
// look it up in `manifest.json`, find its character file in `parts/`, and
// (for runtime-composed elements like buttons / labels / inputs) follow the
// AS-init recipe — e.g. `backgroundUp = "ButtonNormalUp"` →
// `parts/31__ButtonNormalUp.svg`.

import * as fs from "node:fs";
import * as path from "node:path";

import { Command } from "commander";

import { parseActionscriptConstruct } from "../src/parse-actionscript.ts";
import type { SymbolInstanceProps } from "../src/types.ts";

const program = new Command();

type SymbolClass = Map<string, string>; // charId -> className

type CharacterRecord = {
  id: string;
  className?: string;
  kind: "sprite" | "shape" | "image" | "button" | "font" | "other";
  srcSvg?: string;
  srcImages?: string[];
  width?: number;
  height?: number;
  // For sprites, the original FFDec folder path (used to find AS scripts).
  spriteDir?: string;
};

type NamedInstance = {
  name: string;
  characterId: string;
  className?: string;
  parentSpriteId: string;
  parentClassName?: string;
  transform: string;
  width: number;
  height: number;
  // Resolved skin/template file in parts/ (or `full.svg` for the root).
  characterFile?: string;
  // Resolved AS-init properties (from matching on(construct).as).
  asInit?: SymbolInstanceProps;
  // If asInit.backgroundUp / Down points to an exported class, the resolved
  // skin file for convenience.
  resolvedSkins?: {
    up?: string;
    down?: string;
    disabled?: string;
  };
};

program
  .name("extract-all-pieces")
  .description("Index every FFDec-exported piece for a scene")
  .requiredOption("--scene <name>", "logical scene name")
  .requiredOption("--root <charId>", "root sprite character id")
  .requiredOption("--ffdec <dir>", "FFDec export root directory")
  .requiredOption("--out <dir>", "output bundle directory")
  .option("--bitmaps-fallback <dir>", "fallback FLA bitmaps directory")
  .action((opts) => {
    const sceneName: string = opts.scene;
    const rootId: string = String(opts.root);
    const ffdecDir = path.resolve(opts.ffdec);
    const outDir = path.resolve(opts.out);
    const bitmapsFallback = opts.bitmapsFallback
      ? path.resolve(opts.bitmapsFallback)
      : undefined;

    fs.mkdirSync(path.join(outDir, "parts"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "bitmaps"), { recursive: true });
    fs.mkdirSync(path.join(outDir, "scripts"), { recursive: true });

    const symbolClass = parseSymbolClass(
      path.join(ffdecDir, "symbolClass", "symbols.csv"),
    );
    const classToCharId = new Map<string, string>();
    for (const [id, cls] of symbolClass) classToCharId.set(cls, id);

    // ---- Phase 1 — walk every reachable character id from root, including
    //               skin sprites referenced by AS3 (backgroundUp/Down/etc).
    //               FLA controls (Button, Label, TextInput, …) don't reference
    //               their skins via <use> — only via the runtime AS init —
    //               so we must scan scripts to discover skin classes too.
    const characters = new Map<string, CharacterRecord>();
    const queue: string[] = [rootId];
    while (queue.length) {
      const id = queue.shift()!;
      if (characters.has(id)) continue;
      characters.set(
        id,
        locateCharacter(id, symbolClass, ffdecDir, bitmapsFallback),
      );
      const rec = characters.get(id);
      if (rec?.srcSvg) {
        for (const r of scanCharacterRefs(rec.srcSvg)) queue.push(r);
      }
      // For sprites with an AS scripts folder, parse every on(construct) and
      // enqueue every referenced class (backgroundUp/Down/Disabled, icon, …)
      // mapped back to its SWF char id.
      if (rec?.kind === "sprite" && rec.srcSvg) {
        const scriptsRoot = path.join(
          ffdecDir,
          "scripts",
          path.basename(path.dirname(rec.srcSvg)),
          "frame_1",
        );
        if (fs.existsSync(scriptsRoot)) {
          for (const entry of fs.readdirSync(scriptsRoot)) {
            const initFile = path.join(
              scriptsRoot,
              entry,
              "CLIPACTIONRECORD on(construct).as",
            );
            if (!fs.existsSync(initFile)) continue;
            const props = parseActionscriptConstruct(
              fs.readFileSync(initFile, "utf8"),
            );
            if (!props) continue;
            for (const key of [
              "backgroundUp",
              "backgroundDown",
              "backgroundDisabled",
              "icon",
              "buttonBackgroundUp",
              "buttonBackgroundDown",
              "buttonIcon",
              "cellRenderer",
              "background",
            ]) {
              const v = props[key];
              if (typeof v !== "string" || v === "") continue;
              const cid = classToCharId.get(v);
              if (cid) queue.push(cid);
            }
          }
        }
      }
    }

    // ---- Phase 2 — copy assets to parts/ / bitmaps/. Root sprite is
    //               additionally exposed at the top level as `full.svg`.
    const rootRecord = characters.get(rootId);
    if (!rootRecord?.srcSvg) {
      console.error(`Root sprite ${rootId} not found in FFDec export`);
      process.exit(1);
    }
    fs.copyFileSync(rootRecord.srcSvg, path.join(outDir, "full.svg"));

    for (const [id, rec] of characters) {
      const fileForChar = characterPartsFilename(rec, id === rootId);
      rec.spriteDir = rec.srcSvg ? path.dirname(rec.srcSvg) : undefined;
      if (id === rootId) continue; // already at full.svg
      if (rec.kind === "sprite" || rec.kind === "shape" || rec.kind === "button") {
        if (rec.srcSvg) {
          fs.copyFileSync(rec.srcSvg, path.join(outDir, fileForChar));
        }
      } else if (rec.kind === "image") {
        for (const src of rec.srcImages ?? []) {
          const base = path.basename(src);
          fs.copyFileSync(src, path.join(outDir, "bitmaps", base));
        }
      }
    }

    // ---- Phase 3 — copy AS3 scripts. Keep FFDec's tree, just rooted under
    //               <out>/scripts/<parent-folder>.
    let scriptsCopied = 0;
    for (const rec of characters.values()) {
      if (rec.kind !== "sprite" || !rec.spriteDir) continue;
      const scriptDir = path.join(
        ffdecDir,
        "scripts",
        path.basename(rec.spriteDir),
      );
      if (!fs.existsSync(scriptDir)) continue;
      scriptsCopied += copyAsDir(
        scriptDir,
        path.join(outDir, "scripts", path.basename(rec.spriteDir)),
      );
    }

    // ---- Phase 4 — index every named placement (<use id="_xxx">) across
    //               every sprite. Pair each with its AS init script via
    //               document-order matching within each char-id group.
    const namedInstances: NamedInstance[] = [];
    for (const rec of characters.values()) {
      if (rec.kind !== "sprite" || !rec.srcSvg) continue;
      const xml = fs.readFileSync(rec.srcSvg, "utf8");
      const asScripts = readAsScriptsForSprite(
        ffdecDir,
        rec.spriteDir!,
      );
      const indexed = indexUsesInSprite(xml);
      // Pair named placements with AS scripts ordered by depth.
      const asByChar = new Map<string, string[]>();
      for (const folder of asScripts) {
        const m = /^PlaceObject2_(\d+)_[^_]+_(\d+)$/.exec(folder.name);
        if (!m) continue;
        const charId = m[1];
        if (!asByChar.has(charId)) asByChar.set(charId, []);
        asByChar.get(charId)!.push(folder.path);
      }
      const usePosByChar = new Map<string, number>();
      for (const u of indexed) {
        const list = asByChar.get(u.characterId) ?? [];
        const idx = usePosByChar.get(u.characterId) ?? 0;
        usePosByChar.set(u.characterId, idx + 1);

        if (!u.name) continue; // only emit *named* placements into the index
        const asInit = list[idx] ? readAsInit(list[idx]) : undefined;

        const targetClass = symbolClass.get(u.characterId);
        const targetRec = characters.get(u.characterId);
        const targetFile = targetRec
          ? characterPartsFilename(targetRec, u.characterId === rootId)
          : undefined;

        const resolvedSkins: NamedInstance["resolvedSkins"] = {};
        const skin = (which: keyof SymbolInstanceProps): string | undefined => {
          const v = asInit?.[which];
          if (typeof v !== "string") return undefined;
          const cid = classToCharId.get(v);
          if (!cid) return undefined;
          const skinRec = characters.get(cid);
          if (!skinRec) return undefined;
          return characterPartsFilename(skinRec, cid === rootId);
        };
        const up = skin("backgroundUp");
        const dn = skin("backgroundDown");
        const dis = skin("backgroundDisabled");
        if (up) resolvedSkins.up = up;
        if (dn) resolvedSkins.down = dn;
        if (dis) resolvedSkins.disabled = dis;

        namedInstances.push({
          name: u.name,
          characterId: u.characterId,
          className: targetClass,
          parentSpriteId: rec.id,
          parentClassName: rec.className,
          transform: u.transform,
          width: u.width,
          height: u.height,
          characterFile: targetFile,
          asInit,
          resolvedSkins: Object.keys(resolvedSkins).length ? resolvedSkins : undefined,
        });
      }
    }

    // ---- Phase 5 — manifest + README.
    const manifest = {
      scene: sceneName,
      rootCharacterId: rootId,
      rootClassName: symbolClass.get(rootId),
      counts: {
        characters: characters.size,
        sprites: [...characters.values()].filter((c) => c.kind === "sprite").length,
        shapes: [...characters.values()].filter((c) => c.kind === "shape").length,
        images: [...characters.values()].filter((c) => c.kind === "image").length,
        buttons: [...characters.values()].filter((c) => c.kind === "button").length,
        namedInstances: namedInstances.length,
        scriptsCopied,
      },
      characters: [...characters.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, rec]) => ({
          id,
          className: rec.className,
          kind: rec.kind,
          width: rec.width,
          height: rec.height,
          file:
            rec.kind === "sprite" || rec.kind === "shape" || rec.kind === "button"
              ? characterPartsFilename(rec, id === rootId)
              : rec.kind === "image"
                ? `bitmaps/${path.basename((rec.srcImages ?? [""])[0])}`
                : undefined,
        })),
      namedInstances: namedInstances.sort((a, b) => a.name.localeCompare(b.name)),
    };

    fs.writeFileSync(
      path.join(outDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    fs.writeFileSync(path.join(outDir, "README.md"), renderReadme(manifest));

    console.log(
      `Wrote ${outDir}\n  characters=${manifest.counts.characters} (sprites=${manifest.counts.sprites}, shapes=${manifest.counts.shapes}, buttons=${manifest.counts.buttons}, images=${manifest.counts.images})\n  named instances=${manifest.counts.namedInstances}\n  scripts=${manifest.counts.scriptsCopied}`,
    );
  });

function parseSymbolClass(csvPath: string): SymbolClass {
  const out: SymbolClass = new Map();
  if (!fs.existsSync(csvPath)) return out;
  for (const line of fs.readFileSync(csvPath, "utf8").split(/\r?\n/)) {
    const m = /^(\d+);"([^"]+)"/.exec(line.trim());
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function locateCharacter(
  id: string,
  symbolClass: SymbolClass,
  ffdecDir: string,
  bitmapsFallback: string | undefined,
): CharacterRecord {
  const className = symbolClass.get(id);

  const spriteDir =
    findDirStartingWith(
      path.join(ffdecDir, "sprites"),
      `DefineSprite_${id}_`,
    ) ?? path.join(ffdecDir, "sprites", `DefineSprite_${id}`);
  if (fs.existsSync(spriteDir)) {
    const frameFile = path.join(spriteDir, "1.svg");
    if (fs.existsSync(frameFile)) {
      const dims = readSvgDims(frameFile);
      return {
        id,
        className,
        kind: "sprite",
        srcSvg: frameFile,
        width: dims.w,
        height: dims.h,
      };
    }
  }

  const buttonDir = path.join(ffdecDir, "sprites", `DefineButton2_${id}`);
  if (fs.existsSync(buttonDir)) {
    const frameFile = path.join(buttonDir, "1.svg");
    if (fs.existsSync(frameFile)) {
      const dims = readSvgDims(frameFile);
      return {
        id,
        className,
        kind: "button",
        srcSvg: frameFile,
        width: dims.w,
        height: dims.h,
      };
    }
  }

  const shapeFile = path.join(ffdecDir, "shapes", `${id}.svg`);
  if (fs.existsSync(shapeFile)) {
    const dims = readSvgDims(shapeFile);
    return {
      id,
      className,
      kind: "shape",
      srcSvg: shapeFile,
      width: dims.w,
      height: dims.h,
    };
  }

  const imgPng = path.join(ffdecDir, "images", `${id}.png`);
  const imgJpg = path.join(ffdecDir, "images", `${id}.jpg`);
  const imgAlpha = path.join(ffdecDir, "images", `${id}.alpha.png`);
  const found: string[] = [];
  if (fs.existsSync(imgPng)) found.push(imgPng);
  if (fs.existsSync(imgJpg)) found.push(imgJpg);
  if (fs.existsSync(imgAlpha)) found.push(imgAlpha);
  if (found.length === 0 && bitmapsFallback) {
    const fb = path.join(bitmapsFallback, `Bitmap ${id}.png`);
    if (fs.existsSync(fb)) found.push(fb);
  }
  if (found.length > 0) return { id, className, kind: "image", srcImages: found };

  return { id, className, kind: "other" };
}

function findDirStartingWith(base: string, prefix: string): string | null {
  if (!fs.existsSync(base)) return null;
  for (const entry of fs.readdirSync(base)) {
    if (entry.startsWith(prefix)) return path.join(base, entry);
  }
  return null;
}

const CHAR_ID_RE = /\bffdec:characterId="(\d+)"/g;

function scanCharacterRefs(svgFile: string): string[] {
  const out: string[] = [];
  const xml = fs.readFileSync(svgFile, "utf8");
  let m: RegExpExecArray | null;
  while ((m = CHAR_ID_RE.exec(xml)) !== null) out.push(m[1]);
  return out;
}

// Read AS-script subfolders for a sprite, sorted by the placement-depth
// suffix `_N` ascending — that matches the order PlaceObject2 tags were
// emitted into the SWF, which in turn matches FFDec's <use> document order.
function readAsScriptsForSprite(
  ffdecDir: string,
  spriteDir: string,
): { name: string; path: string }[] {
  const root = path.join(
    ffdecDir,
    "scripts",
    path.basename(spriteDir),
    "frame_1",
  );
  if (!fs.existsSync(root)) return [];
  const entries: { name: string; path: string }[] = [];
  for (const entry of fs.readdirSync(root)) {
    const full = path.join(root, entry);
    if (fs.statSync(full).isDirectory()) {
      entries.push({ name: entry, path: full });
    }
  }
  entries.sort((a, b) => {
    const ai = Number(a.name.match(/_(\d+)$/)?.[1] ?? 0);
    const bi = Number(b.name.match(/_(\d+)$/)?.[1] ?? 0);
    return ai - bi;
  });
  return entries;
}

type IndexedUse = {
  characterId: string;
  name?: string;
  transform: string;
  width: number;
  height: number;
};

function indexUsesInSprite(xml: string): IndexedUse[] {
  // Only top-level <use> elements (not inside <defs>) participate in the
  // PlaceObject ordering. Cut everything from `<defs>` onward.
  const cutAt = xml.indexOf("<defs>");
  const scope = cutAt === -1 ? xml : xml.slice(0, cutAt);
  const out: IndexedUse[] = [];
  const useRe = /<use\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(scope)) !== null) {
    const tag = m[0];
    const cid = /ffdec:characterId="(\d+)"/.exec(tag);
    if (!cid) continue;
    const id = /\bid="([^"]+)"/.exec(tag);
    const tr = /\btransform="([^"]+)"/.exec(tag);
    const w = /\bwidth="([\d.]+)"/.exec(tag);
    const h = /\bheight="([\d.]+)"/.exec(tag);
    out.push({
      characterId: cid[1],
      name: id?.[1],
      transform: tr?.[1] ?? "matrix(1, 0, 0, 1, 0, 0)",
      width: w ? Number(w[1]) : 0,
      height: h ? Number(h[1]) : 0,
    });
  }
  return out;
}

function readAsInit(folder: string): SymbolInstanceProps | undefined {
  const file = path.join(folder, "CLIPACTIONRECORD on(construct).as");
  if (!fs.existsSync(file)) return undefined;
  return parseActionscriptConstruct(fs.readFileSync(file, "utf8"));
}

function characterPartsFilename(rec: CharacterRecord, isRoot: boolean): string {
  if (rec.kind === "image") {
    return `bitmaps/${path.basename((rec.srcImages ?? [""])[0])}`;
  }
  if (isRoot) return "full.svg";
  const base = rec.className
    ? `${rec.id}__${sanitize(rec.className)}`
    : rec.id;
  return `parts/${base}.svg`;
}

function copyAsDir(src: string, dst: string): number {
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  const walk = (rel: string) => {
    const abs = path.join(src, rel);
    for (const entry of fs.readdirSync(abs)) {
      const stat = fs.statSync(path.join(abs, entry));
      if (stat.isDirectory()) walk(path.join(rel, entry));
      else if (entry.endsWith(".as")) {
        const target = path.join(dst, rel, entry);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(abs, entry), target);
        count++;
      }
    }
  };
  walk("");
  return count;
}

function readSvgDims(file: string): { w?: number; h?: number } {
  try {
    const head = fs.readFileSync(file, "utf8").slice(0, 2000);
    const w = /\bwidth="([\d.]+)px?/.exec(head)?.[1];
    const h = /\bheight="([\d.]+)px?/.exec(head)?.[1];
    return {
      w: w !== undefined ? Number(w) : undefined,
      h: h !== undefined ? Number(h) : undefined,
    };
  } catch {
    return {};
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

type ManifestForReadme = {
  scene: string;
  rootCharacterId: string;
  rootClassName?: string;
  counts: Record<string, number>;
  characters: {
    id: string;
    className?: string;
    kind: string;
    file?: string;
    width?: number;
    height?: number;
  }[];
  namedInstances: NamedInstance[];
};

function renderReadme(m: ManifestForReadme): string {
  return [
    `# ${m.rootClassName ?? m.scene}`,
    "",
    `Scene assets extracted from JPEXS Free Flash Decompiler (FFDec) export`,
    `of \`assets/sources/core.swf\`. Root sprite: SWF char #${m.rootCharacterId}.`,
    "",
    `**Counts:** ${JSON.stringify(m.counts)}`,
    "",
    "## Layout",
    "",
    "- `full.svg` — root sprite 1:1 from FFDec.",
    "- `parts/<id>[__<className>].svg` — every reachable child sprite, shape,",
    "  or button as its own self-contained FFDec SVG (filename = SWF char id +",
    "  optional AS-export class).",
    "- `bitmaps/<file>` — every reachable raster image (FFDec PNG/JPEG output).",
    "- `scripts/<DefineSprite_…>/frame_1/PlaceObject2_<char>_<class>_<idx>/",
    "  CLIPACTIONRECORD on(construct).as` — every per-placement AS init script,",
    "  as FFDec emits them.",
    "- `manifest.json` — the only thing this tool actually generates: the index",
    "  that lets you find any named instance's character, slot, AS init, and",
    "  (where applicable) the resolved skin file. **No bespoke SVG slicing.**",
    "",
    "## How to use `manifest.json`",
    "",
    "Each entry in `namedInstances[]` looks like:",
    "",
    "```json",
    "{",
    '  "name": "_btnBackToNews",',
    '  "characterId": "45",',
    '  "className": "Button",',
    '  "parentSpriteId": "579",',
    '  "parentClassName": "UI_Login",',
    '  "transform": "matrix(1.3093, 0.0, 0.0, 1.0, 346.0, 377.0)",',
    '  "width": 147,',
    '  "height": 80.5,',
    '  "characterFile": "parts/45__Button.svg",',
    '  "asInit": {',
    '    "backgroundUp": "ButtonNormalUp",',
    '    "backgroundDown": "ButtonNormalDown",',
    '    "enabled": true,',
    '    "label": "Back to news",',
    '    "styleName": "OrangeButton"',
    '  },',
    '  "resolvedSkins": {',
    '    "up": "parts/31__ButtonNormalUp.svg",',
    '    "down": "parts/27__ButtonNormalDown.svg"',
    '  }',
    "}",
    "```",
    "",
    "- `characterFile` is what FFDec rendered for the underlying SWF character",
    "  (usually a template — a transparent hit-area for buttons/labels/inputs).",
    "- `resolvedSkins` is the actual visible skin sprite for buttons (and any",
    "  other element whose `backgroundUp/Down/Disabled` AS3 property maps to",
    "  an AS-exported class). For runtime visuals, **use `resolvedSkins`, not",
    "  `characterFile`**.",
    "- `transform` is the FLA placement's matrix in scene-local coordinates;",
    "  multiply by `parentSpriteId`'s placement transform if you compose into",
    "  a parent scene.",
    "",
    "## Why is `parts/45__Button.svg` mostly empty?",
    "",
    "FLA controls (Button, Label, TextInput, TextArea, ComboBox, DataGrid,",
    "ColorPicker, …) are *templates*: their design-time content is a single",
    "transparent magenta hit-area (`fill=\"#ff00ff\" fill-opacity=\"0\"`). The",
    "visible appearance is composed at runtime by AS3:",
    "",
    "- Buttons: skin sprite from `backgroundUp` / `backgroundDown` /",
    "  `backgroundDisabled` (`resolvedSkins` in the manifest).",
    "- Labels: text from `text`, formatted by the stylesheet entry named in",
    "  `styleName` (font, size, color, alignment).",
    "- Inputs: empty styled box per `styleName`; behaviour from `restrict`,",
    "  `maxChars`, `multiline`, `html`, `wordWrap`.",
    "",
    "To reproduce a button's runtime appearance you compose:",
    "",
    "1. `manifest.json#namedInstances[name]` for the slot (transform, w/h).",
    "2. `resolvedSkins.up` for the visible orange-pill 9-slice SVG.",
    "3. `asInit.label` + `asInit.styleName` for the centred text.",
    "",
    "## Re-running",
    "",
    "```",
    "bun tools/fla-scene-extractor/scripts/extract-all-pieces.ts \\",
    `  --scene ${m.scene} --root ${m.rootCharacterId} \\`,
    "  --ffdec assets/cache/ffdec \\",
    "  --bitmaps-fallback assets/sources/fla/LIBRARY \\",
    `  --out assets/scenes-source/${m.scene}`,
    "```",
    "",
  ].join("\n");
}

program.parseAsync(process.argv);
