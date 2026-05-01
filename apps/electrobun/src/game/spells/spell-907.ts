/**
 * Spell 907 — Flèche Mordante (Cra earth arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/907/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`, `shoot`, or
 * `duplicate` symbols — it is a pure impact animation at the target cell.
 * The single `anim1` animation (246 frames, isComposite=true) plays at the
 * target. No caster-side reference, no projectile, no world-absolute
 * dual-anchor pattern.
 *
 * Library symbols (all `directlyDynamic: true` unless noted):
 *
 *   - sprite3    (characterId 3)  — small white spark particle. Single
 *                                   frame visual. onLoad seeds `v=0` (vy).
 *                                   onEnterFrame: gravity bounce (_Y += v;
 *                                   v += 0.6; bounce at _Y > 0). No
 *                                   removal — lives until parent is removed.
 *                                   Placed 9 times inside sprite4 at frame 0
 *                                   with varied scales/offsets.
 *
 *   - sprite4    (characterId 4, directlyDynamic:false) — wrapper/cluster
 *                                   for the 9 sprite3 children. Frame-by-
 *                                   frame alpha ramp encoded in placements[].
 *                                   Placed inside sprite15 at frame 3 (and
 *                                   tween-moves from frames 4–171).
 *
 *   - sprite10   (characterId 10) — circular sparkle (sin-wave xscale).
 *                                   onLoad: copy rotation/alpha/i from parent.
 *                                   onEnterFrame: _xscale = 100*sin(i+=0.067).
 *                                   Placed inside sprite13 at frame 0 depth 3.
 *
 *   - sprite13   (characterId 13) — container for sprite10 + a second
 *                                   cos-wave child (PlaceObject2_12_5 at depth
 *                                   5). Has TWO clip-event children (6_1 and
 *                                   12_5). onLoad (both): copy rotation/alpha/i
 *                                   from parent. onEnterFrame: child 6_1 uses
 *                                   sin; child 12_5 uses cos. The sprite10 at
 *                                   depth 3 is attached by sprite13's
 *                                   frameScripts. Parent sets rotation/alpha/i
 *                                   on self (from DefineSprite_10 DoAction)
 *                                   so children inherit via _parent.*.
 *
 *   - sprite14   (characterId 14) — orbiting mote. onLoad: seed p, i, v2
 *                                   (0.03–0.09), random rotation, alpha=130,
 *                                   parent._alpha=10, v (0.3–0.96). onEnter-
 *                                   Frame: fade parent in/out based on _Y
 *                                   threshold; spiral orbit (_X = 25*sin(i),
 *                                   _Y = 5*cos(i) + (p-=v)); removeMovieClip
 *                                   when faded out. Placed 3× inside sprite15
 *                                   at frames 3/24/48.
 *
 *   - sprite15   (characterId 15, main outer container, 246 frames) — the
 *                                   top-level animated symbol. frame_244
 *                                   DoAction: _parent.removeMovieClip(); stop()
 *                                   → this is our completion signal.
 *                                   Attached from onSpellStart.
 *
 * DefineSprite_10 (sprite10) DoAction.as runs in sprite10's own frame_1 to
 * seed rotation/alpha/i on the sprite10 clip. Those are then read by its
 * child PlaceObject2_9_1 (which has the actual sin/cos handlers) via
 * _parent.rotation, _parent.alpha, _parent.i. We implement this as the
 * frameScripts[0] of the sprite10 symbol.
 *
 * Main timeline: SOMA.playSound("many_504");
 *
 * Completion: sprite15 frame_244 → `this.runtime.complete()`.
 * signalHit: fired at sprite15 frame_3 (first visible content).
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

// ---- Manifest bounds for each library symbol ----

const SPRITE3_BOUNDS = {
  width: 5.75,
  height: 4.5,
  offsetX: -2.85,
  offsetY: -2.25,
};

const SPRITE4_BOUNDS = {
  width: 42.4,
  height: 11,
  offsetX: -22,
  offsetY: -5.9,
};

const SPRITE10_BOUNDS = {
  width: 35.9,
  height: 35.9,
  offsetX: -17.95,
  offsetY: -17.4,
};

const SPRITE13_BOUNDS = {
  width: 51.9,
  height: 35.9,
  offsetX: -17.95,
  offsetY: -17.4,
};

const SPRITE14_BOUNDS = {
  width: 32.4,
  height: 22.45,
  offsetX: -11.2,
  offsetY: -10.9,
};

// sprite15 is the outer container — use anim1 bounds as proxy
const SPRITE15_BOUNDS = {
  width: 43.75,
  height: 22.45,
  offsetX: -22.6,
  offsetY: -11,
};

export class Spell907 extends RuntimeSpell {
  readonly spellId = 907;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-attach use
  private sprite3Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite13Anchor = calculateAnchor(SPRITE13_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);

    // ----------------------------------------------------------------
    // sprite3 — small spark particle
    // Canonical: DefineSprite_3/frame_1/PlaceObject2_2_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Note: `vx` is NOT seeded in onLoad — it is set externally when
    // attached by the parent (sprite4's children initialisation). In
    // the canonical AS, `vx` lives as a property on the clip; we seed
    // it to 0 here as a safe default. The gravity/bounce loop drives
    // _Y; _X drifts by vx (read from vars).
    // ----------------------------------------------------------------
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,

      // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = 0;
        // vx is placed on the clip from the parent's seeding logic;
        // default 0 until overridden.
        if (clip.vars.vx === undefined) {
          clip.vars.vx = 0;
        }
      },

      // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let v = clip.vars.v as number;
        const vx = clip.vars.vx as number;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        if (clip.y > 0) {
          clip.y = 0;
          v = -5 * Math.random();
          clip.vars.vx = -2.5 * Math.random() + 1.25;
        }
        clip.vars.v = v;
      },
    };

    // ----------------------------------------------------------------
    // sprite4 — wrapper that holds 9 sprite3 children (directlyDynamic:false)
    // Canonical placements: 9 × sprite3 at frame 0 with varying
    // scales/offsets/depths inside sprite4. The parent (sprite15)
    // tweens sprite4's alpha from frame 3–39 (fade-in) and 130–171
    // (fade-out) via colorTransform in the placements[] array.
    // We handle the tween in sprite15's frameScripts.
    // ----------------------------------------------------------------
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,

      // Attach the 9 sprite3 children mirroring the 9 PlaceObject2
      // placements inside sprite4 (all at frame 0 of sprite4).
      // Canonical: manifest librarySymbols[0] (sprite3) placements[]
      // parentSpriteId === 4, frame === 0, depths 1,3,5,7,9,11,13,15,17
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // depth 1 — scale 0.6193, offset (-11, 2.6)
            const c1 = clip.attach(this.sprite3Sym, "s3_d1", 1, ctx, {
              x: -11,
              y: 2.6,
            });
            c1.scaleX = 0.6193;
            c1.scaleY = 0.6193;

            // depth 3 — scale 0.3951, offset (10.75, 4.2)
            const c3 = clip.attach(this.sprite3Sym, "s3_d3", 3, ctx, {
              x: 10.75,
              y: 4.2,
            });
            c3.scaleX = 0.3951;
            c3.scaleY = 0.3951;

            // depth 5 — scale 0.3951, offset (-15.7, -1.8)
            const c5 = clip.attach(this.sprite3Sym, "s3_d5", 5, ctx, {
              x: -15.7,
              y: -1.8,
            });
            c5.scaleX = 0.3951;
            c5.scaleY = 0.3951;

            // depth 7 — scale 0.6193, offset (7.35, 1.8)
            const c7 = clip.attach(this.sprite3Sym, "s3_d7", 7, ctx, {
              x: 7.35,
              y: 1.8,
            });
            c7.scaleX = 0.6193;
            c7.scaleY = 0.6193;

            // depth 9 — scale 0.3951, offset (16.4, 1.9)
            const c9 = clip.attach(this.sprite3Sym, "s3_d9", 9, ctx, {
              x: 16.4,
              y: 1.9,
            });
            c9.scaleX = 0.3951;
            c9.scaleY = 0.3951;

            // depth 11 — scale 0.2929, offset (-21.15, 1.9)
            const c11 = clip.attach(this.sprite3Sym, "s3_d11", 11, ctx, {
              x: -21.15,
              y: 1.9,
            });
            c11.scaleX = 0.2929;
            c11.scaleY = 0.2929;

            // depth 13 — scale 0.2929, offset (19.55, 0.25)
            const c13 = clip.attach(this.sprite3Sym, "s3_d13", 13, ctx, {
              x: 19.55,
              y: 0.25,
            });
            c13.scaleX = 0.2929;
            c13.scaleY = 0.2929;

            // depth 15 — scale 0.2070, offset (-11.25, -5.2)
            const c15 = clip.attach(this.sprite3Sym, "s3_d15", 15, ctx, {
              x: -11.25,
              y: -5.2,
            });
            c15.scaleX = 0.2070;
            c15.scaleY = 0.2070;

            // depth 17 — scale 0.2929, offset (13.95, -5.25)
            const c17 = clip.attach(this.sprite3Sym, "s3_d17", 17, ctx, {
              x: 13.95,
              y: -5.25,
            });
            c17.scaleX = 0.2929;
            c17.scaleY = 0.2929;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite10 — circular sparkle (sin-wave xscale oscillator)
    // Canonical:
    //   DefineSprite_10/frame_1/DoAction.as — seeds rotation/alpha/i
    //   DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The DoAction runs on the sprite10 clip itself (frameScripts[0]),
    // seeding rotation/alpha/i as dynamic vars. Then its inner child
    // (PlaceObject2_9_1 — which we model as the clip's own onLoad/
    // onEnterFrame since the child IS the visual content of sprite10)
    // reads those vars via _parent (= sprite10 clip).
    //
    // In the canonical SWF, sprite10 contains a single PlaceObject2
    // child at depth 1. That child owns the onClipEvent handlers. We
    // flatten this: sprite10's frameScripts[0] seeds the vars, and
    // sprite10's own onLoad/onEnterFrame PORT the PlaceObject2_9_1
    // handlers (they read _parent.rotation etc., which means they read
    // from sprite10's parent — i.e., sprite13 for the rotation/alpha/i
    // values that sprite10's DoAction seeds onto sprite10 itself).
    //
    // More precisely: sprite10.DoAction seeds sprite10.vars.rotation etc.
    // Then PlaceObject2_9_1 onLoad reads _parent.rotation (= sprite10).
    // We implement PlaceObject2_9_1 AS the onLoad/onEnterFrame of
    // sprite10 itself, reading from clip.vars (which were set in
    // frameScripts[0]).
    // ----------------------------------------------------------------
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,

      // AS DefineSprite_10/frame_1/DoAction.as — seeds vars on sprite10
      // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
      // Combined: frameScripts[0] seeds, onLoad reads from self (since
      // the PlaceObject2 child reads _parent which is sprite10).
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_1/DoAction.as
        clip.vars.rotation = Math.floor(Math.random() * 360) - 90;
        clip.vars.alpha = Math.floor(Math.random() * 50) + 40;
        clip.vars.i = Math.random() * 6;

        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent.rotation  (_parent is sprite10 itself here)
        clip.rotation = (clip.vars.rotation as number * Math.PI) / 180;
        clip.alpha = (clip.vars.alpha as number) / 100;
        // i is already set above on vars; re-alias for the enterFrame
        clip.vars.i_phase = clip.vars.i as number;
      },

      // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _xscale = 100 * Math.sin(i += 0.067)
      onEnterFrame: (clip) => {
        let i = clip.vars.i_phase as number;
        i += 0.067;
        clip.scaleX = Math.sin(i);
        // scaleY unchanged — only xscale oscillates
        clip.vars.i_phase = i;
      },
    };

    // ----------------------------------------------------------------
    // sprite13 — container for the two oscillating children
    // Canonical:
    //   DefineSprite_13/frame_1/PlaceObject2_6_1/  — sin child  (depth 1)
    //   DefineSprite_13/frame_1/PlaceObject2_12_5/ — cos child  (depth 5)
    //   sprite10 placed at depth 3 inside sprite13 (parentSpriteId=13)
    //
    // Both PlaceObject2_6_1 and PlaceObject2_12_5 read _parent.rotation/
    // alpha/i, where _parent is sprite13. sprite13 itself does NOT have
    // a DoAction seeding those — those vars are seeded by the parent
    // (sprite10's DoAction, which runs on the sprite10 clip). But
    // sprite13's children read _parent.rotation where _parent IS
    // sprite13 — so sprite13 must expose rotation/alpha/i vars.
    //
    // Looking at the hierarchy:
    //   sprite15 → attachMovie("sprite10", ...) at some depth
    //     sprite10.DoAction seeds rotation/alpha/i on sprite10
    //   sprite15 → attachMovie("sprite13", ...) at some depth
    //     sprite13/PlaceObject2_6_1 onLoad: _rotation = _parent.rotation
    //     → _parent of PlaceObject2_6_1 is sprite13
    //
    // So sprite13 itself needs rotation/alpha/i. These are seeded by
    // sprite13's own frameScripts[0] (mirroring DefineSprite_10/frame_1/
    // DoAction.as which runs identically for each attached instance).
    //
    // We implement sprite13 as a container whose frameScripts[0] seeds
    // its own vars (same DoAction formula), and whose onLoad/onEnterFrame
    // port the TWO PlaceObject2 clip-event children as separate
    // behaviours on the clip (since there are two children with
    // independent i-phases and sin/cos respectively).
    // ----------------------------------------------------------------
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,

      onLoad: (clip, ctx) => {
        // AS DefineSprite_10/frame_1/DoAction.as (same code runs for sprite13
        // when it is the target of a parallel attachMovie)
        clip.vars.rotation = Math.floor(Math.random() * 360) - 90;
        clip.vars.alpha = Math.floor(Math.random() * 50) + 40;
        clip.vars.i = Math.random() * 6;

        // AS DefineSprite_13/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // Seed independent i-phases for the two children
        clip.vars.i_sin = clip.vars.i as number;
        clip.vars.i_cos = clip.vars.i as number;

        // AS DefineSprite_13/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // Apply rotation and alpha to self (the child reads _parent.rotation
        // but we model it ON the clip itself)
        clip.rotation = ((clip.vars.rotation as number) * Math.PI) / 180;
        clip.alpha = (clip.vars.alpha as number) / 100;

        // Attach sprite10 child at depth 3 (canonical placement inside sprite13)
        const s10 = clip.attach(this.sprite10Sym, "sprite10_child", 3, ctx);
        // The sprite10 child's onLoad already runs; nothing more needed.
        void s10;
      },

      // AS DefineSprite_13/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _xscale = 100 * Math.sin(i += 0.067)   (child at depth 1 / PlaceObject2_6_1)
      // AS DefineSprite_13/frame_1/PlaceObject2_12_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
      // _xscale = 100 * Math.cos(i += 0.067)   (child at depth 5 / PlaceObject2_12_5)
      //
      // We model both behaviours on the sprite13 clip itself: sin drives
      // scaleX (depth-1 child effect) and cos drives scaleY as a proxy
      // for the depth-5 child (the visual will read as the oscillating
      // scale pair).
      onEnterFrame: (clip) => {
        let i_sin = clip.vars.i_sin as number;
        let i_cos = clip.vars.i_cos as number;
        i_sin += 0.067;
        i_cos += 0.067;
        // PlaceObject2_6_1: _xscale = 100 * sin(i)
        clip.scaleX = Math.sin(i_sin);
        // PlaceObject2_12_5: _xscale = 100 * cos(i) — applied as scaleY
        // here since both children share the parent container
        clip.scaleY = Math.cos(i_cos);
        clip.vars.i_sin = i_sin;
        clip.vars.i_cos = i_cos;
      },
    };

    // ----------------------------------------------------------------
    // sprite14 — orbiting mote / floating orb
    // Canonical:
    //   DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // sprite14 contains sprite13 (PlaceObject2 at depth 1, scale 0.625).
    // The clip-event child (PlaceObject2_13_1) orbits and fades sprite14
    // itself via _parent._alpha. We model the orbiting physics ON sprite14
    // itself (the clip that sprite15 attaches), treating the PlaceObject2
    // child's _parent as the sprite14 clip.
    // ----------------------------------------------------------------
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,

      // AS DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip, ctx) => {
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        // _rotation = random(360)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // _alpha = 130 (on the child — but we model on self)
        clip.alpha = 130 / 100;
        // _parent._alpha = 10 → sprite14's alpha starts at 10/100
        clip.alpha = 10 / 100;
        clip.vars.v = 0.3 + 0.66 * Math.random();
        // Store the internal child alpha separately
        clip.vars.child_alpha = 130;

        // Attach sprite13 child at depth 1 (scale 0.625, offset 0,0)
        // Canonical: sprite14 contains sprite13 at depth 1 scale 0.625
        const s13 = clip.attach(this.sprite13Sym, "sprite13_child", 1, ctx);
        s13.scaleX = 0.625;
        s13.scaleY = 0.625;
      },

      // AS DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v2 = clip.vars.v2 as number;
        const v = clip.vars.v as number;

        // _Y < -100 / _Y > -100 threshold logic on the inner child's _Y.
        // We track the orbiting Y on the clip itself.
        const orbitY = 5 * Math.cos(i) + (p - v);

        // if(_Y > -100 & _parent._alpha < 100)  → fade in
        if (orbitY > -100 && clip.alpha < 1.0) {
          clip.alpha = Math.min(1.0, clip.alpha + 15 / 100);
        }
        // if(_Y < -100) → fade out
        if (orbitY < -100) {
          clip.alpha = clip.alpha - 15 / 100;
          if (clip.alpha < 0) {
            clip.visible = false;
            clip.remove();
            return;
          }
        }

        // _rotation = _rotation + 1.3  (degrees per frame on the inner child)
        clip.rotation += (1.3 * Math.PI) / 180;

        // _Y = 5 * Math.cos(i) + (p -= v)
        p -= v;
        clip.y = 5 * Math.cos(i) + p;
        // _X = 25 * Math.sin(i += v2)
        i += v2;
        clip.x = 25 * Math.sin(i);

        // if(Math.cos(i) < 0) { _alpha = 80 * cos(i) + 100 }  (child alpha)
        if (Math.cos(i) < 0) {
          const newChildAlpha = 80 * Math.cos(i) + 100;
          clip.vars.child_alpha = newChildAlpha;
          // Apply to self as proxy for inner child alpha
          clip.alpha = Math.max(0, Math.min(1, newChildAlpha / 100));
        }

        clip.vars.p = p;
        clip.vars.i = i;
      },
    };

    // ----------------------------------------------------------------
    // sprite15 — outer animated container (246 frames, isComposite)
    // Canonical: DefineSprite_15/frame_244/DoAction.as
    //   _parent.removeMovieClip(); stop();
    //
    // This is the top-level clip we attach from onSpellStart.
    // It contains sprite4 (placed at frame 3 with alpha ramp),
    // and sprite14 placed at frames 3, 24, and 48.
    //
    // We drive the alpha tween for sprite4 ourselves via frameScripts
    // reading the manifest colorTransform schedule.
    // The anim1 frames provide the background composite visual.
    //
    // signalHit is fired at frame 3 (first visible content frame).
    // ----------------------------------------------------------------
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 246,
      frames: textures.getFrames("anim1"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,

      frameScripts: new Map([
        [
          // frame_1 (index 0) — nothing in canonical AS
          // (placements start at frame 3 = index 3 in 0-based)
          3,
          (clip, ctx) => {
            // AS: PlaceObject2 places sprite4 at depth 1, frame 3
            // matrix: (-0.6, -1.4), scale 1. alphaMult=13/256
            const s4 = clip.attach(this.sprite4Sym, "sprite4_inst", 1, ctx, {
              x: -0.6,
              y: -1.4,
            });
            s4.alpha = 13 / 256;

            // AS: PlaceObject2 places sprite14 at depth 19, frame 3
            // matrix: (-0.05, -0.1). ratio=3
            clip.attach(this.sprite14Sym, "sprite14_d19", 19, ctx, {
              x: -0.05,
              y: -0.1,
            });

            // Signal hit at first content frame
            this.runtime.signalHit();
          },
        ],
        [
          // frame_4 (index 3) — sprite4 alpha ramp continues (alphaMult=20)
          // We use a single onEnterFrame approach on sprite15 to handle
          // the full alpha tween schedule rather than 50+ frame scripts.
          // Instead, register the tween keyframes and interpolate.
          // For correctness we set the key frames explicitly.
          4,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 20 / 256; }
          },
        ],
        [
          5,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 27 / 256; }
          },
        ],
        [
          6,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 33 / 256; }
          },
        ],
        [
          7,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 40 / 256; }
          },
        ],
        [
          8,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 47 / 256; }
          },
        ],
        [
          9,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 54 / 256; }
          },
        ],
        [
          10,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 60 / 256; }
          },
        ],
        [
          11,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 67 / 256; }
          },
        ],
        [
          12,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 74 / 256; }
          },
        ],
        [
          13,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 80 / 256; }
          },
        ],
        [
          14,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 87 / 256; }
          },
        ],
        [
          15,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 94 / 256; }
          },
        ],
        [
          16,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 101 / 256; }
          },
        ],
        [
          17,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 107 / 256; }
          },
        ],
        [
          18,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 114 / 256; }
          },
        ],
        [
          19,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 121 / 256; }
          },
        ],
        [
          20,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 128 / 256; }
          },
        ],
        [
          21,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 135 / 256; }
          },
        ],
        [
          22,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 141 / 256; }
          },
        ],
        [
          23,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 148 / 256; }
          },
        ],
        [
          24,
          (clip, ctx) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 155 / 256; }
            // AS: Place sprite14 at depth 21, frame 24. ratio=24
            clip.attach(this.sprite14Sym, "sprite14_d21", 21, ctx, {
              x: -0.05,
              y: -0.1,
            });
          },
        ],
        [
          25,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 162 / 256; }
          },
        ],
        [
          26,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 168 / 256; }
          },
        ],
        [
          27,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 175 / 256; }
          },
        ],
        [
          28,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 182 / 256; }
          },
        ],
        [
          29,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 189 / 256; }
          },
        ],
        [
          30,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 195 / 256; }
          },
        ],
        [
          31,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 202 / 256; }
          },
        ],
        [
          32,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 209 / 256; }
          },
        ],
        [
          33,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 215 / 256; }
          },
        ],
        [
          34,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 222 / 256; }
          },
        ],
        [
          35,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 229 / 256; }
          },
        ],
        [
          36,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 236 / 256; }
          },
        ],
        [
          37,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 242 / 256; }
          },
        ],
        [
          38,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 249 / 256; }
          },
        ],
        [
          39,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 256 / 256; }
          },
        ],
        [
          48,
          (clip, ctx) => {
            // AS: Place sprite14 at depth 23, frame 48. ratio=48
            clip.attach(this.sprite14Sym, "sprite14_d23", 23, ctx, {
              x: -0.05,
              y: -0.1,
            });
          },
        ],
        [
          // Fade-out schedule for sprite4: frames 130–171
          130,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 250 / 256; }
          },
        ],
        [
          131,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 244 / 256; }
          },
        ],
        [
          132,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 239 / 256; }
          },
        ],
        [
          133,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 233 / 256; }
          },
        ],
        [
          134,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 227 / 256; }
          },
        ],
        [
          135,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 221 / 256; }
          },
        ],
        [
          136,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 215 / 256; }
          },
        ],
        [
          137,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 210 / 256; }
          },
        ],
        [
          138,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 204 / 256; }
          },
        ],
        [
          139,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 198 / 256; }
          },
        ],
        [
          140,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 192 / 256; }
          },
        ],
        [
          141,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 187 / 256; }
          },
        ],
        [
          142,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 181 / 256; }
          },
        ],
        [
          143,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 175 / 256; }
          },
        ],
        [
          144,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 169 / 256; }
          },
        ],
        [
          145,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 163 / 256; }
          },
        ],
        [
          146,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 158 / 256; }
          },
        ],
        [
          147,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 152 / 256; }
          },
        ],
        [
          148,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 146 / 256; }
          },
        ],
        [
          149,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 140 / 256; }
          },
        ],
        [
          150,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 135 / 256; }
          },
        ],
        [
          151,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 129 / 256; }
          },
        ],
        [
          152,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 123 / 256; }
          },
        ],
        [
          153,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 117 / 256; }
          },
        ],
        [
          154,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 111 / 256; }
          },
        ],
        [
          155,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 106 / 256; }
          },
        ],
        [
          156,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 100 / 256; }
          },
        ],
        [
          157,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 94 / 256; }
          },
        ],
        [
          158,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 88 / 256; }
          },
        ],
        [
          159,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 82 / 256; }
          },
        ],
        [
          160,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 77 / 256; }
          },
        ],
        [
          161,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 71 / 256; }
          },
        ],
        [
          162,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 65 / 256; }
          },
        ],
        [
          163,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 59 / 256; }
          },
        ],
        [
          164,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 54 / 256; }
          },
        ],
        [
          165,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 48 / 256; }
          },
        ],
        [
          166,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 42 / 256; }
          },
        ],
        [
          167,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 36 / 256; }
          },
        ],
        [
          168,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 30 / 256; }
          },
        ],
        [
          169,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 25 / 256; }
          },
        ],
        [
          170,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 19 / 256; }
          },
        ],
        [
          171,
          (clip) => {
            const s4 = clip.children.get("sprite4_inst");
            if (s4) { s4.alpha = 13 / 256; }
          },
        ],
        [
          // AS DefineSprite_15/frame_244/DoAction.as
          // _parent.removeMovieClip(); stop();
          // frame_244 = index 243
          243,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("many_504");
    callbacks.playSound("many_504");

    // Attach the outer animated container (sprite15) at root.
    // displayType=11 (TargetCell): container is already at target cell.
    this.root.attach(this.sprite15Sym, "sprite15", 1, context);
  }
}
