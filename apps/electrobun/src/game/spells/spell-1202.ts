/**
 * Spell 1202 — Panda Molotov (Pandawa).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1202/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * symbols (both in animations[], not librarySymbols[]), meaning the harness
 * drives the parabolic arc for `move` and attaches `shoot` at landing.
 * The harness also fires `runtime.signalHit()` automatically on landing —
 * we must NOT call it ourselves.
 *
 * Animations (all in animations[], librarySymbols is empty):
 *   - `flam`  — 22-frame flame sprite used inside the `shoot` composite.
 *               DefineSprite_10_flam: frame_21 stops (stop()).
 *               Referenced as the inner visual of DefineSprite_46.
 *   - `shoot` — 72-frame composite impact explosion.
 *               DefineSprite_39_shoot:
 *                 frame_1/DoAction.as   → SOMA.playSound("panda_molotov")
 *                 frame_1/DoAction_2.as → _rotation = 0
 *                 frame_70/DoAction.as  → _parent.removeMovieClip() → complete
 *
 * Inner symbol hierarchy (from DefineSprite path names):
 *   DefineSprite_47 contains PlaceObject2_46_1 (an instance of DefineSprite_46):
 *     onClipEvent(load):       vr = 15 + random(70)
 *     onClipEvent(enterFrame): _rotation += vr; vr *= 0.98
 *   DefineSprite_46 contains PlaceObject2_45_2 (an instance of the flam anim):
 *     onClipEvent(enterFrame): play()
 *
 * Since librarySymbols[] is empty, ALL textures are accessed by bare name
 * (NO "lib_" prefix). The `flam` inner sprite is baked into the `shoot`
 * composite frames, so for the runtime we treat `move` and `shoot` as
 * container-only symbols with their authored frameScripts, using
 * `frames: []` for `move` and `frames: textures.getFrames("shoot")` for
 * `shoot` (which has the authored composite frame data).
 *
 * The inner DefineSprite_47 / DefineSprite_46 hierarchy is authored content
 * already baked into the `shoot` composite frames — we do not need to
 * re-attach them at runtime; they are rendered via the sprite sheet frames.
 * The `_rotation = 0` in shoot/frame_1 overrides the harness-applied
 * velocity-angle rotation (canonical AS pattern).
 *
 * Main timeline (frame_1/DoAction.as): empty — no sound or child attaches
 * from the main timeline (sound is inside shoot's frame_1 instead).
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
  width: 174.15,
  height: 162.65,
  offsetX: -85.1,
  offsetY: -119.9,
};

export class Spell1202 extends RuntimeSpell {
  readonly spellId = 1202;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move — empty 1-frame container driven by the harness arc ----
    // The harness attaches `move` at root and animates it along the
    // parabolic arc toward the target. No authored frame scripts needed —
    // the move symbol is just a positional placeholder for displayType 30.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- shoot — 72-frame composite impact explosion ----------------
    // AS DefineSprite_39_shoot/frame_1/DoAction.as:
    //   SOMA.playSound("panda_molotov");
    // AS DefineSprite_39_shoot/frame_1/DoAction_2.as:
    //   _rotation = 0;    ← resets the harness-applied velocity-angle
    // AS DefineSprite_39_shoot/frame_70/DoAction.as:
    //   _parent.removeMovieClip();
    //
    // The inner DefineSprite_47 / DefineSprite_46 hierarchy (spinning
    // flam composite with vr physics) is baked into the shoot composite
    // frames and does not need runtime re-attachment. The spin physics
    // (vr = 15 + random(70); _rotation += vr; vr *= 0.98) and the
    // flam looping (play() each enterFrame) are already rendered in the
    // authored sprite sheet.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 72,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_39_shoot/frame_1/DoAction.as:
            //   SOMA.playSound("panda_molotov");
            // AS DefineSprite_39_shoot/frame_1/DoAction_2.as:
            //   _rotation = 0;
            // The sound callback is captured from onSpellStart.
            if (this.playSound) {
              this.playSound("panda_molotov");
            }
            // Override the harness-applied projectile-velocity rotation
            // so the impact explosion is upright (canonical AS pattern).
            clip.rotation = 0;
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_39_shoot/frame_70/DoAction.as:
            //   _parent.removeMovieClip();
            // This removes the outer mc (the root), signalling spell end.
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
    // Capture the sound callback so shoot's frame_1 script can use it.
    // The main timeline frame_1/DoAction.as is empty — no top-level sound.
    // Sound is fired from inside shoot's frame_1 (canonical AS layout).
    this.playSound = callbacks.playSound;
  }
}
