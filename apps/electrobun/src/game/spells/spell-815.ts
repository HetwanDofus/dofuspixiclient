/**
 * Spell 815 — Vlad's Punch (likely a Sacrier/melee spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/815/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion symbols (move/shoot/duplicate),
 * no caster-relative anchoring, no dual-timeline world-absolute pattern. The spell
 * plays entirely at the target cell. Single `anim1` animation in the manifest with
 * no librarySymbols[] — all content is driven by authored timeline clips.
 *
 * AS layout:
 *   - Main timeline frame_1: SOMA.playSound("vlad_806")
 *   - DefineSprite_6 (the "outer" container, 19 frames):
 *       frame_1: SOMA.playSound("punch") + scale-up particle logic (t = random+t, xscale/yscale
 *                ramp via onEnterFrame).
 *       frame_19: stop()
 *   - DefineSprite_3 (single-frame flash/rotation sprite):
 *       frame_1: _rotation = random(360); _alpha = 50
 *   - DefineSprite_12 (level-selector):
 *       frame_1: gotoAndStop(_parent.level)
 *       Each level-frame presumably shows a different sized impact.
 *   - DefineSprite_7 (t=7, 91 frames):
 *       frame_1: t = 7
 *       frame_22: this.end() → signalHit
 *       frame_91: _parent._parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_8 (t=11, 106 frames):
 *       frame_1: t = 11
 *       frame_64: this.end() → signalHit
 *       frame_106: _parent._parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_9 (t=20, 118 frames):
 *       frame_1: t = 20
 *       frame_79: this.end() → signalHit
 *       frame_118: _parent._parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_10 (t=25, 121 frames):
 *       frame_1: t = 25
 *       frame_79: this.end() → signalHit
 *       frame_121: _parent._parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_11 (t=33, 121 frames):
 *       frame_1: t = 33
 *       frame_79: this.end() → signalHit
 *       frame_121: _parent._parent.removeMovieClip(); stop() → complete
 *
 * The manifest has no librarySymbols[]. The animations[] list has a single
 * entry "anim1" (5 frames, composite). These DefineSprites are internal
 * timeline symbols — we model them as container SymbolDefinitions with
 * frames: [] (container-only) since their visual content is the composite
 * anim1 frames, not separate lib_ textures.
 *
 * The DefineSprite_12 "level selector" picks which sub-animation plays
 * based on spell level. The five levels map to the five `anim1` frames.
 * DefineSprite_3 adds a random-rotation flash overlay.
 *
 * The DefineSprite_6 is the impact "punch" wrapper that positions the
 * level-selector and rotation-flash child and plays the punch sound.
 * Its onEnterFrame scales up the outer container rapidly then slows
 * (t /= 1.6 decay).
 *
 * DefineSprites 7, 8, 9, 10, 11 appear to be level-specific impact
 * timelines (t=7 → level 1, t=11 → level 2, t=20 → level 3,
 * t=25 → level 4, t=33 → level 5). They each call this.end() at their
 * hit frame and _parent._parent.removeMovieClip() at their last frame.
 * The outer structure likely attachMovies one of these based on level,
 * wrapping DefineSprite_6 inside it.
 *
 * Since there is no explicit attachMovie chain in the AS (the manifest
 * has no librarySymbols), and the manifest has a single composite
 * "anim1" with 5 frames (one per level), we model each DefineSprite as
 * a SymbolDefinition. DefineSprite_12's gotoAndStop(_parent.level) maps
 * frame index = level - 1 (0-based), selecting the correct anim1 frame.
 *
 * The outermost per-level sprites (7/8/9/10/11) wrap the entire
 * animation; the spell selects one based on context.level. We attach
 * the appropriate sprite from onSpellStart.
 *
 * Library symbol → texture mapping: Since librarySymbols[] is EMPTY,
 * we use bare texture names (no lib_ prefix). The "anim1" animation
 * is the visual content for DefineSprite_3/12/6.
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

// anim1 bounds from manifest.json animations[0]
const ANIM1_BOUNDS = {
  width: 238.25,
  height: 242.35,
  offsetX: -84.65,
  offsetY: -144.45,
};

export class Spell815 extends RuntimeSpell {
  readonly spellId = 815;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold refs for use in onSpellStart
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ---- DefineSprite_3 — single-frame rotation+alpha flash ------
    // AS DefineSprite_3/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _alpha = 50;
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.alpha = 50 / 100;
          },
        ],
      ]),
    };

    // ---- DefineSprite_12 — level-selector (5 frames = 5 levels) --
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   gotoAndStop(_parent.level);
    // Selects the anim1 frame corresponding to the spell level (1-5).
    const sprite12Sym: SymbolDefinition = {
      name: "sprite12",
      totalFrames: 5,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_12/frame_1/DoAction.as
            // gotoAndStop(_parent.level) — level is 1-based, convert to 0-based
            const parent = clip.parent;
            const level = (parent?.vars.level as number) ?? 1;
            clip.gotoAndStop(Math.max(0, Math.min(level - 1, 4)));
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 — punch impact wrapper (19 frames) -------
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   SOMA.playSound("punch");
    // AS DefineSprite_6/frame_1/DoAction_2.as:
    //   t = random(_parent.t) + _parent.t;
    //   _xscale = 0; _yscale = 0;
    //   this.onEnterFrame = function() {
    //     _xscale = _xscale + t; _yscale = _yscale + t;
    //     t /= 1.6;
    //   };
    // AS DefineSprite_6/frame_19/DoAction.as:
    //   stop();
    //
    // Note: SOMA.playSound is only available via callbacks in onSpellStart.
    // DefineSprite_6 is attached as a child of the per-level sprites (7-11),
    // so its "punch" sound will fire when the outer level-sprite's timeline
    // attaches it. We capture the sound callback at init time.
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 19,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as: SOMA.playSound("punch")
            // Sound is fired via the stored callback (see onSpellStart).
            this.punchCallback?.("punch");

            // AS DefineSprite_6/frame_1/DoAction_2.as:
            //   t = random(_parent.t) + _parent.t;
            //   _xscale = 0; _yscale = 0;
            //   this.onEnterFrame = function() { ... };
            const parentT = (clip.parent?.vars.t as number) ?? 10;
            const t = Math.floor(Math.random() * parentT) + parentT;
            clip.vars.t = t;
            clip.scaleX = 0;
            clip.scaleY = 0;

            // Attach visual children: sprite3 (flash) and sprite12 (level selector)
            clip.attach(sprite3Sym, "sprite3", 1, ctx);
            clip.attach(sprite12Sym, "sprite12", 2, ctx);
            // Pass level down so sprite12 can read _parent.level
            clip.vars.level = ctx.level;

            // onEnterFrame is set via the SymbolDefinition's onEnterFrame below,
            // but the canonical AS sets it inline in frame_1. We model it via the
            // symbol's onEnterFrame field — it is already wired. Nothing more needed here.
          },
        ],
        [
          18,
          (clip) => {
            // AS DefineSprite_6/frame_19/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction_2.as onEnterFrame:
        //   _xscale = _xscale + t; _yscale = _yscale + t; t /= 1.6;
        const t = clip.vars.t as number;
        if (t === undefined || t === null) {
          return;
        }
        clip.scaleX = clip.scaleX + t / 100;
        clip.scaleY = clip.scaleY + t / 100;
        clip.vars.t = t / 1.6;
      },
    };

    // ---- DefineSprite_7 — level-1 outer timeline (t=7, 91 frames) --
    // AS DefineSprite_7/frame_1/DoAction.as:   t = 7;
    // AS DefineSprite_7/frame_22/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_7/frame_91/DoAction.as:  _parent._parent.removeMovieClip(); stop()
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 91,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as: t = 7
            clip.vars.t = 7;
            clip.vars.level = ctx.level;
            // Attach the punch-impact child
            clip.attach(sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          21,
          () => {
            // AS DefineSprite_7/frame_22/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_7/frame_91/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — level-2 outer timeline (t=11, 106 frames) -
    // AS DefineSprite_8/frame_1/DoAction.as:   t = 11;
    // AS DefineSprite_8/frame_64/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_8/frame_106/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 106,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as: t = 11
            clip.vars.t = 11;
            clip.vars.level = ctx.level;
            clip.attach(sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          63,
          () => {
            // AS DefineSprite_8/frame_64/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_8/frame_106/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_9 — level-3 outer timeline (t=20, 118 frames) -
    // AS DefineSprite_9/frame_1/DoAction.as:   t = 20;
    // AS DefineSprite_9/frame_79/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_9/frame_118/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 118,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9/frame_1/DoAction.as: t = 20
            clip.vars.t = 20;
            clip.vars.level = ctx.level;
            clip.attach(sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_9/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_9/frame_118/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_10 — level-4 outer timeline (t=25, 121 frames) -
    // AS DefineSprite_10/frame_1/DoAction.as:   t = 25;
    // AS DefineSprite_10/frame_79/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_10/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_1/DoAction.as: t = 25
            clip.vars.t = 25;
            clip.vars.level = ctx.level;
            clip.attach(sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_10/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_10/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_11 — level-5 outer timeline (t=33, 121 frames) -
    // AS DefineSprite_11/frame_1/DoAction.as:   t = 33;
    // AS DefineSprite_11/frame_79/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_11/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 121,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_11/frame_1/DoAction.as: t = 33
            clip.vars.t = 33;
            clip.vars.level = ctx.level;
            clip.attach(sprite6Sym, "sprite6", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_11/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_11/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite3Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
  }

  // Stored reference to the punch sound callback so sprite6's frame_1
  // can fire it (sounds played from within library symbol frame scripts
  // need a captured reference since callbacks are only passed to onSpellStart).
  private punchCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_806")
    callbacks.playSound("vlad_806");

    // Capture the sound callback for use in sprite6's frame_1 script
    this.punchCallback = callbacks.playSound;

    // Attach the appropriate level-based outer sprite.
    // DefineSprites 7–11 map to levels 1–5 respectively.
    // root.vars.level is set by harness; also pass via the symbol attach.
    this.root.vars.level = context.level;

    const level = context.level;
    if (level <= 1) {
      this.root.attach(this.sprite7Sym, "outerSprite", 1, context);
    } else if (level === 2) {
      this.root.attach(this.sprite8Sym, "outerSprite", 1, context);
    } else if (level === 3) {
      this.root.attach(this.sprite9Sym, "outerSprite", 1, context);
    } else if (level === 4) {
      this.root.attach(this.sprite10Sym, "outerSprite", 1, context);
    } else {
      this.root.attach(this.sprite11Sym, "outerSprite", 1, context);
    }
  }
}
