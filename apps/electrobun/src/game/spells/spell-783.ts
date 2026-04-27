/**
 * Spell 783 — (Unknown name, likely a buff/self-aura spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/783/scripts/scripts/
 *
 * displayType=11 (TargetCell). The manifest has no `librarySymbols[]` and
 * no `move`/`shoot`/`duplicate` symbols — this is a single flat animation
 * (`anim1`, 141 frames) placed at the target cell. The canonical AS lives
 * entirely on `DefineSprite_16` (the main animated sprite):
 *   - frame_1:   SOMA.playSound("gonfle")
 *   - frame_139: stop(); _parent.removeMovieClip();
 *
 * Because there are no library symbols, `registerSymbols` registers a
 * single `anim1` symbol that drives the full visual timeline. The
 * `onSpellStart` override attaches it to root and plays the sound.
 *
 * Signal timing:
 *   - signalHit: fired at frame 1 (frame index 0) — the animation is an
 *     impact effect that starts immediately at the target cell.
 *   - complete:  fired at frame 139 (index 138) via the canonical
 *     `_parent.removeMovieClip()` script.
 *
 * Library symbols: none (manifest.librarySymbols is absent/empty).
 * Main timeline: attaches anim1 at root; plays "gonfle" sound on entry.
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
  width: 518,
  height: 391.85,
  offsetX: -249.15,
  offsetY: -278.25,
};

export class Spell783 extends RuntimeSpell {
  readonly spellId = 783;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 141-frame impact animation at target cell -------
    // AS DefineSprite_16/frame_1/DoAction.as:  SOMA.playSound("gonfle")
    // AS DefineSprite_16/frame_139/DoAction.as: stop(); _parent.removeMovieClip();
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 141,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_16/frame_1/DoAction.as:
            // SOMA.playSound("gonfle") — sound is handled in onSpellStart
            // via callbacks.playSound. Also signal hit at impact start.
            this.runtime.signalHit();
          },
        ],
        [
          138,
          (clip) => {
            // AS DefineSprite_16/frame_139/DoAction.as:
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_16/frame_1/DoAction.as: SOMA.playSound("gonfle")
    callbacks.playSound("gonfle");
    // Attach the main animation to root so it starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
