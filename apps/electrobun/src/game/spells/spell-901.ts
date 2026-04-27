/**
 * Spell 901 — Flèche de Cra (Cra arrow spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/901/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `shoot` symbol
 * (93-frame animated arrow impact) and a `move` symbol. The harness
 * rotates the root container to face the target and attaches "shoot"
 * at the target-relative offset. signalHit is NOT fired automatically
 * for displayType=20 — we fire it manually at shoot's frame_1 (the
 * moment the arrow lands at the target).
 *
 * Symbols:
 *   - move (DefineSprite_10_move) — 1-frame container-only symbol.
 *     Has an authored PlaceObject2 child (depth 1) whose clip events
 *     drive oscillating rotation during flight:
 *       onLoad:  a=30, i=0
 *       onEnterFrame: _rotation = 90 + a*cos(i += 0.6); a /= 1.1
 *     Modelled as a nested "move_child" symbol attached from move's
 *     frame_1 script (since PlaceObject2 children are not instantiated
 *     automatically by the runtime).
 *
 *   - shoot (DefineSprite_9_shoot) — 93-frame animated arrow/impact
 *     composite (textures from animations[] entry "shoot"). Has an
 *     authored PlaceObject2 child (DefineSprite_8, depth 2) placed on
 *     its own frame_1 whose clip events oscillate more rapidly:
 *       onLoad:  a=15, i=0
 *       onEnterFrame: _rotation = 90 + a*cos(i += 3.1415); a /= 1.1
 *     DefineSprite_8 has frame_64: stop().
 *     shoot frame_91: _parent.removeMovieClip(); stop() → complete.
 *
 * displayType detection:
 *   - Has "shoot" and "move" symbols → projectile family.
 *   - "move" is a 1-frame container (no multi-frame ballistic arc) →
 *     NOT ProjectileBallistic (30/31).
 *   - Linear arrow toward target with container rotated to face target
 *     → ProjectileLinear (20).
 *
 * Main timeline: no SOMA.playSound or explicit child attaches
 * identified in the manifest scripts — onSpellStart is a no-op.
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
  width: 29.75,
  height: 31.6,
  offsetX: -23.25,
  offsetY: -17.6,
};

export class Spell901 extends RuntimeSpell {
  readonly spellId = 901;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- move_child — oscillating-rotation child inside "move" ---
    // AS: DefineSprite_10_move/frame_1/PlaceObject2_4_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    const moveChildSym: SymbolDefinition = {
      name: "move_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/onClipEvent(load):
        //   a = 30;
        //   i = 0;
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame):
        //   _rotation = 90 + a * Math.cos(i += 0.6);
        //   a /= 1.1;
        const a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.vars.a = a / 1.1;
        clip.vars.i = i;
      },
    };

    // ---- move — 1-frame container-only symbol --------------------
    // AS: DefineSprite_10_move — no authored visual frames.
    // frame_1 has PlaceObject2_4_1 child placed inside it.
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
            // AS: PlaceObject2_4_1 placed on frame_1 of DefineSprite_10_move.
            // Attach the oscillating-rotation child at depth 1.
            clip.attach(moveChildSym, "move_child", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot_inner — oscillating child inside "shoot" ----------
    // AS: DefineSprite_8/frame_1/PlaceObject2_4_2/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // AS: DefineSprite_8/frame_64/DoAction.as → stop()
    const shootInnerSym: SymbolDefinition = {
      name: "shoot_inner",
      totalFrames: 64,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/onClipEvent(load):
        //   a = 15;
        //   i = 0;
        clip.vars.a = 15;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/onClipEvent(enterFrame):
        //   _rotation = 90 + a * Math.cos(i += 3.1415);
        //   a /= 1.1;
        const a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.vars.a = a / 1.1;
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS DefineSprite_8/frame_64/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame animated arrow/impact composite --------
    // AS: DefineSprite_9_shoot — 93 frames of authored visuals.
    // Textures from animations[] entry "shoot" (no lib_ prefix —
    // this symbol lives in animations[], not librarySymbols[]).
    // frame_1: attach shoot_inner (PlaceObject2_4_2 / DefineSprite_8).
    //          Also fire signalHit — for displayType=20 (ProjectileLinear)
    //          the harness places shoot at the target immediately, so
    //          frame_1 is the canonical impact frame.
    // frame_91: _parent.removeMovieClip(); stop(); → spell complete.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2_4_2 (DefineSprite_8) placed on frame_1
            // of DefineSprite_9_shoot. Attach the inner oscillating child.
            clip.attach(shootInnerSym, "shoot_inner", 2, ctx);
            // displayType=20: shoot is placed at target offset on the
            // same tick the harness attaches it — frame_1 is the hit.
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveChildSym);
    this.registry.register(moveSym);
    this.registry.register(shootInnerSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Main timeline: no SOMA.playSound or explicit child attaches
    // identified in the manifest scripts for spell 901.
  }
}
