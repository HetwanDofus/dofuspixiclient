/**
 * Spell 908 — Flèche de Glace / Ice Arrow (Cra).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/908/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol (container
 * with a single placed child that wobbles during flight) and a `shoot` symbol
 * (84-frame authored impact animation). The harness attaches `move` at the caster,
 * drives it along a parabolic arc to the target, then attaches `shoot` at the
 * target on landing and fires signalHit automatically.
 *
 * Library symbols:
 *   - move (DefineSprite_13): container-only. PlaceObject2_12_1 places a child
 *     whose onClipEvent(load) seeds `a=45`, `t=10+3*level`, and sets its scale
 *     to t%. onClipEvent(enterFrame) oscillates rotation: `_rotation = 90 + a*cos(i+=0.5)`
 *     with amplitude decay `a /= 1.1`. This is the spinning/wobbling ice shard
 *     during the projectile flight.
 *   - shoot (DefineSprite_6): 84-frame authored impact. frame_1 resets rotation
 *     to 0 (canonical override of harness-applied velocity angle). frame_4 plays
 *     sound "wab_2005b". frame_70 calls `_parent.removeMovieClip()` + `stop()` →
 *     signals spell completion.
 *
 * Main timeline: no sound on frame_1. The harness handles move/shoot attachment.
 *
 * Signals:
 *   - signalHit: fired by the harness (ProjectileBallistic) on landing — NOT
 *     called from per-spell code.
 *   - complete: fired from shoot's frame_70 script.
 *
 * NOTE: The `move` symbol has a CLIPACTIONRECORD-driven child (PlaceObject2_12_1).
 * The manifest has no `librarySymbols[]` entries, so the child clip is registered
 * as an inline anonymous symbol attached from move's frameScripts[0]. The child
 * shares `move`'s authored frames (no separate texture strip), so it uses
 * `frames: []` (container with onLoad/onEnterFrame handlers driving the visual
 * via rotation/scale only, since the wobbling shard is part of the `move`
 * animation strip itself).
 *
 * Because `librarySymbols[]` is empty in the manifest, we do NOT use any `lib_`
 * prefix for texture keys. The `shoot` animation is loaded as `textures.getFrames("shoot")`.
 * The `move` child is a runtime-only clip with no separate texture (it reads from
 * the parent move clip's rendered visual).
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
  width: 177.7,
  height: 141.7,
  offsetX: -89.05,
  offsetY: -88.5,
};

export class Spell908 extends RuntimeSpell {
  readonly spellId = 908;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- inline child symbol for move's PlaceObject2_12_1 -------
    // AS: DefineSprite_13_move/frame_1/PlaceObject2_12_1/
    //     CLIPACTIONRECORD onClipEvent(load).as +
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // This is the wobbling shard child placed inside the move container.
    // It has no separate texture strip — its visual is contributed by
    // the move animation itself. We register it as a pure-logic clip
    // (frames: []) so the onLoad/onEnterFrame handlers run correctly.
    const moveChildSym: SymbolDefinition = {
      name: "moveChild",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_13_move/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        //   a = 45;
        //   t = 10 + 3 * _parent._parent.level;
        //   _xscale = t;
        //   _yscale = t;
        clip.vars.a = 45;
        // _parent._parent is move's parent (the harness root), which has level on vars
        const root = clip.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        const t = 10 + 3 * level;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // initialise i for the enterFrame oscillation
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_13_move/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _rotation = 90 + a * Math.cos(i += 0.5);
        //   a /= 1.1;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.5;
        // AS rotation in degrees → convert to radians for Pixi
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — container for flight phase -----------------------
    // AS: DefineSprite_13_move
    // 1-frame container-only symbol. frame_1 places the wobbling child
    // (PlaceObject2_12_1) whose clip events drive the shard animation.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_13_move frame_1 — PlaceObject2_12_1 places
            // the dynamic child at depth 1. Attach the inline child symbol
            // so its onLoad and onEnterFrame run for the duration of flight.
            clip.attach(moveChildSym, "moveChild1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 84-frame impact animation -----------------------
    // AS: DefineSprite_6_shoot
    // frame_1: _rotation = 0  (canonical override of harness velocity angle)
    // frame_4: SOMA.playSound("wab_2005b")
    // frame_70: _parent.removeMovieClip(); stop()  → spell complete
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
            // AS: DefineSprite_6_shoot/frame_1/DoAction.as
            //   _rotation = 0;
            // Canonical override: resets the velocity-angle rotation the
            // harness applied when attaching shoot, so the impact renders
            // upright regardless of arc angle.
            clip.rotation = 0;
          },
        ],
        [
          3,
          () => {
            // AS: DefineSprite_6_shoot/frame_4/DoAction.as
            //   SOMA.playSound("wab_2005b");
            this.soundCallback?.("wab_2005b");
          },
        ],
        [
          69,
          (clip) => {
            // AS: DefineSprite_6_shoot/frame_70/DoAction.as
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.parent?.remove();
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
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture the playSound callback so frameScripts inside shoot can
    // use it for the frame_4 sound trigger.
    this.soundCallback = callbacks.playSound;
    // Main timeline frame_1: no explicit SOMA.playSound call on the
    // main timeline for spell 908. The harness has already attached
    // `move`; sound fires from shoot's frame_4 on landing.
  }
}
