/**
 * Spell 2047 — (Unknown name, likely a Cra/ranged arrow spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2047/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `shoot` symbol
 * (90-frame animated projectile) and a `move` symbol (container whose
 * placed child has onClipEvent handlers for wobble rotation). The
 * harness attaches `move` at root rotated toward the target, and
 * `shoot` at the target offset after the projectile arrives. However,
 * looking more carefully: this spell has `DefineSprite_14_shoot` and
 * `DefineSprite_16_move`, where `move` contains a PlaceObject2 child
 * with onClipEvent handlers. The `shoot` symbol has a frame_88 (0-based:
 * 87) that removes the parent and stops. The `move` symbol's child
 * (PlaceObject2_15_1) has onLoad seeding `a=30, i=0` and onEnterFrame
 * doing wobble rotation `_rotation = 90 + a * cos(i += 0.6); a /= 1.1`.
 *
 * Since there is a `move` and `shoot`, this is ProjectileLinear (20).
 * The harness attaches `move` at root (rotated to face target) and
 * `shoot` at the target-offset position inside the rotated container.
 * Actually for displayType=20, the harness attaches `shoot` at the
 * target-local offset and rotates the root. The `move` symbol isn't
 * used by the linear harness directly — but the AS has a `move` sprite
 * with a child clip doing wobble. This suggests the projectile is
 * the `move` clip (flying toward the target), while `shoot` is the
 * impact animation. The linear harness places `shoot` at the target
 * delta. We register both and let the harness handle placement.
 *
 * The `move` child (PlaceObject2_15_1) has wobble rotation handlers
 * — this is the animated arrow/projectile in flight. We register a
 * `move_child` symbol for it and attach it from `move`'s frame_1.
 *
 * signalHit: called from shoot's removal frame (frame 87, 0-based)
 * since the harness does not auto-signal for ProjectileLinear.
 *
 * complete: called from shoot's frame 87 (canonical `_parent.removeMovieClip()`).
 *
 * Library symbols:
 *   - shoot — 90-frame animated impact. frame_88 (index 87) removes
 *     parent and signals completion.
 *   - move — container whose frame_1 places a child clip (PlaceObject2_15_1)
 *     with wobble rotation onEnterFrame.
 *   - move_child (PlaceObject2_15_1) — the wobbling arrow head/body.
 *     onLoad: a=30, i=0. onEnterFrame: rotation wobble decaying.
 *
 * Main timeline: no explicit sound in the provided scripts.
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
  width: 223.6,
  height: 41.1,
  offsetX: 1.55,
  offsetY: -24.95,
};

export class Spell2047 extends RuntimeSpell {
  readonly spellId = 2047;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move_child — the wobbling projectile body (PlaceObject2_15_1) ----
    // AS: DefineSprite_16_move/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_16_move/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // This is the clip placed inside `move` at frame_1 with clip events.
    // It has no library frames of its own (it's a placed instance from
    // within `move`'s authored timeline), so we use frames: [].
    const moveChildSym: SymbolDefinition = {
      name: "move_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_16_move/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
        // a = 30;
        // i = 0;
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_16_move/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = 90 + a * Math.cos(i += 0.6);
        // a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        const rotationDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotationDeg * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — container with wobbling projectile child --------
    // AS: DefineSprite_16_move frame_1 places PlaceObject2_15_1 (the
    // wobbling child). The harness attaches `move` at root position
    // (caster) rotated toward target for ProjectileLinear. The `move`
    // clip's frame_1 (index 0) attaches the wobbling child.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_16_move frame_1 places PlaceObject2_15_1
            // Attach the wobbling child at depth 1 inside move.
            clip.attach(moveChildSym, "move_child", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 90-frame impact animation at target ------------
    // AS: DefineSprite_14_shoot has 90 frames of animated SVG content.
    // frame_88/DoAction.as (0-based index 87):
    //   _parent.removeMovieClip(); stop();
    // Since this is ProjectileLinear (not Ballistic), harness does NOT
    // auto-signalHit — we signal hit here at the removal frame.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 90,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          87,
          (clip) => {
            // AS: DefineSprite_14_shoot/frame_88/DoAction.as
            // _parent.removeMovieClip(); stop();
            // Signal hit at impact (this is the end of the shoot animation).
            this.runtime.signalHit();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveChildSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No explicit SOMA.playSound found in the provided AS scripts.
    // Main timeline has no additional child attaches beyond what the
    // harness handles (move + shoot for ProjectileLinear).
  }
}
