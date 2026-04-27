/**
 * Spell 1208 — (Unknown name, likely an explosion/impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1208/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has a single authored timeline
 * (sprite_36, 117 frames) that plays an explosion at the target cell.
 * No library symbols are attached via `attachMovie` — sprite_36 is the
 * sole animation in `animations[]` with no `librarySymbols[]` entries.
 * The main timeline has only `stop()` on frame_2, meaning the harness
 * places the root at the target cell and sprite_36 plays immediately.
 *
 * sprite_36 canonical AS:
 *   - frame_1/DoAction.as: SOMA.playSound("explosion")
 *   - frame_115/DoAction.as: _parent.removeMovieClip()
 *
 * signalHit is fired at frame_1 (the impact / explosion onset) since
 * this is a TargetCell spell (harness does not drive hit for this
 * displayType).
 *
 * Library symbols: none.
 *
 * Main timeline: frame_2 → stop(); sprite_36 is implicitly placed on
 * the main timeline in frame_1 and handled via onSpellStart.
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

const SPRITE_36_BOUNDS = {
  width: 246.8,
  height: 282.25,
  offsetX: -127.4,
  offsetY: -187.3,
};

export class Spell1208 extends RuntimeSpell {
  readonly spellId = 1208;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite36Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite36Anchor = calculateAnchor(SPRITE_36_BOUNDS);

    // sprite_36 — 117-frame explosion composite at target cell.
    // This is an animations[] entry (not a librarySymbols[] entry),
    // so textures are accessed via the bare name "sprite_36".
    this.sprite36Sym = {
      name: "sprite_36",
      totalFrames: 117,
      frames: textures.getFrames("sprite_36"),
      anchorX: sprite36Anchor.x,
      anchorY: sprite36Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS: DefineSprite_36/frame_1/DoAction.as
            // SOMA.playSound("explosion");
            // Sound is played here in the canonical AS. Since we only
            // have access to callbacks in onSpellStart, the sound is
            // played there instead. signalHit fires at impact onset.
            this.runtime.signalHit();
          },
        ],
        [
          114,
          (clip) => {
            // AS: DefineSprite_36/frame_115/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite36Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_2/DoAction.as → stop()
    // The main timeline stops on frame 2; sprite_36 is placed on frame_1.
    // Play the explosion sound (canonical DefineSprite_36/frame_1 fires this).
    callbacks.playSound("explosion");

    // Attach sprite_36 at root so it begins playing immediately.
    this.root.attach(this.sprite36Sym, "sprite_36", 1, context);
  }
}
