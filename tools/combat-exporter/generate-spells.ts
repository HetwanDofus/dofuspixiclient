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
const SPELLS_OUT_DIR = join(TOOL_DIR, 'test-player/src/spells');
const GUIDE_PATH = join(SPELLS_OUT_DIR, 'CLAUDE.md');
const RUNTIME_PKG = join(REPO_ROOT, 'packages/spell-runtime/src');
const BASE_SPELL_PATH = join(RUNTIME_PKG, 'base-spell.ts');
const INTERFACE_PATH = join(RUNTIME_PKG, 'spell-interface.ts');
const UTILS_INDEX_PATH = join(RUNTIME_PKG, 'index.ts');
const UTILS_FRAME_PATH = join(RUNTIME_PKG, 'frame-animated-sprite.ts');
const UTILS_PARTICLE_PATH = join(RUNTIME_PKG, 'particle-system.ts');
const UTILS_SPRITE_PATH = join(RUNTIME_PKG, 'sprite-config.ts');
const REF_909_PATH = join(SPELLS_OUT_DIR, 'spell-909.ts');
const REF_1005_PATH = join(SPELLS_OUT_DIR, 'spell-1005.ts');

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

    const manifest = JSON.parse(await readText(manifestPath));
    if (!manifest.requiresTypeScript) continue;

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
  const [guide, baseSpell, iface, utilsIndex, utilsFrame, utilsParticle, utilsSprite, ref909, ref1005] =
    await Promise.all([
      readText(GUIDE_PATH),
      readText(BASE_SPELL_PATH),
      readText(INTERFACE_PATH),
      readText(UTILS_INDEX_PATH),
      readText(UTILS_FRAME_PATH),
      readText(UTILS_PARTICLE_PATH),
      readText(UTILS_SPRITE_PATH),
      readText(REF_909_PATH),
      readText(REF_1005_PATH),
    ]);

  return `# Spell Implementation Guide

${guide}

---

# Source Files Reference

## spell-interface.ts
\`\`\`typescript
${iface}
\`\`\`

## base-spell.ts
\`\`\`typescript
${baseSpell}
\`\`\`

## spell-utils/index.ts
\`\`\`typescript
${utilsIndex}
\`\`\`

## spell-utils/frame-animated-sprite.ts
\`\`\`typescript
${utilsFrame}
\`\`\`

## spell-utils/particle-system.ts
\`\`\`typescript
${utilsParticle}
\`\`\`

## spell-utils/sprite-config.ts
\`\`\`typescript
${utilsSprite}
\`\`\`

## Reference: spell-909.ts (beam with particles)
\`\`\`typescript
${ref909}
\`\`\`

## Reference: spell-1005.ts (radial with randomized instances)
\`\`\`typescript
${ref1005}
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

Requirements:
- MUST extend BaseSpell
- Use this.anims.add() to register all FrameAnimatedSprite instances
- Use this.signalHit() for hit signal (auto-guarded, fires once)
- Use this.complete() for completion (auto-guarded, fires once)
- Use init parameter for: scale, angleRad, casterY, targetX, targetY
- Frame numbers: AS is 1-indexed, TS is 0-indexed (subtract 1)
- Use frame numbers inline, not as constants
- Particle physics: Copy EXACT formulas from AS (no approximation)
- Randomization: Replicate exact ranges (AS random(N) = Math.floor(Math.random() * N))
- Sounds: Play at exact frames specified in AS
- No inline ifs (use block form with braces)
- Only override destroy() if you have extra resources (particles)
- NEVER use require() — ALL imports must be top-level ES module imports (import { Sprite, Container, Texture } from 'pixi.js')
- NEVER use dynamic type imports like import('pixi.js').Sprite — import types at the top of the file
- NEVER access private members of FrameAnimatedSprite (like .currentFrame) — use public API only (.sprite, .isComplete(), .isStopped(), .getFrame(), .update(), .onFrame(), .stopAt(), .addTo())

Respond with ONLY the TypeScript file content inside a single \`\`\`typescript code block. No explanation before or after.
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

  if (!code.includes('extends BaseSpell')) {
    errors.push('Missing extends BaseSpell');
  }

  if (!code.includes(`readonly spellId = ${spellId}`)) {
    errors.push(`Missing readonly spellId = ${spellId}`);
  }

  if (!code.includes('setup(')) {
    errors.push('Missing setup() method');
  }

  if (!code.includes('update(')) {
    errors.push('Missing update() method');
  }

  if (code.includes('require(')) {
    errors.push('Contains require() — must use ES module imports only');
  }

  if (code.includes("import('pixi")) {
    errors.push('Contains dynamic import() type — must use top-level imports');
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
