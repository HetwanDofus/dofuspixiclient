/**
 * Spell 806 — Vlad (Sram fist-strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/806/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no move/shoot/duplicate/
 * dual-anchor pattern — it is a pure impact animation at the target cell.
 * No librarySymbols[] entries in the manifest; the single `animations: [{name:"anim1"}]`
 * entry drives the visual.
 *
 * The manifest has NO `librarySymbols[]` array. All DefineSprite_* entries are
 * container-only level-selector / timer sprites that the main timeline (`anim1`)
 * composes internally. The manifest's `animations[0]` ("anim1", 5 frames) is the
 * sole rendered content.
 *
 * Sprite layout (from scripts):
 *
 *   DefineSprite_3  — single-frame rotation randomiser + alpha 50%.
 *                     frame_1: _rotation = random(360); _alpha = 50.
 *
 *   DefineSprite_12 — level-selector clip.
 *                     frame_1: gotoAndStop(_parent.level) — jumps to frame
 *                     equal to spell level (1-6) selecting which sub-sprite plays.
 *
 *   DefineSprite_6  — level-variant container for the "fast" levels (t=random(t)+t,
 *                     grows xscale/yscale by t each frame, t/=1.6).
 *                     frame_1: SOMA.playSound("punch") + scale growth init.
 *                     frame_19: stop().
 *
 *   DefineSprite_7  — 91-frame variant (t=7). frame_22: signalHit.
 *                     frame_91: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_8  — 106-frame variant (t=11). frame_64: signalHit.
 *                     frame_106: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_9  — 118-frame variant (t=20). frame_79: signalHit.
 *                     frame_118: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_10 — 121-frame variant (t=25). frame_79: signalHit.
 *                     frame_121: _parent._parent.removeMovieClip → complete.
 *
 *   DefineSprite_11 — 121-frame variant (t=33). frame_79: signalHit.
 *                     frame_121: _parent._parent.removeMovieClip → complete.
 *
 * Because the manifest has no librarySymbols[] entries we do NOT use a `lib_`
 * prefix for the "anim1" texture key. The `anim1` animation is a 5-frame composite
 * used across the container sprites above. The container sprites themselves are
 * registered as container-only (frames: []).
 *
 * Main timeline frame_1: SOMA.playSound("vlad_806").
 *
 * The spell_level-to-DefineSprite mapping (from DefineSprite_12/frame_1 →
 * gotoAndStop(_parent.level)) selects:
 *   level 1 → DefineSprite_6  (frame_1 of sprite_12 = stop at 1 = sprite6 variant)
 *   level 2 → DefineSprite_7
 *   level 3 → DefineSprite_8
 *   level 4 → DefineSprite_9
 *   level 5 → DefineSprite_10
 *   level 6 → DefineSprite_11
 *
 * In practice, the RuntimeSpell drives a single `anim1` symbol at target.
 * The per-level containers are modelled so the correct longest-lived one
 * fires complete(). We model each as a separate SymbolDefinition with its
 * own frameScripts; DefineSprite_12 picks the right one by level.
 *
 * NOTE: The `anim1` animation has 5 frames; it is looped by the container
 * sprites (no stop() until the hit/end frames), so it naturally cycles
 * visually while the container counts frames.
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

const ANIM1_BOUNDS = {
  width: 238.25,
  height: 242.35,
  offsetX: -84.65,
  offsetY: -144.45,
};

export class Spell806 extends RuntimeSpell {
  readonly spellId = 806;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so DefineSprite_12 can forward to the right sub-symbol.
  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private sprite3Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ---- anim1 — the rendered 5-frame composite sprite -----------
    // No library symbol prefix — manifest has only animations[], no librarySymbols[].
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 5,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
    };

    // ---- DefineSprite_3 — random rotation + 50% alpha -----------
    // AS DefineSprite_3/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _alpha = 50;
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: _rotation = random(360); _alpha = 50;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.alpha = 50 / 100;
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 — level 1 variant (shortest, t grows scale) --
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   SOMA.playSound("punch");
    // AS DefineSprite_6/frame_1/DoAction_2.as:
    //   t = random(_parent.t) + _parent.t;
    //   _xscale = 0; _yscale = 0;
    //   this.onEnterFrame = function() {
    //     _xscale += t; _yscale += t; t /= 1.6;
    //   };
    // AS DefineSprite_6/frame_19/DoAction.as: stop();
    //
    // _parent.t is set by the outer container on frame_1 of whichever
    // DefineSprite_N is active. For DefineSprite_6 the outer container
    // doesn't set a `t` itself — in the original SWF DefineSprite_12
    // holds a `t` from its frame_1 if any, but here DefineSprite_6 is
    // embedded inside DefineSprite_12. We capture `t` from the parent
    // clip's vars at attach time.
    //
    // Since DefineSprite_6 is reached when level=1 and the parent
    // (sprite12) is attached after setting root.vars.level, `_parent.t`
    // resolves to the `t` var on the sprite12 clip. sprite12 gets its
    // `t` forwarded from whatever outer container it's nested in. In our
    // model, sprite12 is directly in root; we seed `t` on it from the
    // level-selected sprite's own `t` value. For sprite6, the canonical
    // t isn't set by an outer DefineSprite_N (it IS the selected variant);
    // in the original SWF DefineSprite_6 is placed directly inside
    // DefineSprite_12, so `_parent.t` is DefineSprite_12's `t`. We
    // approximate by using the `t` on the clip's parent (sprite12),
    // which we seed to a sensible default (matching the other levels).
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 19,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (_clip) => {
        // onLoad is a no-op; frame_1 script below seeds vars.
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as: SOMA.playSound("punch")
            // Sound is played via callbacks captured in onSpellStart. Here
            // we attach the anim1 visual and seed the scale-growth vars.
            //
            // AS DefineSprite_6/frame_1/DoAction_2.as:
            //   t = random(_parent.t) + _parent.t;
            //   _xscale = 0; _yscale = 0;
            const parentT = (clip.parent?.vars.t as number) ?? 7;
            const t = Math.floor(Math.random() * parentT) + parentT;
            clip.vars.t = t;
            clip.scaleX = 0;
            clip.scaleY = 0;

            // Attach the anim1 visual inside this container.
            clip.attach(this.anim1Sym, "anim1", 1, ctx);

            // Set up onEnterFrame for scale growth.
            clip.onEnterFrame = (c) => {
              // AS: _xscale += t; _yscale += t; t /= 1.6;
              const tv = c.vars.t as number;
              c.scaleX += tv / 100;
              c.scaleY += tv / 100;
              c.vars.t = tv / 1.6;
            };
          },
        ],
        [
          18,
          (clip) => {
            // AS DefineSprite_6/frame_19/DoAction.as: stop();
            clip.stop();
            clip.onEnterFrame = null;
          },
        ],
      ]),
    };

    // ---- DefineSprite_7 — level 2 variant (91 frames, t=7) ------
    // AS DefineSprite_7/frame_1/DoAction.as: t = 7;
    // AS DefineSprite_7/frame_22/DoAction.as: this.end(); (signalHit)
    // AS DefineSprite_7/frame_91/DoAction.as: _parent._parent.removeMovieClip(); stop();
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
            // AS DefineSprite_7/frame_1/DoAction.as: t = 7;
            clip.vars.t = 7;
            clip.attach(this.anim1Sym, "anim1", 1, ctx);
          },
        ],
        [
          21,
          () => {
            // AS DefineSprite_7/frame_22/DoAction.as: this.end(); → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_7/frame_91/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — level 3 variant (106 frames, t=11) ----
    // AS DefineSprite_8/frame_1/DoAction.as: t = 11;
    // AS DefineSprite_8/frame_64/DoAction.as: this.end(); (signalHit)
    // AS DefineSprite_8/frame_106/DoAction.as: _parent._parent.removeMovieClip(); stop();
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
            // AS DefineSprite_8/frame_1/DoAction.as: t = 11;
            clip.vars.t = 11;
            clip.attach(this.anim1Sym, "anim1", 1, ctx);
          },
        ],
        [
          63,
          () => {
            // AS DefineSprite_8/frame_64/DoAction.as: this.end(); → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_8/frame_106/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_9 — level 4 variant (118 frames, t=20) ----
    // AS DefineSprite_9/frame_1/DoAction.as: t = 20;
    // AS DefineSprite_9/frame_79/DoAction.as: this.end(); (signalHit)
    // AS DefineSprite_9/frame_118/DoAction.as: _parent._parent.removeMovieClip(); stop();
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
            // AS DefineSprite_9/frame_1/DoAction.as: t = 20;
            clip.vars.t = 20;
            clip.attach(this.anim1Sym, "anim1", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_9/frame_79/DoAction.as: this.end(); → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          117,
          (clip) => {
            // AS DefineSprite_9/frame_118/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_10 — level 5 variant (121 frames, t=25) ---
    // AS DefineSprite_10/frame_1/DoAction.as: t = 25;
    // AS DefineSprite_10/frame_79/DoAction.as: this.end(); (signalHit)
    // AS DefineSprite_10/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop();
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
            // AS DefineSprite_10/frame_1/DoAction.as: t = 25;
            clip.vars.t = 25;
            clip.attach(this.anim1Sym, "anim1", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_10/frame_79/DoAction.as: this.end(); → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_10/frame_121/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_11 — level 6 variant (121 frames, t=33) ---
    // AS DefineSprite_11/frame_1/DoAction.as: t = 33;
    // AS DefineSprite_11/frame_79/DoAction.as: this.end(); (signalHit)
    // AS DefineSprite_11/frame_121/DoAction.as: _parent._parent.removeMovieClip(); stop();
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
            // AS DefineSprite_11/frame_1/DoAction.as: t = 33;
            clip.vars.t = 33;
            clip.attach(this.anim1Sym, "anim1", 1, ctx);
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_11/frame_79/DoAction.as: this.end(); → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_11/frame_121/DoAction.as:
            //   _parent._parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_12 — level-selector clip -------------------
    // AS DefineSprite_12/frame_1/DoAction.as:
    //   gotoAndStop(_parent.level);
    //
    // The sprite has one authored frame per level (1-6). On frame 1 it
    // reads _parent.level and jumps to that frame index. Each "frame N"
    // of sprite_12 in the original SWF contained a placed child of the
    // corresponding DefineSprite_6..11. We model this by: frame_1 reads
    // the level, attaches the matching sub-symbol, and stops.
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 6,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_12/frame_1/DoAction.as:
            //   gotoAndStop(_parent.level);
            const level = (clip.parent?.vars.level as number) ?? 1;
            const target = Math.max(1, Math.min(6, Math.floor(level)));

            // Map level → sub-symbol and attach it.
            const subSymMap: Record<number, SymbolDefinition> = {
              1: this.sprite6Sym,
              2: this.sprite7Sym,
              3: this.sprite8Sym,
              4: this.sprite9Sym,
              5: this.sprite10Sym,
              6: this.sprite11Sym,
            };
            const subSym = subSymMap[target];
            if (subSym) {
              clip.attach(subSym, `levelVariant`, 1, ctx);
            }
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite11Sym);
    this.registry.register(this.sprite12Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_806");
    callbacks.playSound("vlad_806");

    // Seed level on root.vars so sprite12 (and its children) can read
    // _parent.level via clip.parent?.vars.level.
    this.root.vars.level = context.level;

    // Attach sprite3 (rotation randomiser) and sprite12 (level selector)
    // at root — these are the implicit main-timeline placements.
    this.root.attach(this.sprite3Sym, "sprite3", 1, context);
    this.root.attach(this.sprite12Sym, "sprite12", 2, context);

    // DefineSprite_6/frame_1 plays "punch" — capture and fire it.
    // In the original SWF that sound fires when sprite6 is active
    // (level 1). For other levels the sound isn't emitted by the
    // sub-sprite, but the manifest lists it as a top-level sound at
    // frame 0. We fire it here for all levels, matching the manifest
    // declaration.
    callbacks.playSound("punch");
  }
}
