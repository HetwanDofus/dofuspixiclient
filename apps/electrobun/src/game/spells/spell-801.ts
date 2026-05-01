/**
 * Spell 801 — Vlad (Sacrieur / Sadida area buff).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/801/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile logic, no caster reference.
 * The animation plays entirely at the target cell. A single composite
 * main timeline (anim1, 306 frames) drives the outer sprite (DefineSprite_14).
 * Inside that, several library symbols are placed and driven by clip events.
 *
 * Library symbols (all in manifest.librarySymbols):
 *
 *   - sprite3  (characterId 3, directlyDynamic: true)
 *     Tiny spark/dust particle. onLoad seeds vx/vy via `v` and gravity.
 *     onEnterFrame: gravity drift, bounce when Y > 0. Placed at depth 1,3,5,7,9,11,13,15,17
 *     inside sprite4 (9 instances) at frame 0 with different transforms.
 *
 *   - sprite4  (characterId 4, directlyDynamic: false)
 *     Wrapper around the sprite3 particle cluster. No clip events of its own.
 *     Placed at depth 1 inside DefineSprite_14 starting at frame 3, with a long
 *     alpha tween from ~5% to 100% (frames 3-39) then back to ~5% (frames 157-198).
 *     frameScripts at the place/move frames mutate alpha accordingly.
 *
 *   - sprite9  (characterId 9, directlyDynamic: true)
 *     A single-frame horizontal slash/glyph element. onLoad randomises
 *     scale (xscale/yscale) 80-130%. No onEnterFrame. Placed at depth 1
 *     inside sprite10 at frame 0.
 *
 *   - sprite10 (characterId 10, directlyDynamic: true)
 *     Rotating/pulsing container that holds sprite9. onLoad seeds _rotation
 *     (random 0-359 degrees, shifted by -90), _alpha (40-89), and phase i.
 *     onEnterFrame: _xscale = 100 * sin(i += 0.1) — oscillates horizontal scale.
 *     Placed 5× inside sprite12 (depths 3,5,7,9,12) at frame 0.
 *
 *   - sprite12 (characterId 12, directlyDynamic: true)
 *     Container for sprite10 instances. onEnterFrame: _alpha = random(170)
 *     — random alpha flicker every frame. Placed at depth 1 inside sprite13
 *     at frame 0.
 *
 *   - sprite13 (characterId 13, directlyDynamic: true)
 *     Outer spiralling halo. onLoad: seeds st, i, p, v2, rotation, alpha;
 *     sets _parent._alpha = 10. onEnterFrame: spiral via cos/sin with rising
 *     Y until -80 then fade out and remove parent. Placed at depths 19,21,23,25
 *     inside DefineSprite_14 at frames 3, 24, 48, 72 (staggered instances).
 *
 * DefineSprite_14 (the outer animation, mapped to anim1 with 306 frames):
 *   frame_304/DoAction.as: _parent.removeMovieClip() → spell complete.
 *   signalHit at impact (anim1 start — frame 0, i.e. immediately on attach).
 *
 * Main timeline frame_1: SOMA.playSound("vlad_801").
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
  width: 37.35,
  height: 4.2,
  offsetX: 0.15,
  offsetY: -2.2,
};

const SPRITE10_BOUNDS = {
  width: 37.35,
  height: 4.2,
  offsetX: 0.25,
  offsetY: -2.2,
};

const SPRITE12_BOUNDS = {
  width: 61.7,
  height: 46.9,
  offsetX: -23.55,
  offsetY: -23.8,
};

const SPRITE13_BOUNDS = {
  width: 38.55,
  height: 29.35,
  offsetX: -14.75,
  offsetY: -16,
};

export class Spell801 extends RuntimeSpell {
  readonly spellId = 801;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep refs so onSpellStart can attach them and frameScripts can reference
  private sprite3Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const sprite13Anchor = calculateAnchor(SPRITE13_BOUNDS);

    // ---- sprite3 — spark/dust particle (directlyDynamic: true) --------
    // AS scripts/DefineSprite_3/frame_1/PlaceObject2_2_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS: v = 0;
        // (vx is set by the parent's placement transform, so init it 0 here)
        clip.vars.v = 0;
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame):
        //   _Y = _Y + v;
        //   _X = _X + vx;
        //   v += 0.6;
        //   if(_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
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

    // ---- sprite9 — horizontal slash glyph (directlyDynamic: true) ------
    // AS scripts/DefineSprite_9/frame_1/PlaceObject2_8_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    // No onEnterFrame script for sprite9 itself.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS: var t = 80 + random(50); _xscale = t; _yscale = t;
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ---- sprite10 — rotating pulsing container (directlyDynamic: true) --
    // Holds one sprite9 instance. Placed 5× inside sprite12.
    // AS scripts/DefineSprite_10/frame_1/PlaceObject2_9_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: _rotation = random(360) - 90; _alpha = random(50) + 40; i = Math.random() * 6;
        const rotDeg = Math.floor(Math.random() * 360) - 90;
        clip.rotation = (rotDeg * Math.PI) / 180;
        const alphaPct = Math.floor(Math.random() * 50) + 40;
        clip.alpha = alphaPct / 100;
        clip.vars.i = Math.random() * 6;

        // Attach the single sprite9 child per placement in sprite10:
        // parentSpriteId 10, frame 0, depth 1, translateX 0.1, translateY 0
        clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx, {
          x: 0.1,
          y: 0,
        });
      },
      onEnterFrame: (clip) => {
        // AS: _xscale = 100 * Math.sin(i += 0.1);
        let i = clip.vars.i as number;
        i += 0.1;
        clip.scaleX = Math.sin(i);
        clip.vars.i = i;
      },
    };

    // ---- sprite12 — random-alpha container (directlyDynamic: true) ------
    // Holds 5× sprite10 instances. Placed inside sprite13.
    // AS scripts/DefineSprite_12/frame_1/PlaceObject2_6_1/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    // No onLoad script for sprite12 itself.
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onLoad: (clip, ctx) => {
        // sprite12 placement inside sprite13: frame 0, depth 1
        // matrix: scaleX 0.625, scaleY 0.625, translateX -0.05, translateY -1.1
        // (The clip has already been placed by sprite13's frameScripts with the
        //  outer transform; we attach the 5 sprite10 children here on load.)
        //
        // placements of sprite10 inside sprite12 (parentSpriteId 12):
        //   depth 3:  tx 0.55, ty 0.05
        //   depth 5:  tx 0.55, ty 0.05
        //   depth 7:  tx 0.55, ty 0.05
        //   depth 9:  tx 0.55, ty 0.05
        //   depth 12: tx 0.55, ty 0.05
        const offsets = [3, 5, 7, 9, 12];
        for (let idx = 0; idx < offsets.length; idx++) {
          const depth = offsets[idx]!;
          clip.attach(this.sprite10Sym, `sprite10_${depth}`, depth, ctx, {
            x: 0.55,
            y: 0.05,
          });
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame):
        //   _alpha = random(170);
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ---- sprite13 — outer spiralling halo (directlyDynamic: true) -------
    // Holds one sprite12 instance. Placed 4× staggered inside the main anim.
    // AS scripts/DefineSprite_13/frame_1/PlaceObject2_12_1/
    //   CLIPACTIONRECORD onClipEvent(load).as
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: st=0; i=0; p=0; v2=0.05+0.05*Math.random(); _rotation=random(360);
        //     _alpha=120; _parent._alpha=10; v=0.5+0.5*Math.random();
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.05 + 0.05 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        // Set parent (the anim1 clip) alpha to 10%
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.5 + 0.5 * Math.random();

        // Attach the sprite12 child that lives inside sprite13:
        // parentSpriteId 13, frame 0, depth 1, matrix scaleX 0.625, scaleY 0.625,
        // translateX -0.05, translateY -1.1
        clip.attach(this.sprite12Sym, "sprite12_1", 1, ctx, {
          x: -0.05,
          y: -1.1,
        });
        // Apply scale to the newly-attached sprite12 child
        const sprite12child = clip.children.get("sprite12_1");
        if (sprite12child) {
          sprite12child.scaleX = 0.625;
          sprite12child.scaleY = 0.625;
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_13/frame_1/PlaceObject2_12_1/onClipEvent(enterFrame):
        //   if(_Y > -80 & _parent._alpha < 100) { _parent._alpha += 6; }
        //   if(_Y < -80) {
        //     _parent._alpha -= 6;
        //     if(_parent._alpha < 0) { _parent._visible=0; st=1; _parent.removeMovieClip(); }
        //   }
        //   _rotation = _rotation + 1.3;
        //   _Y = 5 * Math.cos(i) + (p -= v);
        //   _X = 25 * Math.sin(i += v2);
        //   if(Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;
        const parent = clip.parent;

        if (clip.y > -80 && parent && parent.alpha < 1.0) {
          parent.alpha = Math.min(1.0, parent.alpha + 6 / 100);
        }
        if (clip.y < -80) {
          if (parent) {
            parent.alpha = parent.alpha - 6 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              parent.remove();
            }
          }
        }

        // _rotation += 1.3 degrees per frame
        clip.rotation += (1.3 * Math.PI) / 180;

        p -= v;
        clip.y = 5 * Math.cos(i) + p;
        i += v2;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // _alpha = 80 * cos(i) + 100  (in AS 0-100 range)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }

        clip.vars.i = i;
        clip.vars.p = p;
      },
    };

    // ---- sprite4 — spark cluster wrapper (directlyDynamic: false) --------
    // Holds 9 sprite3 instances at fixed transforms. No dynamic handlers of
    // its own. Placed at depth 1 inside the main anim (DefineSprite_14) with
    // a long alpha tween: frames 3-39 ramp up, frames 157-198 ramp down.
    // The alpha tween is encoded in the placements[].colorTransform.alphaMult.
    // We model it by computing alpha per-frame inside an onEnterFrame that
    // reads the elapsed frame counter off the clip.
    //
    // For simplicity (and correctness), we drive the alpha changes via
    // frameScripts on the anim1 symbol at the exact keyframe indices listed
    // in the placements[] colorTransform entries, and let the runtime
    // interpolate visually between them via the live clip.alpha.
    // Because the runtime only fires frameScripts at specific frames we
    // instead apply a smooth linear interpolation in the parent's onEnterFrame
    // using the known keyframes:
    //   Ramp-in:  frames 3-39  (alphaMult 13→256)  → alpha 13/256 to 1.0
    //   Hold:     frames 39-157                     → alpha 1.0
    //   Ramp-out: frames 157-198 (alphaMult 250→13) → alpha ~0.98 to 0.05
    //
    // The sprite4 clip itself has no handlers; the tween is applied by the
    // anim1 (outer) frameScripts on the clip reference after attaching it.
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip, ctx) => {
        // Attach the 9 sprite3 instances with transforms from placements[]:
        // All at parentSpriteId 4, frame 0, various depths + transforms.
        //   depth 1:  scaleX 0.619, scaleY 0.619, tx -11,    ty 2.6
        //   depth 3:  scaleX 0.395, scaleY 0.395, tx 10.75,  ty 4.2
        //   depth 5:  scaleX 0.395, scaleY 0.395, tx -15.7,  ty -1.8
        //   depth 7:  scaleX 0.619, scaleY 0.619, tx 7.35,   ty 1.8
        //   depth 9:  scaleX 0.395, scaleY 0.395, tx 16.4,   ty 1.9
        //   depth 11: scaleX 0.293, scaleY 0.293, tx -21.15, ty 1.9
        //   depth 13: scaleX 0.293, scaleY 0.293, tx 19.55,  ty 0.25
        //   depth 15: scaleX 0.207, scaleY 0.207, tx -11.25, ty -5.2
        //   depth 17: scaleX 0.293, scaleY 0.293, tx 13.95,  ty -5.25
        const placements = [
          { depth: 1,  sx: 0.6192626953125,   tx: -11,    ty: 2.6   },
          { depth: 3,  sx: 0.395050048828125,  tx: 10.75,  ty: 4.2   },
          { depth: 5,  sx: 0.395050048828125,  tx: -15.7,  ty: -1.8  },
          { depth: 7,  sx: 0.6192626953125,    tx: 7.35,   ty: 1.8   },
          { depth: 9,  sx: 0.395050048828125,  tx: 16.4,   ty: 1.9   },
          { depth: 11, sx: 0.292877197265625,  tx: -21.15, ty: 1.9   },
          { depth: 13, sx: 0.292877197265625,  tx: 19.55,  ty: 0.25  },
          { depth: 15, sx: 0.20703125,         tx: -11.25, ty: -5.2  },
          { depth: 17, sx: 0.292877197265625,  tx: 13.95,  ty: -5.25 },
        ];
        for (const pl of placements) {
          const child = clip.attach(
            this.sprite3Sym,
            `sprite3_${pl.depth}`,
            pl.depth,
            ctx,
            { x: pl.tx, y: pl.ty },
          );
          child.scaleX = pl.sx;
          child.scaleY = pl.sx;
        }
      },
    };

    // ---- anim1 — main 306-frame outer sprite (DefineSprite_14) ----------
    // This is the top-level authored animation. It:
    //   • places sprite4 at frame 3 (depth 1) with alpha 13/256 (~5%)
    //   • ramps sprite4 alpha up to 256/256 by frame 39
    //   • places four staggered sprite13 instances at frames 3,24,48,72
    //     (depths 19,21,23,25)
    //   • holds from frame 39 to 157 (full alpha on sprite4)
    //   • ramps sprite4 alpha back down frames 157-198
    //   • frame 304: _parent.removeMovieClip() → complete
    //
    // We drive the sprite4 alpha tween and sprite13 staggered placements
    // from frameScripts. The anim1 texture frames show the composite SWF
    // background; the live clip events overlay on top.

    const anim1Frames = textures.getFrames("anim1");
    const anim1TotalFrames = 306;

    // Build the frameScripts map for the anim1 symbol.
    // We need:
    //   frame 3  (index 2):  place sprite4 + first sprite13
    //   frame 24 (index 23): place second sprite13
    //   frame 48 (index 47): place third sprite13
    //   frame 72 (index 71): place fourth sprite13
    //   frame 303 (index 303 — wait, frame_304 in AS = index 303):
    //     _parent.removeMovieClip() → complete

    // For the alpha tween on sprite4 we use a per-tick onEnterFrame on the
    // anim1 clip itself, reading its currentFrame to compute the right alpha.

    this.anim1Sym = {
      name: "anim1",
      totalFrames: anim1TotalFrames,
      frames: anim1Frames,
      anchorX: calculateAnchor({ width: 46.35, height: 29.35, offsetX: -22.6, offsetY: -16.1 }).x,
      anchorY: calculateAnchor({ width: 46.35, height: 29.35, offsetX: -22.6, offsetY: -16.1 }).y,
      onEnterFrame: (clip) => {
        // Drive the sprite4 alpha tween based on currentFrame.
        // Ramp-in: AS frames 3-39 (0-based 2-38): alphaMult 13→256
        // Hold:    AS frames 39-157 (0-based 38-156): alphaMult 256
        // Ramp-out: AS frames 157-198 (0-based 156-197): alphaMult 250→13
        const sprite4clip = clip.children.get("sprite4_1");
        if (sprite4clip) {
          const f = clip.currentFrame; // 0-based
          if (f >= 2 && f <= 38) {
            // Linear interpolation from 13/256 to 256/256 over frames 2-38 (37 steps)
            const t = (f - 2) / 36;
            sprite4clip.alpha = (13 + (256 - 13) * t) / 256;
          } else if (f >= 39 && f <= 156) {
            sprite4clip.alpha = 1.0;
          } else if (f >= 157 && f <= 197) {
            // AS placement keyframes: frame 157 (alphaMult 250) ... frame 198 (alphaMult 13)
            // Linear from 250/256 at index 156 to 13/256 at index 197 (41 steps)
            const t = (f - 156) / 41;
            sprite4clip.alpha = (250 - (250 - 13) * t) / 256;
          } else if (f > 197) {
            sprite4clip.alpha = 0;
          }
        }
      },
      frameScripts: new Map([
        [
          // AS frame_3 = index 2: place sprite4 (depth 1) + first sprite13 (depth 19)
          2,
          (clip, ctx) => {
            // Place sprite4 at depth 1 with initial transform from placements:
            //   translateX -0.6, translateY -1.4, alphaMult 13
            if (!clip.children.has("sprite4_1")) {
              const s4 = clip.attach(this.sprite4Sym, "sprite4_1", 1, ctx, {
                x: -0.6,
                y: -1.4,
              });
              s4.alpha = 13 / 256;
            }
            // Place first sprite13 at depth 19:
            //   translateX -0.05, translateY -0.1, ratio 3
            if (!clip.children.has("sprite13_19")) {
              clip.attach(this.sprite13Sym, "sprite13_19", 19, ctx, {
                x: -0.05,
                y: -0.1,
              });
            }
            // Signal hit at animation start (impact frame for displayType 11)
            this.runtime.signalHit();
          },
        ],
        [
          // AS frame_24 = index 23: place second sprite13 (depth 21)
          23,
          (clip, ctx) => {
            if (!clip.children.has("sprite13_21")) {
              clip.attach(this.sprite13Sym, "sprite13_21", 21, ctx, {
                x: -0.05,
                y: -0.1,
              });
            }
          },
        ],
        [
          // AS frame_48 = index 47: place third sprite13 (depth 23)
          47,
          (clip, ctx) => {
            if (!clip.children.has("sprite13_23")) {
              clip.attach(this.sprite13Sym, "sprite13_23", 23, ctx, {
                x: -0.05,
                y: -0.1,
              });
            }
          },
        ],
        [
          // AS frame_72 = index 71: place fourth sprite13 (depth 25)
          71,
          (clip, ctx) => {
            if (!clip.children.has("sprite13_25")) {
              clip.attach(this.sprite13Sym, "sprite13_25", 25, ctx, {
                x: -0.05,
                y: -0.1,
              });
            }
          },
        ],
        [
          // AS DefineSprite_14/frame_304/DoAction.as (index 303):
          //   _parent.removeMovieClip();
          303,
          (clip) => {
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
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
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("vlad_801");
    callbacks.playSound("vlad_801");

    // Attach the top-level anim1 clip at root. displayType=11 means the root
    // container is already positioned at the target cell; anim1 goes at (0,0).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
