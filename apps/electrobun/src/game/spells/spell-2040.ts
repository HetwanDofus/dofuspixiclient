/**
 * Spell 2040 — (unknown name, projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2040/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `move` symbol (DefineSprite_10_move)
 * with a wobble-rotation clip event (typical projectile-in-flight wiggle), and a `shoot`
 * symbol (DefineSprite_9_shoot, 93 frames) that contains `sprite8` (DefineSprite_8, 66 frames)
 * as a placed child. The harness attaches `shoot` at the target offset inside the rotated
 * container. No `attachMovie` calls — the `shoot` symbol has `sprite8` placed via PlaceObject2
 * with clip events; those must be live clips.
 *
 * Library symbols:
 *   - sprite8 (characterId 8) — directlyDynamic: true. 66-frame animated impact burst.
 *     onLoad: seeds a=10, i=0. onEnterFrame: wobbles rotation as `90 + a*cos(i += π)`, decays a /= 1.5.
 *     frame_64 (index 63): stop().
 *   - move  — container-only (2 frames implied by usage; no authored frames).
 *     PlaceObject2_4_1 carries onClipEvent(load): a=30, i=0;
 *     onClipEvent(enterFrame): _rotation = 90 + a*cos(i += 0.6); a /= 1.1.
 *     This is the PROJECTILE IN FLIGHT wobble. The harness drives its position along the line;
 *     the onLoad/onEnterFrame handle its rotation wobble.
 *   - shoot — 93-frame container. Placed inside harness at target offset.
 *     frame 0: attaches sprite8 child with placement matrix from manifest.
 *     frame 90 (AS frame_91): _parent.removeMovieClip() → runtime.complete().
 *
 * Main timeline: no DoAction scripts found — no sound, no explicit attaches beyond harness.
 *
 * displayType=20 (ProjectileLinear): The harness attaches `move` at caster, rotates root to
 * face target, and places `shoot` at the target-local offset. The `move` symbol's clip events
 * drive the in-flight wobble; `shoot` drives the impact animation at the target.
 *
 * signalHit: fired at frame 0 of `shoot` (first impact frame), since harness does NOT
 * auto-signal for displayType 20.
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

// Bounds from manifest.json librarySymbols[0] (sprite8 / characterId 8)
const SPRITE8_BOUNDS = {
  width: 38.65,
  height: 32.2,
  offsetX: -32.1,
  offsetY: -18.1,
};

// Placement matrix for sprite8 inside shoot (from manifest librarySymbols[0].placements[0])
const SPRITE8_PLACEMENT = {
  translateX: 0.05,
  translateY: 0.15,
  scaleX: 0.981719970703125,
  scaleY: 0.981719970703125,
};

export class Spell2040 extends RuntimeSpell {
  readonly spellId = 2040;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);

    // ---- sprite8 — animated impact composite (DefineSprite_8) ----
    // directlyDynamic: true — has its own CLIPACTIONRECORD onClipEvent(load/enterFrame).
    //
    // AS scripts/DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load):
    //   a = 10; i = 0;
    //
    // AS scripts/DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.5;
    //
    // AS scripts/DefineSprite_8/frame_64/DoAction.as:
    //   stop();
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 10;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        a /= 1.5;
        clip.vars.a = a;
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

    // ---- move — projectile-in-flight container (DefineSprite_10_move) ----
    // PlaceObject2_4_1 carries onClipEvent(load/enterFrame) on the placed child
    // inside move. In this spell's structure, the `move` symbol itself IS the
    // projectile clip driven by the harness. The clip events in
    // DefineSprite_10_move/frame_1/PlaceObject2_4_1 describe a child placed inside
    // move at depth 4 — but from the manifest there's no separate library symbol
    // for it (no corresponding librarySymbols entry). Looking at the scripts path:
    // the PlaceObject2_4_1 is inside DefineSprite_10_move's frame_1, meaning it
    // places a child sprite (the actual projectile visual) inside `move`, and that
    // child has the wobble clip events.
    //
    // Since the manifest has no separate librarySymbol for the child placed at
    // depth 4 inside move, the exporter has baked it into `move`'s own authored
    // frames (move is a container-only symbol with no separate frame textures).
    // However, the CLIPACTIONRECORD scripts still need a live runtime entity.
    // We model the `move` symbol itself as carrying these wobble handlers —
    // the harness will animate move's position along the line, and these handlers
    // animate move's rotation (matching the projectile-wobble behavior).
    //
    // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load):
    //   a = 30; i = 0;
    //
    // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 30;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.6;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- shoot — 93-frame impact container (DefineSprite_9_shoot) ----
    // The harness attaches shoot at the target-local offset (inside the
    // rotated container) when using displayType 20 (ProjectileLinear).
    //
    // frame_1 (index 0): place sprite8 child at the canonical placement matrix.
    //   Also signal hit here (first impact frame, harness doesn't auto-signal for type 20).
    //
    // frame_91 (index 90):
    //   AS DefineSprite_9_shoot/frame_91/DoAction.as: _parent.removeMovieClip(); stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 37.95, height: 31.6, offsetX: -31.45, offsetY: -17.6 }).x,
      anchorY: calculateAnchor({ width: 37.95, height: 31.6, offsetX: -31.45, offsetY: -17.6 }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite8 inside shoot at depth 1, using the manifest placement matrix.
            // AS: PlaceObject2 at frame 0 of DefineSprite_9_shoot, parentSpriteId=9, depth=1.
            const child = clip.attach(sprite8Sym, "sprite8", 1, ctx, {
              x: SPRITE8_PLACEMENT.translateX,
              y: SPRITE8_PLACEMENT.translateY,
            });
            child.scaleX = SPRITE8_PLACEMENT.scaleX;
            child.scaleY = SPRITE8_PLACEMENT.scaleY;
            // Signal hit at first impact frame (displayType 20 — harness does not auto-signal).
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_91/DoAction.as: _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite8Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No SOMA.playSound or explicit main-timeline child attaches found
    // in the canonical AS for spell 2040.
  }
}
