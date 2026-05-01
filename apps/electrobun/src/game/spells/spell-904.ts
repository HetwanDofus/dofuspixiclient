/**
 * Spell 904 — Flèche de Glace / Ice Arrow (Cra).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/904/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`/`shoot`/`duplicate`
 * projectile symbols and no caster-relative anchoring — it renders entirely
 * at the target cell. The main animation (anim1, 318 frames) plays at target.
 * Several library symbols are attached onto it as dynamic clip-event particles:
 *
 *   - lib_sprite3  — small glint/spark particle (directlyDynamic:true).
 *                    onLoad: seeds `v=0` and (via parent sprite4 placement) a
 *                    per-instance vx; onEnterFrame: gravity bounce physics.
 *                    Multiple instances attached at different offsets/scales by
 *                    sprite4's frame_0 script.
 *   - lib_sprite4  — wrapper container for sprite3 particles (directlyDynamic:false).
 *                    Has 9 placements of sprite3 at frame 0. Placed four times on
 *                    sprite14 (the main animation) at frames 0, 21, 45, 69 via
 *                    sprite13 being attached, which itself contains sprite12 which
 *                    contains sprite10 which contains sprite9. Actually, sprite4 is
 *                    placed directly on DefineSprite_14 (the top-level anim) at frame 0.
 *   - lib_sprite9  — pulsing crystal shard (directlyDynamic:true).
 *                    onLoad: random rotation, alpha 40-90%, random phase i.
 *                    onEnterFrame: xscale oscillates via sin(i+=0.1).
 *   - lib_sprite10 — wrapper for sprite9 (directlyDynamic:true with own enterFrame).
 *                    onLoad: random rotation, alpha 40-90%, random phase i.
 *                    onEnterFrame: _xscale = 100*sin(i+=0.1). Has 4 placements of
 *                    sprite10 on sprite12 at frame 0.
 *   - lib_sprite12 — wrapper that contains sprite10 instances (directlyDynamic:true).
 *                    onEnterFrame: _alpha = random(170). Placed once in sprite13.
 *   - lib_sprite13 — rotating ice cloud particle (directlyDynamic:true).
 *                    onLoad: seeds spiral physics vars.
 *                    onEnterFrame: spiral upward, fade in/out, remove when done.
 *                    Placed 4 times on DefineSprite_14 (the top-level anim) at
 *                    frames 0, 21, 45, 69.
 *
 * DefineSprite_14 is the top-level composite (= anim1). Its frame_316 script
 * calls `_parent.removeMovieClip(); stop();` — this is the completion signal.
 *
 * Main timeline frame_1: SOMA.playSound("jet_904").
 *
 * Library symbols (placements on top-level sprite14 / anim1):
 *   - sprite4  placed at depth 1,  frame 0 (the spark burst wrapper)
 *   - sprite13 placed at depths 19,21,23,25 at frames 0,21,45,69 respectively
 *
 * Since librarySymbols is non-empty and all symbols use the `lib_` prefix,
 * textures.getFrames("lib_<name>") is used throughout.
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

const SPRITE9_BOUNDS = {
  width: 75.85,
  height: 67.45,
  offsetX: -26.1,
  offsetY: -33.8,
};

const SPRITE10_BOUNDS = {
  width: 75.85,
  height: 67.45,
  offsetX: -26,
  offsetY: -33.8,
};

const SPRITE12_BOUNDS = {
  width: 75.85,
  height: 67.45,
  offsetX: -25.45,
  offsetY: -33.75,
};

const SPRITE13_BOUNDS = {
  width: 47.4,
  height: 42.15,
  offsetX: -15.95,
  offsetY: -21.2,
};

const ANIM1_BOUNDS = {
  width: 54,
  height: 42.15,
  offsetX: -22.6,
  offsetY: -21.3,
};

export class Spell904 extends RuntimeSpell {
  readonly spellId = 904;
  // No projectile motion, no caster anchoring — pure impact at target cell.
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold sym refs for use in parent frameScripts
  private sprite3Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const sprite13Anchor = calculateAnchor(SPRITE13_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_sprite3 — gravity-bounce spark particle --------
    // directlyDynamic:true — has its own CLIPACTIONRECORD handlers.
    //
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   v = 0;
    //
    // AS: scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _Y = _Y + v;
    //   _X = _X + vx;
    //   v += 0.6;
    //   if(_Y > 0) { _Y = 0; v = -5*Math.random(); vx = -2.5*Math.random()+1.25; }
    //
    // Note: `vx` is not seeded in onLoad — it is set by the parent sprite4's
    // PlaceObject2 matrix translateX, i.e. each instance starts at the authored
    // x offset from the parent. The onEnterFrame re-randomises vx on first bounce
    // (_Y > 0). Until then vx drifts per the initial position delta.
    // We seed vx=0 in onLoad and rely on the parent's attach transform for x offset.
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 0;
        // vx not explicitly seeded in AS onLoad; initialise to 0.
        // The enterFrame will randomise it on first ground bounce.
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        let vx = clip.vars.vx as number;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        if (clip.y > 0) {
          clip.y = 0;
          v = -5 * Math.random();
          vx = -2.5 * Math.random() + 1.25;
        }
        clip.vars.v = v;
        clip.vars.vx = vx;
      },
    };

    // ---- lib_sprite4 — wrapper container for 9 sprite3 instances ----
    // directlyDynamic:false — no handlers of its own. Its frameScripts
    // attach 9 sprite3 instances at their authored offsets/scales from
    // the placements[] array (all at frame 0 of sprite4, parentSpriteId=4).
    //
    // Placements (from manifest librarySymbols[0].placements):
    //   depth 1:  scale 0.619, x=-11,    y=2.6
    //   depth 3:  scale 0.395, x=10.75,  y=4.2
    //   depth 5:  scale 0.395, x=-15.7,  y=-1.8
    //   depth 7:  scale 0.619, x=7.35,   y=1.8
    //   depth 9:  scale 0.395, x=16.4,   y=1.9
    //   depth 11: scale 0.293, x=-21.15, y=1.9
    //   depth 13: scale 0.293, x=19.55,  y=0.25
    //   depth 15: scale 0.207, x=-11.25, y=-5.2
    //   depth 17: scale 0.293, x=13.95,  y=-5.25
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 placements at frame 0 of DefineSprite_4.
            // Attach 9 sprite3 instances at their authored offsets.
            const placements: Array<{
              depth: number;
              scale: number;
              x: number;
              y: number;
            }> = [
              { depth: 1,  scale: 0.6192626953125, x: -11,    y: 2.6   },
              { depth: 3,  scale: 0.395050048828125, x: 10.75, y: 4.2   },
              { depth: 5,  scale: 0.395050048828125, x: -15.7, y: -1.8  },
              { depth: 7,  scale: 0.6192626953125, x: 7.35,   y: 1.8   },
              { depth: 9,  scale: 0.395050048828125, x: 16.4,  y: 1.9   },
              { depth: 11, scale: 0.292877197265625, x: -21.15,y: 1.9   },
              { depth: 13, scale: 0.292877197265625, x: 19.55, y: 0.25  },
              { depth: 15, scale: 0.20703125,        x: -11.25,y: -5.2  },
              { depth: 17, scale: 0.292877197265625, x: 13.95, y: -5.25 },
            ];
            for (const p of placements) {
              const child = clip.attach(
                this.sprite3Sym,
                `sprite3_d${p.depth}`,
                p.depth,
                ctx,
                { x: p.x, y: p.y }
              );
              child.scaleX = p.scale;
              child.scaleY = p.scale;
            }
          },
        ],
      ]),
    };

    // ---- lib_sprite9 — pulsing crystal shard (directlyDynamic:true) ----
    //
    // AS: scripts/DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 80 + random(50);
    //   _xscale = t;
    //   _yscale = t;
    //
    // (No enterFrame for sprite9 itself — the enterFrame lives on sprite10
    //  which wraps sprite9. sprite9's onLoad just sets uniform scale.)
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ---- lib_sprite10 — wrapper for sprite9, owns enterFrame --------
    // directlyDynamic:true — has its own CLIPACTIONRECORD handlers.
    //
    // AS: scripts/DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360) - 90;
    //   _alpha = random(50) + 40;
    //   i = Math.random() * 6;
    //
    // AS: scripts/DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _xscale = 100 * Math.sin(i += 0.1);
    //
    // sprite10 has one placement of sprite9 at depth 1, offset (0.1, 0).
    // We attach sprite9 from sprite10's frameScripts frame_0.
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.1;
        clip.scaleX = (100 * Math.sin(i)) / 100;
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 depth 1 at frame 0 of DefineSprite_10 — place sprite9.
            // matrix: translateX=0.1, translateY=0, scale=1
            const child = clip.attach(
              this.sprite9Sym,
              "sprite9_inner",
              1,
              ctx,
              { x: 0.1, y: 0 }
            );
            child.scaleX = 1;
            child.scaleY = 1;
          },
        ],
      ]),
    };

    // ---- lib_sprite12 — wrapper that contains 4 sprite10 instances -----
    // directlyDynamic:true (owns enterFrame).
    //
    // AS: scripts/DefineSprite_12/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(170);
    //
    // (No separate onLoad for sprite12 — alpha randomised each frame.)
    //
    // sprite12 has 4 placements of sprite10 (depths 3,5,7,10) at frame 0
    // of DefineSprite_12, all at offset (0.55, 0.05), scale 1.
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: 4 PlaceObject2 placements of sprite10 on DefineSprite_12 at frame 0.
            // depths 3, 5, 7, 10; all at offset (0.55, 0.05), scale 1.
            const depths = [3, 5, 7, 10];
            for (const depth of depths) {
              const child = clip.attach(
                this.sprite10Sym,
                `sprite10_d${depth}`,
                depth,
                ctx,
                { x: 0.55, y: 0.05 }
              );
              child.scaleX = 1;
              child.scaleY = 1;
            }
          },
        ],
      ]),
    };

    // ---- lib_sprite13 — rotating/spiralling ice cloud (directlyDynamic:true) ----
    //
    // AS: scripts/DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //   p = 0;
    //   i = 0;
    //   v2 = 0.03 + 0.06 * Math.random();
    //   _rotation = random(360);
    //   _alpha = 130;
    //   _parent._alpha = 10;
    //   v = 0.3 + 0.66 * Math.random();
    //
    // AS: scripts/DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if(_Y > -100 & _parent._alpha < 100) { _parent._alpha += 15; }
    //   if(_Y < -100) {
    //     _parent._alpha -= 15;
    //     if(_parent._alpha < 0) { _parent._visible = 0; this.stop = 1; _parent.removeMovieClip(); }
    //   }
    //   _rotation = _rotation + 1.3;
    //   _Y = 5 * Math.cos(i) + (p -= v);
    //   _X = 25 * Math.sin(i += v2);
    //   if(Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
    //
    // sprite13 has one placement of sprite12 at depth 1, offset (-0.05, -0.1),
    // scale 0.625. We attach sprite12 from sprite13's frameScripts frame_0.
    //
    // Note: `_parent._alpha` refers to sprite13's PARENT (the anim1 container or
    // the outer clip that sprite13 is attached to). In this runtime, sprite13's
    // parent will be the anim1Sym clip (or root). We set the parent's alpha via
    // clip.parent?.alpha.
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 130 / 100;
        // _parent._alpha = 10 — set the sprite13 parent's alpha
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.66 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v2 = clip.vars.v2 as number;
        const v = clip.vars.v as number;
        const parent = clip.parent;

        // Fade-in while ascending (Y > -100 in AS coords = y > -100 here)
        if (clip.y > -100 && parent && parent.alpha < 100 / 100) {
          parent.alpha = Math.min(1, parent.alpha + 15 / 100);
        }
        // Fade-out and remove when high enough
        if (clip.y < -100) {
          if (parent) {
            parent.alpha = Math.max(0, parent.alpha - 15 / 100);
            if (parent.alpha <= 0) {
              parent.visible = false;
              parent.remove();
              return;
            }
          }
        }

        // Rotation advance: _rotation + 1.3 degrees
        clip.rotation += (1.3 * Math.PI) / 180;

        // Spiral position
        p -= v;
        clip.y = 5 * Math.cos(i) + p;
        clip.x = 25 * Math.sin(i + v2);
        i += v2;

        // Depth modulation alpha
        if (Math.cos(i) < 0) {
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }

        clip.vars.p = p;
        clip.vars.i = i;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 depth 1 at frame 0 of DefineSprite_13 — place sprite12.
            // matrix: scale=0.625, offset=(-0.05, -0.1)
            const child = clip.attach(
              this.sprite12Sym,
              "sprite12_inner",
              1,
              ctx,
              { x: -0.05, y: -0.1 }
            );
            child.scaleX = 0.625;
            child.scaleY = 0.625;
          },
        ],
      ]),
    };

    // ---- anim1 — top-level composite, 318 frames -------------------
    // DefineSprite_14 in the SWF. frame_316 (0-indexed: 315) fires:
    //   _parent.removeMovieClip(); stop();
    // which is the spell completion.
    //
    // The anim1 timeline also places:
    //   - sprite4  at depth 1,  frame 0  (the spark burst wrapper)
    //   - sprite13 at depth 19, frame 0
    //   - sprite13 at depth 21, frame 21  (ratio=21)
    //   - sprite13 at depth 23, frame 45  (ratio=45)
    //   - sprite13 at depth 25, frame 69  (ratio=69)
    //
    // We also need to call signalHit at an appropriate frame. The spell
    // hits at the target cell; given it's a non-projectile impact spell,
    // the hit should fire at the first impact frame (~frame 1 in AS,
    // i.e. index 0 here when the animation begins). The canonical AS
    // doesn't have an explicit `this.end()` call, so we fire signalHit
    // at the first anim frame (frame 0, index 0 in our 0-based system).
    //
    // DefineSprite_14/frame_316/DoAction.as: _parent.removeMovieClip(); stop();
    // 0-based: frame 315 → runtime complete.
    //
    // The alphaMult fade-in/fade-out on sprite4 (depth 1) is driven by
    // the authored PlaceObject2 `kind: "move"` tween in the manifest.
    // These are baked into the pre-rendered SVG for anim1. We handle
    // the alpha tween for sprite4 via the anim1 frameScripts (smooth
    // interpolation between keyframes 0→36 and 154→195).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 318,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 depth 1 frame 0 on DefineSprite_14 — attach sprite4.
            // matrix: offset(-0.6, -1.4), scale=1
            // colorTransform: alphaMult=13/256 initially.
            const sp4 = clip.attach(
              this.sprite4Sym,
              "sprite4_d1",
              1,
              ctx,
              { x: -0.6, y: -1.4 }
            );
            sp4.scaleX = 1;
            sp4.scaleY = 1;
            sp4.alpha = 13 / 256;

            // AS: PlaceObject2 depth 19 frame 0 on DefineSprite_14 — attach sprite13.
            // matrix: offset(-0.05, -0.1), scale=1
            const sp13_0 = clip.attach(
              this.sprite13Sym,
              "sprite13_d19",
              19,
              ctx,
              { x: -0.05, y: -0.1 }
            );
            sp13_0.scaleX = 1;
            sp13_0.scaleY = 1;

            // Signal hit at the first frame — impact at target cell.
            this.runtime.signalHit();
          },
        ],
        [
          // frame 21 (0-based): attach another sprite13 at depth 21 (ratio=21)
          21,
          (clip, ctx) => {
            const sp13_21 = clip.attach(
              this.sprite13Sym,
              "sprite13_d21",
              21,
              ctx,
              { x: -0.05, y: -0.1 }
            );
            sp13_21.scaleX = 1;
            sp13_21.scaleY = 1;
          },
        ],
        [
          // frame 45 (0-based): attach another sprite13 at depth 23 (ratio=45)
          45,
          (clip, ctx) => {
            const sp13_45 = clip.attach(
              this.sprite13Sym,
              "sprite13_d23",
              23,
              ctx,
              { x: -0.05, y: -0.1 }
            );
            sp13_45.scaleX = 1;
            sp13_45.scaleY = 1;
          },
        ],
        [
          // frame 69 (0-based): attach another sprite13 at depth 25 (ratio=69)
          69,
          (clip, ctx) => {
            const sp13_69 = clip.attach(
              this.sprite13Sym,
              "sprite13_d25",
              25,
              ctx,
              { x: -0.05, y: -0.1 }
            );
            sp13_69.scaleX = 1;
            sp13_69.scaleY = 1;
          },
        ],
        [
          // DefineSprite_14/frame_316/DoAction.as (0-based: 315):
          //   _parent.removeMovieClip(); stop();
          315,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      // Per-frame alpha tween for sprite4 (depth 1):
      // The manifest shows alphaMult ramping 13→256 over frames 0-36,
      // then holding full until frame 154, then fading 250→13 over
      // frames 154-195. We drive this in onEnterFrame for anim1.
      onEnterFrame: (clip) => {
        const sprite4Clip = clip.children.get("sprite4_d1");
        if (!sprite4Clip) {
          return;
        }
        const f = clip.currentFrame;
        if (f <= 36) {
          // Ramp from alphaMult 13 to 256 over frames 0-36 (AS frames 1-37).
          // Canonical keyframes: frame 0→alphaMult 13, frame 36→alphaMult 256
          const t = f / 36;
          sprite4Clip.alpha = (13 + (256 - 13) * t) / 256;
        } else if (f < 154) {
          // Hold at full
          sprite4Clip.alpha = 256 / 256;
        } else if (f <= 195) {
          // Ramp from alphaMult 250 to 13 over frames 154-195
          const t = (f - 154) / (195 - 154);
          sprite4Clip.alpha = (250 - (250 - 13) * t) / 256;
        } else {
          // After 195: fully faded (alphaMult 13 = nearly invisible)
          sprite4Clip.alpha = 13 / 256;
        }
      },
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("jet_904");
    callbacks.playSound("jet_904");

    // The top-level composite (anim1 / DefineSprite_14) is the main
    // timeline content. Attach it to root so it starts ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
