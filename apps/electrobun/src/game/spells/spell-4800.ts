/**
 * Spell 4800 — (Unknown name, likely a Sacrieur or misc spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/4800/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no library symbols, no
 * attachMovie calls, no projectile motion, and no caster references.
 * The sole content is a single `animations: [{name: "anim1", frameCount: 159}]`
 * entry — a composite 159-frame animation anchored at the target cell.
 *
 * AS layout:
 *   - DefineSprite_36 is the main animation sprite (159 frames).
 *   - frame_34/DoAction.as: `this.end()` → signalHit (damage popup).
 *   - frame_157/DoAction.as: `_parent.removeMovieClip()` → spell complete.
 *
 * No library symbols, no librarySymbols[] entries in manifest, no particles,
 * no sounds recorded in the scripts (no SOMA.playSound). The anim1 timeline
 * is the top-level animation placed directly on the main timeline.
 *
 * Library symbols: none.
 * Main timeline: attaches anim1 at root via onSpellStart; no sound.
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
  width: 82.45,
  height: 108,
  offsetX: -45.3,
  offsetY: -84,
};

export class Spell4800 extends RuntimeSpell {
  readonly spellId = 4800;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 159-frame composite impact animation at target ----
    // No library symbol prefix — anim1 is in animations[] only, not
    // librarySymbols[]. Use bare "anim1" key (no "lib_" prefix).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 159,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          33,
          (_clip) => {
            // AS DefineSprite_36/frame_34/DoAction.as: this.end()
            // → damage popup / hit signal at frame 34 (0-based: 33).
            this.runtime.signalHit();
          },
        ],
        [
          156,
          (clip) => {
            // AS DefineSprite_36/frame_157/DoAction.as:
            //   _parent.removeMovieClip();
            // The outer mc removal → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: no SOMA.playSound found in scripts.
    // Attach anim1 at the root so it starts ticking from the next frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
