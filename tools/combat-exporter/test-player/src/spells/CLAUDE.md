# Spell Implementation Guide (RuntimeSpell + SpellClip)

## Overview

This directory contains TypeScript implementations of Dofus 1.29 spell visuals. Every spell **MUST** behave identically to its canonical ActionScript — no approximations, no "improvements", no deviations. Hit signal and completion timing are load-bearing for the combat sequencer.

Generated files are written to `apps/electrobun/src/game/spells/spell-{id}.ts` and consumed by `spell-module-loader.ts` via a Vite glob.

## Architecture

The runtime is a **TypeScript-native composition layer**, not a Flash emulator. Each spell is a tree of `SpellClip` nodes mirroring the AS `MovieClip` tree, with explicit `frameScripts` + `onLoad` + `onEnterFrame` handlers ported 1:1 from the canonical `DefineSprite_*/frame_*/DoAction.as` and `CLIPACTIONRECORD onClipEvent(...)` files.

```
RuntimeSpell  (your subclass)
  ├── SymbolRegistry  ← register every "library symbol" (lib_baton, lib_effet, lib_cercle, …)
  ├── SpellRuntime    ← drives the tick loop at canonical 60fps (TRIPLEFRAMERATE)
  └── SpellClip "root" (== this.container)
        ├── attached children populated by `configureHarness` (move / shoot / duplicate)
        └── attached children populated by `onSpellStart` (your main timeline frame_1)
```

## Source layout

```
tools/combat-exporter/output/spell-anims/{SPELL_ID}/
├── manifest.json            # animations[], librarySymbols[], sounds[]
└── scripts/scripts/         # canonical decompiled AS — SOURCE OF TRUTH
    ├── frame_1/DoAction.as                                # main timeline
    ├── DefineSprite_8_baton/frame_1/DoAction.as           # symbol frame scripts
    └── DefineSprite_7_baton2/frame_1/PlaceObject2_6_1/
        CLIPACTIONRECORD onClipEvent(load).as              # clip events

packages/spell-runtime/src/
├── spell-interface.ts       # SpellContext, SpellCallbacks, SpellTextureProvider, SpellDisplayType
└── clip/
    ├── clip.ts              # SpellClip
    ├── runtime.ts           # SpellRuntime (60 fps tick)
    ├── runtime-spell.ts     # RuntimeSpell (your superclass)
    ├── harness.ts           # configureHarness, resolveAnchor
    ├── symbol-registry.ts   # SymbolRegistry
    └── types.ts             # SymbolDefinition, FrameScript, ClipEventHandler

apps/electrobun/src/game/spells/
└── spell-{id}.ts            # Generated implementations (this is what you write)
```

## RuntimeSpell — what you subclass

```ts
export abstract class RuntimeSpell implements ISpellAnimation {
  abstract readonly spellId: number;
  abstract readonly displayType: number;             // SpellDisplayType.* — see below

  readonly container: Container;
  protected readonly root: SpellClip;
  protected readonly registry: SymbolRegistry;
  protected runtime!: SpellRuntime;                  // populated in init()

  protected abstract registerSymbols(
    textures: SpellTextureProvider,
    context: SpellContext,
  ): void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {}                                         // override for SOMA.playSound + main-timeline child attaches

  // The runtime drives these — DO NOT override them in your subclass.
  init(...): void  { /* configureHarness + registerSymbols + onSpellStart */ }
  update(deltaMs): void { this.runtime.tick(deltaMs); }
  isComplete(): boolean { return this.runtime.isComplete; }
  destroy(): void { ... }
}
```

You implement **two methods**: `registerSymbols` (always) and optionally `onSpellStart` (for the main-timeline `frame_1/DoAction.as` actions).

## displayType — pick the right one

`displayType` controls how `configureHarness` anchors + animates the root clip. It must match the spell's canonical AS dispatch.

