#!/usr/bin/env bun

/**
 * Generate TypeScript spell implementations using the Claude API.
 *
 * Reads spell ActionScript from output/spell-anims/{id}/scripts/,
 * sends it to Claude with the full implementation guide as cached context,
 * extracts the TypeScript code block from the response, validates it,
 * and writes it to test-player/src/spells/spell-{id}.ts.
 *
 * Usage:
 *   bun generate-spells.ts [options]
 *
 *   --spell <id>        Generate only this spell
 *   --dry-run           List spells that need generation, don't call API
 *   --skip-existing     Skip spells with existing implementation files
 *   --concurrency <n>   Parallel API calls (default: 4)
 *   --model <name>      Model ID (default: claude-sonnet-4-6, or ANTHROPIC_MODEL env)
 *   --verbose           Show detailed progress
 */

import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, exists, write } from 'fs/promises';
import { join, resolve } from 'path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TOOL_DIR = resolve(import.meta.dirname!);
const REPO_ROOT = resolve(TOOL_DIR, '../..');
const SPELL_ANIMS_DIR = join(TOOL_DIR, 'output/spell-anims');
// svg-spritesheet output: per-animation atlas.json files carry the
// content-hash dedup result (frameOrder + duplicates + unique frames[]).
// The AI MUST consult these to compute the right SymbolDefinition.totalFrames
// — see "Deduplicated frame count" in the prompt.
const SPELL_ATLAS_DIR = join(REPO_ROOT, 'assets/spritesheets/spells');
// Runtime path — the Vite glob in spell-module-loader.ts loads from here.
const SPELLS_OUT_DIR = join(REPO_ROOT, 'apps/electrobun/src/game/spells');
const GUIDE_PATH = join(TOOL_DIR, 'test-player/src/spells/CLAUDE.md');
const RUNTIME_PKG = join(REPO_ROOT, 'packages/spell-runtime/src');
const INTERFACE_PATH = join(RUNTIME_PKG, 'spell-interface.ts');
// Clip-runtime sources — the actual API the LLM must target.
const CLIP_TYPES_PATH = join(RUNTIME_PKG, 'clip/types.ts');
const CLIP_PATH = join(RUNTIME_PKG, 'clip/clip.ts');
const RUNTIME_PATH = join(RUNTIME_PKG, 'clip/runtime.ts');
const RUNTIME_SPELL_PATH = join(RUNTIME_PKG, 'clip/runtime-spell.ts');
const HARNESS_PATH = join(RUNTIME_PKG, 'clip/harness.ts');
const SYMBOL_REGISTRY_PATH = join(RUNTIME_PKG, 'clip/symbol-registry.ts');
const SPRITE_CONFIG_PATH = join(RUNTIME_PKG, 'sprite-config.ts');
// Hand-perfected reference implementations (NEVER overwritten).
const REF_103_PATH = join(SPELLS_OUT_DIR, 'spell-103.ts');
const REF_909_PATH = join(SPELLS_OUT_DIR, 'spell-909.ts');

/**
 * JSON registry of hand-perfected spell IDs. The generator skips these
 * and a sibling `notes` map documents WHY each one is protected. Edit
 * the file directly to lock additional spell-<id>.ts modules from
 * AI overwrite — do NOT add IDs here in code.
 */
const PROTECTED_SPELLS_JSON = join(TOOL_DIR, 'protected-spells.json');

interface ProtectedSpellsRegistry {
  ids: number[];
  notes?: Record<string, string>;
}

