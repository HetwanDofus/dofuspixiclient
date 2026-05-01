/**
 * Spell 2023 — (Unknown name, likely a death/explosion effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2023/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol
 * (114-frame explosion animation) placed at the target cell. There is no
 * `move`, no caster-relative logic, no projectile arc — this is a pure
 * impact animation. The main-timeline `DoAction.as` only plays a sound.
 *
 * Library symbols (all placed via PlaceObject2 with CLIPACTIONRECORD handlers):
 *
 *   - sprite21 (directlyDynamic: true) — a 42-frame particle sprite.
 *     onLoad: seeds alpha, scale (ta), vr, parent.vr, i.
 *     onEnterFrame: oscillates scaleX via sin(i += vr *= 0.9);
 *                   rotates parent via _rotation += parent.vr *= 0.9.
 *     Placed inside sprite22 at depth 1 with a small y-offset.
 *
 *   - sprite22 (directlyDynamic: false) — wrapper sprite (1 frame).
 *     No own clip events. Its job is to hold sprite21.
 *     frameScripts[0]: attach sprite21 at depth 1 with the canonical matrix.
 *     Placed inside sprite23 at depth 1 with translateX=2.25, translateY=-1.7.
 *
 *   - sprite23 (directlyDynamic: true) — 1-frame particle that holds sprite22.
 *     onLoad (PlaceObject2_22_1): seeds v = 3.3 + random(40).
 *     onEnterFrame (PlaceObject2_22_1): _X += v *= 0.8 (child sprite22 drifts).
 *     Additionally each of the 10 placements inside sprite24 has its own
 *     onLoad: _rotation = random(360).
 *     frameScripts[0]: attach sprite22 at depth 1 with its canonical offset.
 *     Placed 10 times inside sprite24 (depths 1,3,5,7,9,11,13,15,17,19)
 *     each with a random initial rotation from their respective onClipEvent(load).
 *
 *   - sprite24 (not in librarySymbols — it IS the shoot symbol's inner
 *     composite). Looking at the script tree more carefully:
 *
 * Overall composite hierarchy:
 *   shoot (DefineSprite_18_shoot, 114 frames, placed by harness as TargetCell)
 *     └── [via onSpellStart] the shoot symbol itself IS the top-level sprite.
 *         The outer PlaceObject2_24_1 on the MAIN TIMELINE (frame_1) places
 *         an instance of DefineSprite_24 inside the ROOT, not inside shoot.
 *         That PlaceObject2_24_1 carries its own onClipEvent(load/enterFrame):
 *           load:  t = 0
 *           enter: if (t++ > 45) _alpha -= 3.3
 *         DefineSprite_24 contains 10 sprite23 instances at various transforms.
 *         Each sprite23 has a random rotation onLoad, drifts via sprite22/sprite21.
 *
 * So the structure is:
 *   root (TargetCell anchor)
 *     ├── shoot (DefineSprite_18_shoot, 114 frames) — registered + attached by harness
 *     └── sprite24_inst (DefineSprite_24, dynamically placed from onSpellStart)
 *             with onLoad (t=0) and onEnterFrame (fade after frame 45)
 *           ├── sprite23 @depth1  (random rotation, drifting)
 *           ├── sprite23 @depth3
 *           ├── ...×10
 *
 * Frame scripts:
 *   shoot frame_1  (index 0): _rotation = 0
 *   shoot frame_100 (index 99): _parent.removeMovieClip() → complete()
 *
 * signalHit: fired at shoot frame_1 (the explosion starts) since this is
 * TargetCell and the harness does NOT auto-signal for displayType=11.
 *
 * Main timeline: SOMA.playSound("explo_death")
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

// --- Manifest bounds ---

const SPRITE21_BOUNDS = {
  width: 13.5,
  height: 16.35,
  offsetX: -6.7,
  offsetY: -8.15,
};

const SPRITE22_BOUNDS = {
  width: 13.5,
  height: 16.35,
  offsetX: -6.7,
  offsetY: -8.2,
};

const SPRITE23_BOUNDS = {
  width: 13.5,
  height: 16.35,
  offsetX: -4.45,
  offsetY: -9.9,
};

// shoot bounds from animations[]
const SHOOT_BOUNDS = {
  width: 184.9,
  height: 110.4,
  offsetX: -92.4,
  offsetY: -54.85,
};

export class Spell2023 extends RuntimeSpell {
  readonly spellId = 2023;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so onSpellStart can attach them
  private sprite21Sym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;
  private sprite23Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);
    const sprite22Anchor = calculateAnchor(SPRITE22_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- sprite21 (directlyDynamic: true) -----------------------
    // AS DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // This is the innermost animated particle: a 42-frame leaf/spark
    // that oscillates its own scaleX via sin and rotates its parent
    // (sprite22) via vr decay.
    this.sprite21Sym = {
      name: "sprite21",
      totalFrames: 42,
      frames: textures.getFrames("lib_sprite21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      onLoad: (clip) => {
        // AS: _alpha = 50 + random(50)
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        // AS: ta = 30 + random(70); _xscale = ta; _yscale = ta
        const ta = 30 + Math.floor(Math.random() * 70);
        clip.scaleX = ta / 100;
        clip.scaleY = ta / 100;
        // AS: vr = 3.36 * (-0.5 + Math.random())
        clip.vars.vr = 3.36 * (-0.5 + Math.random());
        // AS: _parent.vr = 100 * (-0.5 + Math.random())
        if (clip.parent) {
          clip.parent.vars.vr = 100 * (-0.5 + Math.random());
        }
        // AS: i = 0
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: _xscale = 100 * Math.sin(i += vr *= 0.9)
        let vr = clip.vars.vr as number;
        let i = clip.vars.i as number;
        vr *= 0.9;
        i += vr;
        clip.scaleX = Math.sin(i);
        clip.vars.vr = vr;
        clip.vars.i = i;
        // AS: _parent._rotation += _parent.vr *= 0.9
        const parent = clip.parent;
        if (parent) {
          let pvr = parent.vars.vr as number;
          pvr *= 0.9;
          parent.rotation += (pvr * Math.PI) / 180;
          parent.vars.vr = pvr;
        }
      },
    };

    // ---- sprite22 (directlyDynamic: false) ----------------------
    // A wrapper sprite with 1 frame. No clip events of its own.
    // Its frameScripts[0] attaches sprite21 at depth 1 with the
    // canonical matrix from placements[0]:
    //   translateX: 0, translateY: -0.05
    // AS: no own CLIPACTIONRECORD — purely structural.
    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite22"),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite21 at depth 1 with canonical matrix from
            // librarySymbols[sprite21].placements[0] (parentSpriteId=22)
            clip.attach(this.sprite21Sym, "sprite21_1", 1, ctx, {
              x: 0,
              y: -0.05,
            });
          },
        ],
      ]),
    };

    // ---- sprite23 (directlyDynamic: true) -----------------------
    // A 1-frame container that:
    //   (a) is placed 10 times inside sprite24 each with random rotation
    //       (each PlaceObject2_23_X in sprite24 has onClipEvent(load):
    //        _rotation = random(360) )
    //   (b) holds one sprite22 which drifts outward:
    //       AS DefineSprite_23/frame_1/PlaceObject2_22_1/onClipEvent(load):
    //         v = 3.3 + random(40)
    //       AS DefineSprite_23/frame_1/PlaceObject2_22_1/onClipEvent(enterFrame):
    //         _X = _X + (v *= 0.8)
    //
    // The onLoad for sprite23 itself seeds the random rotation (applied
    // from the parent sprite24's onLoad for each placement). The child
    // sprite22 drift is handled by the sprite22 child's own clip, but
    // since our runtime can't attach PlaceObject2 child events to a
    // specific placed child, we model the drift as an onEnterFrame on
    // sprite23 that moves the "sprite22_1" child — mirroring the AS
    // where the child's enterFrame does _X += v *= 0.8.
    //
    // Actually reading more carefully: PlaceObject2_22_1 is the
    // INSTANCE placed inside DefineSprite_23, so the onClipEvent(load/
    // enterFrame) belong to that specific placed instance. We model this
    // by giving sprite22 an onLoad/onEnterFrame that runs when it is
    // instantiated inside sprite23. However sprite22 is "directlyDynamic:
    // false" and has no own handlers. The handlers are on the INSTANCE
    // placed inside sprite23's timeline (PlaceObject2_22_1). We need to
    // capture these as part of sprite23's frameScripts[0] which attaches
    // sprite22, then manage the drift ourselves. The cleanest approach is
    // to model the drift directly in sprite23's onEnterFrame by moving
    // the child.
    this.sprite23Sym = {
      name: "sprite23",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_24/frame_1/PlaceObject2_23_X/onClipEvent(load):
        //   _rotation = random(360)
        // (This fires for every instance placed in sprite24.)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite22 at depth 1 with canonical placement matrix
            // from librarySymbols[sprite22].placements[0] (parentSpriteId=23):
            //   translateX: 2.25, translateY: -1.7
            // Then seed the drift velocity v on the child, matching
            // AS DefineSprite_23/frame_1/PlaceObject2_22_1/onClipEvent(load):
            //   v = 3.3 + random(40)
            const child = clip.attach(this.sprite22Sym, "sprite22_1", 1, ctx, {
              x: 2.25,
              y: -1.7,
            });
            // Seed drift velocity on the child so our onEnterFrame can read it
            child.vars.v = 3.3 + Math.floor(Math.random() * 40);
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_23/frame_1/PlaceObject2_22_1/onClipEvent(enterFrame):
        //   _X = _X + (v *= 0.8)
        // The child sprite22 drifts outward along the x-axis of sprite23.
        const child = clip.children.get("sprite22_1");
        if (child) {
          let v = child.vars.v as number;
          v *= 0.8;
          child.x += v;
          child.vars.v = v;
        }
      },
    };

    // ---- sprite24 — 10-instance explosion scatter composite -----
    // DefineSprite_24 is placed on the MAIN TIMELINE (PlaceObject2_24_1)
    // with its own onClipEvent(load/enterFrame):
    //   load:  t = 0
    //   enter: if (t++ > 45) _alpha -= 3.3
    // It is NOT listed as a librarySymbols entry (it's the outermost
    // dynamic sprite placed directly on the main timeline). We model it
    // as a SymbolDefinition so we can attach it from onSpellStart.
    //
    // Its frame_1 (index 0) places 10 sprite23 instances at depths
    // 1,3,5,7,9,11,13,15,17,19 with the transforms from:
    // librarySymbols[sprite23].placements (all parentSpriteId=24, frame=0).
    this.sprite24Sym = {
      name: "sprite24",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_1/PlaceObject2_24_1/CLIPACTIONRECORD onClipEvent(load).as
        //   t = 0
        clip.vars.t = 0;
      },
      onEnterFrame: (clip) => {
        // AS frame_1/PlaceObject2_24_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   if (t++ > 45) { _alpha = _alpha - 3.3; }
        let t = clip.vars.t as number;
        if (t > 45) {
          clip.alpha = Math.max(0, clip.alpha - 3.3 / 100);
        }
        clip.vars.t = t + 1;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place 10 sprite23 instances per librarySymbols[sprite23].placements[]
            // (all at parentSpriteId=24, frame=0). The transforms below are
            // taken verbatim from the manifest placements array.
            //
            // Each sprite23's onLoad will fire and set a random rotation.
            // Depths match the PlaceObject2_23_X naming convention.

            // depth 1: translateX=10.45, translateY=4.25
            clip.attach(this.sprite23Sym, "sprite23_1", 1, ctx, {
              x: 10.45,
              y: 4.25,
            });
            // depth 3: translateX=-2.95, translateY=-5.25
            clip.attach(this.sprite23Sym, "sprite23_3", 3, ctx, {
              x: -2.95,
              y: -5.25,
            });
            // depth 5: translateX=-14.95, translateY=0.25
            clip.attach(this.sprite23Sym, "sprite23_5", 5, ctx, {
              x: -14.95,
              y: 0.25,
            });
            // depth 7: translateX=-10.45, translateY=7.25
            clip.attach(this.sprite23Sym, "sprite23_7", 7, ctx, {
              x: -10.45,
              y: 7.25,
            });
            // depth 9: translateX=-1.55, translateY=8.75
            clip.attach(this.sprite23Sym, "sprite23_9", 9, ctx, {
              x: -1.55,
              y: 8.75,
            });
            // depth 11: translateX=11.7, translateY=2.5
            clip.attach(this.sprite23Sym, "sprite23_11", 11, ctx, {
              x: 11.7,
              y: 2.5,
            });
            // depth 13: translateX=-1.7, translateY=-7
            clip.attach(this.sprite23Sym, "sprite23_13", 13, ctx, {
              x: -1.7,
              y: -7,
            });
            // depth 15: translateX=-13.7, translateY=-1.5
            clip.attach(this.sprite23Sym, "sprite23_15", 15, ctx, {
              x: -13.7,
              y: -1.5,
            });
            // depth 17: translateX=-9.2, translateY=5.5
            clip.attach(this.sprite23Sym, "sprite23_17", 17, ctx, {
              x: -9.2,
              y: 5.5,
            });
            // depth 19: translateX=-0.3, translateY=7
            clip.attach(this.sprite23Sym, "sprite23_19", 19, ctx, {
              x: -0.3,
              y: 7,
            });
          },
        ],
      ]),
    };

    // ---- shoot (DefineSprite_18_shoot, 114 frames) ---------------
    // animations[] entry "shoot" — placed by the harness at target cell.
    // frame_1  (index 0):  _rotation = 0  (canonical override)
    //                       signalHit fired here (first visible impact frame)
    // frame_100 (index 99): _parent.removeMovieClip(); stop() → complete()
    this.shootSym = {
      name: "shoot",
      totalFrames: 114,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_18_shoot/frame_1/DoAction.as: _rotation = 0
            // (clip.rotation is 0 by default; explicit set for canonical fidelity)
            _clip.rotation = 0;
            // Signal hit at the first frame of the explosion impact.
            this.runtime.signalHit();
          },
        ],
        [
          99,
          (clip) => {
            // AS DefineSprite_18_shoot/frame_100/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite21Sym);
    this.registry.register(this.sprite22Sym);
    this.registry.register(this.sprite23Sym);
    this.registry.register(this.sprite24Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("explo_death");
    callbacks.playSound("explo_death");

    // Attach the shoot symbol at the root. For TargetCell the harness
    // does NOT automatically attach "shoot" — that is only done for
    // ProjectileBallistic. We must attach it explicitly here.
    // The root is positioned at the target cell by the harness.
    this.root.attach(this.shootSym, "shoot", 1, context);

    // Attach the sprite24 scatter composite at the root.
    // This mirrors the main-timeline PlaceObject2_24_1 placement.
    // It is placed above the shoot at depth 2 so the scatter particles
    // draw on top of the explosion (matching the authored layering).
    this.root.attach(this.sprite24Sym, "sprite24_1", 2, context);
  }
}
