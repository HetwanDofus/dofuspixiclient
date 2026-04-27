/**
 * Spell 403 — Lakam (Feca or similar, impact at target cell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/403/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * single impact animation anchored at the target cell. The top-level
 * main timeline plays a sound. The canonical SWF has two authored
 * sprites composited into `anim1`:
 *
 *   - DefineSprite_9 — outer container (82 frames). frame_1 seeds `t=17`.
 *     frame_82 calls `_parent.removeMovieClip()` + stop() → spell complete.
 *
 *   - DefineSprite_6 — particle container (single frame). Has a placed
 *     child (PlaceObject2_5_1) whose clip events drive particle physics:
 *       onLoad (×2): seed _rotation, t (scale), vx.
 *       onEnterFrame: decay _yscale by /1.1, fade _alpha by -2.3,
 *                     drift _X += (vx *= 0.97).
 *
 *   - DefineSprite_2 — 13-frame sub-animation. frame_13: stop(). Used as
 *     the impact flash composite. We signal hit at its stop frame.
 *
 *   - DefineSprite_5 — single-frame particle. frame_1: _rotation = random(360).
 *
 * Because librarySymbols[] is empty in the manifest, all symbols are in
 * the animations[] list. The main rendered animation is `anim1` (84 frames).
 * We register `anim1` as the sole symbol and drive completion from its
 * canonical removal frame (frame 82 → index 81, since frame_82 maps to
 * index 81 in the DoAction — but the AS says `frame_82` which is 0-based
 * index 81). signalHit is fired at DefineSprite_2's stop frame (frame_13
 * → index 12 within the anim1 composite timeline).
 *
 * Main timeline: SOMA.playSound("lakam_401b").
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
  width: 145.25,
  height: 145.25,
  offsetX: -47.95,
  offsetY: -69.45,
};

export class Spell403 extends RuntimeSpell {
  readonly spellId = 403;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main impact composite animation (84 frames) ----
    // This is the sole top-level animation. No librarySymbols[] in the
    // manifest, so we use textures.getFrames("anim1") (no lib_ prefix).
    //
    // The canonical AS layout embeds:
    //   DefineSprite_9 (outer, 82 frames):
    //     frame_1/DoAction.as: t = 17  (seeds an internal counter)
    //     frame_82/DoAction.as: _parent.removeMovieClip(); stop();
    //
    //   DefineSprite_6 (particle, 1 frame, placed child):
    //     onClipEvent(load) #1: _rotation = random(360); t = random(50)+20;
    //                           _xscale = t; _yscale = t;
    //     onClipEvent(load) #2: vx = 1.65 + 5 * Math.random();
    //     onClipEvent(enterFrame): _yscale /= 1.1; _alpha -= 2.3;
    //                              _X += (vx *= 0.97);
    //
    //   DefineSprite_2 (impact flash, 13 frames):
    //     frame_13/DoAction.as: stop();  → signalHit here
    //
    //   DefineSprite_5 (particle, 1 frame):
    //     frame_1/DoAction.as: _rotation = random(360);
    //
    // Since the manifest provides `anim1` as a single composite animation
    // with 84 frames of pre-rendered SVGs, we drive the timeline using
    // those frames directly. The per-symbol logic is faithfully represented
    // in the frameScripts below at the canonical frame indices.

    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 84,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_9/frame_1/DoAction.as
            // t = 17  (internal counter seed — stored on vars for fidelity)
            clip.vars.t = 17;
          },
        ],
        [
          12,
          (_clip) => {
            // AS DefineSprite_2/frame_13/DoAction.as: stop();
            // DefineSprite_2 is the 13-frame impact flash embedded in
            // anim1. frame_13 (0-based index 12) is when it stops —
            // this is the canonical hit signal moment.
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_9/frame_82/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            // frame_82 is 0-based index 81. This removes the outer mc
            // and ends the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_401b");
    callbacks.playSound("lakam_401b");

    // Attach the main animation at root. For TargetCell (displayType=11)
    // the container is already anchored at the target cell, so we place
    // anim1 at (0,0) within it.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
