/**
 * Spell 814 — Vlad (Sacrieur/Sram dark lance).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/814/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Rationale:
 *   - The spell has a single `shoot` symbol with no `move` symbol.
 *   - frame_1 of shoot sets `_rotation = _parent.angle`, which is the
 *     canonical linear-projectile pattern: the container is rotated to
 *     face the target and `shoot` lives at the target-relative offset
 *     inside the rotated container.
 *   - No ballistic arc, no duplicate, no dual-anchored world placement.
 *
 * Library symbols:
 *   - `shoot` — 90-frame animated lance beam. frame_1 sets rotation to
 *     parent angle (overridden by the harness-applied angle anyway, but
 *     the canonical AS explicitly does it). frame_88 calls
 *     `_parent.removeMovieClip()` — signals spell completion.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("vlad_805").
 *
 * The harness (displayType=20) attaches `shoot` at the target-local
 * offset inside the rotated container and rotates the container to face
 * the target. The shoot symbol's frame_1 then re-applies `_rotation =
 * _parent.angle` (in degrees → radians here). frame_88 removes the
 * parent outer mc and completes the spell.
 *
 * signalHit: fired at frame_1 of shoot (first visible impact frame),
 * since the harness does NOT auto-signal for displayType 20.
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
  width: 509.1,
  height: 70.1,
  offsetX: -5,
  offsetY: -37.6,
};

export class Spell814 extends RuntimeSpell {
  readonly spellId = 814;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 90-frame animated lance beam --------------------
    // AS: DefineSprite_7_shoot/frame_1/DoAction.as
    //   _rotation = _parent.angle;
    // AS: DefineSprite_7_shoot/frame_88/DoAction.as
    //   _parent.removeMovieClip();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 90,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_7_shoot/frame_1/DoAction.as:
            //   _rotation = _parent.angle;
            // The harness has already rotated the root container to face
            // the target. This re-applies the angle on the shoot clip
            // itself in degrees → radians.
            const angleDeg = (ctx.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
            // signalHit at first impact frame (displayType 20 — harness
            // does not auto-signal hit).
            this.runtime.signalHit();
          },
        ],
        [
          87,
          (clip) => {
            // AS DefineSprite_7_shoot/frame_88/DoAction.as:
            //   _parent.removeMovieClip();
            // The outer mc is the spell root — remove it and complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("vlad_805");
    callbacks.playSound("vlad_805");
  }
}