| Const | Value | Anchor / harness behaviour | When to use |
|---|---|---|---|
| `CasterCell` | 10 | root at caster cell | self-buffs, caster-anchored impacts |
| `TargetCell` | 11 | root at target cell | impacts at target (most common) |
| `CasterCellAlt` | 12 | root at caster cell | rare alt of 10 |
| `ProjectileLinear` | 20 | root at caster, rotated to target, "shoot" attached at target offset | linear arrows / beams along a straight line |
| `ProjectileLinearAlt` | 21 | same as 20, alt | alt linear |
| `ProjectileBallistic` | 30 | parabolic arc; harness drives "move" along arc, attaches "shoot" at impact | thrown/lobbed projectiles |
| `ProjectileBallisticAlt` | 31 | same as 30, slower arc factor (0.9 vs 0.5) | alt ballistic |
| `BeamLine` | 40 | drops "duplicate" symbols periodically along caster→target line | continuous beams |
| `BeamLineAlt` | 41 | same as 40, attaches "shoot" at impact | beam with explosion |
| `WorldAbsolute` | 50 | container at world (0,0); spell positions children using `_parent.cellFrom`/`cellTo` | dual-anchored spells (one piece at caster, another at target) |
| `WorldAbsoluteAlt` | 51 | same as 50 | alt world-absolute |

**How to detect from AS:**
- Has `move` + `shoot` library symbols, with a 2-frame `move` whose frame_2 attaches `effet` → **30 (ProjectileBallistic)**
- Has only `shoot`, with caster-rotation logic → **20 (ProjectileLinear)**
- Has `duplicate` symbol → **40/41 (BeamLine)**
- Two top-level sprites that read `_parent.cellFrom` AND `_parent.cellTo` and position themselves with `_X = _parent.cellFrom.x` etc. → **50/51 (WorldAbsolute)**
- Single impact at target cell, no projectile, no caster reference → **11 (TargetCell)**
- Spell stays on the caster (e.g. shield, aura) → **10 (CasterCell)**

Default for spells whose AS can't be cleanly classified: **11 (TargetCell)**.

## SymbolDefinition contract

For every `librarySymbols[]` entry in manifest.json that AS calls `attachMovie("name", ..., depth)` against, register a `SymbolDefinition`:

```ts
const cercleAnchor = calculateAnchor({
  width: 34.75, height: 34.4, offsetX: -17.2, offsetY: -17.3,   // copy from manifest librarySymbols[i]
});

const cercleSym: SymbolDefinition = {
  name: "cercle",                                      // matches attachMovie("cercle", ...)
  totalFrames: 1,                                       // copy from manifest
  frames: textures.getFrames("lib_cercle"),             // texture provider — see below
  anchorX: cercleAnchor.x,
  anchorY: cercleAnchor.y,

  onLoad: (clip, ctx) => {
    // canonical: PlaceObject2_X_Y/CLIPACTIONRECORD onClipEvent(load).as
    clip.vars.vx = 5 + 10 * Math.random();
    clip.scaleX = 0;
    clip.scaleY = 0;
  },

  onEnterFrame: (clip, ctx) => {
    // canonical: PlaceObject2_X_Y/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const vx = clip.vars.vx as number;
    clip.x += vx;
    if ((clip.vars.t as number) < 0) {
      clip.remove();                                    // canonical: removeMovieClip(this)
    }
  },

  frameScripts: new Map([
    [0, (clip, ctx) => { /* canonical: frame_1/DoAction.as */ }],
    [42, (clip) => { clip.stop(); }],                   // canonical: frame_43/DoAction.as → stop()
  ]),
};

this.registry.register(cercleSym);
```

### Symbol naming — manifest vs AS (CRITICAL — read carefully)

The texture provider exposes two distinct namespaces:

1. **`librarySymbols[]` entries** → expose textures under key `lib_<name>`.
   - Use `textures.getFrames("lib_<name>")` ONLY when the source manifest's `librarySymbols[]` has an entry with that name.
   - Bounds for `calculateAnchor` come from `librarySymbols[i].{width,height,offsetX,offsetY}`.

2. **`animations[]` entries** → expose textures under the bare name.
   - Use `textures.getFrames("<name>")` (NO `lib_` prefix) for any symbol that only appears in the top-level `animations[]` list.
   - Bounds come from `animations[i].{width,height,offsetX,offsetY}`.

**How to choose:**

