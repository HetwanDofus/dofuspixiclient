/**
 * Spell 611 — Dodge (Sram / generic evasion flash).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/611/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` (2-frame
 * container) and `shoot` (144-frame impact burst), both present in
 * manifest.animations — the harness drives move along a parabolic arc,
 * then attaches shoot at landing.
 *
 * Symbol layout:
 *
 *   - `sprite9` (lib_sprite9) — small spark/debris particle (directlyDynamic).
 *       characterId=9, 1 frame. Used in both move and shoot contexts.
 *       onLoad (DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(load)):
 *         seeds vrot ∈ [-25,25], vrot2 ∈ [-0.3,0.3].
 *       onEnterFrame (DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(enterFrame)):
 *         while _Y < parent.p: vrot2 decays by /1.16, xscale = 50*sin(i+=vrot2),
 *         rotation increments by vrot.
 *       The parent DefineSprite_9 (a wrapper) has its own DoAction that seeds
 *         per-instance roti, dv, v, vx, vy, p, cacc and drives an onEnterFrame
 *         that moves the wrapper clip toward its ceiling p.
 *
 *   - `sprite8` (DefineSprite_8 inner leaf) — random-frame stop on load.
 *       DoAction: gotoAndStop(random(4)+1). Rendered as part of composite.
 *       Not a library symbol in manifest.librarySymbols; baked into move frames.
 *
 *   - `sprite13` (DefineSprite_13 inner leaf) — slow horizontal drift in move.
 *       DoAction: v = 2*Math.random()-3; onEnterFrame: _X += v.
 *
 *   - `move` (DefineSprite_14_move) — 2-frame container driven by harness.
 *       frame_1: 6 placements of sprite13 (depths 1,5,9,13,17,21), each does
 *         gotoAndStop(random(_totalframes)+1) on load.
 *       frame_2 DoAction: _parent.roti = _rotation; stop().
 *
 *   - `shoot` (DefineSprite_11_shoot) — 144-frame impact burst.
 *       frame_1 DoAction: _parent.move.removeMovieClip() (harness already did this).
 *       frame_1 placements:
 *         - PlaceObject2_3_3 (depth 3): DefineSprite_3 wrapper, onLoad sets
 *           _rotation = _parent._parent.roti (captured from move's frame_2).
 *         - PlaceObject2_9_15,17,19,21,23,25 (depths 15-25 odd): sprite9 instances,
 *           each onLoad does gotoAndStop(random(_totalframes)+1).
 *       frame_109 PlaceObject2_10_1 onEnterFrame: _parent._alpha -= 3
 *         (fade out the shoot container from frame 109 onward).
 *       frame_142 DoAction: stop().
 *
 *   - `sprite3` (DefineSprite_3) — wrapper placed inside shoot at depth 3.
 *       Placed at frame_1 of shoot. onLoad: _rotation = _parent._parent.roti.
 *       Itself contains a DefineSprite_2 sub-timeline (46 frames, stops at 45).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("dodge_601"); (no stop needed,
 * harness drives move/shoot).
 *
 * Completion: shoot frame_142 calls stop(); we call runtime.complete() there.
 * signalHit: NOT called here — harness fires it automatically at ballistic landing
 * (displayType=30).
 *
 * Notes on roti:
 *   move's frame_2 DoAction captures `_parent.roti = _rotation` where _rotation
 *   is the harness-applied angle of the move container. shoot's frame_1 then reads
 *   `_parent._parent.roti` (shoot → root → roti). We store roti on root.vars.
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

// ---- Manifest bounds for lib_sprite9 ----
const SPRITE9_BOUNDS = {
  width: 15.1,
  height: 8.1,
  offsetX: -7.75,
  offsetY: -4.35,
};

// ---- Manifest bounds for move animation (container) ----
const MOVE_BOUNDS = {
  width: 161.15,
  height: 44.1,
  offsetX: -98.4,
  offsetY: -21.7,
};

// ---- Manifest bounds for shoot animation (container) ----
const SHOOT_BOUNDS = {
  width: 108.5,
  height: 43.5,
  offsetX: -66,
  offsetY: -27.25,
};

export class Spell611 extends RuntimeSpell {
  readonly spellId = 611;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Hold symbol refs for cross-symbol access
  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- sprite9 — spark/debris particle (directlyDynamic) ------
    // The wrapper DefineSprite_9 owns a child (PlaceObject2_8_1 which is
    // an instance of sprite8, i.e. DefineSprite_8) and its own DoAction
    // that acts on a child named `c`. We model DefineSprite_9 as the
    // "outer wrapper" symbol here, using the lib_sprite9 texture.
    //
    // In the canonical AS, the outer sprite (DefineSprite_9) contains:
    //   - One placed child `c` (DefineSprite_8, a random-frame leaf).
    //   - DoAction on frame_1 that seeds variables and sets up onEnterFrame
    //     on `this` (the DefineSprite_9 instance) to move it.
    //   - The placed child `c` (PlaceObject2_8_1) has its own clipEvents
    //     (vrot, vrot2) driving oscillation.
    //
    // Since DefineSprite_8 (the inner leaf) is not in librarySymbols,
    // we treat the whole DefineSprite_9 as a single particle unit whose
    // visual is the lib_sprite9 texture. The onLoad seeds both the wrapper
    // (DefineSprite_9/frame_1/DoAction.as) and the inner clip-event logic
    // (PlaceObject2_8_1/onClipEvent(load)).
    // The onEnterFrame merges both the wrapper's onEnterFrame lambda and the
    // inner clipEvent enterFrame behavior.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/DoAction.as:
        //   roti = _parent._parent.roti - 30 + 60*Math.random();
        //   c._rotation = roti;
        //   dv = 1.05 + 0.2*Math.random();
        //   v = 3 + 10*Math.random();
        //   vx = v * Math.cos(roti * PI/180);
        //   vy = v * Math.sin(roti * PI/180);
        //   p = 60 - random(30);
        //   cacc = 0.3 + 0.3*Math.random();
        const root = clip.parent?.parent ?? clip.parent;
        const rotiParent = (root?.vars.roti as number) ?? 0;
        const roti = rotiParent - 30 + 60 * Math.random();
        clip.vars.roti = roti;
        // c._rotation is the inner leaf rotation — stored as cRotation
        clip.vars.cRotation = roti;
        clip.rotation = (roti * Math.PI) / 180;
        const dv = 1.05 + 0.2 * Math.random();
        clip.vars.dv = dv;
        const v = 3 + 10 * Math.random();
        const vx = v * Math.cos((roti * Math.PI) / 180);
        const vy = v * Math.sin((roti * Math.PI) / 180);
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        const p = 60 - Math.floor(Math.random() * 30);
        clip.vars.p = p;
        const cacc = 0.3 + 0.3 * Math.random();
        clip.vars.cacc = cacc;

        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(load):
        //   vrot = -25 + 50*Math.random();
        //   vrot2 = -0.3 + 0.6*Math.random();
        clip.vars.vrot = -25 + 50 * Math.random();
        clip.vars.vrot2 = -0.3 + 0.6 * Math.random();
        clip.vars.i = 0;
        // Internal sub-Y for tracking the "c._y" concept (starts at 0)
        clip.vars.cy = 0;
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/DoAction.as onEnterFrame lambda:
        //   if(c._y < p) { c._y += cacc; _X += vx; _Y += vy; vx /= dv; vy /= dv; }
        const p = clip.vars.p as number;
        const cacc = clip.vars.cacc as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const dv = clip.vars.dv as number;
        let cy = clip.vars.cy as number;

        if (cy < p) {
          cy += cacc;
          clip.x += vx;
          clip.y += vy;
          vx /= dv;
          vy /= dv;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
          clip.vars.cy = cy;
        }

        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(enterFrame):
        //   if(_Y < _parent.p) {
        //     vrot2 /= 1.16;
        //     _xscale = 50 * Math.sin(i += vrot2);
        //     _rotation = _rotation + vrot;
        //   }
        // Note: _Y here is the outer sprite's Y (clip.y), _parent.p is clip.vars.p
        if (clip.y < p) {
          let vrot2 = clip.vars.vrot2 as number;
          const vrot = clip.vars.vrot as number;
          let i = clip.vars.i as number;
          vrot2 /= 1.16;
          i += vrot2;
          clip.vars.vrot2 = vrot2;
          clip.vars.i = i;
          // AS: _xscale = 50 * sin(i+=vrot2) — in percent, convert to decimal
          clip.scaleX = (50 * Math.sin(i)) / 100;
          // AS: _rotation = _rotation + vrot (degrees)
          clip.rotation += (vrot * Math.PI) / 180;
        }
      },
    };

    // ---- sprite13 — horizontal-drift particle inside move --------
    // AS DefineSprite_13/frame_1/DoAction.as:
    //   v = 2*Math.random() - 3;
    //   this.onEnterFrame = function() { _X = _X + v; };
    // Not in librarySymbols; used as container-only with no texture.
    // The gotoAndStop in each PlaceObject2_13_*/onClipEvent(load) randomises
    // displayed frame — but since we have no separate frame textures for
    // DefineSprite_13, we treat it as a texture-free drift point.
    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS DefineSprite_13/frame_1/DoAction.as
        const v = 2 * Math.random() - 3;
        clip.vars.v = v;

        // AS DefineSprite_14_move/frame_1/PlaceObject2_13_*/onClipEvent(load):
        //   gotoAndStop(random(_totalframes) + 1);
        // totalFrames=1, so gotoAndStop(1) → no-op, handled implicitly.
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_13/frame_1/DoAction.as onEnterFrame:
        //   _X = _X + v;
        const v = clip.vars.v as number;
        clip.x += v;
      },
    };

    // ---- move — 2-frame projectile container ---------------------
    // AS DefineSprite_14_move/frame_1: 6 placements of sprite13 at
    //   depths 1,5,9,13,17,21, each does gotoAndStop(random+1) on load.
    // AS DefineSprite_14_move/frame_2/DoAction.as:
    //   _parent.roti = _rotation;  stop();
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_14_move/frame_1: place 6 sprite13 instances.
            // Depths from PlaceObject2_13_1, _5, _9, _13, _17, _21.
            // Each onLoad does gotoAndStop(random(_totalframes)+1) — totalFrames=1,
            // effectively a no-op. The real behaviour is the drift onEnterFrame.
            clip.attach(sprite13Sym, "s13_1", 1, ctx);
            clip.attach(sprite13Sym, "s13_5", 5, ctx);
            clip.attach(sprite13Sym, "s13_9", 9, ctx);
            clip.attach(sprite13Sym, "s13_13", 13, ctx);
            clip.attach(sprite13Sym, "s13_17", 17, ctx);
            clip.attach(sprite13Sym, "s13_21", 21, ctx);
          },
        ],
        [
          1,
          (clip) => {
            // AS DefineSprite_14_move/frame_2/DoAction.as:
            //   _parent.roti = _rotation;
            //   stop();
            // Store the current rotation (harness-applied angle) on root.vars.roti
            // in degrees so shoot's frame_1 can read it.
            const root = clip.parent;
            if (root) {
              // clip.rotation is in radians; convert back to degrees for roti.
              root.vars.roti = (clip.rotation * 180) / Math.PI;
            }
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite3 (DefineSprite_3) — wrapper inside shoot at depth 3 ---
    // AS DefineSprite_11_shoot/frame_1/PlaceObject2_3_3/onClipEvent(load):
    //   _rotation = _parent._parent.roti;
    // DefineSprite_3 itself contains DefineSprite_2 (46 frames, stops at 45).
    // We model it as a single-frame container (no separate texture) whose
    // onLoad sets the rotation from the captured roti on root.vars.
    // DefineSprite_3/frame_16/DoAction.as: stop() — handled as frameScript.
    // DefineSprite_2/frame_46/DoAction.as: stop() — inner, not separately
    // controllable at this level; the composite shoot textures already bake it.
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 16,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onLoad: (clip) => {
        // AS DefineSprite_11_shoot/frame_1/PlaceObject2_3_3/onClipEvent(load):
        //   _rotation = _parent._parent.roti;
        // _parent is shoot, _parent._parent is root. roti in degrees.
        const root = clip.parent?.parent;
        const rotiDeg = (root?.vars.roti as number) ?? 0;
        clip.rotation = (rotiDeg * Math.PI) / 180;
      },

      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_3/frame_16/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite10 (DefineSprite_10) — fade driver placed at frame 109 ---
    // AS DefineSprite_11_shoot/frame_109/PlaceObject2_10_1/onClipEvent(enterFrame):
    //   _parent._alpha -= 3;
    // This is placed at frame 109 of shoot (0-based: 108). On every subsequent
    // enterFrame it decreases the shoot container's alpha by 3 (out of 100).
    // We model it as a hidden single-frame symbol whose onEnterFrame drives the
    // shoot parent's alpha. Alpha: AS 0-100 → TS 0-1 delta = 3/100 = 0.03.
    const sprite10Sym: SymbolDefinition = {
      name: "sprite10",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      onEnterFrame: (clip) => {
        // AS DefineSprite_11_shoot/frame_109/PlaceObject2_10_1/onClipEvent(enterFrame):
        //   _parent._alpha -= 3;  (AS alpha 0-100)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3 / 100);
        }
      },
    };

    // ---- shoot — 144-frame impact burst --------------------------
    // AS DefineSprite_11_shoot/frame_1/DoAction.as:
    //   _parent.move.removeMovieClip();
    //   (harness already removes move on landing, but we honour it)
    // frame_1: place sprite3 at depth 3, place 6 sprite9 instances at
    //   depths 15,17,19,21,23,25 (PlaceObject2_9_15/17/19/21/23/25).
    //   Each sprite9 onLoad: gotoAndStop(random(_totalframes)+1) → random frame.
    //   Since sprite9 has totalFrames=1, gotoAndStop(1) is a no-op visually,
    //   but the onLoad also seeds particle physics.
    // frame_109 (0-based 108): place sprite10 (the fade driver).
    // frame_142 (0-based 141): DoAction: stop(); → we also signal complete.
    //
    // The 6 sprite9 placements from the manifest (depths 15–25) have transforms:
    //   depth 15: (17.4, 12.5)
    //   depth 17: (-10.1, -9.25)
    //   depth 19: (21.35, -18.1)
    //   depth 21: (0.1, -22.2)
    //   depth 23: (35.15, -4.8)
    //   depth 25: (5.2, 7.15)
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 144,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_11_shoot/frame_1/DoAction.as:
            //   _parent.move.removeMovieClip();
            // The harness already removed move at landing, but mirror it:
            const moveClip = clip.parent?.children.get("move");
            if (moveClip) {
              moveClip.remove();
            }

            // AS DefineSprite_11_shoot/frame_1/PlaceObject2_3_3/onClipEvent(load):
            // Place sprite3 at depth 3 (no transform offset in manifest,
            // so default (0,0)).
            clip.attach(sprite3Sym, "sprite3_3", 3, ctx);

            // AS DefineSprite_11_shoot/frame_1/PlaceObject2_9_15..25 placements.
            // Each has onLoad: gotoAndStop(random(_totalframes)+1) — drives sprite9
            // onLoad which seeds particle physics. The manifest-listed placement
            // transforms are applied after attach() so onLoad can read them.
            clip.attach(this.sprite9Sym, "sp9_15", 15, ctx, {
              x: 17.4,
              y: 12.5,
            });
            clip.attach(this.sprite9Sym, "sp9_17", 17, ctx, {
              x: -10.1,
              y: -9.25,
            });
            clip.attach(this.sprite9Sym, "sp9_19", 19, ctx, {
              x: 21.35,
              y: -18.1,
            });
            clip.attach(this.sprite9Sym, "sp9_21", 21, ctx, {
              x: 0.1,
              y: -22.2,
            });
            clip.attach(this.sprite9Sym, "sp9_23", 23, ctx, {
              x: 35.15,
              y: -4.8,
            });
            clip.attach(this.sprite9Sym, "sp9_25", 25, ctx, {
              x: 5.2,
              y: 7.15,
            });
          },
        ],
        [
          108,
          (clip, ctx) => {
            // AS DefineSprite_11_shoot/frame_109/PlaceObject2_10_1:
            // Place the fade-driver sprite at depth 1.
            clip.attach(sprite10Sym, "sprite10_1", 1, ctx);
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_11_shoot/frame_142/DoAction.as: stop();
            clip.stop();
            // Signal spell completion — this is the final frame of the
            // longest-lived symbol; mirrors _parent.removeMovieClip() semantics.
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite9Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(sprite3Sym);
    this.registry.register(sprite10Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("dodge_601");
    callbacks.playSound("dodge_601");
  }
}
