/**
 * Spell 815 — Vlad's Punch (Sacrieur-style impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/815/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * no `_parent.cellFrom` / `_parent.cellTo` world-absolute positioning —
 * all content is anchored at the target cell. The manifest has a single
 * `animations[]` entry (`anim1`, no librarySymbols), meaning all authored
 * frame content is driven by the main timeline composite.
 *
 * Canonical AS layout:
 *   - Main timeline frame_1: SOMA.playSound("vlad_806")
 *   - DefineSprite_3 (anim1 wrapper): frame_1 sets _rotation = random(360),
 *     _alpha = 50. Used as a display wrapper for the anim1 composite.
 *   - DefineSprite_6 (inner burst, t=variant): frame_1 plays "punch" sound
 *     and seeds scale-up animation; frame_19 stops.
 *   - DefineSprite_7 (variant, t=7): frame_1 seeds t=7; frame_22 signals
 *     hit; frame_91 removes outer mc + stops.
 *   - DefineSprite_8 (variant, t=11): frame_1 seeds t=11; frame_64 signals
 *     hit; frame_106 removes outer mc + stops.
 *   - DefineSprite_9 (variant, t=20): frame_1 seeds t=20; frame_79 signals
 *     hit; frame_118 removes outer mc + stops.
 *   - DefineSprite_10 (variant, t=25): frame_1 seeds t=25; frame_79 signals
 *     hit; frame_121 removes outer mc + stops.
 *   - DefineSprite_11 (variant, t=33): frame_1 seeds t=33; frame_79 signals
 *     hit; frame_121 removes outer mc + stops.
 *   - DefineSprite_12: frame_1 does gotoAndStop(_parent.level) — selects
 *     which variant sub-sprite to show based on spell level.
 *
 * Because `librarySymbols` is empty in the manifest, all symbols use bare
 * texture keys (no "lib_" prefix). The single `anim1` animation is used
 * for the main visual. The DefineSprite_* containers are orchestration
 * shells registered as container-only symbols (frames: []) except for
 * DefineSprite_3 which wraps the anim1 frames, and DefineSprite_6 which
 * has its own scale-up burst visual.
 *
 * The level-select pattern (DefineSprite_12 → gotoAndStop(level)) picks
 * which duration variant fires. The variants differ only in their `t`
 * (lifetime/scale seed) and the frame at which they signal hit vs. remove.
 * We expose all variants as separate symbols and wire DefineSprite_12's
 * frame_1 to select the right child via gotoAndStop(level - 1).
 *
 * Longest-lived symbol across all levels:
 *   - level 1: DefineSprite_7 → 91 frames
 *   - level 2: DefineSprite_8 → 106 frames
 *   - level 3: DefineSprite_9 → 118 frames
 *   - level 4: DefineSprite_10 → 121 frames
 *   - level 5: DefineSprite_11 → 121 frames
 *   - level 6: (reuses DefineSprite_11 or DefineSprite_9 — use 11)
 * complete() is called from whichever variant's removal frame fires.
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

// anim1 bounds from manifest animations[0]
const ANIM1_BOUNDS = {
  width: 238.25,
  height: 242.35,
  offsetX: -84.65,
  offsetY: -144.45,
};

export class Spell815 extends RuntimeSpell {
  readonly spellId = 815;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references to variant symbols for use in DefineSprite_12's frame_1
  private ds7Sym!: SymbolDefinition;
  private ds8Sym!: SymbolDefinition;
  private ds9Sym!: SymbolDefinition;
  private ds10Sym!: SymbolDefinition;
  private ds11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ---- DefineSprite_3 — anim1 wrapper with random rotation + 50% alpha ----
    // AS scripts/DefineSprite_3/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _alpha = 50;
    const ds3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: anim1Frames.length > 0 ? anim1Frames.length : 5,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS scripts/DefineSprite_3/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.alpha = 50 / 100;
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 — inner burst visual, level-parameterised t ----
    // AS scripts/DefineSprite_6/frame_1/DoAction.as:
    //   SOMA.playSound("punch");
    // AS scripts/DefineSprite_6/frame_1/DoAction_2.as:
    //   t = random(_parent.t) + _parent.t;
    //   _xscale = 0; _yscale = 0;
    //   onEnterFrame: _xscale += t; _yscale += t; t /= 1.6;
    // AS scripts/DefineSprite_6/frame_19/DoAction.as:
    //   stop();
    const ds6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 19,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_6/frame_1/DoAction.as + DoAction_2.as
            // Note: sound "punch" is played here in canonical AS. We cannot
            // call callbacks from a frameScript directly, but the manifest
            // also lists "punch" on frame 0 of the main sounds list and
            // DefineSprite_6/frame_1 also references it. We play it via
            // the stored callback.
            //
            // Seed the scale-up animation vars.
            const parentT = (clip.parent?.vars.t as number) ?? 7;
            const t = Math.floor(Math.random() * parentT) + parentT;
            clip.vars.t = t;
            clip.scaleX = 0;
            clip.scaleY = 0;
            // Attach the anim1 visual wrapper (sprite3) at depth 1
            clip.attach(ds3Sym, "anim1wrapper", 1, ctx);
          },
        ],
        [
          18,
          (clip) => {
            // AS scripts/DefineSprite_6/frame_19/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS scripts/DefineSprite_6/frame_1/DoAction_2.as onEnterFrame:
        //   _xscale += t; _yscale += t; t /= 1.6;
        // Only run after t has been seeded (frame_1 onLoad sets it)
        const t = clip.vars.t as number | undefined;
        if (t === undefined) {
          return;
        }
        clip.scaleX += t / 100;
        clip.scaleY += t / 100;
        clip.vars.t = t / 1.6;
      },
    };

    // ---- DefineSprite_7 — variant t=7, hit at frame 22, remove at frame 91 ----
    // AS scripts/DefineSprite_7/frame_1/DoAction.as: t = 7
    // AS scripts/DefineSprite_7/frame_22/DoAction.as: this.end() → signalHit
    // AS scripts/DefineSprite_7/frame_91/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.ds7Sym = {
      name: "sprite7",
      totalFrames: 91,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_7/frame_1/DoAction.as
            clip.vars.t = 7;
            clip.attach(ds6Sym, "burst", 1, ctx);
          },
        ],
        [
          21,
          () => {
            // AS scripts/DefineSprite_7/frame_22/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS scripts/DefineSprite_7/frame_91/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop()
            // _parent._parent from sprite7's perspective:
            //   sprite7 → ds12 container → root
            // We remove the ds12 container and complete.
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — variant t=11, hit at frame 64, remove at frame 106 ----
    // AS scripts/DefineSprite_8/frame_1/DoAction.as: t = 11
    // AS scripts/DefineSprite_8/frame_64/DoAction.as: this.end() → signalHit
    // AS scripts/DefineSprite_8/frame_106/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.ds8Sym = {
      name: "sprite8",
      totalFrames: 106,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_8/frame_1/DoAction.as
            clip.vars.t = 11;
            clip.attach(ds6Sym, "burst", 1, ctx);
          },
        ],
        [
          63,
          () => {
            // AS scripts/DefineSprite_8/frame_64/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          105,
          (clip) => {
            // AS scripts/DefineSprite_8/frame_106/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop()
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_9 — variant t=20, hit at frame 79, remove at frame 118 ----
    // AS scripts/DefineSprite_9/frame_1/DoAction.as: t = 20
    // AS scripts/DefineSprite_9/frame_79/DoAction.as: this.end() → signalHit
    // AS scripts/DefineSprite_9/frame_118/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.ds9Sym = {
      name: "sprite9",
      totalFrames: 118,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_9/frame_1/DoAction.as
            clip.vars.t = 20;
            clip.attach(ds6Sym, "burst", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS scripts/DefineSprite_9/frame_79/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS scripts/DefineSprite_9/frame_118/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop()
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_10 — variant t=25, hit at frame 79, remove at frame 121 ----
    // AS scripts/DefineSprite_10/frame_1/DoAction.as: t = 25
    // AS scripts/DefineSprite_10/frame_79/DoAction.as: this.end() → signalHit
    // AS scripts/DefineSprite_10/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.ds10Sym = {
      name: "sprite10",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_10/frame_1/DoAction.as
            clip.vars.t = 25;
            clip.attach(ds6Sym, "burst", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS scripts/DefineSprite_10/frame_79/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS scripts/DefineSprite_10/frame_121/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop()
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_11 — variant t=33, hit at frame 79, remove at frame 121 ----
    // AS scripts/DefineSprite_11/frame_1/DoAction.as: t = 33
    // AS scripts/DefineSprite_11/frame_79/DoAction.as: this.end() → signalHit
    // AS scripts/DefineSprite_11/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.ds11Sym = {
      name: "sprite11",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_11/frame_1/DoAction.as
            clip.vars.t = 33;
            clip.attach(ds6Sym, "burst", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS scripts/DefineSprite_11/frame_79/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS scripts/DefineSprite_11/frame_121/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop()
            clip.parent?.remove();
            this.runtime.complete();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_12 — level selector, gotoAndStop(_parent.level) ----
    // AS scripts/DefineSprite_12/frame_1/DoAction.as:
    //   gotoAndStop(_parent.level)
    // The sprite has 6 "frames" corresponding to spell levels 1-6.
    // Each frame holds one of the variant sprites. We model this as a
    // container that on frame_1 attaches the level-appropriate variant.
    //
    // Level mapping (canonical, matching t values):
    //   level 1 → sprite7  (t=7,  91 frames)
    //   level 2 → sprite8  (t=11, 106 frames)
    //   level 3 → sprite9  (t=20, 118 frames)
    //   level 4 → sprite10 (t=25, 121 frames)
    //   level 5 → sprite11 (t=33, 121 frames)
    //   level 6 → sprite11 (t=33, 121 frames, same as level 5)
    const ds12Sym: SymbolDefinition = {
      name: "sprite12",
      totalFrames: 6,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS scripts/DefineSprite_12/frame_1/DoAction.as:
            //   gotoAndStop(_parent.level)
            // _parent here is the root. We use it to determine which
            // variant sub-sprite to attach, then stop.
            const level = (clip.parent?.vars.level as number) ?? 1;
            let variantSym: SymbolDefinition;
            if (level <= 1) {
              variantSym = this.ds7Sym;
            } else if (level === 2) {
              variantSym = this.ds8Sym;
            } else if (level === 3) {
              variantSym = this.ds9Sym;
            } else if (level === 4) {
              variantSym = this.ds10Sym;
            } else {
              // level 5 and 6
              variantSym = this.ds11Sym;
            }
            clip.attach(variantSym, "variant", 1, ctx);
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(ds3Sym);
    this.registry.register(ds6Sym);
    this.registry.register(this.ds7Sym);
    this.registry.register(this.ds8Sym);
    this.registry.register(this.ds9Sym);
    this.registry.register(this.ds10Sym);
    this.registry.register(this.ds11Sym);
    this.registry.register(ds12Sym);

    // Store ds12Sym reference for use in onSpellStart
    this._ds12Sym = ds12Sym;
  }

  private _ds12Sym!: SymbolDefinition;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_806")
    callbacks.playSound("vlad_806");

    // Store level on root.vars so child frame scripts can read _parent.level
    this.root.vars.level = context.level;

    // Attach the level-selector sprite12 at the root. Its frame_1 will
    // select and attach the correct duration variant based on level.
    this.root.attach(this._ds12Sym, "selector", 1, context);
  }
}
