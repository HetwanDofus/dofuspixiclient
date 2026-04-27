/**
 * Spell 812 — Vlad (BeamLine spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/812/scripts/scripts/
 *
 * displayType=40 (BeamLine). The spell has a single `duplicate` symbol
 * that is dropped periodically along the caster→target line by the harness.
 * No `shoot` symbol exists (no BeamLineAlt), so displayType=40 (not 41).
 *
 * Library symbols: none in `librarySymbols[]` — the manifest has only
 * `animations: [{ name: "duplicate", ... }]`. The `duplicate` symbol is
 * registered with bare key `"duplicate"` and textures.getFrames("duplicate").
 *
 * duplicate symbol (126 frames):
 *   - frame_1 (DoAction.as): SOMA.playSound("vlad_812")
 *   - frame_1 (DoAction_2.as): random scale 50–110%, matching yscale, random
 *     rotation in [-10, +19] degrees.
 *   - frame_124 (DoAction.as): this.removeMovieClip()
 *
 * DefineSprite_11/frame_1: gotoAndStop(random(6) + 1) — sub-sprite inside
 * duplicate that randomly selects one of 6 sub-frames. This sprite is
 * part of the authored composite; we cannot attach it separately but the
 * composite texture already bakes its visuals. Tracked for completeness.
 *
 * DefineSprite_5/frame_55, DefineSprite_12/frame_85, DefineSprite_13/frame_124:
 * All just stop() — internal authored sub-sprites within the duplicate
 * composite; no attachMovie calls needed.
 *
 * Main timeline: no explicit main-timeline scripts beyond what the harness
 * handles. The sound fires from duplicate's frame_1 script.
 *
 * signalHit: fired by the BeamLine harness automatically when the line
 * traversal completes (when dist > fullDist). We do NOT call it manually.
 *
 * complete(): fired from duplicate's frame_124 script (this.removeMovieClip)
 * — but because individual duplicates removing themselves does NOT end the
 * spell, we need to fire complete() from the LAST duplicate to be placed.
 * However, since all duplicates play the same 126-frame timeline and are
 * placed at roughly the same time, the harness signals hit when done
 * placing them, and we complete() from the final frame of ANY duplicate
 * reaching frame_124. In canonical AS, `this.removeMovieClip()` on a
 * duplicate just removes that instance. The spell has no outer `_parent`
 * removal — completion is implicitly when all duplicates have removed
 * themselves. We fire complete() from the first duplicate that reaches
 * frame_124 (idempotent, safe).
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

const DUPLICATE_BOUNDS = {
  width: 59.25,
  height: 159.2,
  offsetX: -23,
  offsetY: -95.75,
};

export class Spell812 extends RuntimeSpell {
  readonly spellId = 812;
  readonly displayType = SpellDisplayType.BeamLine;

  private callbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- duplicate — 126-frame beam segment composite -----------
    // Placed periodically along caster→target line by the BeamLine harness.
    //
    // AS DefineSprite_20_duplicate/frame_1/DoAction.as:
    //   SOMA.playSound("vlad_812");
    //
    // AS DefineSprite_20_duplicate/frame_1/DoAction_2.as:
    //   this._xscale = 50 + random(60);
    //   this._yscale = this._xscale;
    //   this._rotation = -10 + random(30);
    //
    // AS DefineSprite_20_duplicate/frame_124/DoAction.as:
    //   this.removeMovieClip();
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 126,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20_duplicate/frame_1/DoAction.as
            // Sound is played once per duplicate instance placed.
            // We capture the callbacks reference from onSpellStart.
            if (this.callbacks) {
              this.callbacks.playSound("vlad_812");
            }

            // AS DefineSprite_20_duplicate/frame_1/DoAction_2.as
            // this._xscale = 50 + random(60);  → range [50, 110]
            // this._yscale = this._xscale;
            // this._rotation = -10 + random(30); → range [-10, +19] deg
            const scale = (50 + Math.floor(Math.random() * 60)) / 100;
            clip.scaleX = scale;
            clip.scaleY = scale;
            clip.rotation = ((-10 + Math.floor(Math.random() * 30)) * Math.PI) / 180;
          },
        ],
        [
          123,
          (clip) => {
            // AS DefineSprite_20_duplicate/frame_124/DoAction.as
            // this.removeMovieClip() — remove this duplicate instance.
            // Fire complete() (idempotent) so the spell ends when the
            // first duplicate finishes its timeline.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Capture callbacks so duplicate's frame_1 can play the sound.
    // The canonical sound trigger is inside the duplicate symbol itself
    // (DefineSprite_20_duplicate/frame_1/DoAction.as), not the main timeline.
    this.callbacks = callbacks;
  }
}