async function loadProtectedSpellIds(): Promise<Set<number>> {
  if (!(await exists(PROTECTED_SPELLS_JSON))) {
    console.warn(
      `[generate-spells] ${PROTECTED_SPELLS_JSON} missing — no spells will be protected from overwrite`,
    );
    return new Set();
  }
  try {
    const raw = await readText(PROTECTED_SPELLS_JSON);
    const parsed = JSON.parse(raw) as ProtectedSpellsRegistry;
    if (!Array.isArray(parsed.ids)) {
      throw new Error('`ids` must be an array of numeric spell IDs');
    }
    const set = new Set<number>();
    for (const id of parsed.ids) {
      if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
        throw new Error(`invalid spell id ${id} in protected-spells.json`);
      }
      set.add(id);
    }
    return set;
  } catch (err) {
    throw new Error(
      `[generate-spells] failed to read ${PROTECTED_SPELLS_JSON}: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpellInfo {
  id: number;
  manifestPath: string;
  scriptsDir: string;
  hasExisting: boolean;
}

interface GenerateResult {
  spellId: number;
  success: boolean;
  error?: string;
  durationMs: number;
  retries: number;
}

interface Options {
  spellId?: number;
  dryRun: boolean;
  skipExisting: boolean;
  concurrency: number;
  model: string;
  verbose: boolean;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = {
    dryRun: false,
    skipExisting: false,
    concurrency: 4,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--spell':
        opts.spellId = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--skip-existing':
        opts.skipExisting = true;
        break;
      case '--concurrency':
        opts.concurrency = parseInt(args[++i], 10);
        break;
      case '--model':
        opts.model = args[++i];
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--help':
        console.log(`Usage: bun generate-spells.ts [options]

  --spell <id>        Generate only this spell
  --dry-run           List spells that need generation, don't call API
  --skip-existing     Skip spells with existing implementation files
  --concurrency <n>   Parallel API calls (default: 4)
  --model <name>      Model ID (default: claude-sonnet-4-6, or ANTHROPIC_MODEL env)
  --verbose           Show detailed progress`);
        process.exit(0);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function readText(path: string): Promise<string> {
  return Bun.file(path).text();
}

/** Recursively collect all .as files under a directory */
async function collectASFiles(dir: string): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.as')) {
        const content = await readText(full);
        // Store relative path from scripts dir for readability
        const rel = full.slice(dir.length + 1);
        results.push({ path: rel, content });
      }
    }
  }

  if (await exists(dir)) {
    await walk(dir);
  }
  return results;
}

/**
 * Per-animation atlas summary read from the svg-spritesheet output.
 *
 * The svg-spritesheet runs content-hash dedup over all logical frames of an
 * animation: identical frames (post-`_parent.removeMovieClip()` placeholders,
 * "still" sections of the timeline, etc.) collapse into a single unique
 * cell in the atlas. The runtime's vello renderer rasterises ONE GPU cell
 * per unique frame and the JS-side texture array is built off that — it
 * does NOT have a logical→cell mapping, so a SymbolDefinition that
 * declares `totalFrames = <logical count>` will tick the playhead past
 * the last unique cell and the texture lookup wraps back into frame 0
 * ("the animation restarts at frame 1 after the end" symptom).
 *
 * This summary surfaces the dedup result so the prompt can tell the AI
 * to use the LAST unique logical frame index + 1 as `totalFrames`, and
 * to remap the canonical `_parent.removeMovieClip()` script frame to the
 * matching unique-cell frame.
 *
 * Layout:
 *   assets/spritesheets/spells/<id>/atlas.json                (single-anim)
 *   assets/spritesheets/spells/<id>/<animName>/atlas.json     (multi-anim)
 */
interface AnimAtlasSummary {
  animation: string;
  logicalFrameCount: number;
  uniqueFrameCount: number;
  /** Last logical frame index that has a unique cell (highest non-deduped). */
  lastUniqueLogicalIndex: number;
  /** Map of dedup'd logical frame id → canonical id (truncated to 8 entries for prompt brevity). */
  duplicatesPreview: Record<string, string>;
  duplicatesTotal: number;
}

async function collectAtlasSummaries(spellId: number): Promise<AnimAtlasSummary[]> {
  const root = join(SPELL_ATLAS_DIR, String(spellId));
  if (!(await exists(root))) {
    return [];
  }

  const summaries: AnimAtlasSummary[] = [];

  // Single-anim layout: <id>/atlas.json
  const flatPath = join(root, 'atlas.json');
  if (await exists(flatPath)) {
    const summary = await readAtlasJson(flatPath);
    if (summary) summaries.push(summary);
    return summaries;
  }

  // Multi-anim layout: <id>/<animName>/atlas.json
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, 'atlas.json');
    if (!(await exists(path))) continue;
    const summary = await readAtlasJson(path, entry.name);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

async function readAtlasJson(
  path: string,
  fallbackName?: string,
): Promise<AnimAtlasSummary | null> {
  try {
    const raw = await readText(path);
    const json = JSON.parse(raw) as {
      animation?: string;
      frames?: { id: string }[];
      frameOrder?: string[];
      duplicates?: Record<string, string>;
    };
    const animation = json.animation ?? fallbackName ?? '?';
    const frameOrder = json.frameOrder ?? [];
    const uniqueIds = new Set((json.frames ?? []).map((f) => f.id));
    let lastUniqueLogicalIndex = -1;
    for (let i = 0; i < frameOrder.length; i++) {
      if (uniqueIds.has(frameOrder[i])) {
        lastUniqueLogicalIndex = i;
      }
    }
    const duplicates = json.duplicates ?? {};
    const dupKeys = Object.keys(duplicates);
    const duplicatesPreview: Record<string, string> = {};
    for (const k of dupKeys.slice(0, 4).concat(dupKeys.slice(-4))) {
      duplicatesPreview[k] = duplicates[k];
    }
    return {
      animation,
      logicalFrameCount: frameOrder.length,
      uniqueFrameCount: uniqueIds.size,
      lastUniqueLogicalIndex,
      duplicatesPreview,
      duplicatesTotal: dupKeys.length,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Spell discovery
// ---------------------------------------------------------------------------

async function discoverSpells(
  opts: Options,
  protectedIds: Set<number>,
): Promise<SpellInfo[]> {
  const spells: SpellInfo[] = [];
  const entries = await readdir(SPELL_ANIMS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = parseInt(entry.name, 10);
    if (isNaN(id)) continue;
    if (opts.spellId !== undefined && id !== opts.spellId) continue;

    const manifestPath = join(SPELL_ANIMS_DIR, entry.name, 'manifest.json');
    if (!(await exists(manifestPath))) continue;

    // Every spell now gets a bespoke TS class — there is no
    // PreRenderedSpell fallback. The legacy `requiresTypeScript`
    // flag is ignored at discovery time.

    if (protectedIds.has(id)) continue;
    const hasExisting = await exists(join(SPELLS_OUT_DIR, `spell-${id}.ts`));
    if (opts.skipExisting && hasExisting) continue;

    spells.push({
      id,
      manifestPath,
      scriptsDir: join(SPELL_ANIMS_DIR, entry.name, 'scripts'),
      hasExisting,
    });
  }

  spells.sort((a, b) => a.id - b.id);
  return spells;
}

// ---------------------------------------------------------------------------
// Static context (cached across all API calls)
// ---------------------------------------------------------------------------

async function loadStaticContext(): Promise<string> {
  const [
    guide,
    iface,
    clipTypes,
    clip,
    runtime,
    runtimeSpell,
    harness,
    symbolRegistry,
    spriteConfig,
    ref103,
    ref909,
  ] = await Promise.all([
    readText(GUIDE_PATH),
    readText(INTERFACE_PATH),
    readText(CLIP_TYPES_PATH),
    readText(CLIP_PATH),
    readText(RUNTIME_PATH),
    readText(RUNTIME_SPELL_PATH),
    readText(HARNESS_PATH),
    readText(SYMBOL_REGISTRY_PATH),
    readText(SPRITE_CONFIG_PATH),
    readText(REF_103_PATH),
    readText(REF_909_PATH),
  ]);

  return `# Spell Implementation Guide

${guide}

---

# Runtime API — read these to understand the contract

## spell-interface.ts (SpellContext, SpellCallbacks, SpellTextureProvider, SpellDisplayType)
\`\`\`typescript
${iface}
\`\`\`

## clip/types.ts (SymbolDefinition, FrameScript, ClipEventHandler)
\`\`\`typescript
${clipTypes}
\`\`\`

## clip/clip.ts (SpellClip — the API your handlers use)
\`\`\`typescript
${clip}
\`\`\`

## clip/runtime.ts (SpellRuntime — drives the tick at canonical 60 fps)
\`\`\`typescript
${runtime}
\`\`\`

## clip/runtime-spell.ts (RuntimeSpell — your superclass)
\`\`\`typescript
${runtimeSpell}
\`\`\`

## clip/harness.ts (configureHarness — displayType-based root setup; you do NOT call this directly)
\`\`\`typescript
${harness}
\`\`\`

## clip/symbol-registry.ts (SymbolRegistry — passive lookup map)
\`\`\`typescript
${symbolRegistry}
\`\`\`

## sprite-config.ts (calculateAnchor — the one helper from this file you use)
\`\`\`typescript
${spriteConfig}
\`\`\`

---

# Reference implementations — hand-perfected, 1:1 with canonical AS

## spell-103.ts — Attaque Naturelle (Feca, displayType=30 ProjectileBallistic)
The canonical example for ballistic projectiles + library symbols + particles.
\`\`\`typescript
${ref103}
\`\`\`

## spell-909.ts — Flèche Enflammée (Cra, displayType=51 WorldAbsoluteAlt)
The canonical example for dual-anchored timelines + onSpellStart child attaches + manual signalHit.
\`\`\`typescript
${ref909}
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Per-spell context (user message)
// ---------------------------------------------------------------------------

async function loadSpellContext(spell: SpellInfo): Promise<string> {
  const manifest = await readText(spell.manifestPath);
  const asFiles = await collectASFiles(spell.scriptsDir);
  const atlasSummaries = await collectAtlasSummaries(spell.id);

  // Surface CLIPACTIONRECORD files explicitly so the prompt cannot
  // "miss" them — these are the dynamic per-frame scripts that drive
  // particle physics, alpha pulses, spirals, etc. The single biggest
  // class of generation failures has been the model claiming these are
  // "baked into the pre-rendered SVG frames" — they are NOT, and that
  // claim ships visibly broken animations.
  const clipFiles = asFiles.filter((f) => f.path.includes('CLIPACTIONRECORD'));
  const loadFiles = clipFiles.filter((f) => f.path.includes('(load)'));
  const enterFrameFiles = clipFiles.filter((f) => f.path.includes('(enterFrame)'));

  let context = `# Generate TypeScript for Spell ${spell.id}

## manifest.json
\`\`\`json
${manifest}
\`\`\`

## ActionScript Files (SOURCE OF TRUTH)
`;

  for (const file of asFiles) {
    context += `
### ${file.path}
\`\`\`actionscript
${file.content}
\`\`\`
`;
  }

  if (clipFiles.length > 0) {
    context += `
## ⚠️ CLIPACTIONRECORD inventory — ${clipFiles.length} script(s) MUST be ported

This spell ships ${loadFiles.length} \`onClipEvent(load)\` and ${enterFrameFiles.length} \`onClipEvent(enterFrame)\` script(s). Each one drives dynamic per-frame behavior (position, scale, rotation, alpha, removal) that runs in the Flash player at runtime — Arakne's pre-rendered SVGs ONLY capture static PlaceObject2 transforms, never the per-tick state changes these scripts produce. Skipping any of them ships a visibly broken spell.

Files that MUST be ported:
${clipFiles.map((f) => `- ${f.path}`).join('\n')}

For each PlaceObject2_X_Y directory with a CLIPACTIONRECORD:
1. Identify the sprite character (DefineSprite_X based on the parent dir name pattern)
2. Register a SymbolDefinition for that sprite with the bounds from manifest \`librarySymbols[]\` or its placement context
3. Implement \`onLoad\` from \`CLIPACTIONRECORD onClipEvent(load).as\` (one-shot init: random seeds, vars setup)
4. Implement \`onEnterFrame\` from \`CLIPACTIONRECORD onClipEvent(enterFrame).as\` (per-tick physics + transform mutation)
5. Attach the symbol via the parent's frameScripts (mirroring the canonical \`PlaceObject2\` placement frame), or via the harness for displayType 30/31

`;
  }

  if (atlasSummaries.length > 0) {
    context += `
## ⚠️ Deduplicated frame counts — \`totalFrames\` MUST be the unique-cell count

The svg-spritesheet content-hash dedupes identical frames across the timeline.
The runtime's vello renderer rasterises ONE GPU cell per UNIQUE frame, and the
Pixi texture array is built off that cell layout. There is NO logical→cell
mapping at runtime — \`framesArr[i]\` is a Texture pointing to strip cell \`i\`,
not to canonical frame \`i\`'s rendered content. So if your SymbolDefinition
declares \`totalFrames\` = the canonical SWF frame count and the timeline ticks
past the last unique cell, \`framesArr[currentFrame]\` either falls back to
frame 0 or wraps onto a wrong atlas cell — the visible "anim restarts at
frame 1 after the end" symptom.

Per-animation dedup result for THIS spell (read from
\`assets/spritesheets/spells/${spell.id}/[<anim>/]atlas.json\`):

${atlasSummaries
  .map(
    (s) => `- **${s.animation}**: logical=${s.logicalFrameCount}, unique=${s.uniqueFrameCount}, lastUniqueLogicalIndex=${s.lastUniqueLogicalIndex}, duplicates=${s.duplicatesTotal}${
      s.duplicatesTotal > 0
        ? `\n  Sample dedup: ${Object.entries(s.duplicatesPreview).map(([k, v]) => `${k}→${v}`).join(', ')}${s.duplicatesTotal > 8 ? ' …' : ''}`
        : ''
    }`,
  )
  .join('\n')}

Rules for \`totalFrames\` and frame-script remapping:
1. **Set \`totalFrames\` = \`lastUniqueLogicalIndex + 1\`** for each animation, NOT the canonical SWF \`frameCount\` from manifest.json. Example: spell 108 anim1 has logical=129 / unique=88 / lastUniqueLogicalIndex=87 → \`totalFrames: 88\`.
2. **Remap canonical script frames that fall in the deduped tail.** Walk the canonical AS frame index N — if N > lastUniqueLogicalIndex, use \`lastUniqueLogicalIndex\` instead. Example: AS \`frame_127\` (= 0-idx 126) on a 129/88 animation → use \`frameScripts.set(${'lastUniqueLogicalIndex'}, ...)\` (= 87 in the example), not 126. The visual is identical because the trimmed frames were dedup'd to the same cell anyway.
3. **Container-only symbols (\`frames: []\`, no atlas) are unaffected** — keep their declared \`totalFrames\` from the SWF.
4. **Inline numeric constants** (\`totalFrames: 88\`, \`frameScripts.set(87, ...)\`). Do NOT extract these into a \`UNIQUE_COUNT\` constant — the prompt audit greps for raw numbers matching the per-animation table above.
`;
  }

  context += `
## Instructions

Generate the complete TypeScript implementation for spell ${spell.id}.

Hard requirements:
- MUST \`extends RuntimeSpell\` from "@dofus/spell-runtime"
- MUST declare \`readonly spellId = ${spell.id};\`
- MUST declare \`readonly displayType = SpellDisplayType.<NAME>;\` — pick the correct one by reading the AS scripts (see displayType detection table in the guide)
- MUST implement \`protected registerSymbols(textures, context): void\` registering every library symbol the AS \`attachMovie\` calls reference
- SHOULD implement \`protected onSpellStart(callbacks, context): void\` for main-timeline \`SOMA.playSound(...)\` and any explicit child attaches
- ALL imports from "@dofus/spell-runtime" only — NO pixi.js imports, NO relative paths
- DO NOT override \`init\`, \`update\`, \`isComplete\`, or \`destroy\` — RuntimeSpell handles them
- DO NOT touch \`this.runtime\` until inside a frameScripts/onLoad/onEnterFrame/onSpellStart callback (it's not assigned at constructor time)
- For displayType 30/31 (ProjectileBallistic): the harness fires \`runtime.signalHit()\` automatically on landing — you must NOT call it again from your code
- For all other displayTypes: call \`this.runtime.signalHit()\` from the canonical hit frame
- Call \`this.runtime.complete()\` from the frame script that mirrors the canonical \`_parent.removeMovieClip()\` of the outer mc (usually the final frame of the longest-lived sprite/shoot)
- CRITICAL — never claim CLIPACTIONRECORD behaviors are "baked into pre-rendered SVG frames", "fully baked", or "no need to re-implement at runtime". They are NOT. Each onLoad and onEnterFrame must be ported 1:1 to a SymbolDefinition handler. Comments containing those phrases are a generation failure.

AS → TS translation rules:
- Frame numbers: AS \`frame_N\` → \`frameScripts.set(N - 1, ...)\` (0-based). Inline the number, don't extract it as a constant
- Rotation: AS degrees → TS radians. \`_rotation = X\` → \`clip.rotation = (X * Math.PI) / 180\`
- Scale: AS percent → TS decimal. \`_xscale = 50\` → \`clip.scaleX = 50 / 100\`
- Alpha: AS 0-100 → TS 0-1. \`_alpha = 50\` → \`clip.alpha = 50 / 100\`
- Variables: \`p.vx = 5\` → \`clip.vars.vx = 5\` (read with cast \`const vx = clip.vars.vx as number\`)
- Random: \`random(N)\` → \`Math.floor(Math.random() * N)\`; \`Math.random()\` stays the same
- Strict-less-than-float bounds: \`while (c < 2 + f*f*0.7)\` → \`for (let c = 0; c < 2 + level * level * 0.7; c++)\` (do NOT Math.floor the bound)
- Removal: \`removeMovieClip(this)\` → \`clip.remove()\`; \`_parent.removeMovieClip()\` → \`clip.parent?.remove()\` or \`this.runtime.complete()\` if it's the outer mc
- gotoAndPlay/Stop: AS \`gotoAndPlay(N)\` → \`clip.gotoAndPlay(N - 1)\`
- Symbol textures: ALWAYS \`textures.getFrames("lib_<name>")\` for library symbols (note the \`lib_\` prefix); never assume frame indices

Symbol registration:
- For each \`librarySymbols[]\` entry in manifest.json that AS \`attachMovie\`s, build a \`SymbolDefinition\` with: \`name\` (matches the attachMovie string), \`totalFrames\` = \`lastUniqueLogicalIndex + 1\` from the per-animation atlas summary (NOT the SWF \`frameCount\` from manifest.json — see "Deduplicated frame counts" above), \`frames: textures.getFrames("lib_<name>")\`, anchorX/anchorY from \`calculateAnchor({width, height, offsetX, offsetY})\` using the librarySymbols entry's bounds, plus appropriate onLoad/onEnterFrame/frameScripts hand-ported from the AS files. When the canonical AS \`frame_<N>/DoAction.as\` index N falls past \`lastUniqueLogicalIndex\`, register the script at \`lastUniqueLogicalIndex\` instead (the dedup'd tail is visually identical to the last unique cell).
- For container-only symbols (e.g. spell 103's \`move\` and \`shoot\`): \`frames: []\`, anchorX/Y: 0.5, with frameScripts driving attaches/sound/completion
- For displayType 30/31, you MUST register \`move\` and \`shoot\` symbols (the harness expects them by name)
- For displayType 40/41, you MUST register \`duplicate\` (and optionally \`shoot\` for 41)

CLIPACTIONRECORD-driven library symbols (kind: "clipEvent" in manifest.librarySymbols):
- These are sprites that the SWF places via PlaceObject2 with onClipEvent handlers attached. The combat-exporter has STRIPPED them from the parent's pre-rendered SVG and exported them as separate library symbols (frame textures under \`lib_<name>_*.svg\`). The runtime must attach a live clip for each placement so the dynamic handlers actually run.
- Two flavors, distinguished by \`directlyDynamic\` in the manifest entry:
  1. **directlyDynamic: true** — the sprite owns CLIPACTIONRECORDs in its own scripts directory (\`scripts/scripts/DefineSprite_<characterId>/.../CLIPACTIONRECORD onClipEvent(*).as\`). Port these to the SymbolDefinition's \`onLoad\` and \`onEnterFrame\` handlers — they drive per-tick particle physics, alpha pulses, spirals, removeMovieClip lifecycle.
  2. **directlyDynamic: false** — a "wrapper" sprite. Has no handlers of its own. Its only job is to attach the dynamic descendants listed under nested-parent placements. Use \`frames: textures.getFrames("lib_<name>")\` (often empty) and a \`frameScripts.set(0, ...)\` that calls \`clip.attach(...)\` for each child library symbol whose \`placements[].parentSpriteId === <this sprite's characterId>\`.
- The \`placements[]\` array tells you WHEN, WHERE, and WITH WHAT TRANSFORM to attach this symbol:
  - \`parentSpriteId\` — the SWF sprite whose timeline contains this placement. The OUTERMOST symbols (parentSpriteId === the main animation's sprite ID, usually the highest-numbered DefineSprite) get attached from \`onSpellStart\` or root \`frameScripts\`. Inner ones get attached from their parent library symbol's frameScripts.
  - \`frame\` — 0-indexed parent frame at which to attach. \`kind: "place"\` = call \`clip.attach(...)\` here; \`kind: "move"\` = mutate the existing clip's matrix/colorTransform (often inside an \`onEnterFrame\` per-frame check, or a frameScripts entry for that specific frame).
  - \`matrix\` — pixel-space affine. Apply as \`clip.x = matrix.translateX; clip.y = matrix.translateY; clip.scaleX = matrix.scaleX; …\` after attaching. (rotateSkew0/1 ≠ 0 indicates rotation/skew — convert via \`Math.atan2\`.)
  - \`colorTransform.alphaMult\` — 0–256 alpha multiplier. Apply as \`clip.alpha = alphaMult / 256\`.
  - \`ratio\` — staggered-instance offset (set by the Macromedia authoring tool); when present and >0, the AS \`onEnterFrame\` should be initialized with a phase offset of \`ratio\` ticks. For most cases honour this only as the placement frame.
- For sprites with MANY placements at the same parent frame (e.g. spell 101's sprite3 has 9 placements all at frame 0 of sprite4 with different depths/transforms), attach 9 separate clips in the parent's \`frameScripts.set(0, ...)\`. Don't try to merge them — each instance has independent var state for its handlers.
- For sprites with placements that have \`kind: "move"\` (tween updates), the cleanest port is: at \`kind: "place"\` frames, capture an attachment reference; at \`kind: "move"\` frames in the parent's frameScripts, mutate that reference's matrix/colorTransform. For long color-tween schedules (e.g. 50+ move entries), prefer interpolating in the parent's onEnterFrame using the start/end keyframes you can read from \`placements[]\`.

Quality:
- Lead the file with a docstring describing the spell, its canonical AS layout, and your displayType choice
- Inside each onLoad / onEnterFrame / frameScripts entry, add a short comment quoting the canonical AS file path it ports (e.g. \`// AS DefineSprite_8_baton/frame_1/DoAction.as\`)
- Use block-form ifs with braces. No inline if statements
- No \`require()\`, no dynamic \`import()\`, no \`pixi.js\` imports
- Output the file as a single \`\`\`typescript code block. No prose before or after.
`;

  return context;
}

// ---------------------------------------------------------------------------
// Code extraction & validation
// ---------------------------------------------------------------------------

function extractTypeScript(response: string): string | null {
  // Try fenced typescript block
  const tsMatch = response.match(/```typescript\n([\s\S]*?)```/);
  if (tsMatch) return tsMatch[1].trim();

  // Try generic code block
  const genericMatch = response.match(/```\n([\s\S]*?)```/);
  if (genericMatch) return genericMatch[1].trim();

  // If the response looks like raw TypeScript (starts with import or /*)
  if (response.trimStart().startsWith('import ') || response.trimStart().startsWith('/**')) {
    return response.trim();
  }

  return null;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateOutput(
  code: string,
  spellId: number,
  asFiles: { path: string; content: string }[],
  manifestJson: string | null,
): ValidationResult {
  const errors: string[] = [];

  if (!code || code.length < 50) {
    errors.push('Output is empty or too short');
    return { valid: false, errors };
  }

  if (!code.includes(`class Spell${spellId}`)) {
    errors.push(`Missing class Spell${spellId}`);
  }

  if (!code.includes('extends RuntimeSpell')) {
    errors.push('Missing `extends RuntimeSpell` — must subclass RuntimeSpell from "@dofus/spell-runtime"');
  }

  if (!code.includes(`readonly spellId = ${spellId}`)) {
    errors.push(`Missing \`readonly spellId = ${spellId}\``);
  }

  if (!/readonly\s+displayType\s*=\s*SpellDisplayType\./.test(code)) {
    errors.push('Missing `readonly displayType = SpellDisplayType.<NAME>` — pick a value from SpellDisplayType');
  }

  if (!/registerSymbols\s*\(/.test(code)) {
    errors.push('Missing `registerSymbols(...)` method — required for every RuntimeSpell subclass');
  }

  if (/\bextends\s+BaseSpell\b/.test(code)) {
    errors.push('Uses `extends BaseSpell` — that architecture is removed. Subclass RuntimeSpell instead.');
  }

  if (/\b(setup|getFramesOrWarn|this\.anims|FrameAnimatedSprite|ASParticleSystem|SpellInitContext)\b/.test(code)) {
    errors.push('References legacy BaseSpell APIs (setup/anims/FrameAnimatedSprite/ASParticleSystem/SpellInitContext). Port to RuntimeSpell + SpellClip.');
  }

  if (/from\s+["']pixi\.js["']/.test(code)) {
    errors.push('Direct `pixi.js` import is forbidden — only import from "@dofus/spell-runtime".');
  }

  if (/from\s+["']\.\.?\//.test(code)) {
    errors.push('Relative import detected — import everything from "@dofus/spell-runtime".');
  }

  if (code.includes('require(')) {
    errors.push('Contains require() — must use ES module imports only');
  }

  if (code.includes("import('")) {
    errors.push('Contains dynamic import() — must use top-level imports');
  }

  if (/this\.signalHit\b|this\.complete\(/.test(code) && !/this\.runtime\.(signalHit|complete)/.test(code)) {
    errors.push('Use `this.runtime.signalHit()` / `this.runtime.complete()` — `this.signalHit/complete` no longer exist on RuntimeSpell.');
  }

  if (/^\s*(public\s+|protected\s+|override\s+)*(update|init|isComplete|destroy)\s*\(/m.test(code)) {
    errors.push('Do not override `init`, `update`, `isComplete`, or `destroy` — RuntimeSpell handles them. Drive completion via frame scripts calling `this.runtime.complete()`.');
  }

  // Anti-pattern: model claiming CLIPACTIONRECORD behaviors are "baked"
  // into the pre-rendered SVG frames. They are NOT — the SVGs only
  // capture static PlaceObject2 transforms. Skipping them produces
  // visibly broken animations (static / wrong position / no motion),
  // which is exactly the user-visible bug spell-101 originally shipped.
  const bakedClaimPatterns: { pattern: RegExp; explain: string }[] = [
    { pattern: /baked into the (pre[- ]rendered )?(svg )?frames/i, explain: '"baked into the pre-rendered frames"' },
    { pattern: /fully baked/i, explain: '"fully baked"' },
    { pattern: /(no need to (re-?implement|port).*at runtime|do not need to re-?implement.*at runtime)/i, explain: '"no need to (re-)implement at runtime"' },
    { pattern: /clip[- ]event behavi[ou]rs?[^.]*(baked|pre[- ]rendered|exporter)/i, explain: '"clip-event behaviours are baked / pre-rendered"' },
    { pattern: /the composition tree is baked/i, explain: '"the composition tree is baked"' },
    { pattern: /visual[- ]only.*no game[- ]logic side effects/i, explain: '"visual-only, no game-logic side effects" (used to justify skipping a port)' },
  ];
  for (const { pattern, explain } of bakedClaimPatterns) {
    if (pattern.test(code)) {
      errors.push(
        `Forbidden claim ${explain} — CLIPACTIONRECORD scripts are NOT baked into the SVGs. ` +
          `Port every onClipEvent(load) and onClipEvent(enterFrame) script to a SymbolDefinition's onLoad / onEnterFrame handler.`,
      );
    }
  }

  // Coverage check: if the spell ships CLIPACTIONRECORDs, the generated
  // class must have at least one corresponding onLoad / onEnterFrame
  // handler. Otherwise the dynamics never run at runtime.
  const clipFiles = asFiles.filter((f) => f.path.includes('CLIPACTIONRECORD'));
  if (clipFiles.length > 0) {
    const loadCount = clipFiles.filter((f) => f.path.includes('(load)')).length;
    const enterCount = clipFiles.filter((f) => f.path.includes('(enterFrame)')).length;
    const hasOnLoadHandler = /\bonLoad\s*:/.test(code);
    const hasOnEnterHandler = /\bonEnterFrame\s*:/.test(code);

    if (loadCount > 0 && !hasOnLoadHandler) {
      errors.push(
        `Source has ${loadCount} CLIPACTIONRECORD onClipEvent(load) script(s) but the generated TS has NO \`onLoad:\` handler on any SymbolDefinition. Each onClipEvent(load) must be ported as a SymbolDefinition's onLoad — that's where particle physics seed values (i, v, vx, p, …) get initialized.`,
      );
    }
    if (enterCount > 0 && !hasOnEnterHandler) {
      errors.push(
        `Source has ${enterCount} CLIPACTIONRECORD onClipEvent(enterFrame) script(s) but the generated TS has NO \`onEnterFrame:\` handler on any SymbolDefinition. Each onClipEvent(enterFrame) must be ported as a SymbolDefinition's onEnterFrame — these scripts drive per-tick particle physics, alpha pulses, spirals, and removeMovieClip lifecycle that the pre-rendered SVGs do NOT capture.`,
      );
    }
  }

  // Manifest-level coverage: every clipEvent library symbol must be
  // both REGISTERED (a SymbolDefinition with the matching name) AND
  // ATTACHED (clip.attach call) somewhere in the code. Registering
  // without attaching means the symbol exists but is never instantiated
  // — its handlers never run. This is the exact bug spell-101.ts shipped
  // with: 5 SymbolDefinitions registered, only sprite14 ever attached.
  if (manifestJson !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestJson);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      const libSyms = (parsed as { librarySymbols?: unknown[] }).librarySymbols;
      if (Array.isArray(libSyms)) {
        for (const sym of libSyms) {
          if (typeof sym !== 'object' || sym === null) continue;
          const s = sym as { name?: string; kind?: string; directlyDynamic?: boolean; characterId?: number };
          if (s.kind !== 'clipEvent' || typeof s.name !== 'string') continue;
          const reSymName = new RegExp(`name\\s*:\\s*['"]${s.name}['"]`);
          const reAttach = new RegExp(
            `\\.attach\\s*\\([\\s\\S]*?\\b${s.name}Sym\\b` +
              `|\\.attach\\s*\\([\\s\\S]*?this\\.${s.name}\\b` +
              `|\\.attach\\s*\\([\\s\\S]*?\\b${s.name}\\b`,
          );
          if (!reSymName.test(code)) {
            errors.push(
              `Library symbol "${s.name}" (clipEvent, ${s.directlyDynamic ? 'directlyDynamic' : 'wrapper'}) not registered. Build a SymbolDefinition with \`name: "${s.name}"\` and \`frames: textures.getFrames("lib_${s.name}")\`. ${s.directlyDynamic ? `Port its onLoad/onEnterFrame from scripts/scripts/DefineSprite_${s.characterId ?? '?'}/.../CLIPACTIONRECORD onClipEvent(*).as` : 'Use frameScripts to clip.attach inner library symbols whose placements[].parentSpriteId matches this characterId.'}`,
            );
            continue;
          }
          if (!reAttach.test(code)) {
            errors.push(
              `Library symbol "${s.name}" is registered but never attached via \`clip.attach(...)\`. Use the \`placements[]\` schedule from manifest.librarySymbols (parentSpriteId, frame, depth, matrix, colorTransform) to attach instances at the canonical frames — without this, the symbol's handlers never run.`,
            );
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// API call with retry
// ---------------------------------------------------------------------------

type Message = { role: 'user' | 'assistant'; content: string };

async function callAPI(
  client: Anthropic,
  systemContext: string,
  messages: Message[],
  model: string,
  verbose: boolean,
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 16384,
    system: [
      {
        type: 'text',
        text: systemContext,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  if (verbose) {
    const u = response.usage;
    console.log(
      `    tokens: in=${u.input_tokens} out=${u.output_tokens} cache_read=${(u as any).cache_read_input_tokens ?? 0} cache_create=${(u as any).cache_creation_input_tokens ?? 0}`,
    );
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Generate a single spell
// ---------------------------------------------------------------------------

async function generateSpell(
  client: Anthropic,
  spell: SpellInfo,
  systemContext: string,
  opts: Options,
): Promise<GenerateResult> {
  const start = performance.now();

  try {
    const spellContext = await loadSpellContext(spell);
    const messages: Message[] = [{ role: 'user', content: spellContext }];
    // Re-collect AS files once for validation (cheap on disk; same set
    // loadSpellContext already enumerated). Used to drive the
    // CLIPACTIONRECORD coverage check + clipEvent library-symbol
    // register/attach check (which also reads the manifest).
    const asFiles = await collectASFiles(spell.scriptsDir);
    const manifestJson = await readText(spell.manifestPath).catch(() => null);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let responseText: string;
      try {
        responseText = await callAPI(client, systemContext, messages, opts.model, opts.verbose);
      } catch (error: any) {
        // Don't retry auth errors
        if (error?.status === 401 || error?.status === 403) {
          throw error;
        }
        // Retry network/rate-limit errors with backoff
        if (attempt < MAX_ATTEMPTS - 1) {
          await Bun.sleep(Math.pow(2, attempt) * 1000);
          continue;
        }
        throw error;
      }

      const code = extractTypeScript(responseText);
      if (!code) {
        if (attempt < MAX_ATTEMPTS - 1) {
          // Ask the model to try again
          messages.push({ role: 'assistant', content: responseText });
          messages.push({
            role: 'user',
            content: 'I could not extract a TypeScript code block from your response. Please respond with ONLY the complete TypeScript file inside a single ```typescript code block. Nothing else.',
          });
          continue;
        }
        return {
          spellId: spell.id,
          success: false,
          error: 'Failed to extract TypeScript from response after retries',
          durationMs: performance.now() - start,
          retries: attempt,
        };
      }

      const validation = validateOutput(code, spell.id, asFiles, manifestJson);
      if (!validation.valid) {
        if (attempt < MAX_ATTEMPTS - 1) {
          // Feed validation errors back to the model
          messages.push({ role: 'assistant', content: responseText });
          messages.push({
            role: 'user',
            content: `Your output has these validation errors:\n${validation.errors.map((e) => `- ${e}`).join('\n')}\n\nPlease fix these issues and respond with the corrected complete TypeScript file inside a single \`\`\`typescript code block.`,
          });
          if (opts.verbose) {
            console.log(`    attempt ${attempt + 1} failed: ${validation.errors.join(', ')} — retrying`);
          }
          continue;
        }
        return {
          spellId: spell.id,
          success: false,
          error: `Validation failed: ${validation.errors.join(', ')}`,
          durationMs: performance.now() - start,
          retries: attempt,
        };
      }

      // Success — write output
      const outputPath = join(SPELLS_OUT_DIR, `spell-${spell.id}.ts`);
      await Bun.write(outputPath, code + '\n');

      return {
        spellId: spell.id,
        success: true,
        durationMs: performance.now() - start,
        retries: attempt,
      };
    }

    // Should not reach here
    return {
      spellId: spell.id,
      success: false,
      error: 'Exhausted all attempts',
      durationMs: performance.now() - start,
      retries: MAX_ATTEMPTS,
    };
  } catch (error: any) {
    return {
      spellId: spell.id,
      success: false,
      error: error?.message ?? String(error),
      durationMs: performance.now() - start,
      retries: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Concurrency-limited parallel execution
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();

  for (const task of tasks) {
    const p = task().then((r) => {
      results.push(r);
    });
    const wrapped = p.finally(() => executing.delete(wrapped));
    executing.add(wrapped);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log('Dofus Spell Generator');
  console.log(`  Model: ${opts.model}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log('');

  const protectedIds = await loadProtectedSpellIds();
  console.log(
    `  Protected spells (read from protected-spells.json): ${
      protectedIds.size === 0
        ? '(none)'
        : [...protectedIds].sort((a, b) => a - b).join(', ')
    }`,
  );
  console.log('');

  // If the user explicitly asked for a single protected spell, refuse
  // up front rather than silently generating nothing.
  if (opts.spellId !== undefined && protectedIds.has(opts.spellId)) {
    console.error(
      `Error: spell ${opts.spellId} is listed in protected-spells.json — refusing to overwrite. Remove it from the list first.`,
    );
    process.exit(1);
  }

  // Discover spells
  const spells = await discoverSpells(opts, protectedIds);

  if (spells.length === 0) {
    console.log('No spells to generate.');
    return;
  }

  const existingCount = spells.filter((s) => s.hasExisting).length;
  const newCount = spells.length - existingCount;

  console.log(`Found ${spells.length} spell(s) requiring TypeScript:`);
  console.log(`  New: ${newCount}`);
  console.log(`  Overwrite: ${existingCount}`);
  console.log('');

  if (opts.dryRun) {
    console.log('Spells:');
    for (const spell of spells) {
      const tag = spell.hasExisting ? ' (overwrite)' : '';
      console.log(`  ${spell.id}${tag}`);
    }
    return;
  }

  // Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  // Load static context
  console.log('Loading static context...');
  const systemContext = await loadStaticContext();
  console.log(`  Static context loaded (${Math.round(systemContext.length / 4)} estimated tokens)`);
  console.log('');

  // Initialize client
  const client = new Anthropic();

  // Generate spells
  console.log('Generating spells...');
  console.log('');

  let completedCount = 0;
  const total = spells.length;

  const tasks = spells.map((spell) => () =>
    generateSpell(client, spell, systemContext, opts).then((result) => {
      completedCount++;
      const idx = `[${completedCount}/${total}]`;
      const time = `(${(result.durationMs / 1000).toFixed(1)}s)`;
      const retryTag = result.retries > 0 ? ` [${result.retries} retries]` : '';

      if (result.success) {
        console.log(`${idx} Spell ${result.spellId} ... OK ${time}${retryTag}`);
      } else {
        console.log(`${idx} Spell ${result.spellId} ... FAILED ${time}${retryTag}`);
        if (opts.verbose && result.error) {
          console.log(`    Error: ${result.error}`);
        }
      }

      return result;
    }),
  );

  const results = await runWithConcurrency(tasks, opts.concurrency);

  // Summary
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log('');
  console.log('==========================================');
  console.log('Generation complete!');
  console.log(`  Successful: ${successes.length}`);
  console.log(`  Failed: ${failures.length}`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log('==========================================');

  if (failures.length > 0) {
    console.log('');
    console.log('Failed spells:');
    for (const f of failures) {
      console.log(`  ${f.spellId}: ${f.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
