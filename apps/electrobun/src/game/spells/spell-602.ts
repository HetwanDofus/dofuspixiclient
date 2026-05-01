/**
 * Spell 602 — Dodge (Sram, dodge animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/602/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster reference,
 * no dual-anchor. It is a self-contained impact animation at the target cell.
 * The main timeline plays a single `anim1` composite clip (243 frames). The
 * `librarySymbols` in the manifest are all `directlyDynamic` (clipEvent) symbols that
 * are placed inside `DefineSprite_14` (the outer anim1 container) at specific frames.
 *
 * Canonical symbol tree inside DefineSprite_14:
 *   - sprite4  (directlyDynamic: false) — wrapper, placed at frame 0 depth 1.
 *               Itself contains 9 sprite3 instances at various depths/transforms,
 *               plus sprite9 at depth-chain (via sprite10 → sprite12 → sprite13).
 *               Also has a long per-frame alpha tween on depth 1 from the placements[].
 *   - sprite13 (directlyDynamic: true)  — spinning/spiraling orb with alpha pulse.
 *               Placed at frame 0 depth 19, frame 21 depth 21, frame 45 depth 23,
 *               frame 69 depth 25 inside DefineSprite_14.
 *
 * Nested chain inside sprite4:
 *   - sprite12 (directlyDynamic: true, placed inside sprite13's parent=12 → actually
 *               placed inside sprite4's child at depth 1) — actually placed inside sprite13
 *               No wait — let's read the placements carefully:
 *
 * Placement parentSpriteId analysis:
 *   sprite3  placements: parentSpriteId=4  → placed inside sprite4
 *   sprite9  placements: parentSpriteId=10 → placed inside sprite10
 *   sprite10 placements: parentSpriteId=12 → placed inside sprite12
 *   sprite12 placements: parentSpriteId=13 → placed inside sprite13
 *   sprite4  placements: parentSpriteId=14 → placed inside DefineSprite_14 (root anim)
 *   sprite13 placements: parentSpriteId=14 → placed inside DefineSprite_14 (root anim)
 *
 * So the nesting hierarchy is:
 *   anim1 (DefineSprite_14)
 *     └─ sprite4 (frame 0, depth 1) — no clip events, contains:
 *           └─ sprite3 ×9 (depth 1,3,5,7,9,11,13,15,17) — gravity bounce dots
 *     └─ sprite13 ×4 (frames 0,21,45,69, depths 19,21,23,25) — spinning spiral orbs
 *           └─ sprite12 (depth 1) — contains:
 *                 └─ sprite10 ×5 (depths 3,5,7,9,12) — pulsing wing strips
 *                       └─ sprite9 (depth 1) — random-scale wing shape
 *
 * DefineSprite_14 frame scripts:
 *   frame_157 (index 156): this.end() → signalHit
 *   frame_241 (index 240): _parent.removeMovieClip(); stop() → complete
 *
 * Main timeline: SOMA.playSound("dodge_602")
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

// ---- Bounds from manifest librarySymbols[] ----

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
  height: 11.45,
  offsetX: 0.15,
  offsetY: -5.95,
};

const SPRITE10_BOUNDS = {
  width: 37.35,
  height: 11.45,
  offsetX: 0.25,
  offsetY: -5.95,
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
  offsetY: -15,
};

export class Spell602 extends RuntimeSpell {
  readonly spellId = 602;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs so they can be cross-referenced in parent frameScripts
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

    // ---- sprite9 — single-frame wing-shape with random scale ----
    // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 80 + random(50);
    //   _xscale = t; _yscale = t;
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

    // ---- sprite10 — pulsing wing strip (contains sprite9, has enterFrame) ----
    // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360) - 90;
    //   _alpha = random(50) + 40;
    //   i = Math.random() * 6;
    // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _xscale = 100 * Math.sin(i += 0.16);
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        const rotDeg = Math.floor(Math.random() * 360) - 90;
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
        // Attach sprite9 as placed inside sprite10 at depth 1
        // AS: PlaceObject2 parentSpriteId=10 frame=0 depth=1 translateX=0.1 translateY=0
        clip.attach(this.sprite9Sym, "sprite9_1", 1, ctx, { x: 0.1, y: 0 });
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.16;
        clip.vars.i = i;
        clip.scaleX = (100 * Math.sin(i)) / 100;
      },
    };

    // ---- sprite12 — wrapper containing sprite10 instances (directlyDynamic: true) ----
    // onEnterFrame: _alpha = random(170)
    // AS DefineSprite_12/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Also: sprite10 has 5 placements inside sprite12 at depths 3,5,7,9,12 all at frame 0
    // matrix translateX=0.55 translateY=0.05 for all
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onLoad: (clip, ctx) => {
        // AS placements: sprite10 x5 inside sprite12 at frame=0, depths 3,5,7,9,12
        // All with matrix translateX=0.55 translateY=0.05
        clip.attach(this.sprite10Sym, "sprite10_3", 3, ctx, { x: 0.55, y: 0.05 });
        clip.attach(this.sprite10Sym, "sprite10_5", 5, ctx, { x: 0.55, y: 0.05 });
        clip.attach(this.sprite10Sym, "sprite10_7", 7, ctx, { x: 0.55, y: 0.05 });
        clip.attach(this.sprite10Sym, "sprite10_9", 9, ctx, { x: 0.55, y: 0.05 });
        clip.attach(this.sprite10Sym, "sprite10_12", 12, ctx, { x: 0.55, y: 0.05 });
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ---- sprite3 — small gravity-bounce dot ----
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //   v = 0;
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _Y = _Y + v; _X = _X + vx; v += 0.6;
    //   if(_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 0;
        // vx is not initialized in onLoad (no vx = assignment there); it starts undefined
        // The enterFrame reads vx; undefined + number = NaN in AS, but in the game it
        // likely reads 0 initially since v is seeded to 0. We seed vx = 0 for safety.
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        const vx = (clip.vars.vx as number) ?? 0;
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

    // ---- sprite4 — wrapper containing 9 sprite3 instances (directlyDynamic: false) ----
    // Has long per-frame alpha tween on depth 1 (itself, handled by the anim1 placement data)
    // sprite3 is placed at 9 depths inside sprite4 all at frame=0
    // placements from manifest:
    //   depth 1:  scaleX=0.6193 scaleY=0.6193 tx=-11    ty=2.6
    //   depth 3:  scaleX=0.3951 scaleY=0.3951 tx=10.75  ty=4.2
    //   depth 5:  scaleX=0.3951 scaleY=0.3951 tx=-15.7  ty=-1.8
    //   depth 7:  scaleX=0.6193 scaleY=0.6193 tx=7.35   ty=1.8
    //   depth 9:  scaleX=0.3951 scaleY=0.3951 tx=16.4   ty=1.9
    //   depth 11: scaleX=0.2929 scaleY=0.2929 tx=-21.15 ty=1.9
    //   depth 13: scaleX=0.2929 scaleY=0.2929 tx=19.55  ty=0.25
    //   depth 15: scaleX=0.2070 scaleY=0.2070 tx=-11.25 ty=-5.2
    //   depth 17: scaleX=0.2929 scaleY=0.2929 tx=13.95  ty=-5.25
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: directlyDynamic=false; attach all 9 sprite3 children per placements[]
        // placement frame=0 means all placed at entry frame
        const placements: Array<{ depth: number; sx: number; sy: number; tx: number; ty: number }> = [
          { depth: 1,  sx: 0.6192626953125,    sy: 0.6192626953125,    tx: -11,    ty: 2.6   },
          { depth: 3,  sx: 0.395050048828125,   sy: 0.395050048828125,   tx: 10.75,  ty: 4.2   },
          { depth: 5,  sx: 0.395050048828125,   sy: 0.395050048828125,   tx: -15.7,  ty: -1.8  },
          { depth: 7,  sx: 0.6192626953125,    sy: 0.6192626953125,    tx: 7.35,   ty: 1.8   },
          { depth: 9,  sx: 0.395050048828125,   sy: 0.395050048828125,   tx: 16.4,   ty: 1.9   },
          { depth: 11, sx: 0.292877197265625,   sy: 0.292877197265625,   tx: -21.15, ty: 1.9   },
          { depth: 13, sx: 0.292877197265625,   sy: 0.292877197265625,   tx: 19.55,  ty: 0.25  },
          { depth: 15, sx: 0.20703125,          sy: 0.20703125,          tx: -11.25, ty: -5.2  },
          { depth: 17, sx: 0.292877197265625,   sy: 0.292877197265625,   tx: 13.95,  ty: -5.25 },
        ];
        for (const p of placements) {
          const child = clip.attach(this.sprite3Sym, `sprite3_d${p.depth}`, p.depth, ctx, { x: p.tx, y: p.ty });
          child.scaleX = p.sx;
          child.scaleY = p.sy;
        }
      },
    };

    // ---- sprite13 — spinning spiral orb (directlyDynamic: true) ----
    // Contains sprite12 (placed at depth 1) with matrix scaleX=0.625 scaleY=0.625 tx=-0.05 ty=-0.1
    // AS DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.st = 0;
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        const rotDeg = Math.floor(Math.random() * 360);
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = 120 / 100;
        // _parent._alpha = 10 — sets the parent's alpha (the anim1 root child clip)
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.6 * Math.random();
        // Attach sprite12 inside sprite13 at depth 1
        // placement: parentSpriteId=13, frame=0, depth=1, scaleX=0.625, scaleY=0.625, tx=-0.05, ty=-0.1
        const child12 = clip.attach(this.sprite12Sym, "sprite12_1", 1, ctx, { x: -0.05, y: -0.1 });
        child12.scaleX = 0.625;
        child12.scaleY = 0.625;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;

        // if(_Y > -100 & _parent._alpha < 100) { _parent._alpha += 6.6; }
        if (clip.y > -100 && clip.parent && clip.parent.alpha < 1.0) {
          clip.parent.alpha = Math.min(1.0, clip.parent.alpha + 6.6 / 100);
        }

        // if(_Y < -100) { _parent._alpha -= 6.6; if(_parent._alpha < 0) { _parent._visible = 0; this.stop = 1; _parent.removeMovieClip(); } }
        if (clip.y < -100) {
          if (clip.parent) {
            clip.parent.alpha = clip.parent.alpha - 6.6 / 100;
            if (clip.parent.alpha < 0) {
              clip.parent.visible = false;
              clip.parent.remove();
            }
          }
        }

        // _rotation = _rotation + 1.3
        clip.rotation += (1.3 * Math.PI) / 180;

        // _Y = 5 * Math.cos(i) + (p -= v)
        p -= v;
        clip.vars.p = p;
        clip.y = 5 * Math.cos(i) + p;

        // _X = 25 * Math.sin(i += v2)
        i += v2;
        clip.vars.i = i;
        clip.x = 25 * Math.sin(i);

        // if(Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        if (Math.cos(i) < 0) {
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };

    // ---- anim1 — the outer 243-frame composite container ----
    // DefineSprite_14 in canonical AS.
    // frame_157 (index 156): this.end() → signalHit
    // frame_241 (index 240): _parent.removeMovieClip(); stop() → complete
    //
    // Placements inside DefineSprite_14:
    //   sprite4  at frame 0,  depth 1  (the wrapper with 9 sprite3 dots)
    //   sprite13 at frame 0,  depth 19
    //   sprite13 at frame 21, depth 21  (ratio=21)
    //   sprite13 at frame 45, depth 23  (ratio=45)
    //   sprite13 at frame 69, depth 25  (ratio=69)
    //
    // The per-frame alpha tween on sprite4 (depth 1) is encoded in the placements[].
    // We handle it via onEnterFrame tracking the current frame of anim1.
    // However, SpellClip's currentFrame is internal. We'll track elapsed frames via
    // a closure variable and apply the alpha per-tick.
    //
    // Alpha tween data from placements[]: alphaMult/256 for each frame. We store the
    // keyframes and interpolate linearly (or step) between them.
    // Fade-in: frames 0-36 alpha goes 13/256 → 256/256 (fully opaque at frame 36)
    // Full: frames 37-153 alpha = 1.0
    // Fade-out: frames 154-195 alpha goes 250/256 → 13/256 (then gone)
    const alphaKeyframes: Array<{ frame: number; alpha: number }> = [
      { frame: 0,   alpha: 13  / 256 },
      { frame: 1,   alpha: 20  / 256 },
      { frame: 2,   alpha: 27  / 256 },
      { frame: 3,   alpha: 33  / 256 },
      { frame: 4,   alpha: 40  / 256 },
      { frame: 5,   alpha: 47  / 256 },
      { frame: 6,   alpha: 54  / 256 },
      { frame: 7,   alpha: 60  / 256 },
      { frame: 8,   alpha: 67  / 256 },
      { frame: 9,   alpha: 74  / 256 },
      { frame: 10,  alpha: 80  / 256 },
      { frame: 11,  alpha: 87  / 256 },
      { frame: 12,  alpha: 94  / 256 },
      { frame: 13,  alpha: 101 / 256 },
      { frame: 14,  alpha: 107 / 256 },
      { frame: 15,  alpha: 114 / 256 },
      { frame: 16,  alpha: 121 / 256 },
      { frame: 17,  alpha: 128 / 256 },
      { frame: 18,  alpha: 135 / 256 },
      { frame: 19,  alpha: 141 / 256 },
      { frame: 20,  alpha: 148 / 256 },
      { frame: 21,  alpha: 155 / 256 },
      { frame: 22,  alpha: 162 / 256 },
      { frame: 23,  alpha: 168 / 256 },
      { frame: 24,  alpha: 175 / 256 },
      { frame: 25,  alpha: 182 / 256 },
      { frame: 26,  alpha: 189 / 256 },
      { frame: 27,  alpha: 195 / 256 },
      { frame: 28,  alpha: 202 / 256 },
      { frame: 29,  alpha: 209 / 256 },
      { frame: 30,  alpha: 215 / 256 },
      { frame: 31,  alpha: 222 / 256 },
      { frame: 32,  alpha: 229 / 256 },
      { frame: 33,  alpha: 236 / 256 },
      { frame: 34,  alpha: 242 / 256 },
      { frame: 35,  alpha: 249 / 256 },
      { frame: 36,  alpha: 256 / 256 },
      { frame: 154, alpha: 250 / 256 },
      { frame: 155, alpha: 244 / 256 },
      { frame: 156, alpha: 239 / 256 },
      { frame: 157, alpha: 233 / 256 },
      { frame: 158, alpha: 227 / 256 },
      { frame: 159, alpha: 221 / 256 },
      { frame: 160, alpha: 215 / 256 },
      { frame: 161, alpha: 210 / 256 },
      { frame: 162, alpha: 204 / 256 },
      { frame: 163, alpha: 198 / 256 },
      { frame: 164, alpha: 192 / 256 },
      { frame: 165, alpha: 187 / 256 },
      { frame: 166, alpha: 181 / 256 },
      { frame: 167, alpha: 175 / 256 },
      { frame: 168, alpha: 169 / 256 },
      { frame: 169, alpha: 163 / 256 },
      { frame: 170, alpha: 158 / 256 },
      { frame: 171, alpha: 152 / 256 },
      { frame: 172, alpha: 146 / 256 },
      { frame: 173, alpha: 140 / 256 },
      { frame: 174, alpha: 135 / 256 },
      { frame: 175, alpha: 129 / 256 },
      { frame: 176, alpha: 123 / 256 },
      { frame: 177, alpha: 117 / 256 },
      { frame: 178, alpha: 111 / 256 },
      { frame: 179, alpha: 106 / 256 },
      { frame: 180, alpha: 100 / 256 },
      { frame: 181, alpha: 94  / 256 },
      { frame: 182, alpha: 88  / 256 },
      { frame: 183, alpha: 82  / 256 },
      { frame: 184, alpha: 77  / 256 },
      { frame: 185, alpha: 71  / 256 },
      { frame: 186, alpha: 65  / 256 },
      { frame: 187, alpha: 59  / 256 },
      { frame: 188, alpha: 54  / 256 },
      { frame: 189, alpha: 48  / 256 },
      { frame: 190, alpha: 42  / 256 },
      { frame: 191, alpha: 36  / 256 },
      { frame: 192, alpha: 30  / 256 },
      { frame: 193, alpha: 25  / 256 },
      { frame: 194, alpha: 19  / 256 },
      { frame: 195, alpha: 13  / 256 },
    ];

    // Build a quick-lookup map for alpha tween (frame → alpha)
    const alphaMap = new Map<number, number>();
    for (const kf of alphaKeyframes) {
      alphaMap.set(kf.frame, kf.alpha);
    }

    // closure tracking frame count for the anim1 onEnterFrame alpha tween
    let anim1Frame = 0;

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 243,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({ width: 46.35, height: 29.35, offsetX: -22.6, offsetY: -15.1 }).x,
      anchorY: calculateAnchor({ width: 46.35, height: 29.35, offsetX: -22.6, offsetY: -15.1 }).y,
      onLoad: (clip, ctx) => {
        anim1Frame = 0;
        // Attach sprite4 at frame 0, depth 1, matrix tx=-0.6 ty=-1.4
        // (alphaMult 13/256 at frame 0 is the sprite4's initial alpha)
        const sp4 = clip.attach(this.sprite4Sym, "sprite4_1", 1, ctx, { x: -0.6, y: -1.4 });
        sp4.alpha = 13 / 256;
        clip.vars.sprite4 = sp4;

        // Attach sprite13 instances at frame 0, depth 19 (ratio=0 effectively)
        // placement: frame=0, depth=19, tx=-0.05, ty=-0.1
        clip.attach(this.sprite13Sym, "sprite13_19", 19, ctx, { x: -0.05, y: -0.1 });
      },
      onEnterFrame: (clip, ctx) => {
        // Track frame index for timed placements and alpha tween
        anim1Frame++;

        // Apply sprite4 alpha tween based on current frame
        const sp4 = clip.vars.sprite4 as ReturnType<typeof clip.attach> | undefined;
        if (sp4) {
          const mappedAlpha = alphaMap.get(anim1Frame);
          if (mappedAlpha !== undefined) {
            sp4.alpha = mappedAlpha;
          } else if (anim1Frame > 36 && anim1Frame < 154) {
            // fully opaque in the middle
            sp4.alpha = 1;
          }
          // frames 196+ left at 13/256 effectively invisible (no more keyframes)
        }

        // Timed placement of sprite13 instances
        // frame 21: attach sprite13 at depth 21
        if (anim1Frame === 21) {
          clip.attach(this.sprite13Sym, "sprite13_21", 21, ctx, { x: -0.05, y: -0.1 });
        }
        // frame 45: attach sprite13 at depth 23
        if (anim1Frame === 45) {
          clip.attach(this.sprite13Sym, "sprite13_23", 23, ctx, { x: -0.05, y: -0.1 });
        }
        // frame 69: attach sprite13 at depth 25
        if (anim1Frame === 69) {
          clip.attach(this.sprite13Sym, "sprite13_25", 25, ctx, { x: -0.05, y: -0.1 });
        }
      },
      frameScripts: new Map([
        [
          156,
          (_clip) => {
            // AS DefineSprite_14/frame_157/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          240,
          (clip) => {
            // AS DefineSprite_14/frame_241/DoAction.as: _parent.removeMovieClip(); stop()
            clip.stop();
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

  protected onSpellStart(callbacks: SpellCallbacks, context: SpellContext): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("dodge_602");
    callbacks.playSound("dodge_602");

    // Attach the top-level anim1 (DefineSprite_14) onto the root.
    // The main timeline places this as the primary content.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
