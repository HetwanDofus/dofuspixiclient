/**
 * Spell 604 — Dodge (Sram / Ecaflip dodge-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/604/scripts/scripts/
 *
 * displayType=40 (BeamLine). Detection rationale:
 *   - The manifest has a `duplicate` animation (isComposite=true, 4 frames).
 *   - DefineSprite_26_duplicate/frame_1/DoAction.as scales the clip by
 *     `10 * _parent.level + 50` and jumps to a random frame — classic
 *     BeamLine "duplicate" pattern.
 *   - There is a `shoot` animation (90 frames) in animations[] whose
 *     frame_1 sets `_rotation = _parent.angle` — also canonical for
 *     BeamLine type 41 (BeamLineAlt attaches shoot at the end of the line).
 *   - Since shoot exists, this is displayType=41 (BeamLineAlt).
 *
 * Library symbols:
 *   Neither `shoot` nor `duplicate` appear in `librarySymbols[]`
 *   (that array is absent / empty in the manifest). Both are pure
 *   `animations[]` entries. Therefore textures are fetched with the
 *   bare name ("shoot", "duplicate") — NO `lib_` prefix.
 *
 * Symbol layout:
 *   - `duplicate` — 4-frame composite particle dropped periodically
 *     along the caster→target line by the harness. frame_1 scales by
 *     level and jumps to a random frame. Inner child clips (PlaceObject2
 *     entries inside frames 1 and 2) all run `gotoAndStop(random(_totalframes)+1)`
 *     on load — we approximate this by giving the symbol a random-stop
 *     onLoad since we have no access to the internal child sprites from
 *     outside the composite. The harness handles motion.
 *   - `shoot` — 90-frame impact animation placed at the target end of
 *     the beam by the BeamLineAlt harness. frame_1 sets rotation to
 *     _parent.angle. frame_88 calls `_parent.removeMovieClip()` which
 *     is the outer mc → spell complete.
 *
 * Main timeline: SOMA.playSound("dodge_604"); (frame_1/DoAction.as)
 *
 * Hit signal: for displayType 40/41 the harness fires signalHit when
 * the beam reaches the target — we do NOT call it again from spell code.
 *
 * Complete: fired from shoot's frame_88 script (AS frame_88 =
 * frameScripts index 87), which calls `_parent.removeMovieClip()`.
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

// Bounds from animations[] entries (no librarySymbols[] present).
const SHOOT_BOUNDS = {
  width: 301.75,
  height: 135.95,
  offsetX: -101.9,
  offsetY: -60.45,
};

const DUPLICATE_BOUNDS = {
  width: 70.95,
  height: 116.9,
  offsetX: -41.1,
  offsetY: -70.65,
};

export class Spell604 extends RuntimeSpell {
  readonly spellId = 604;
  readonly displayType = SpellDisplayType.BeamLineAlt;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- shoot — 90-frame impact animation at target end of beam ----
    // Placed by the BeamLineAlt harness at the target when the beam
    // finishes sweeping.
    //
    // AS DefineSprite_3_shoot/frame_1/DoAction.as:
    //   _rotation = _parent.angle;
    //
    // AS DefineSprite_3_shoot/frame_88/DoAction.as:
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
            // AS DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = _parent.angle;
            // _parent.angle is stored in degrees on root.vars by the harness.
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          87,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_88/DoAction.as
            // _parent.removeMovieClip();
            // This is the outer mc removal → signal spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- duplicate — 4-frame composite particle dropped along beam --
    // Dropped periodically along the caster→target line by the harness.
    //
    // AS DefineSprite_26_duplicate/frame_1/DoAction.as:
    //   t = 10 * _parent.level + 50;
    //   _xscale = t;
    //   _yscale = t;
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // Inner child clip events (PlaceObject2_25_3 and PlaceObject2_19_1
    // at frames 2) all do:
    //   gotoAndStop(random(_totalframes) + 1);
    // We model the outer frame_1 script via frameScripts[0]. The inner
    // composite child clips are baked into the composite SVG frames so
    // their random-stop behaviour is represented by the outer
    // gotoAndStop on the duplicate clip itself.
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 4,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_26_duplicate/frame_1/DoAction.as
            // t = 10 * _parent.level + 50;
            // _xscale = t; _yscale = t;
            // gotoAndStop(random(_totalframes) + 1);
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const t = 10 * level + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // AS random(_totalframes) + 1 → 1-based frame, convert to 0-based.
            const randomFrame = Math.floor(Math.random() * 4);
            clip.gotoAndStop(randomFrame);
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as
    // SOMA.playSound("dodge_604");
    callbacks.playSound("dodge_604");
  }
}
