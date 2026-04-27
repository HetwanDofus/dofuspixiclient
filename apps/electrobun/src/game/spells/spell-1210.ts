/**
 * Spell 1210 — Vague de Panda (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1210/scripts/scripts/
 *
 * displayType=40 (BeamLine). The spell has a `duplicate` symbol
 * (DefineSprite_18_duplicate) that is periodically dropped along the
 * caster→target line by the harness. The duplicate symbol itself has
 * authored frame textures (273 frames in animations[]) and internal
 * sub-symbols (DefineSprite_5, DefineSprite_8, DefineSprite_10,
 * DefineSprite_14, DefineSprite_17) that are placed on its authored
 * timeline at construction time and randomised on frame_1. There is
 * no `shoot` symbol (displayType=40, not 41).
 *
 * Library symbols (all container-only since they only appear via
 * authored-timeline PlaceObject references inside duplicate, not via
 * explicit attachMovie calls we need to handle manually — the harness
 * drives the `duplicate` placement):
 *
 *   - DefineSprite_5  (1 frame)  — frame_1: gotoAndStop(random(2)+2)
 *   - DefineSprite_8  (1 frame)  — frame_1: gotoAndStop(random(2)+2)
 *   - DefineSprite_10 (≥40 frames) — frame_1: _rotation = random(360);
 *                                     frame_40: stop()
 *   - DefineSprite_14 (1 frame)  — frame_1: gotoAndStop(random(2)+2)
 *   - DefineSprite_17 (1 frame)  — frame_1: gotoAndStop(random(2)+2)
 *   - duplicate (DefineSprite_18_duplicate, 273 frames) — the canonical
 *     beam-line unit. frame_1: mirror xscale if |angle|>90, jump to
 *     frame 148 if angle<0. frame_127: _parent.removeMovieClip().
 *     frame_271: _parent.removeMovieClip().
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("panda_vague").
 *
 * signalHit: fired by the BeamLine harness automatically when the last
 * duplicate is placed. We do NOT call it ourselves.
 *
 * complete(): fired from duplicate's frame_127 (or frame_271 for the
 * alt-direction variant) via this.runtime.complete().
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

// Bounds from manifest animations[0] (duplicate)
const DUPLICATE_BOUNDS = {
  width: 134.95,
  height: 119.8,
  offsetX: -58.7,
  offsetY: -57.35,
};

export class Spell1210 extends RuntimeSpell {
  readonly spellId = 1210;
  readonly displayType = SpellDisplayType.BeamLine;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- DefineSprite_5 — sub-symbol inside duplicate -------------
    // AS DefineSprite_5/frame_1/DoAction.as:
    //   gotoAndStop(random(2) + 2);
    // Container-only (no direct texture frames at this level);
    // the authored timeline carries its own visual content.
    const sprite5Sym: SymbolDefinition = {
      name: "DefineSprite_5",
      totalFrames: 3,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5/frame_1/DoAction.as
            clip.gotoAndStop(Math.floor(Math.random() * 2) + 1);
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — sub-symbol inside duplicate -------------
    // AS DefineSprite_8/frame_1/DoAction.as:
    //   gotoAndStop(random(2) + 2);
    const sprite8Sym: SymbolDefinition = {
      name: "DefineSprite_8",
      totalFrames: 3,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            clip.gotoAndStop(Math.floor(Math.random() * 2) + 1);
          },
        ],
      ]),
    };

    // ---- DefineSprite_10 — rotating sub-symbol inside duplicate ---
    // AS DefineSprite_10/frame_1/DoAction.as:
    //   _rotation = random(360);
    // AS DefineSprite_10/frame_40/DoAction.as:
    //   stop();
    const sprite10Sym: SymbolDefinition = {
      name: "DefineSprite_10",
      totalFrames: 40,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          39,
          (clip) => {
            // AS DefineSprite_10/frame_40/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_14 — sub-symbol inside duplicate ------------
    // AS DefineSprite_14/frame_1/DoAction.as:
    //   gotoAndStop(random(2) + 2);
    const sprite14Sym: SymbolDefinition = {
      name: "DefineSprite_14",
      totalFrames: 3,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_14/frame_1/DoAction.as
            clip.gotoAndStop(Math.floor(Math.random() * 2) + 1);
          },
        ],
      ]),
    };

    // ---- DefineSprite_17 — sub-symbol inside duplicate ------------
    // AS DefineSprite_17/frame_1/DoAction.as:
    //   gotoAndStop(random(2) + 2);
    const sprite17Sym: SymbolDefinition = {
      name: "DefineSprite_17",
      totalFrames: 3,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_17/frame_1/DoAction.as
            clip.gotoAndStop(Math.floor(Math.random() * 2) + 1);
          },
        ],
      ]),
    };

    // ---- duplicate (DefineSprite_18_duplicate) — 273-frame beam unit
    // The harness drops one of these per interval along the beam line.
    //
    // AS DefineSprite_18_duplicate/frame_1/DoAction.as:
    //   if(Math.abs(_parent.angle) > 90) { _xscale = -_xscale; }
    //   if(_parent.angle < 0)            { gotoAndPlay(148); }
    //
    // AS DefineSprite_18_duplicate/frame_127/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // AS DefineSprite_18_duplicate/frame_271/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // The duplicate reads _parent.angle from root.vars.angle (stored
    // in degrees by the harness, matching canonical AS convention).
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 273,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_18_duplicate/frame_1/DoAction.as
            const root = clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (Math.abs(angleDeg) > 90) {
              clip.scaleX = -clip.scaleX;
            }
            if (angleDeg < 0) {
              clip.gotoAndPlay(147); // AS gotoAndPlay(148) → 0-based 147
            }
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_18_duplicate/frame_127/DoAction.as:
            //   _parent.removeMovieClip();
            // This clip IS the outer duplicate placed by the harness;
            // removing it and signalling complete ends the spell.
            clip.remove();
            this.runtime.complete();
          },
        ],
        [
          270,
          (clip) => {
            // AS DefineSprite_18_duplicate/frame_271/DoAction.as:
            //   _parent.removeMovieClip();
            // Alt-direction variant reaches this frame after the
            // gotoAndPlay(148) branch plays out.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite5Sym);
    this.registry.register(sprite8Sym);
    this.registry.register(sprite10Sym);
    this.registry.register(sprite14Sym);
    this.registry.register(sprite17Sym);
    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("panda_vague");
    callbacks.playSound("panda_vague");
  }
}
