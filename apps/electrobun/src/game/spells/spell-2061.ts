/**
 * Spell 2061 — (Unknown name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2061/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single animation (`anim1`)
 * with no library symbols and no projectile/beam logic. It plays an 18-frame
 * impact animation at the target cell. The only AS script is
 * `DefineSprite_2/frame_16/DoAction.as` which calls
 * `_parent.removeMovieClip(); stop();` — this is the outer mc removal that
 * drives spell completion. We signal hit at that same frame (frame 16, index 15)
 * and complete the spell.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline: single `anim1` animation played at target cell. Removed at
 * frame 16 (0-based: 15).
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

export class Spell2061 extends RuntimeSpell {
  readonly spellId = 2061;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 18-frame impact animation at target cell --------
    // AS: DefineSprite_2/frame_16/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    // frame_16 is 1-based → frameScripts.set(15, ...) (0-based)
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS: DefineSprite_2/frame_16/DoAction.as
            // _parent.removeMovieClip(); stop();
            // This is the outer mc removal — signal hit and complete.
            this.runtime.signalHit();
            clip.remove();
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
    // Main timeline frame_1: attach anim1 at the target cell (root is
    // already anchored at target for displayType=11, so attach at local
    // origin (0,0)).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
