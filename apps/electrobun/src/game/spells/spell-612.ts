/**
 * Spell 612 — Dodge (Beam/Line spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/612/scripts/scripts/
 *
 * displayType=41 (BeamLineAlt). The manifest has both a `duplicate` symbol
 * (3-frame composite dropped periodically along the caster→target line) and
 * a `shoot` symbol (84-frame animation at the impact point). The harness for
 * displayType=41 drives the "duplicate" beam-line drops and attaches "shoot"
 * at the target on completion, then auto-signals hit.
 *
 * Library symbols (from manifest.json animations[]):
 *   - shoot   — 84-frame impact animation at target. frame_1 resets rotation
 *               to 0. frame_70 removes parent (→ complete). No lib_ prefix
 *               since these are top-level `animations[]` entries.
 *   - duplicate — 3-frame composite. frame_1 scales by level, jumps to a
 *                 random frame. Its authored child clips each jump to a random
 *                 frame on load (the PlaceObject2 onClipEvent(load) handlers).
 *
 * Main timeline: SOMA.playSound("dodge_604"); (frame_1/DoAction.as)
 *
 * NOTE: `shoot` has `_rotation = 0` on frame_1 (DefineSprite_16_shoot/frame_1/
 * DoAction.as), which overrides any rotation the harness applies when attaching
 * it. The harness passes rotation via transform before frame_1 runs, so the
 * frame_1 `_rotation = 0` canonically wins — this is handled automatically by
 * the attach() ordering contract.
 *
 * `duplicate` frame_1 calls `gotoAndStop(random(_totalframes) + 1)` to jump to
 * a random frame. The two PlaceObject2 children inside duplicate/frame_2 each
 * call `gotoAndStop(random(_totalframes) + 1)` on their own load — since these
 * are authored timeline children (not runtime-attached), we model their "random
 * frame on load" behaviour inside the duplicate symbol's onLoad handler by
 * randomising the whole symbol's starting frame.
 *
 * The harness (BeamLineAlt) calls `runtime.signalHit()` automatically when the
 * beam reaches the target. Do NOT call signalHit manually.
 * Call `this.runtime.complete()` from shoot's frame_70 script.
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
  width: 121.1,
  height: 112.65,
  offsetX: -58.55,
  offsetY: -74.2,
};

const DUPLICATE_BOUNDS = {
  width: 83.25,
  height: 133,
  offsetX: -50.05,
  offsetY: -83.7,
};

export class Spell612 extends RuntimeSpell {
  readonly spellId = 612;
  readonly displayType = SpellDisplayType.BeamLineAlt;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- shoot — 84-frame impact animation at target -------------
    // AS DefineSprite_16_shoot/frame_1/DoAction.as:
    //   _rotation = 0;
    // AS DefineSprite_16_shoot/frame_70/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_16_shoot/frame_1/DoAction.as:
            //   _rotation = 0;
            // Overrides any velocity-angle rotation applied by the harness.
            clip.rotation = 0;
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_16_shoot/frame_70/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- duplicate — 3-frame composite dropped along the beam line --
    // AS DefineSprite_39_duplicate/frame_1/DoAction.as:
    //   t = 10 * _parent.level + 40;
    //   _xscale = t;
    //   _yscale = t;
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // AS DefineSprite_39_duplicate/frame_2/PlaceObject2_37_1/onClipEvent(load):
    //   gotoAndStop(random(_totalframes) + 1);
    // AS DefineSprite_39_duplicate/frame_2/PlaceObject2_37_3/onClipEvent(load):
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // The authored children of duplicate (PlaceObject2_37_1 and _37_3) each
    // jump to a random frame on load. Since these are sub-clips within the
    // composite asset (not runtime-attached symbols we can hook individually),
    // their visual variation is baked into the composite frames. We model the
    // outer duplicate's own random-frame jump in its onLoad handler.
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 3,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_39_duplicate/frame_1/DoAction.as:
        //   t = 10 * _parent.level + 40;
        //   _xscale = t; _yscale = t;
        //   gotoAndStop(random(_totalframes) + 1);
        // _parent here is the root (the harness attaches duplicate children
        // to the root clip). Level is stored on root.vars.level.
        const root = clip.parent ?? clip;
        const level = (root.vars.level as number) ?? 1;
        const t = 10 * level + 40;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // Jump to a random frame (AS: random(_totalframes) + 1 is 1-based).
        const randomFrame = Math.floor(Math.random() * 3);
        clip.gotoAndStop(randomFrame);
      },
    };

    this.registry.register(shootSym);
    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("dodge_604");
    callbacks.playSound("dodge_604");
  }
}
