/**
 * Spell 901 — Flèche des Feuilles (Cra wind/leaf arrow), displayType=20 ProjectileLinear.
 *
 * Canonical AS source: tools/combat-exporter/output/spell-anims/901/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear): the harness anchors the root at the caster cell,
 * rotates it to face the target, and attaches "shoot" at the target-relative offset.
 * There is no ballistic "move" arc — the arrow travels instantaneously along the line.
 *
 * Library symbols:
 *   - sprite8 (characterId 8, directlyDynamic: true) — 66-frame arrow impact sprite.
 *     Placed at depth 2 inside the "shoot" container (DefineSprite_9_shoot), frame 0,
 *     via matrix (scaleX≈0.98, translateX≈0.05, translateY≈0.15).
 *     onLoad seeds wobble amplitude `a=15`, phase `i=0`.
 *     onEnterFrame: oscillating rotation `_rotation = 90 + a * cos(i += π); a /= 1.1`.
 *     frame_64 (index 63): stop().
 *
 *   - move — container symbol referenced by the ProjectileLinear harness. No frame
 *     textures; carries a wobble clip (PlaceObject2_4_1) whose clip events are:
 *     onLoad: a=30, i=0.
 *     onEnterFrame: _rotation = 90 + a * cos(i += 0.6); a /= 1.1.
 *     (This is the pre-impact wobble on the "move" placeholder while traveling.)
 *
 *   - shoot — 93-frame composite timeline.
 *     frame_91 (index 90): _parent.removeMovieClip(); stop() → spell complete.
 *     Attaches sprite8 at depth 2, frame 0, with canonical placement matrix.
 *
 * Main timeline: no explicit sounds found in the script list; no DoAction on the
 * main timeline. onSpellStart is a no-op (or could play a sound if identified).
 *
 * signalHit: displayType 20 — harness does NOT auto-signal hit. We fire it from
 * shoot's frame 0 (the moment the arrow lands at the target).
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

// Bounds from manifest.json librarySymbols[0] (sprite8)
const SPRITE8_BOUNDS = {
  width: 30.3,
  height: 32.2,
  offsetX: -23.75,
  offsetY: -18.1,
};

// Bounds from manifest.json animations[0] (shoot — composite, used for "shoot" symbol)
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
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- sprite8 — directlyDynamic impact wobble sprite ----------
    // Placed inside "shoot" at depth 2, frame 0, with matrix:
    //   scaleX=scaleY≈0.9817, translateX=0.05, translateY=0.15
    //
    // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 15;
    //   i = 0;
    //
    // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = 90 + a * Math.cos(i += 3.1415);
    //   a /= 1.1;
    //
    // AS DefineSprite_8/frame_64/DoAction.as
    //   stop();
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 15;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        // AS _rotation in degrees → TS radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
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

    // ---- moveWobble — the clip placed inside "move" via PlaceObject2_4_1 ----
    // DefineSprite_10_move has a child placed at depth 1 (PlaceObject2_4_1) whose
    // clip events are:
    //
    // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 30;
    //   i = 0;
    //
    // AS DefineSprite_10_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = 90 + a * Math.cos(i += 0.6);
    //   a /= 1.1;
    //
    // The "move" container itself has no visual frames — it's a placeholder container
    // for the ProjectileLinear harness. The wobble child is a separate unnamed sprite
    // (no librarySymbol entry) placed inside move. We model it as an inline symbol.
    const moveWobbleSym: SymbolDefinition = {
      name: "moveWobble",
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
        // AS _rotation in degrees → TS radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — container for the ProjectileLinear harness ------
    // The harness attaches "move" at root for displayType 20. move's
    // frame_1 places the wobble child inside it.
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
            // Canonical PlaceObject2_4_1 placement in DefineSprite_10_move frame_1:
            // attach the wobble child with its onLoad/onEnterFrame handlers.
            clip.attach(moveWobbleSym, "wobble", 1, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame composite impact timeline -------------
    // The harness attaches "shoot" at the target-relative offset for
    // displayType 20 (ProjectileLinear). shoot carries:
    //   - frame_0: attach sprite8 at depth 2 with canonical placement matrix;
    //              signal hit (arrow has arrived at target).
    //   - frame_90 (AS frame_91): _parent.removeMovieClip(); stop() → complete.
    //
    // AS DefineSprite_9_shoot/frame_91/DoAction.as:
    //   _parent.removeMovieClip();
    //   stop();
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
            // Canonical PlaceObject2 placement of sprite8 at depth 2 in
            // DefineSprite_9_shoot, frame 1, with matrix:
            //   scaleX=0.981719970703125, scaleY=0.981719970703125
            //   rotateSkew0=0, rotateSkew1=0
            //   translateX=0.05, translateY=0.15
            clip.attach(sprite8Sym, "sprite8", 2, ctx, {
              x: 0.05,
              y: 0.15,
            });
            // Apply canonical scale from placement matrix (no rotation skew)
            const sprite8Child = clip.children.get("sprite8");
            if (sprite8Child) {
              sprite8Child.scaleX = 0.981719970703125;
              sprite8Child.scaleY = 0.981719970703125;
            }
            // displayType 20: harness does NOT auto-signal hit → we do it here
            // at the frame when shoot lands at the target.
            this.runtime.signalHit();
          },
        ],
        [
          90,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_91/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveWobbleSym);
    this.registry.register(moveSym);
    this.registry.register(sprite8Sym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical AS script list for spell 901.
    // No explicit main-timeline child attaches required (harness handles move/shoot
    // for displayType 20).
  }
}
