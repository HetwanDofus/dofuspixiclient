/**
 * Spell 0 — Generic impact animation (no named spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/0/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single authored timeline
 * (`anim1`, 94 frames) with no library symbols and no projectile motion.
 * It plays at the target cell and removes itself on frame 93.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Main timeline (DefineSprite_15):
 *   - frame_1:  SOMA.playSound("gonfle")
 *   - frame_93: stop(); _parent.removeMovieClip() → spell complete
 *
 * The single `anim1` animation is registered as a container-with-frames
 * symbol and attached at root in onSpellStart.
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
  width: 336.15,
  height: 340.95,
  offsetX: -174,
  offsetY: -278.25,
};

export class Spell0 extends RuntimeSpell {
  readonly spellId = 0;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — 94-frame impact animation at target cell.
    // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("gonfle")
    // AS DefineSprite_15/frame_93/DoAction.as: stop(); _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 94,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          92,
          (clip) => {
            // AS DefineSprite_15/frame_93/DoAction.as: stop(); _parent.removeMovieClip()
            clip.stop();
            clip.remove();
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
    // AS DefineSprite_15/frame_1/DoAction.as: SOMA.playSound("gonfle")
    callbacks.playSound("gonfle");

    // Attach anim1 at root so it starts ticking from the next runtime frame.
    // displayType=11 (TargetCell): root container is already positioned at
    // the target cell by the harness / spell-view.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Signal hit immediately on impact (no projectile; effect lands at target).
    this.runtime.signalHit();
  }
}
