/**
 * Spell 301 — Setag (Sadida).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/301/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion,
 * no caster reference, no dual-anchored WorldAbsolute layout. The
 * entire animation plays at the target cell.
 *
 * Library symbols (all in `librarySymbols[]`, textures via `lib_` prefix):
 *
 *   - sprite3  (directlyDynamic: true)  — tiny spark particle.
 *     onLoad seeds v=0. onEnterFrame applies gravity (v+=0.6),
 *     drifts X, bounces at Y=0.
 *
 *   - sprite4  (directlyDynamic: false) — horizontal bar wrapper.
 *     Contains 5 sprite3 instances placed at static authored offsets
 *     (depths 1,3,5,7,9 with different scales). No dynamic handlers
 *     of its own — frameScripts attaches the sprite3 children.
 *     Placed inside the main anim1 container at frame 3 (0-indexed 2),
 *     depth 1. Its alpha is tweened by the parent from alphaMult=13
 *     (frame 3) up to 256 (frame 30) then back down to 26 (frame 171).
 *
 *   - sprite23 (directlyDynamic: true)  — magic leaf placed inside
 *     sprite24. Two placement records:
 *       PlaceObject2_22_7 (depth 7): onLoad seeds rotation/alpha/i;
 *         onEnterFrame oscillates xscale = 100*sin(i+=0.5).
 *       PlaceObject2_21_1 (depth 1): onLoad seeds ta/scale/gotoAndPlay.
 *
 *   - sprite24 (directlyDynamic: true)  — spiralling orb container.
 *     Contains sprite23 instances. onLoad seeds spiral vars + attaches
 *     sprite23 children. onEnterFrame spirals (sin/cos path), fades
 *     in/out, removes itself when alpha goes negative after rising.
 *     Placed at depths 11, 13, 15 in the main container (frames 3,
 *     12, 24 — 0-indexed 2, 11, 23).
 *
 * DefineSprite_25 is the outermost container (anim1 animation):
 *   frame_88  (0-indexed 87)  → this.end()                 (signalHit)
 *   frame_325 (0-indexed 324) → _parent.removeMovieClip()  (complete)
 *
 * DefineSprite_21 is a looping spinner placed statically on the
 * sprite25 authored timeline — its behavior (AS: onEnterFrame
 * accelerates gotoAndPlay) is captured in the anim1 composite frames
 * that the renderer pre-rasterized. No runtime attach needed.
 *
 * Main timeline frame_1: SOMA.playSound("setag_301").
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

// librarySymbols[] bounds
const SPRITE3_BOUNDS = {
  width: 5.75,
  height: 4.5,
  offsetX: -2.85,
  offsetY: -2.25,
};

const SPRITE4_BOUNDS = {
  width: 39.55,
  height: 4.7,
  offsetX: -22,
  offsetY: 0.4,
};

const SPRITE23_BOUNDS = {
  width: 42,
  height: 54.8,
  offsetX: -16.8,
  offsetY: -20.1,
};

const SPRITE24_BOUNDS = {
  width: 36.1,
  height: 35.15,
  offsetX: -15,
  offsetY: -13,
};

// animations[] bounds (no lib_ prefix for texture key)
const ANIM1_BOUNDS = {
  width: 43.65,
  height: 35.15,
  offsetX: -22.6,
  offsetY: -13.1,
};

export class Spell301 extends RuntimeSpell {
  readonly spellId = 301;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite3Sym!: SymbolDefinition;
  private sprite23Sym!: SymbolDefinition;
  private sprite23AltSym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE23_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE24_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite3 — tiny spark particle (directlyDynamic: true) ----
    // Placed inside sprite4 at 5 static positions (depths 1,3,5,7,9)
    // with different scales and offsets per the placements[] matrix.
    //
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   v = 0;
    //
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _Y = _Y + v; _X = _X + vx; v += 0.6;
    //   if (_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 0;
        // vx is not seeded in onLoad — undefined until first bounce; initialise to 0
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
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

    // ---- sprite4 — horizontal bar wrapper (directlyDynamic: false) ----
    // Contains 5 sprite3 instances at static authored positions.
    // placements[] from manifest (parentSpriteId=4, all frame 0):
    //   depth 1: scale=0.619, tx=-11,    ty=2.6
    //   depth 3: scale=0.395, tx= 10.75, ty=4.2
    //   depth 5: scale=0.619, tx=  7.35, ty=1.8
    //   depth 7: scale=0.395, tx= 16.4,  ty=1.9
    //   depth 9: scale=0.293, tx=-21.15, ty=1.9
    // No dynamic handlers of its own — frameScripts attaches sprite3 children.
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
            // Attach 5 sprite3 particles at the authored static positions
            // (from manifest librarySymbols[sprite4].placements where parentSpriteId===4)

            // depth 1: scaleX=scaleY=0.6193, tx=-11, ty=2.6
            const p1 = clip.attach(this.sprite3Sym, "spark1", 1, ctx, {
              x: -11,
              y: 2.6,
            });
            p1.scaleX = 0.6192626953125;
            p1.scaleY = 0.6192626953125;

            // depth 3: scaleX=scaleY=0.3951, tx=10.75, ty=4.2
            const p2 = clip.attach(this.sprite3Sym, "spark2", 3, ctx, {
              x: 10.75,
              y: 4.2,
            });
            p2.scaleX = 0.395050048828125;
            p2.scaleY = 0.395050048828125;

            // depth 5: scaleX=scaleY=0.6193, tx=7.35, ty=1.8
            const p3 = clip.attach(this.sprite3Sym, "spark3", 5, ctx, {
              x: 7.35,
              y: 1.8,
            });
            p3.scaleX = 0.6192626953125;
            p3.scaleY = 0.6192626953125;

            // depth 7: scaleX=scaleY=0.3951, tx=16.4, ty=1.9
            const p4 = clip.attach(this.sprite3Sym, "spark4", 7, ctx, {
              x: 16.4,
              y: 1.9,
            });
            p4.scaleX = 0.395050048828125;
            p4.scaleY = 0.395050048828125;

            // depth 9: scaleX=scaleY=0.2929, tx=-21.15, ty=1.9
            const p5 = clip.attach(this.sprite3Sym, "spark5", 9, ctx, {
              x: -21.15,
              y: 1.9,
            });
            p5.scaleX = 0.292877197265625;
            p5.scaleY = 0.292877197265625;
          },
        ],
      ]),
    };

    // ---- sprite23 — magic leaf (directlyDynamic: true), variant A ----
    // PlaceObject2_22_7 placement inside sprite24 (depth 7).
    //
    // AS DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(load).as:
    //   _rotation = random(360) - 90;
    //   _alpha = random(50) + 40;
    //   i = Math.random() * 6;
    //
    // AS DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _xscale = 100 * Math.sin(i += 0.5);
    this.sprite23Sym = {
      name: "sprite23",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(load).as
        clip.rotation =
          ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_23/frame_1/PlaceObject2_22_7/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.5;
        // _xscale = 100 * sin(i) → decimal scale
        clip.scaleX = (100 * Math.sin(i)) / 100;
        clip.vars.i = i;
      },
    };

    // ---- sprite23 variant B — PlaceObject2_21_1 (depth 1 inside sprite24) ----
    // AS DefineSprite_23/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   ta = random(40) + 70;
    //   _xscale = 0.5 * ta;
    //   _yscale = 0.5 * ta;
    //   gotoAndPlay(random(30));
    // (no onClipEvent(enterFrame) script for this placement)
    this.sprite23AltSym = {
      name: "sprite23alt",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_23/frame_1/PlaceObject2_21_1/CLIPACTIONRECORD onClipEvent(load).as
        const ta = Math.floor(Math.random() * 40) + 70;
        clip.scaleX = (0.5 * ta) / 100;
        clip.scaleY = (0.5 * ta) / 100;
        // AS gotoAndPlay(random(30)) — 1-based → 0-based
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
      },
    };

    // ---- sprite24 — spiralling orb container (directlyDynamic: true) ----
    // Contains sprite23 at depths 1 and 7.
    // Placement matrix for sprite24 inside sprite25:
    //   frame 3  (0-idx 2):  depth 11, tx=-0.05, ty=-0.1, alphaMult=256, blueAdd=143
    //   frame 12 (0-idx 11): depth 13, tx=-0.05, ty=-0.1, alphaMult=256, redAdd=55,blueAdd=255
    //   frame 24 (0-idx 23): depth 15, tx=-0.05, ty=-0.1, alphaMult=256, redAdd=-79,...
    //
    // AS DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   st=0; i=0; p=0;
    //   v2 = 0.05 + 0.05 * Math.random();
    //   _rotation = random(360);
    //   _alpha = 120;
    //   _parent._alpha = 10;
    //   v = 0.5 + 0.5 * Math.random();
    //
    // AS DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if (_Y > -80 & _parent._alpha < 100) { _parent._alpha += 6; }
    //   if (_Y < -80) {
    //     _parent._alpha -= 6;
    //     if (_parent._alpha < 0) { _parent._visible = 0; st = 1; _parent.removeMovieClip(); }
    //   }
    //   _rotation = _rotation + 1.3;
    //   _Y = 5 * Math.cos(i) + (p -= v);
    //   _X = 25 * Math.sin(i += v2);
    //   if (Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
    this.sprite24Sym = {
      name: "sprite24",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.05 + 0.05 * Math.random();
        // _rotation = random(360) → degrees to radians
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // _alpha = 120 in AS (0-100 scale) → 120/100 = 1.2 clamped; Flash allows >100
        // but Pixi clamps to 1.0. Use 1.0 as the maximum representable.
        clip.alpha = Math.min(1, 120 / 100);
        // _parent._alpha = 10 → the sprite24 container alpha
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.5 + 0.5 * Math.random();

        // Attach sprite23 children inside sprite24
        // PlaceObject2_21_1: depth 1 — scale-seeded leaf
        clip.attach(this.sprite23AltSym, "sprite23_base", 1, ctx);
        // PlaceObject2_22_7: depth 7 — oscillating leaf
        clip.attach(this.sprite23Sym, "sprite23_leaf", 7, ctx);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_24/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v2 = clip.vars.v2 as number;
        const v = clip.vars.v as number;

        // Fade in: _Y > -80 && _parent._alpha < 100
        if (clip.y > -80) {
          if (clip.parent && clip.parent.alpha * 100 < 100) {
            clip.parent.alpha = Math.min(1, clip.parent.alpha + 6 / 100);
          }
        }

        // Fade out: _Y < -80
        if (clip.y < -80) {
          if (clip.parent) {
            clip.parent.alpha = clip.parent.alpha - 6 / 100;
            if (clip.parent.alpha < 0) {
              clip.parent.visible = false;
              clip.vars.st = 1;
              clip.parent.remove();
              return;
            }
          }
        }

        // _rotation = _rotation + 1.3 (degrees/frame → radians delta)
        clip.rotation += (1.3 * Math.PI) / 180;

        // Spiral position
        p -= v;
        clip.y = 5 * Math.cos(i) + p;
        clip.x = 25 * Math.sin(i);
        i += v2;
        clip.vars.i = i;
        clip.vars.p = p;

        // Alpha modulation: if (Math.cos(i) < 0) { _alpha = 80*cos(i)+100; }
        if (Math.cos(i) < 0) {
          // AS _alpha is 0-100; convert to 0-1
          clip.alpha = Math.max(0, Math.min(1, (80 * Math.cos(i) + 100) / 100));
        }
      },
    };

    // ---- anim1 — main 327-frame composite animation ---------------
    // In animations[] (not librarySymbols[]) → textures.getFrames("anim1") (no lib_ prefix).
    // This is the outermost DefineSprite_25 container timeline:
    //   frame_88  (0-indexed 87)  → this.end()                 → signalHit
    //   frame_325 (0-indexed 324) → _parent.removeMovieClip()  → complete
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 327,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          87,
          (_clip) => {
            // AS DefineSprite_25/frame_88/DoAction.as: this.end();
            this.runtime.signalHit();
          },
        ],
        [
          324,
          (clip) => {
            // AS DefineSprite_25/frame_325/DoAction.as: _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite23Sym);
    this.registry.register(this.sprite23AltSym);
    this.registry.register(this.sprite24Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("setag_301");
    callbacks.playSound("setag_301");

    // Attach the main anim1 composite (DefineSprite_25) as primary child.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Attach sprite4 (the horizontal spark bar) at the canonical placement
    // frame 3 (0-indexed 2) of sprite25, depth 1.
    // Initial alpha from colorTransform: alphaMult=13/256 ≈ 0.051
    const bar = this.root.attach(this.sprite4Sym, "sprite4_bar", 2, context, {
      x: -0.6,
      y: -1.4,
    });
    bar.alpha = 13 / 256;

    // Attach three sprite24 spiralling orb instances.
    // placement[0]: frame 3 (0-idx 2), depth 11, tx=-0.05, ty=-0.1
    const orb1 = this.root.attach(
      this.sprite24Sym,
      "sprite24_1",
      11,
      context,
      { x: -0.05, y: -0.1 },
    );
    // alphaMult=256 at placement — the onLoad immediately sets parent alpha to 10/100
    orb1.alpha = 256 / 256;

    // placement[1]: frame 12 (0-idx 11), depth 13, tx=-0.05, ty=-0.1
    const orb2 = this.root.attach(
      this.sprite24Sym,
      "sprite24_2",
      13,
      context,
      { x: -0.05, y: -0.1 },
    );
    orb2.alpha = 256 / 256;

    // placement[2]: frame 24 (0-idx 23), depth 15, tx=-0.05, ty=-0.1
    const orb3 = this.root.attach(
      this.sprite24Sym,
      "sprite24_3",
      15,
      context,
      { x: -0.05, y: -0.1 },
    );
    orb3.alpha = 256 / 256;
  }
}
