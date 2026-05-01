/**
 * Spell 2106 — (Unknown name, likely a Cra or similar ranged spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2106/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `move` symbol (DefineSprite_10_move)
 * with a wobble clip event, and a `shoot` symbol (DefineSprite_9_shoot) which is a 93-frame
 * composite placed at the target offset. The harness attaches `shoot` at the target-relative
 * offset inside the rotated container. The `move` symbol carries a clip-event that oscillates
 * its rotation (wobble/flutter effect during flight). `shoot` ends the spell at frame 91 via
 * `_parent.removeMovieClip()`.
 *
 * Library symbols:
 *   - sprite8 (lib_sprite8) — 66-frame animated sprite placed inside `move` (parentSpriteId=9
 *     in the manifest, but the PlaceObject2_4_1 clip events live under DefineSprite_10_move).
 *     Actually, examining the scripts carefully:
 *       • DefineSprite_10_move / PlaceObject2_4_1 → the wobble clip on `move` itself
 *       • DefineSprite_8 / PlaceObject2_4_2 → a clip placed inside DefineSprite_8 (sprite8)
 *     sprite8 is placed inside shoot (parentSpriteId=9 = DefineSprite_9_shoot) at frame 0,
 *     depth 1, with the given matrix. sprite8 has its own onLoad/onEnterFrame (the ±10-degree
 *     vibration that decays rapidly at 1.5x per tick).
 *
 * Move symbol: empty container whose placed child (PlaceObject2_4_1) wobbles rotation with
 *   amplitude 30 deg decaying at 1.1x per tick.
 *
 * Shoot symbol: 93-frame composite (animations["shoot"]). At frame 91 removes parent (spell
 *   complete). sprite8 is attached inside shoot at depth 1 with the placement matrix from
 *   manifest (scale≈0.982, translate≈(0.05, 0.15)).
 *
 * signalHit: fired on the first frame of shoot (frame 0), since that is when the projectile
 *   lands at the target. The harness does NOT call signalHit for ProjectileLinear — we must
 *   do it ourselves.
 *
 * Main timeline: no SOMA.playSound found in the script list; onSpellStart is minimal.
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

// Bounds from manifest.librarySymbols[0] (sprite8)
const SPRITE8_BOUNDS = {
  width: 37.9,
  height: 34,
  offsetX: -31.35,
  offsetY: -18.1,
};

// Bounds for shoot from manifest.animations[0]
const SHOOT_BOUNDS = {
  width: 37.25,
  height: 33.35,
  offsetX: -30.75,
  offsetY: -17.6,
};

export class Spell2106 extends RuntimeSpell {
  readonly spellId = 2106;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- sprite8 — 66-frame animated sub-sprite inside shoot ----
    // Placed inside DefineSprite_8 (which is placed inside shoot/DefineSprite_9_shoot).
    // The PlaceObject2_4_2 clip events live under DefineSprite_8/frame_1 and drive a
    // rapid ±10-degree vibration that decays at 1.5× per tick.
    //
    // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as:
    //   a = 10; i = 0;
    // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.5;
    // AS DefineSprite_8/frame_64/DoAction.as:
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
        // AS _rotation = 90 + a * Math.cos(i) → degrees → radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.5;
        clip.vars.a = a;
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS DefineSprite_8/frame_64/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — container with a wobbling child (PlaceObject2_4_1) ----
    // DefineSprite_10_move is the projectile body flying toward the target.
    // The harness attaches it at the caster (inside the rotated root container).
    // Its placed child (PlaceObject2_4_1) carries the wobble clip events; since
    // `move` is a container, we model the wobble on `move` itself (the placed
    // child IS move in our model — there are no separate named sub-clips here,
    // the PlaceObject2_4_1 refers to the inner content of move's authored frame).
    // We implement the wobble on move's onLoad/onEnterFrame directly, mirroring
    // the PlaceObject2_4_1 clip events that live inside move's frame_1.
    //
    // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   a = 30; i = 0;
    // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1;
    //
    // NOTE: `move` has no texture frames of its own (it's a container).
    // For ProjectileLinear the harness attaches move at root; the sprite
    // is conceptually inside it. However, since the manifest's `move` symbol
    // is not in librarySymbols (it only appears implicitly as DefineSprite_10_move
    // via the script paths), and the harness expects a registered "move" symbol,
    // we register it here with the shoot bounds as a rough approximation for
    // anchor (the harness doesn't use the anchor for `move` positioning).
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
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
        // AS _rotation = 90 + a * Math.cos(i) → degrees → radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- shoot — 93-frame composite impact at target -------------
    // The harness (ProjectileLinear) attaches shoot at the target-relative
    // offset inside the rotated root container.
    // Frame 0: signal hit + attach sprite8 child (placed at depth 1 with
    //   the matrix from manifest.librarySymbols[0].placements[0]).
    // Frame 90 (AS frame_91): _parent.removeMovieClip() → complete.
    //
    // AS DefineSprite_9_shoot/frame_91/DoAction.as: _parent.removeMovieClip(); stop();
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
            // First frame of shoot = projectile has landed at target.
            // Signal hit so damage popups appear.
            this.runtime.signalHit();

            // Attach sprite8 as a child of shoot. The manifest placement
            // (librarySymbols[0].placements[0]) places it at depth 1 with:
            //   scaleX = scaleY ≈ 0.9817, translateX = 0.05, translateY = 0.15
            //   rotateSkew0 = rotateSkew1 = 0 (no rotation from matrix)
            // We apply translate; scale is close to 1 so we also apply it.
            //
            // AS: PlaceObject2 of sprite8 inside DefineSprite_9_shoot frame_1
            const child = clip.attach(sprite8Sym, "sprite8_1", 1, ctx, {
              x: 0.05,
              y: 0.15,
            });
            child.scaleX = 0.981719970703125;
            child.scaleY = 0.981719970703125;
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop();
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
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical scripts for spell 2106.
    // The harness (ProjectileLinear) will attach `move` at root (caster local)
    // and `shoot` at the target-relative offset automatically.
  }
}
