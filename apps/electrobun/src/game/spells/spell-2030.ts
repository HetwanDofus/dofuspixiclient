/**
 * Spell 2030 — Crockette (Sadida-style projectile).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2030/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest has `move` and `shoot`
 * animations, which is the canonical indicator of a ballistic projectile:
 * `move` is the in-flight projectile, `shoot` is the impact animation.
 *
 * Library symbols (from animations[], no librarySymbols[] entries):
 *   - move  — 6-frame animated projectile in flight. Purely visual, no
 *             frame scripts beyond the harness driving it along the arc.
 *             DefineSprite_8 (the small bouncing crockette): frame_1 randomly
 *             jumps to frame 60 (4/5 chance), so it either plays from frame 1
 *             or stays at frame 1 (1/5 chance). frame_34 stops.
 *   - shoot — 108-frame impact composite. frame_4 resets rotation to 0 (canonical
 *             override). frame_106 removes parent + stops (spell complete).
 *
 * Internal sub-symbols referenced in the scripts (DefineSprite_12, DefineSprite_14):
 *   - DefineSprite_12: a particle inside shoot — frame_1 randomises play
 *     position, alpha, scale. frame_97 stops.
 *   - DefineSprite_14: a long-running container (295 frames) inside shoot — frame_295 stops.
 *
 * The harness fires runtime.signalHit() automatically at landing for
 * displayType=30 — we must NOT call it from spell code.
 *
 * Main timeline: SOMA.playSound("crockette_206"); (no stop, no child attaches).
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

// Bounds from manifest animations[] entries (no librarySymbols present)
const SHOOT_BOUNDS = {
  width: 63.6,
  height: 30.2,
  offsetX: -31.8,
  offsetY: -14.75,
};

const MOVE_BOUNDS = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

export class Spell2030 extends RuntimeSpell {
  readonly spellId = 2030;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- move — 6-frame in-flight crockette projectile -----------
    // The manifest shows move has actual visual frames (isComposite: false,
    // 6 frames). DefineSprite_8 is the sub-sprite inside move that has the
    // randomised frame-jump logic. Since move is a direct animation entry
    // (not a librarySymbols entry), we use bare "move" key for textures.
    //
    // DefineSprite_8/frame_1/DoAction.as: if(random(5) != 1) { gotoAndStop(60); }
    // DefineSprite_8/frame_34/DoAction.as: stop();
    //
    // DefineSprite_8 is a sub-sprite baked into the composite move frames.
    // The move animation itself plays through its 6 frames looping during
    // flight (the harness drives position). We register move with its
    // visual frames so the projectile sprite renders.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 6,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
    };

    // ---- shoot — 108-frame impact composite ----------------------
    // DefineSprite_15_shoot/frame_4/DoAction.as:  _rotation = 0;
    // DefineSprite_15_shoot/frame_106/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // frame_4 (index 3): reset rotation to 0 — canonical override of
    // whatever velocity-angle the harness applied at attach time.
    // frame_106 (index 105): remove parent mc → signals spell completion.
    //
    // Note: the shoot animation has 108 frames in the manifest but the
    // canonical removal fires at frame_106 (index 105). Frames 107-108
    // would never play after the stop() + removal.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 108,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_15_shoot/frame_4/DoAction.as: _rotation = 0;
            // Canonical override — upright impact regardless of arc angle.
            clip.rotation = 0;
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_15_shoot/frame_106/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("crockette_206");
    callbacks.playSound("crockette_206");
  }
}
