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
 * Spells that have hand-perfected RuntimeSpell ports — the generator
 * must NOT overwrite them and uses them as in-prompt references.
 */
const PROTECTED_SPELL_IDS = new Set<number>([103, 909, 911]);

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

// ---------------------------------------------------------------------------
// Spell discovery
// ---------------------------------------------------------------------------

async function discoverSpells(opts: Options): Promise<SpellInfo[]> {
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

    if (PROTECTED_SPELL_IDS.has(id)) continue;
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
- For each \`librarySymbols[]\` entry in manifest.json that AS \`attachMovie\`s, build a \`SymbolDefinition\` with: \`name\` (matches the attachMovie string), \`totalFrames\` (from manifest), \`frames: textures.getFrames("lib_<name>")\`, anchorX/anchorY from \`calculateAnchor({width, height, offsetX, offsetY})\` using the librarySymbols entry's bounds, plus appropriate onLoad/onEnterFrame/frameScripts hand-ported from the AS files
- For container-only symbols (e.g. spell 103's \`move\` and \`shoot\`): \`frames: []\`, anchorX/Y: 0.5, with frameScripts driving attaches/sound/completion
- For displayType 30/31, you MUST register \`move\` and \`shoot\` symbols (the harness expects them by name)
- For displayType 40/41, you MUST register \`duplicate\` (and optionally \`shoot\` for 41)

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

function validateOutput(code: string, spellId: number): ValidationResult {
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

      const validation = validateOutput(code, spell.id);
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

  // Discover spells
  const spells = await discoverSpells(opts);

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
