/**
 * Spell 213 — Crockette (likely a Sadida or similar earth/nature spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/213/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no move/shoot/duplicate
 * symbols and no caster-side positioning logic. All content is anchored
 * at the target cell. The main animation (DefineSprite_13 / anim1) plays
 * at the target, and DefineSprite_13/frame_304 fires `_parent.removeMovieClip()`
 * to signal completion.
 *
 * Library symbols (all directlyDynamic unless noted):
 *
 *   - sprite3  (characterId 3, directlyDynamic: true) — tiny spark/bubble
 *              particle. onLoad seeds v=0. onEnterFrame: gravity bounce with
 *              random horizontal drift. Placed 9× inside sprite4 at frame 0
 *              (depths 1,3,5,7,9,11,13,15,17) with varying scales/positions.
 *
 *   - sprite4  (characterId 4, directlyDynamic: false) — wrapper/container
 *              for the 9 sprite3 instances. Placed inside DefineSprite_13
 *              (the main anim sprite) at frames 3, 24, 48, 72 (depths
 *              1-based per placement). Has a long alpha tween (13→38 fade-in,
 *              157→198 fade-out) handled via the main sprite's authored SVG
 *              timeline — the alpha tween values are baked into the composite
 *              anim1 frames. We attach sprite4 at the correct frames from
 *              the anim1 frameScripts.
 *
 *   - sprite9  (characterId 9, directlyDynamic: true) — glowing orb. onLoad
 *              seeds t ∈ [80,129] and sets scale. Placed inside sprite10
 *              (depth 1).
 *
 *   - sprite10 (characterId 10, directlyDynamic: true) — wobbling ring.
 *              onLoad seeds _rotation, _alpha, i. onEnterFrame: xscale =
 *              100*sin(i+=0.1). Placed inside sprite11 (depth 3).
 *
 *   - sprite11 (characterId 11, directlyDynamic: true) — alpha-flicker
 *              wrapper. onEnterFrame: _alpha = random(170). Placed inside
 *              sprite12 at depths 1 and 5.
 *
 *   - sprite12 (characterId 12, directlyDynamic: true) — ascending spiral
 *              particle. Two sprite11 instances (PlaceObject2_11_1 at depth 1,
 *              PlaceObject2_11_5 at depth 5), each with their own load/enter
 *              handlers driving a Lissajous-style ascent + removeMovieClip
 *              when fully faded. Placed inside DefineSprite_13 at frames
 *              3, 24, 48, 72 (depths 19, 25, 31, 37).
 *
 * Main timeline (frame_1/DoAction.as):
 *   SOMA.playSound("crockette_213");
 *
 * DefineSprite_13/frame_304/DoAction.as:
 *   _parent.removeMovieClip() → this.runtime.complete()
 *
 * The main animation (anim1) has 306 frames and is the root visual —
 * we register it as the "anim1" symbol attached at root from onSpellStart.
 * Its frameScripts fire sprite4 and sprite12 attachments at frames 3/24/48/72
 * and complete() at frame 303 (0-based for AS frame_304).
 *
 * signalHit is fired at frame 3 (first particle spawn = first impact frame).
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
  width: 67,
  height: 73.6,
  offsetX: -29.5,
  offsetY: -29.4,
};

const SPRITE10_BOUNDS = {
  width: 67,
  height: 73.6,
  offsetX: -29.4,
  offsetY: -29.4,
};

const SPRITE11_BOUNDS = {
  width: 67,
  height: 73.6,
  offsetX: -28.85,
  offsetY: -29.35,
};

const SPRITE12_BOUNDS = {
  width: 43.55,
  height: 46.1,
  offsetX: -18.1,
  offsetY: -18.45,
};

const ANIM1_BOUNDS = {
  width: 48,
  height: 46.1,
  offsetX: -22.6,
  offsetY: -18.55,
};

export class Spell213 extends RuntimeSpell {
  readonly spellId = 213;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs so they can be cross-referenced in frameScripts.
  private sprite3Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite3 — gravity-bounce spark particle ----------------
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   v = 0;
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _Y = _Y + v; _X = _X + vx; v += 0.6;
    //   if (_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
    // Note: DefineSprite_3/frame_1/DoAction.as is just `math.sin();` — a no-op stub, ignore.
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 0;
        // vx is read in enterFrame before first bounce sets it — init to 0.
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

    // ---- sprite9 — glowing orb, child of sprite10 ---------------
    // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 80 + random(50); _xscale = t; _yscale = t;
    // No enterFrame for sprite9 itself.
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

    // ---- sprite10 — wobbling ring, child of sprite11 ------------
    // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360) - 90; _alpha = random(50) + 40; i = Math.random() * 6;
    // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _xscale = 100 * Math.sin(i += 0.1);
    // sprite10 also hosts sprite9 at depth 1 (placed in its frame_1 via placement matrix).
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
        // Placement: sprite9 is placed inside sprite10 at depth 1, matrix translateX=0.1, translateY=0.
        clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx, { x: 0.1, y: 0 });
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.1;
        clip.scaleX = (100 * Math.sin(i)) / 100;
        clip.vars.i = i;
      },
    };

    // ---- sprite11 — alpha-flicker wrapper, child of sprite12 ----
    // AS DefineSprite_11/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(170);
    // sprite11 hosts sprite10 at depth 3 (matrix translateX=0.55, translateY=0.05).
    // There is no onLoad for sprite11's own PlaceObject2 — only enterFrame.
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      onLoad: (clip, ctx) => {
        // No AS onClipEvent(load) for sprite11 itself.
        // Place sprite10 at depth 3 as per manifest placements (parentSpriteId=11, depth=3).
        clip.attach(this.sprite10Sym, "sprite10_3", 3, ctx, { x: 0.55, y: 0.05 });
        // sprite11 also has a second placement of itself at depth 5 inside sprite12 —
        // that second instance is handled by sprite12's onLoad (PlaceObject2_11_5).
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_11/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ---- sprite12 — ascending spiral particle -------------------
    // sprite12 has TWO PlaceObject2 entries (depth 1 = PlaceObject2_11_1, depth 5 = PlaceObject2_11_5)
    // both placing sprite11 (characterId 11). Each has its own load + enterFrame handlers.
    //
    // PlaceObject2_11_1 (depth 1):
    //   onLoad: st=0; i=0; p=0; v2=0.05+0.05*Math.random(); _rotation=random(360);
    //           _alpha=120; _parent._alpha=10; v=0.5+0.5*Math.random();
    //   onEnterFrame: spiral ascent, fade in/out, removeMovieClip when faded.
    //
    // PlaceObject2_11_5 (depth 5):
    //   identical load + enterFrame handlers.
    //
    // Because both children are sprite11 (same symbol), we attach two instances
    // and give each its own vars for the spiral state.
    // The handlers reference _parent._alpha which means the sprite12 clip's alpha.

    // Helper to create the spiral enterFrame logic for a sprite11 child.
    // Both depth-1 and depth-5 instances share identical handler code.
    const makeSpiralEnterFrame = () => {
      return (clip: import("@dofus/spell-runtime").SpellClip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // (identical for PlaceObject2_11_5)
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;
        const parent = clip.parent;

        // if (_Y > -80 & _parent._alpha < 100) { _parent._alpha += 6; }
        if (clip.y > -80 && (parent ? parent.alpha * 100 : 0) < 100) {
          if (parent) {
            parent.alpha = Math.min(1, parent.alpha + 6 / 100);
          }
        }
        // if (_Y < -80) { _parent._alpha -= 6; if (_parent._alpha < 0) { hide + removeMovieClip } }
        if (clip.y < -80) {
          if (parent) {
            parent.alpha = parent.alpha - 6 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              parent.remove();
            }
          }
        }
        // _rotation = _rotation + 1.3
        clip.rotation += (1.3 * Math.PI) / 180;
        // _Y = 5 * Math.cos(i) + (p -= v)
        p -= v;
        clip.y = 5 * Math.cos(i) + p;
        // _X = 25 * Math.sin(i += v2)
        i += v2;
        clip.x = 25 * Math.sin(i);
        // if (Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        if (Math.cos(i) < 0) {
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
        clip.vars.i = i;
        clip.vars.p = p;
      };
    };

    // We need a custom sprite11 variant that carries the spiral handlers
    // (instead of the plain flickering one). In canonical AS, the spiral
    // behavior lives on the PlaceObject2 instance (clip-event on the
    // placed sprite11 inside sprite12), NOT on sprite11's own definition.
    // We create two distinct symbol definitions for the two spiral instances
    // (depth 1 and depth 5) so each gets independent vars.

    const makeSpiralSprite11 = (instanceSuffix: string): SymbolDefinition => ({
      name: `sprite11_spiral_${instanceSuffix}`,
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.05 + 0.05 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        // _parent._alpha = 10 — set sprite12 instance's alpha to 10/100
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.5 + 0.5 * Math.random();
        // Also attach sprite10 as the visual content of this sprite11 instance
        // (mirrors sprite11's authored composition: sprite10 at depth 3).
        clip.attach(this.sprite10Sym, `sprite10_d3_${instanceSuffix}`, 3, ctx, {
          x: 0.55,
          y: 0.05,
        });
      },
      onEnterFrame: makeSpiralEnterFrame(),
    });

    const sprite11Spiral1Sym = makeSpiralSprite11("d1");
    const sprite11Spiral5Sym = makeSpiralSprite11("d5");

    // ---- sprite4 — wrapper for 9 sprite3 bubble particles -------
    // directlyDynamic: false — no clip events of its own.
    // Attaches 9 sprite3 instances at frame 0 per manifest placements.
    // Each placement has a distinct depth, matrix (scale + translate).
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
            // AS: sprite4 places 9 instances of sprite3 (characterId 3) at
            // depths 1,3,5,7,9,11,13,15,17 per manifest placements[].
            // Apply matrix.scaleX/scaleY and translateX/translateY from each placement.

            // depth 1: scale 0.619, pos (-11, 2.6)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d1", 1, ctx, {
                x: -11,
                y: 2.6,
              });
              c.scaleX = 0.6192626953125;
              c.scaleY = 0.6192626953125;
            }
            // depth 3: scale 0.395, pos (10.75, 4.2)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d3", 3, ctx, {
                x: 10.75,
                y: 4.2,
              });
              c.scaleX = 0.395050048828125;
              c.scaleY = 0.395050048828125;
            }
            // depth 5: scale 0.395, pos (-15.7, -1.8)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d5", 5, ctx, {
                x: -15.7,
                y: -1.8,
              });
              c.scaleX = 0.395050048828125;
              c.scaleY = 0.395050048828125;
            }
            // depth 7: scale 0.619, pos (7.35, 1.8)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d7", 7, ctx, {
                x: 7.35,
                y: 1.8,
              });
              c.scaleX = 0.6192626953125;
              c.scaleY = 0.6192626953125;
            }
            // depth 9: scale 0.395, pos (16.4, 1.9)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d9", 9, ctx, {
                x: 16.4,
                y: 1.9,
              });
              c.scaleX = 0.395050048828125;
              c.scaleY = 0.395050048828125;
            }
            // depth 11: scale 0.293, pos (-21.15, 1.9)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d11", 11, ctx, {
                x: -21.15,
                y: 1.9,
              });
              c.scaleX = 0.292877197265625;
              c.scaleY = 0.292877197265625;
            }
            // depth 13: scale 0.293, pos (19.55, 0.25)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d13", 13, ctx, {
                x: 19.55,
                y: 0.25,
              });
              c.scaleX = 0.292877197265625;
              c.scaleY = 0.292877197265625;
            }
            // depth 15: scale 0.207, pos (-11.25, -5.2)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d15", 15, ctx, {
                x: -11.25,
                y: -5.2,
              });
              c.scaleX = 0.20703125;
              c.scaleY = 0.20703125;
            }
            // depth 17: scale 0.293, pos (13.95, -5.25)
            {
              const c = clip.attach(this.sprite3Sym, "s3_d17", 17, ctx, {
                x: 13.95,
                y: -5.25,
              });
              c.scaleX = 0.292877197265625;
              c.scaleY = 0.292877197265625;
            }
          },
        ],
      ]),
    };

    // ---- sprite12 — ascending spiral container ------------------
    // directlyDynamic: true. Hosts two sprite11 spiral instances.
    // Its own lifecycle is governed by those children calling
    // _parent.removeMovieClip() when they fade out.
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite11 spiral instance at depth 1 (PlaceObject2_11_1)
            // manifest placement: scaleX=0.625, scaleY=0.625, translateX=-0.05, translateY=-0.1
            {
              const c = clip.attach(sprite11Spiral1Sym, "s11_d1", 1, ctx, {
                x: -0.05,
                y: -0.1,
              });
              c.scaleX = 0.625;
              c.scaleY = 0.625;
            }
            // Place sprite11 spiral instance at depth 5 (PlaceObject2_11_5)
            // manifest placement: scaleX=0.625, scaleY=0.625, translateX=1.6, translateY=0
            {
              const c = clip.attach(sprite11Spiral5Sym, "s11_d5", 5, ctx, {
                x: 1.6,
                y: 0,
              });
              c.scaleX = 0.625;
              c.scaleY = 0.625;
            }
          },
        ],
      ]),
    };

    // ---- anim1 — main composite animation (306 frames) ----------
    // This is DefineSprite_13 in the SWF (the outermost anim container).
    // The pre-rendered anim1 frames cover the visual backbone of the spell.
    // frame_304 (0-based: 303): _parent.removeMovieClip() → complete().
    // Frames 3, 24, 48, 72 (0-based: 2, 23, 47, 71): place sprite4 (bubbles)
    // and sprite12 (spirals).
    //
    // signalHit fires at the first sprite placement frame (frame 3, 0-based 2)
    // which represents the first visible impact moment.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 306,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          2,
          (clip, ctx) => {
            // AS DefineSprite_13: frame_3 places sprite4 (depth 1, ratio 3)
            // and sprite12 (depth 19, ratio 3).
            // matrix for sprite4: translateX=-0.6, translateY=-1.4
            {
              const c = clip.attach(this.sprite4Sym, "sprite4_f3", 1, ctx, {
                x: -0.6,
                y: -1.4,
              });
              c.alpha = 13 / 256;
            }
            // matrix for sprite12: translateX=-0.05, translateY=-0.1
            clip.attach(this.sprite12Sym, "sprite12_f3", 19, ctx, {
              x: -0.05,
              y: -0.1,
            });
            // First impact frame — signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          23,
          (clip, ctx) => {
            // AS DefineSprite_13: frame_24 places sprite4 (depth 25, ratio 24)
            // and sprite12 (depth 25, ratio 24). Using distinct names.
            {
              const c = clip.attach(
                this.sprite4Sym,
                "sprite4_f24",
                25,
                ctx,
                { x: -0.6, y: -1.4 }
              );
              c.alpha = 13 / 256;
            }
            clip.attach(this.sprite12Sym, "sprite12_f24", 26, ctx, {
              x: -0.05,
              y: -0.1,
            });
          },
        ],
        [
          47,
          (clip, ctx) => {
            // AS DefineSprite_13: frame_48 places sprite4 (depth 31, ratio 48)
            // and sprite12 (depth 31, ratio 48).
            {
              const c = clip.attach(
                this.sprite4Sym,
                "sprite4_f48",
                31,
                ctx,
                { x: -0.6, y: -1.4 }
              );
              c.alpha = 13 / 256;
            }
            clip.attach(this.sprite12Sym, "sprite12_f48", 32, ctx, {
              x: -0.05,
              y: -0.1,
            });
          },
        ],
        [
          71,
          (clip, ctx) => {
            // AS DefineSprite_13: frame_72 places sprite4 (depth 37, ratio 72)
            // and sprite12 (depth 37, ratio 72).
            {
              const c = clip.attach(
                this.sprite4Sym,
                "sprite4_f72",
                37,
                ctx,
                { x: -0.6, y: -1.4 }
              );
              c.alpha = 13 / 256;
            }
            clip.attach(this.sprite12Sym, "sprite12_f72", 38, ctx, {
              x: -0.05,
              y: -0.1,
            });
          },
        ],
        [
          303,
          (clip) => {
            // AS DefineSprite_13/frame_304/DoAction.as: _parent.removeMovieClip()
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
    this.registry.register(this.sprite11Sym);
    this.registry.register(sprite11Spiral1Sym);
    this.registry.register(sprite11Spiral5Sym);
    this.registry.register(this.sprite12Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("crockette_213");
    callbacks.playSound("crockette_213");

    // Attach the main anim1 timeline at root — this is the "main timeline"
    // placement of DefineSprite_13 at the target cell (displayType=11).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
