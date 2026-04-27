/**
 * Spell 2041 — (Unknown name, likely a Cra/explosion-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2041/scripts/scripts/
 *
 * displayType=11 (TargetCell). Rationale: single `shoot` symbol anchored
 * at target cell, no `move` / `duplicate` / caster-reference logic, no
 * `_parent.cellFrom`/`cellTo` reads. The harness attaches `shoot` via
 * ProjectileLinear only when there is directional logic; here the AS
 * frame_1 simply resets `_rotation = 0`, which is an impact-at-target
 * pattern. No `move` symbol is present in `animations[]`, confirming
 * this is a pure target-cell impact (TargetCell = 11).
 *
 * Library symbols:
 *   - shoot — 39-frame animated impact composite. No library-symbol entry
 *     (manifest `librarySymbols` is absent); the `animations[]` entry
 *     named "shoot" IS the rendered content, so we use
 *     `textures.getFrames("shoot")` (no `lib_` prefix).
 *     frame_1 (index 0): `_rotation = 0` — ensures upright regardless of
 *       any harness-applied rotation.
 *     frame_37 (index 36): `_parent.removeMovieClip(); stop();` → removes
 *       outer mc + signals spell complete.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("explosion"); stop().
 *
 * Hit signal: fired at the canonical impact moment, which is frame_1 of
 * the shoot symbol (the explosion starts immediately on landing — the
 * spell registers hit as soon as the shoot clip is shown). We fire
 * signalHit at frame index 0 (first visible frame of the impact).
 *
 * The harness for TargetCell (11) does NOT attach `shoot` automatically
 * (that is a ProjectileLinear/Ballistic concern). For TargetCell we
 * attach `shoot` ourselves from `onSpellStart`, which is the canonical
 * pattern for impact-only spells.
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
  width: 179.2,
  height: 107.05,
  offsetX: -89.75,
  offsetY: -53.4,
};

export class Spell2041 extends RuntimeSpell {
  readonly spellId = 2041;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 39-frame impact animation -----------------------
    // No librarySymbols entry in manifest; "shoot" lives in animations[].
    // Texture key is "shoot" (no lib_ prefix).
    //
    // AS DefineSprite_5_shoot/frame_1/DoAction.as:
    //   _rotation = 0;
    //
    // AS DefineSprite_5_shoot/frame_37/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 39,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_shoot/frame_1/DoAction.as: _rotation = 0
            clip.rotation = (0 * Math.PI) / 180;
            // Impact begins — signal hit so the combat sequencer can
            // show damage numbers. displayType=11 so harness does NOT
            // fire signalHit automatically.
            this.runtime.signalHit();
          },
        ],
        [
          36,
          (clip) => {
            // AS DefineSprite_5_shoot/frame_37/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("explosion");
    callbacks.playSound("explosion");

    // Attach the shoot symbol at the target cell (container origin for
    // TargetCell). The harness has already positioned the container at
    // cellTo, so we attach at local (0, 0).
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
