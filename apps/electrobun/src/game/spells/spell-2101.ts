/**
 * Spell 2101 — Flamme (fire impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2101/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move` or projectile symbol,
 * no `duplicate`, no dual-anchored world-absolute children. The spell
 * consists of a single `shoot` symbol that plays a 84-frame fire animation
 * at the target cell, then removes the parent clip and signals completion.
 *
 * Library symbols:
 *   - shoot — 84-frame fire burst animation at target cell.
 *       frame_1: `_rotation = 0` (cancel any harness rotation); plays
 *                sounds "flamme_2022" and "pet".
 *       frame_70: `_parent.removeMovieClip(); stop()` — signals completion.
 *
 * Main timeline: No explicit main-timeline AS; the `shoot` symbol is the
 * only content, attached by the harness (ProjectileLinear / TargetCell
 * harness path). Since there is no `move` symbol and the single symbol is
 * named `shoot`, this is a TargetCell spell where the harness attaches
 * `shoot` at the target. The `_rotation = 0` in frame_1 confirms it.
 *
 * Sounds are played from inside shoot's frame_1 script (canonical
 * DefineSprite_20_shoot/frame_1/DoAction.as), NOT from the main timeline —
 * so `onSpellStart` only needs to trigger the initial child attach and we
 * drive the sounds from the shoot symbol's frame script.
 *
 * NOTE: DoAction.as and DoAction_2.as at both frame_1 and frame_70 are
 * duplicates (Flash export artifact). We port each unique action once.
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

const SHOOT_BOUNDS = {
  width: 235.7,
  height: 236,
  offsetX: -133.25,
  offsetY: -152.75,
};

export class Spell2101 extends RuntimeSpell {
  readonly spellId = 2101;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame fire burst impact at target cell -------
    // Canonical: DefineSprite_20_shoot
    // frame_1/DoAction.as + frame_1/DoAction_2.as (identical):
    //   _rotation = 0;
    //   SOMA.playSound("flamme_2022");
    //   SOMA.playSound("pet");
    // frame_70/DoAction.as + frame_70/DoAction_2.as (identical):
    //   _parent.removeMovieClip();
    //   stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_20_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            //   SOMA.playSound("flamme_2022");
            //   SOMA.playSound("pet");
            clip.rotation = 0;
            this.soundCallbacks?.playSound("flamme_2022");
            this.soundCallbacks?.playSound("pet");
          },
        ],
        [
          69,
          (clip, _ctx) => {
            // AS DefineSprite_20_shoot/frame_70/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  private soundCallbacks?: SpellCallbacks;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks so the shoot frame_1 script can play sounds.
    this.soundCallbacks = callbacks;
    // Attach the shoot symbol at the target cell (root is at target for
    // TargetCell displayType). The harness doesn't auto-attach `shoot`
    // for TargetCell (only for ProjectileBallistic/Linear) so we do it
    // here from the main timeline implicit placement.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
