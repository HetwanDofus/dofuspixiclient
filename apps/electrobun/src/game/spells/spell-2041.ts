/**
 * Spell 2041 — Unknown (explosion impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2041/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move` symbol, no caster-side
 * reference, no `duplicate` symbol, and no `_parent.cellFrom` / `_parent.cellTo`
 * reads in the scripts. The single symbol `shoot` is a 39-frame impact animation
 * anchored at the target cell. This matches the TargetCell pattern exactly.
 *
 * Library symbols:
 *   None in `librarySymbols[]` — manifest.json has no librarySymbols array.
 *   `shoot` appears only in `animations[]`, so it is a top-level authored
 *   animation, NOT a library symbol. It is registered as a container-driven
 *   symbol with `frames: textures.getFrames("shoot")` (NO `lib_` prefix).
 *
 * Symbol behaviour:
 *   - `shoot` — 39-frame impact burst.
 *       frame_1 (index 0): `_rotation = 0` — reset any harness-applied rotation.
 *       frame_37 (index 36): `_parent.removeMovieClip(); stop()` — outer mc
 *           removal triggers spell complete + signalHit.
 *
 * Main timeline: `SOMA.playSound("explosion"); stop();` — played in onSpellStart.
 *
 * Signal ordering:
 *   - signalHit: fired from frame 36 of `shoot` (canonical impact frame).
 *   - complete: fired from the same frame 36 script (canonical removal).
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

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 39-frame impact burst at target cell -----------
    // Anchored at target (TargetCell displayType). The harness attaches
    // nothing automatically for TargetCell; onSpellStart attaches shoot
    // to the root so it begins playing immediately.
    //
    // AS DefineSprite_5_shoot/frame_1/DoAction.as:
    //   _rotation = 0;
    //
    // AS DefineSprite_5_shoot/frame_37/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 39,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_shoot/frame_1/DoAction.as
            // _rotation = 0 — reset any rotation; keep upright at target.
            clip.rotation = 0;
          },
        ],
        [
          36,
          (clip) => {
            // AS DefineSprite_5_shoot/frame_37/DoAction.as
            // _parent.removeMovieClip(); stop();
            // The outer mc (_parent of shoot) is the root, so this
            // signals both hit and completion.
            this.runtime.signalHit();
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
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("explosion");
    callbacks.playSound("explosion");

    // Attach `shoot` to root at depth 1 so it begins playing from frame 1.
    // For TargetCell the root container is positioned at the target cell by
    // the harness; shoot renders centred on the target.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
