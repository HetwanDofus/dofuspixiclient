/**
 * Spell 1105 — (Unknown name, likely a Sacrieur/misc spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1105/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no
 * caster-side reference, no `move`/`shoot`/`duplicate` symbols. The
 * main timeline is a single-anchor impact at the target cell with two
 * authored animation timelines:
 *
 *   - sprite_2 — 622-frame outer aura/ring animation. Placed on the
 *     root (main timeline). Drives spell lifetime.
 *       frame_205: this.end() → signalHit.
 *       frame_238: this.removeMovieClip() → spell complete.
 *
 *   - sprite_4 (DefineSprite_4) — 648-frame looping particle/sparkle.
 *     Placed on the root (main timeline). Has its own looping AS:
 *       frame_1:   gotoAndPlay(random(270) + 3) → random entry point.
 *       frame_640: gotoAndPlay(315)             → loop back.
 *
 * Main timeline:
 *   frame_1: SOMA.playSound("autre_1105"); (main timeline sound)
 *   frame_205: this.end()             → damage popup
 *   frame_238: this.removeMovieClip() → spell complete
 *
 * Both sprites are in `animations[]` only (no `librarySymbols[]`), so
 * we use bare texture keys ("sprite_2", "sprite_4") — NO `lib_` prefix.
 *
 * The main-timeline frame scripts (frame_205 / frame_238) belong to the
 * outer SWF's root timeline. We model the root as a single "root_anim"
 * symbol that drives those frame events. Since there are no explicit
 * `attachMovie` calls in the AS (the sub-sprites are authored children
 * placed by the Flash IDE at frame 1), we attach sprite_2 and sprite_4
 * from onSpellStart and wire the root's frame counters via the root
 * clip's own frameScripts (using a minimal root-timeline sym).
 *
 * To route frame_205 / frame_238 from the root timeline we use the
 * root SpellClip's own onEnterFrame + frame counter, mirroring the
 * outer SWF's 238-frame lifetime.
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

// Bounds from manifest animations[] entries (no librarySymbols present).
const SPRITE_2_BOUNDS = {
  width: 143,
  height: 143,
  offsetX: -80.8,
  offsetY: -74.7,
};

const SPRITE_4_BOUNDS = {
  width: 48.6,
  height: 48.6,
  offsetX: -24.3,
  offsetY: -24.3,
};

export class Spell1105 extends RuntimeSpell {
  readonly spellId = 1105;
  // Single impact at target cell, no projectile, no caster reference.
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite2Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite2Anchor = calculateAnchor(SPRITE_2_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE_4_BOUNDS);

    // ---- sprite_2 — 622-frame outer aura (main impact visual) --------
    // Canonical main-timeline frame_205/DoAction.as: this.end() → signalHit
    // Canonical main-timeline frame_238/DoAction.as: this.removeMovieClip()
    //
    // The main timeline authored child sprite_2 carries these two key
    // frames. We model sprite_2 as a 622-frame symbol and intercept
    // frame 204 (AS frame_205) and frame 237 (AS frame_238) via
    // frameScripts. Note: the AS frame_205 and frame_238 refer to the
    // MAIN TIMELINE frame count, not sprite_2's internal frame count.
    // Since sprite_2 is placed at frame 1 of the main timeline and plays
    // continuously, its internal frame index tracks 1:1 with the main
    // timeline at those points.
    this.sprite2Sym = {
      name: "sprite_2",
      totalFrames: 622,
      frames: textures.getFrames("sprite_2"),
      anchorX: sprite2Anchor.x,
      anchorY: sprite2Anchor.y,
      frameScripts: new Map([
        [
          204,
          (_clip) => {
            // AS scripts/frame_205/DoAction.as: this.end()
            // → damage popup at target cell
            this.runtime.signalHit();
          },
        ],
        [
          237,
          (clip) => {
            // AS scripts/frame_238/DoAction.as: this.removeMovieClip()
            // → spell complete; remove the outer mc
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_4 (DefineSprite_4) — looping sparkle/particle -------
    // Canonical DefineSprite_4/frame_1/DoAction.as:
    //   gotoAndPlay(random(270) + 3)
    //   → random entry point in [3..272] (AS 1-based → runtime 0-based: [2..271])
    //
    // Canonical DefineSprite_4/frame_640/DoAction.as:
    //   gotoAndPlay(315)
    //   → loop back to AS frame 315 = runtime frame 314
    this.sprite4Sym = {
      name: "sprite_4",
      totalFrames: 648,
      frames: textures.getFrames("sprite_4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_4/frame_1/DoAction.as:
            //   gotoAndPlay(random(270) + 3)
            // AS is 1-based; random(270) ∈ [0,269]; result ∈ [3,272]
            // Runtime 0-based: [2,271]
            const target = Math.floor(Math.random() * 270) + 2;
            clip.gotoAndPlay(target);
          },
        ],
        [
          639,
          (clip) => {
            // AS DefineSprite_4/frame_640/DoAction.as:
            //   gotoAndPlay(315)
            // Runtime 0-based: 314
            clip.gotoAndPlay(314);
          },
        ],
      ]),
    };

    this.registry.register(this.sprite2Sym);
    this.registry.register(this.sprite4Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("autre_1105");
    callbacks.playSound("autre_1105");

    // The main SWF timeline implicitly places both sprite_2 and sprite_4
    // at frame 1 as authored children. Attach them here so they start
    // ticking from the next runtime frame.
    this.root.attach(this.sprite2Sym, "sprite2", 1, context);
    this.root.attach(this.sprite4Sym, "sprite4", 2, context);
  }
}
