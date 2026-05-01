/**
 * Spell 2048 — (Cra arrow spell, likely Flèche Percutante or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2048/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Detection rationale:
 *   - The manifest has a `shoot` animation (93 frames, composite) and a
 *     `move` symbol (DefineSprite_9_move) whose frame_1 plays a sound.
 *   - DefineSprite_9_move contains a PlaceObject2_3_1 with onClipEvent(load)
 *     and onClipEvent(enterFrame) handlers that oscillate _rotation — this is
 *     the arrow wobble sprite placed inside `move`.
 *   - There is no ballistic arc / parabolic motion, no `effet` attachment, no
 *     `duplicate` symbol → not ballistic, not beam.
 *   - The shoot (DefineSprite_8_shoot) runs for 93 frames and frame_91 calls
 *     `_parent.removeMovieClip()` → spell completion at the target cell.
 *   - Presence of a linear projectile + rotation-to-target pattern → ProjectileLinear.
 *
 * Library symbols:
 *   - DefineSprite_7 (inner sprite inside move, PlaceObject2_3_1):
 *       onLoad seeds `a=30, i=0` for oscillation.
 *       onEnterFrame sets `_rotation = 90 + a * cos(i += 0.6); a /= 1.1`.
 *       frame_64: stop().
 *     Registered as "sprite7" (container-only, placed by move's frame_1 script).
 *
 *   - move (DefineSprite_9_move):
 *       frame_1: SOMA.playSound("pic") + attaches sprite7 child.
 *     Container-only; harness attaches it at caster.
 *
 *   - shoot (DefineSprite_8_shoot):
 *       93 frames of rendered arrow frames.
 *       frame_91: _parent.removeMovieClip() → runtime.complete().
 *     Harness attaches it at target offset when the linear projectile "arrives"
 *     (for ProjectileLinear the harness attaches shoot immediately at target delta).
 *
 * Main timeline: manifest shows sound at frame 0 ("pic") — this is also echoed
 * by DefineSprite_9_move/frame_1/DoAction.as. The sound is played from move's
 * frame_1 script (onSpellStart is not needed for additional sound here, but we
 * mirror the canonical main-timeline stop() with a no-op).
 *
 * signalHit: For ProjectileLinear the harness does NOT auto-signal hit (only
 * ProjectileBallistic 30/31 does). We signal hit from shoot's first frame (frame_1,
 * index 0) since the arrow arrives at the target cell immediately when shoot attaches.
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

// shoot bounds from manifest animations[] entry (NOT librarySymbols — no lib_ prefix)
const SHOOT_BOUNDS = {
  width: 12.85,
  height: 31.6,
  offsetX: -12.45,
  offsetY: -17.6,
};

export class Spell2048 extends RuntimeSpell {
  readonly spellId = 2048;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  // Keep a reference to the sound callback so move's frame_1 script can use it.
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- DefineSprite_7 — arrow-head oscillation sprite ----------
    // Placed by DefineSprite_9_move/frame_1 via PlaceObject2_3_1.
    // AS onClipEvent(load):
    //   a = 30;
    //   i = 0;
    // AS onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 0.6);
    //   a /= 1.1;
    // AS DefineSprite_7/frame_64/DoAction.as: stop()
    //
    // There are no librarySymbols[] entries in the manifest, so this is
    // a container-only sprite. No frames available; rendered visuals are
    // part of the composite `shoot` animation.
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.a = 30;
        clip.vars.i = 0;
      },

      // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        const a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        // AS: _rotation = 90 + a * Math.cos(i)  — degrees → radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        clip.vars.a = a / 1.1;
        clip.vars.i = i;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_7/frame_64/DoAction.as → stop()
          63,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — projectile container (2-frame minimum) -----------
    // AS DefineSprite_9_move/frame_1/DoAction.as: SOMA.playSound("pic")
    // PlaceObject2_3_1 places sprite7 on this clip's frame_1.
    // The harness (ProjectileLinear) attaches `move` at the caster
    // position rotated toward the target; `shoot` is attached at the
    // target offset.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          // AS: DefineSprite_9_move/frame_1/DoAction.as
          0,
          (clip, ctx) => {
            // Play sound — delegate via captured callback reference.
            if (this._playSound) {
              this._playSound("pic");
            }
            // PlaceObject2_3_1 places sprite7 at this frame inside move.
            clip.attach(sprite7Sym, "sprite7", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame arrow impact at target -----------------
    // manifest animations[0]: name="shoot", 93 frames, composite.
    // AS DefineSprite_8_shoot/frame_91/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    // No lib_ prefix — shoot is in animations[], not librarySymbols[].
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,

      frameScripts: new Map([
        [
          // frame_1 (index 0): arrow has just arrived at target — signal hit.
          0,
          () => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_8_shoot/frame_91/DoAction.as
          // frame_91 → index 90
          90,
          (clip) => {
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite7Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture the sound callback so move's frame_1 script can use it
    // when the harness attaches move and its frame_1 fires.
    this._playSound = callbacks.playSound;
    // Main timeline stop() — no explicit children to attach here;
    // the harness handles move + shoot placement for ProjectileLinear.
  }
}
