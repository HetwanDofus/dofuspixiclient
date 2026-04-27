/**
 * Spell 307 — Setag (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/307/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single animated impact at target cell.
 * No library symbols are referenced via attachMovie — the manifest has
 * no `librarySymbols[]` entries and no `attachMovie` calls in any AS
 * script. The entire visual is the single composite `anim1` animation
 * (129 frames) played at the target cell.
 *
 * AS layout:
 *   - DefineSprite_10 (inner anim, ~85 frames):
 *       frame_85: stop()
 *
 *   - DefineSprite_12 (outer/container, 129 frames):
 *       frame_1:   SOMA.playSound("setag_307")
 *       frame_127: _parent.removeMovieClip() → spell complete
 *
 * The `anim1` animation in the manifest is the composite of
 * DefineSprite_12, so we register it as a single symbol and drive
 * completion from frame 126 (0-based frame_127).
 *
 * signalHit is fired at frame 0 (impact is immediate / first frame of
 * impact animation), which is canonical for single-impact target-cell
 * spells with no separate projectile phase.
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell307 extends RuntimeSpell {
  readonly spellId = 307;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite 129-frame impact animation at target --
    // AS DefineSprite_12/frame_1/DoAction.as: SOMA.playSound("setag_307")
    // AS DefineSprite_12/frame_127/DoAction.as: _parent.removeMovieClip()
    // AS DefineSprite_10/frame_85/DoAction.as: stop()
    // (DefineSprite_10 is an inner sprite within the composite; its
    //  stop() at frame_85 is baked into the composite frames.)
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_12/frame_1/DoAction.as
            // Sound is played in onSpellStart; signalHit fires here
            // as the impact begins on frame 1.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_12/frame_127/DoAction.as
            // _parent.removeMovieClip() → spell complete
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
    // AS DefineSprite_12/frame_1/DoAction.as: SOMA.playSound("setag_307")
    callbacks.playSound("setag_307");

    // Attach the main animation at the target (root is at target cell
    // for TargetCell displayType).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
