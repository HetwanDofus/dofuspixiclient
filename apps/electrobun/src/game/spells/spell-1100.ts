/**
 * Spell 1100 — (Dodge/Lakam effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1100/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * no attachMovie calls — a single authored animation plays at the target cell.
 * The manifest has one animations[] entry ("anim1", 84 frames) and no
 * librarySymbols[]. The SWF main timeline places a DefineSprite_15 child that
 * plays "dodge_1100" on frame_1 and calls _parent.removeMovieClip() on frame_82.
 *
 * Library symbols:
 *   - anim1 — 84-frame composite animation at target cell. frame_1 plays
 *     "dodge_1100" sound; frame_82 removes parent and signals spell completion.
 *
 * Main timeline: SOMA.playSound("lakam_402"); attaches the anim1 sprite.
 *
 * Since librarySymbols[] is empty in the manifest, we use bare "anim1" as
 * the texture key (NO lib_ prefix). The anim1 symbol is the only content;
 * it is attached from onSpellStart and drives its own lifecycle via frameScripts.
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
  height: 312.15,
  offsetX: -174,
  offsetY: -410.15,
};

export class Spell1100 extends RuntimeSpell {
  readonly spellId = 1100;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 84-frame impact animation at target cell --------
    // AS DefineSprite_15/frame_1/DoAction.as:
    //   SOMA.playSound("dodge_1100");
    // AS DefineSprite_15/frame_82/DoAction.as:
    //   _parent.removeMovieClip();
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 84,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_15/frame_1/DoAction.as:
            //   SOMA.playSound("dodge_1100");
            // Sound is played via onSpellStart for the main timeline entry;
            // the DefineSprite_15 frame_1 also plays dodge_1100 when the
            // sprite begins. We fire it here via the stored callback.
            this.soundCallback?.("dodge_1100");
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_15/frame_82/DoAction.as:
            //   _parent.removeMovieClip();
            // frame_82 in AS → index 81 here (0-based).
            // _parent is the root (outer mc) → signal completion.
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
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("lakam_402");
    callbacks.playSound("lakam_402");

    // Store callback so frameScripts can fire dodge_1100 sound.
    this.soundCallback = callbacks.playSound;

    // Signal hit at the start of impact (displayType=11, no projectile).
    this.runtime.signalHit();

    // Attach the main animation sprite at the root (target cell origin).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }

  private soundCallback?: (id: string) => void;
}
