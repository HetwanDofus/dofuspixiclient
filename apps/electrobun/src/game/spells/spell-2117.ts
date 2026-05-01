/**
 * Spell 2117 — (Unknown name, likely a simple impact effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2117/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single animation (`anim1`)
 * with no library symbols and no projectile/beam logic. The manifest
 * contains no `librarySymbols[]` entries and no `attachMovie` calls in
 * the AS scripts. The sole AS script is:
 *
 *   DefineSprite_2/frame_16/DoAction.as:
 *     _parent.removeMovieClip();
 *     stop();
 *
 * This means the animation plays through 18 frames, and at frame 16
 * (0-based: frame index 15) the sprite removes its parent (the outer mc)
 * and signals spell completion.
 *
 * Library symbols: none — `librarySymbols[]` is absent from the manifest.
 *
 * Main timeline: single `anim1` animation, no sound, no explicit child
 * attaches beyond what the harness provides.
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
  width: 284.6,
  height: 149.55,
  offsetX: -143.2,
  offsetY: -74.6,
};

export class Spell2117 extends RuntimeSpell {
  readonly spellId = 2117;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — single 18-frame impact animation ---------------
    // The manifest has no librarySymbols[] entries. The animation
    // `anim1` is the main (and only) visual content. We register it
    // as a SymbolDefinition so it can be attached to the root clip
    // from onSpellStart and driven by the runtime tick loop.
    //
    // AS DefineSprite_2/frame_16/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    //
    // frame_16 in AS is 1-based → frameScripts.set(15, ...) here.
    // `_parent.removeMovieClip()` removes the outer mc → complete().
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_2/frame_16/DoAction.as
          // frame_16 (1-based) → index 15 (0-based)
          15,
          (clip) => {
            // _parent.removeMovieClip() — removes the outer mc.
            // Signal hit at the impact frame before completing.
            this.runtime.signalHit();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound() call exists in the canonical main-timeline
    // scripts for this spell.
    //
    // Attach the anim1 symbol to root so the runtime can tick it.
    // For displayType=11 (TargetCell), the harness places the
    // container at the target cell; anim1 at root local (0,0) renders
    // centred on the target.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
