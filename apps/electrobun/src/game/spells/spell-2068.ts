/**
 * Spell 2068 — Lance (Feca or similar lance/spear spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2068/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Rationale:
 *   - The manifest has a single `shoot` animation entry (no `move`, no
 *     `duplicate`), no librarySymbols entries, and the AS for
 *     DefineSprite_10_shoot/frame_1 does `_rotation = 0` — the canonical
 *     pattern for a linear projectile whose shoot resets the rotation.
 *   - DefineSprite_16 is the outer wrapper timeline (172 frames) that
 *     positions itself at `_parent.cellTo` (frame_1/DoAction_2.as) and
 *     plays a sound (frame_1/DoAction.as). Frame 34 fires `this.end()`
 *     (signalHit) and frame 172 removes the outer mc (complete).
 *   - DefineSprite_10_shoot is the inner 28-frame impact animation. Its
 *     frame_24 does `_parent.removeMovieClip()` — this kills the shoot
 *     clip itself, not the outer wrapper.
 *   - The main timeline has only `frame_2/DoAction.as: stop();`, so
 *     no additional children are attached there.
 *
 * Since the `animations[]` list contains `shoot` (no librarySymbols),
 * the texture key is the bare name "shoot" (no `lib_` prefix).
 *
 * Library symbols:
 *   - shoot (from animations[]) — 28-frame impact animation.
 *       frame_1 (index 0): `_rotation = 0` — resets harness rotation.
 *       frame_24 (index 23): `_parent.removeMovieClip(); stop()` — removes
 *         the shoot clip from its parent (DefineSprite_16).
 *
 * DefineSprite_16 — outer wrapper (172 frames, container-only):
 *   frame_1 (index 0):
 *     DoAction.as:   SOMA.playSound("lance02")
 *     DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *   frame_34 (index 33): this.end() → signalHit
 *   frame_172 (index 171): _parent.removeMovieClip() → complete
 *
 * Main timeline: frame_2 → stop(). No sound here; sound is on the
 * inner DefineSprite_16/frame_1. onSpellStart attaches DefineSprite_16.
 *
 * NOTE: The harness for displayType=20 attaches "shoot" at the
 * target-local offset inside the rotated container. DefineSprite_16 is
 * a separate outer wrapper that overrides its own position to cellTo
 * on frame_1, so it is attached directly to root (not via the harness
 * shoot slot) in onSpellStart.
 *
 * Wait — re-reading the AS more carefully:
 *   DefineSprite_16 IS the "main" outer animated timeline. It places
 *   itself at cellTo and plays the sound. It also contains (or references)
 *   the shoot clip. Given the scripts structure:
 *     - DefineSprite_16 positions itself at cellTo and plays sound.
 *     - DefineSprite_10_shoot is the visual animation attached inside it.
 *   The harness for ProjectileLinear attaches "shoot" by name. If we
 *   name DefineSprite_16 as "shoot" in the registry and give it 172
 *   frames + a child attach of the actual visual frames, that matches the
 *   canonical structure (harness places "shoot" at target, shoot's frame_1
 *   overrides position to cellTo, plays sound, then frame_34 hits, frame_172
 *   completes). The inner DefineSprite_10_shoot visual is a nested symbol.
 *
 *   For simplicity and correctness we model this as:
 *   - "shoot" → DefineSprite_16 (172-frame container, positions at cellTo,
 *     plays sound, signals hit at 34, completes at 172, attaches inner
 *     visual "shoot_inner" at frame_1).
 *   - "shoot_inner" → DefineSprite_10_shoot (28-frame visual animation,
 *     resets rotation at frame_1, removes itself at frame_24).
 *
 *   The harness attaches "shoot" at target-local offset. shoot's frame_1
 *   then overrides its own position to the absolute cellTo world coord.
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
  width: 205.8,
  height: 149.3,
  offsetX: -103.2,
  offsetY: -87.7,
};

export class Spell2068 extends RuntimeSpell {
  readonly spellId = 2068;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  private shootInnerSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot_inner — DefineSprite_10_shoot (28-frame visual) ---
    // AS DefineSprite_10_shoot/frame_1/DoAction.as: _rotation = 0
    // AS DefineSprite_10_shoot/frame_24/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    this.shootInnerSym = {
      name: "shoot_inner",
      totalFrames: 28,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_1/DoAction.as
            // Reset any rotation applied by parent or harness.
            clip.rotation = 0;
          },
        ],
        [
          23,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_24/DoAction.as
            // _parent.removeMovieClip() — removes the shoot_inner clip
            // from its parent (the "shoot" wrapper / DefineSprite_16).
            // The outer "shoot" wrapper continues its own 172-frame timeline.
            clip.remove();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — DefineSprite_16 (172-frame outer wrapper) -------
    // This is what the harness attaches by name "shoot" at the target
    // local offset inside the rotated container.
    //
    // AS DefineSprite_16/frame_1/DoAction.as:   SOMA.playSound("lance02")
    // AS DefineSprite_16/frame_1/DoAction_2.as: _X = _parent.cellTo.x
    //                                            _Y = _parent.cellTo.y
    // AS DefineSprite_16/frame_34/DoAction.as:  this.end() → signalHit
    // AS DefineSprite_16/frame_172/DoAction.as: _parent.removeMovieClip()
    //                                            → spell complete
    //
    // Frame_1 overrides the harness-applied position to the absolute
    // cellTo world coordinate (canonical AS `_X = _parent.cellTo.x`).
    // The sound is played here rather than in onSpellStart because the
    // canonical AS fires it on this inner clip's frame_1.
    this.shootSym = {
      name: "shoot",
      totalFrames: 172,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_16/frame_1/DoAction.as
            // SOMA.playSound("lance02") — captured via runtime callbacks.
            this.runtime.callbacks.playSound("lance02");

            // AS DefineSprite_16/frame_1/DoAction_2.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y
            // Walk to root to get cellTo world coords.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }

            // Attach the inner visual shoot animation.
            clip.attach(this.shootInnerSym, "shoot_inner", 1, ctx);
          },
        ],
        [
          33,
          () => {
            // AS DefineSprite_16/frame_34/DoAction.as: this.end()
            // Signal hit — damage popup fires at target.
            this.runtime.signalHit();
          },
        ],
        [
          171,
          (clip) => {
            // AS DefineSprite_16/frame_172/DoAction.as:
            // _parent.removeMovieClip() — the outer mc is removed,
            // signalling spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootInnerSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: stop()
    // The main timeline immediately stops after frame 2. No sound here
    // (sound is on DefineSprite_16/frame_1). No explicit child attaches
    // needed — the harness for ProjectileLinear will attach "shoot"
    // (= DefineSprite_16) at the target-local offset.
    // Nothing to do in onSpellStart for this spell.
  }
}