| Situation | Symbol-registration name | textures.getFrames key |
|---|---|---|
| AS `attachMovie("cercle")` AND manifest has `librarySymbols: [{name: "cercle", ...}]` | `"cercle"` | `"lib_cercle"` |
| AS `attachMovie("cercle")` AND manifest has `animations: [{name: "sprite_25"}]` (cercle is the AS link, sprite_25 is the SWF id) | `"cercle"` | `"sprite_25"` |
| Top-level main-timeline content named `anim1` in `animations[]`, NOT in `librarySymbols[]` (typical for self-buffs / shields) | `"anim1"` | `"anim1"` |
| `move` / `shoot` / `duplicate` in `animations[]` only (placeholder containers) | `"move"` etc. | `"move"` etc. (or just `frames: []` if container-only) |

**Rule of thumb:** if `librarySymbols` is empty in the source manifest, you almost certainly should NOT use a `lib_` prefix anywhere. Most self-buff / shield / aura spells fit this pattern: a single `animations: ["anim1"]` entry, no library symbols, all rendering driven by the bare `anim1` timeline.

If a `getFrames("lib_<name>")` call returns no textures, the spell renders blank. Triple-check the manifest before adding the prefix.

## clip.attach — the canonical attachMovie

```ts
parent.attach(symbolDef, instanceName, depth, ctx, transform?);
```

Mirrors AS `parent.attachMovie(name, instance, depth)` PLUS the immediate transform statements that follow. Order of operations:
1. Create child + add to parent
2. Apply `transform.{x,y,rotation}` if supplied
3. Run `symbol.onLoad(child, ctx)`
4. Run `symbol.frameScripts.get(0)(child, ctx)` (the entry-frame script)

This order is canonical: the post-attach transform setters run BEFORE clip events, so `frame_1` actions can override (e.g. spell 103's `shoot/frame_1` does `_rotation = 0`, deliberately undoing any rotation set by the harness).

## SpellClip API (what your handlers can do)

```ts
clip.x, clip.y                          // pixel coords (NOT twips)
clip.scaleX, clip.scaleY                // decimal (1 = 100%, NOT Flash percent)
clip.rotation                           // RADIANS (NOT Flash degrees)
clip.alpha                              // 0-1 (NOT Flash 0-100)
clip.visible

clip.vars.foo                           // AS dynamic locals — read/write any string
clip.parent                             // SpellClip | null
clip.children                           // Map<string, SpellClip>

clip.stop()                             // halt timeline
clip.play()                             // resume
clip.gotoAndPlay(zeroBasedFrame)        // AS gotoAndPlay(N) → call with (N - 1)
clip.gotoAndStop(zeroBasedFrame)
clip.attach(sym, name, depth, ctx, t?)  // attachMovie + optional transform
clip.remove()                           // removeMovieClip(this) — deferred, fires after current tick
clip.find("path/to/child")              // descendant lookup
```

## Frame indexing — AS is 1-based, runtime is 0-based

| AS source | Runtime |
|---|---|
| `frame_1/DoAction.as` | `frameScripts.set(0, fn)` |
| `frame_43/DoAction.as` | `frameScripts.set(42, fn)` |
| `gotoAndPlay(2)` | `clip.gotoAndPlay(1)` |
| `totalFrames=106` (AS) | `totalFrames: 106` (no -1; this is a count, not an index) |

**Always inline the frame number** — don't extract it as a constant. The reader needs to see "this fires at frame 67" matching the canonical `frame_67/DoAction.as`.

## Unit conversions — AS uses Flash units

AS code stores rotation in **degrees**, scale in **percent**, alpha in **0-100**. `SpellClip` uses **radians**, **decimal scale**, **0-1 alpha**.

```ts
// AS: _rotation = 30 * sin(t)
clip.rotation = (30 * Math.sin(t) * Math.PI) / 180;

// AS: _xscale = _yscale = 50
clip.scaleX = 50 / 100;  // or just 0.5
clip.scaleY = 50 / 100;

// AS: _alpha = 50
clip.alpha = 50 / 100;
```

For an AS expression that updates rotation by a delta in degrees per frame:
```ts
// AS: _rotation = _rotation - vr;   (vr in degrees)
clip.rotation -= (vr * Math.PI) / 180;
```

## Lifecycle hooks — when to call signalHit / complete

The runtime exposes two idempotent signals on `this.runtime`:

```ts
this.runtime.signalHit();   // canonical: damage popups; usually fired at impact frame
this.runtime.complete();    // canonical: end of spell; usually fired by removeMovieClip on outer mc
```

Both are guarded — calling either twice is a no-op. **Pick ONE place per signal.**

When the harness handles ballistic motion (displayType 30/31), it calls `runtime.signalHit()` automatically at the landing frame. Per-spell modules should NOT also call it for displayType 30/31 spells. For all other displayTypes you must signal hit yourself, typically from a `frameScripts` callback at the canonical impact frame.

For `complete()`: fire it from the frame_N script that calls `_parent.removeMovieClip()` in the canonical AS:
```ts
[105, (clip) => {
  clip.remove();
  this.runtime.complete();
}],
```

## onSpellStart — main timeline frame_1

The canonical SWF main timeline is invariably `SOMA.playSound("..."); stop();` plus implicit child placement. Override `onSpellStart`:

```ts
protected onSpellStart(callbacks: SpellCallbacks, ctx: SpellContext): void {
  callbacks.playSound("ronce");
  // For displayType 50/51 the canonical main timeline ALSO places
  // sub-sprites at the root that aren't move/shoot — attach them here.
  this.root.attach(this.sprite22Sym, "sprite22", 1, ctx);
}
```

For displayType 30/31, harness already attaches `move` (frame_2 of which attaches `effet`) — your `onSpellStart` is usually only `playSound`.

## Imports — strict whitelist

```ts
import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";
```

**No relative imports.** Everything from `@dofus/spell-runtime`. **No** `pixi.js` imports — the runtime owns Pixi; your code just sets `clip.x`/`clip.scaleX`/`clip.rotation`/etc.

**Never** use `require()` or dynamic `import('pixi.js').Sprite` — top-level ES imports only.

## Class skeleton

```ts
/**
 * Spell {ID} — {Spell Name}.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/{ID}/scripts/scripts/
 *
 * displayType={N} ({SpellDisplayType.NAME}). {Why this displayType.}
 *
 * Library symbols:
 *   - lib_X — {role}. onLoad seeds {…}. onEnterFrame {…}.
 *   - lib_Y — {role}. frame_N {action}; frame_M removes itself.
 *
 * Main timeline: {summary of frame_1/DoAction.as actions}.
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const X_BOUNDS = { width: …, height: …, offsetX: …, offsetY: … };

export class Spell{ID} extends RuntimeSpell {
  readonly spellId = {ID};
  readonly displayType = SpellDisplayType.{NAME};

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const xAnchor = calculateAnchor(X_BOUNDS);

    const xSym: SymbolDefinition = {
      name: "x",
      totalFrames: 1,
      frames: textures.getFrames("lib_x"),
      anchorX: xAnchor.x,
      anchorY: xAnchor.y,
      onLoad: (clip) => { /* canonical onClipEvent(load) */ },
      onEnterFrame: (clip) => { /* canonical onClipEvent(enterFrame) */ },
    };

    this.registry.register(xSym);
    // … register all symbols the AS attachMovie's …
  }

  protected onSpellStart(callbacks: SpellCallbacks, _ctx: SpellContext): void {
    callbacks.playSound("…");
  }
}
```

## Reference implementations

These are hand-perfected and 1:1 with canonical AS. Use them as templates.

- **`spell-103.ts`** (Attaque Naturelle, Feca) — displayType=30 ProjectileBallistic. Symbols: baton (drift particle), baton2 (impact thorn), effet (16-frame burst), move (2-frame), shoot (106-frame burn). Demonstrates the canonical `2 + level² * 0.7` particle-count loop, `_rotation = 0` override in shoot frame_1, and impact removal pattern.

- **`spell-909.ts`** (Flèche Enflammée, Cra) — displayType=51 WorldAbsoluteAlt. Two parallel authored timelines (sprite_22 caster-side, sprite_41 target-side), runtime-spawned cercle particles with full physics. Demonstrates dual-anchored placement using `_parent.cellFrom` / `_parent.cellTo`, signalHit on a frame script (since harness doesn't drive it for displayType 50/51), and main-timeline child attaching from `onSpellStart`.

## Translation rules — AS → TS

### Variables
AS dynamic locals (`p.vx = 5`) → `clip.vars.vx = 5`. Read with cast: `const vx = clip.vars.vx as number;`.

### Random
| AS | TS |
|---|---|
| `random(N)` | `Math.floor(Math.random() * N)` |
| `Math.random()` | `Math.random()` |
| `0.5 - random` (== `0.5 - Math.random()`) | `0.5 - Math.random()` |

### Loop bounds — AS uses strict-less-than against floats
```as
while (c < 2 + f*f*0.7) { … }   // level=1: bound = 2.7, loop runs 3 times (NOT 2)
```
```ts
const bound = 2 + level * level * 0.7;
for (let c = 0; c < bound; c++) { … }   // ceil(2.7) = 3 iterations — correct
```
**Do not Math.floor the bound.** Strict-less-than-float gives ceil, and `for (... ; c < bound ...)` reproduces that exactly.

### Coordinate references inside handlers
```as
_parent.cellFrom.x         // outer mc property set by configureHarness on root.vars
```
```ts
const root = clip.parent;                              // walk up to the root
const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
clip.x = cellFrom?.x ?? 0;
```

For AS `_parent._parent._parent.level` (3-level traversal), follow the chain: `clip.parent?.parent?.parent`. Cache the result if used repeatedly in onEnterFrame.

### Sounds
| AS | TS |
|---|---|
| `SOMA.playSound("foo")` | `callbacks.playSound("foo")` (only available in `onSpellStart`) |

For sounds played from a frame_N inside a library symbol (rare), capture the callbacks reference in `onSpellStart` and use it from your frameScripts:
```ts
private soundCallback?: (id: string) => void;
protected onSpellStart(callbacks, _ctx) {
  this.soundCallback = callbacks.playSound;
  callbacks.playSound("entry_sound");
}
// Later in a frameScripts entry:
this.soundCallback?.("impact_sound");
```

### Removing self
| AS | TS |
|---|---|
| `removeMovieClip(this)` | `clip.remove()` |
| `_parent.removeMovieClip()` | `clip.parent?.remove()` (or `this.runtime.complete()` if outer mc) |

### gotoAndPlay / gotoAndStop
| AS | TS |
|---|---|
| `gotoAndPlay(7)` | `clip.gotoAndPlay(6)` |
| `gotoAndStop(43)` | `clip.gotoAndStop(42)` |

## Common mistakes to avoid

1. **Wrong displayType** — read the AS scripts; pick the right one from the table above. Default to TargetCell when truly unsure.
2. **Off-by-one on frame numbers** — AS frame_N → `frameScripts.set(N - 1, ...)`.
3. **Calling `signalHit` for displayType 30/31** — harness already does it at landing.
4. **Using degrees / Flash units in TS** — convert to radians / 0-1 / decimal.
5. **Approximating physics** — copy formulas EXACTLY from AS, including weird-looking constants (0.97, 0.95, accx multipliers).
6. **`Math.floor` on a strict-less-than-float bound** — produces off-by-one particle counts.
7. **Hardcoding library textures** — always `textures.getFrames("lib_<name>")`, never assume frame indices.
8. **Importing pixi.js directly** — don't. The runtime is your only API.
9. **Calling `this.complete()` from update** — there is no update override. Call `this.runtime.complete()` from a frame script at the canonical removal frame.
10. **Re-entering signalHit / complete** — they're idempotent but write the call ONCE in the right canonical place.
11. **Missing the `onLoad` step** — if AS has `PlaceObject2_X_Y/CLIPACTIONRECORD onClipEvent(load).as`, you MUST port it. Particles often seed all their physics there.
12. **Forgetting onSpellStart sound** — almost every spell has `SOMA.playSound(...)` on the main timeline frame_1. Don't lose it.
