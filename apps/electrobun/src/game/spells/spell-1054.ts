/**
 * Spell 1054 — Sacrieur blood-pulse aura (Sacrieur).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1054/scripts/scripts/
 *
 * displayType=10 (CasterCell). This is a caster-anchored self-buff / aura —
 * no projectile, no target-cell impact, the entire animation plays at the
 * caster's feet. The outer DefineSprite_22 is the root container; its
 * timeline is 306 frames, plays three looping "sacrieur_1054" sounds at
 * frames 19, 106 and 196, and removes itself at frame 304.
 *
 * Library symbols (all directlyDynamic unless noted):
 *
 *   sprite4   (char 4)  — tiny blood droplet particle. onLoad seeds `v=0`,
 *                         no `vx` init (set externally). onEnterFrame: gravity
 *                         bounce — _Y += v; _X += vx; v += 0.6; bounce when
 *                         _Y > 0 with vx randomised.
 *
 *   sprite5   (char 5)  — directlyDynamic:false wrapper. Contains six sprite4
 *                         placements at various depths/scales. Attached from
 *                         DefineSprite_22 at frame 3 (depth 2), alpha-tweened
 *                         by the parent over frames 3-198. Because the parent
 *                         manages the alpha tween via PlaceObject2 colorTransform
 *                         moves we drive it as a per-frame alpha lerp in
 *                         sprite22's onEnterFrame rather than hundreds of
 *                         individual frameScripts entries.
 *
 *   sprite16  (char 16) — rotating/flickering blob. onLoad: gotoAndPlay(random(30)).
 *                         (1-frame, no enterFrame handler.)
 *
 *   sprite17  (char 17) — blob flash layer. onLoad: gotoAndPlay(random(30)).
 *
 *   sprite18  (char 18) — scaling glow ring. onLoad: t=80+random(50);
 *                         _xscale=_yscale=t. No enterFrame.
 *
 *   sprite19  (char 19) — pulsing blade. onLoad: _rotation=random(360)-90;
 *                         _alpha=random(50)+40; i=Math.random()*6.
 *                         onEnterFrame: _xscale=100*sin(i+=0.1).
 *
 *   sprite20  (char 20) — flickering glow. No onLoad.
 *                         onEnterFrame: _alpha=random(170).
 *
 *   sprite21  (char 21) — spiralling orb. onLoad seeds p,i,v2,rotation,alpha;
 *                         sets _parent._alpha=10. onEnterFrame: float spiral
 *                         with alpha ramp-in/out + removeMovieClip when fully
 *                         faded. Three separate placements on sprite22 at frames
 *                         3, 24 and 48 (depths 14, 16, 18).
 *
 *   sprite22  (char 22) — outermost container. 306-frame authored timeline.
 *                         frame 19  → playSound("sacrieur_1054")
 *                         frame 106 → playSound("sacrieur_1054")
 *                         frame 196 → playSound("sacrieur_1054")
 *                         frame 304 → _parent.removeMovieClip() → complete()
 *
 * Main timeline (top-level): the spell simply attaches sprite22 at root from
 * onSpellStart. No explicit SOMA.playSound on the main timeline — sounds are
 * fired from DefineSprite_22's own frameScripts.
 *
 * signalHit: fired at frame 19 of sprite22 (first sound = first visual impact).
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

const SPRITE4_BOUNDS = {
  width: 5.75,
  height: 4.5,
  offsetX: -2.85,
  offsetY: -2.25,
};

const SPRITE5_BOUNDS = {
  width: 42.4,
  height: 9.9,
  offsetX: -22,
  offsetY: -5.9,
};

const SPRITE16_BOUNDS = {
  width: 47.3,
  height: 46.15,
  offsetX: -10.6,
  offsetY: -32.2,
};

const SPRITE17_BOUNDS = {
  width: 60.75,
  height: 48.3,
  offsetX: -4.3,
  offsetY: -22.7,
};

const SPRITE18_BOUNDS = {
  width: 60.75,
  height: 48.3,
  offsetX: -3.05,
  offsetY: -22.45,
};

const SPRITE19_BOUNDS = {
  width: 60.75,
  height: 48.3,
  offsetX: -2.95,
  offsetY: -22.45,
};

const SPRITE20_BOUNDS = {
  width: 69.3,
  height: 59.4,
  offsetX: -10.95,
  offsetY: -33.5,
};

const SPRITE21_BOUNDS = {
  width: 43.3,
  height: 37.15,
  offsetX: -6.9,
  offsetY: -21.05,
};

// ---- Alpha tween schedule for sprite5 (depth 2 child of sprite22) ----
// Canonical PlaceObject2 colorTransform alphaMult values (0-256 range) keyed
// by 0-based parent frame index. Extracted verbatim from manifest placements[].
// Frames not listed hold the previous value (or 256 once fully opaque).
const SPRITE5_ALPHA_TWEEN: ReadonlyMap<number, number> = new Map([
  [3, 13],
  [4, 20],
  [5, 27],
  [6, 33],
  [7, 40],
  [8, 47],
  [9, 54],
  [10, 60],
  [11, 67],
  [12, 74],
  [13, 80],
  [14, 87],
  [15, 94],
  [16, 101],
  [17, 107],
  [18, 114],
  [19, 121],
  [20, 128],
  [21, 135],
  [22, 141],
  [23, 148],
  [24, 155],
  [25, 162],
  [26, 168],
  [27, 175],
  [28, 182],
  [29, 189],
  [30, 195],
  [31, 202],
  [32, 209],
  [33, 215],
  [34, 222],
  [35, 229],
  [36, 236],
  [37, 242],
  [38, 249],
  [39, 256],
  // Held at 256 until fade-out begins at frame 157.
  [157, 250],
  [158, 244],
  [159, 239],
  [160, 233],
  [161, 227],
  [162, 221],
  [163, 215],
  [164, 210],
  [165, 204],
  [166, 198],
  [167, 192],
  [168, 187],
  [169, 181],
  [170, 175],
  [171, 169],
  [172, 163],
  [173, 158],
  [174, 152],
  [175, 146],
  [176, 140],
  [177, 135],
  [178, 129],
  [179, 123],
  [180, 117],
  [181, 111],
  [182, 106],
  [183, 100],
  [184, 94],
  [185, 88],
  [186, 82],
  [187, 77],
  [188, 71],
  [189, 65],
  [190, 59],
  [191, 54],
  [192, 48],
  [193, 42],
  [194, 36],
  [195, 30],
  [196, 25],
  [197, 19],
  [198, 13],
]);

export class Spell1054 extends RuntimeSpell {
  readonly spellId = 1054;
  readonly displayType = SpellDisplayType.CasterCell;

  private sprite22Sym!: SymbolDefinition;
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE17_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE19_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE20_BOUNDS);
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);

    // ---- sprite4 — blood droplet particle ----------------------
    // AS DefineSprite_4/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
    //   v = 0;
    // AS DefineSprite_4/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _Y += v; _X += vx; v += 0.6;
    //   if (_Y > 0) { _Y = 0; v = -5*Math.random(); vx = -2.5*Math.random()+1.25; }
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 0;
        // vx is left uninitialised here (matches canonical AS — vx only appears
        // in the enterFrame bounce branch; the initial value is supplied by the
        // parent wrapper's placement matrix translateX effectively being 0, so
        // the first few ticks it drifts only by gravity until the first bounce).
        clip.vars.vx = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_3_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
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

    // ---- sprite5 — wrapper containing six sprite4 droplets -----
    // directlyDynamic: false — no own clip events.
    // Placements from manifest: six sprite4 instances at various scales/offsets.
    // The parent (sprite22) drives the alpha tween on this clip via its
    // PlaceObject2 colorTransform schedule (SPRITE5_ALPHA_TWEEN above).
    const sprite5Sym: SymbolDefinition = {
      name: "sprite5",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach six sprite4 instances matching the PlaceObject2 placements
            // inside sprite5's authored timeline (parentSpriteId === 5).
            // depth 1: scaleX=scaleY=0.619, tx=-11, ty=2.6
            const c1 = clip.attach(sprite4Sym, "drop1", 1, ctx);
            c1.x = -11;
            c1.y = 2.6;
            c1.scaleX = 0.6192626953125;
            c1.scaleY = 0.6192626953125;

            // depth 3: scaleX=scaleY=0.619, tx=7.35, ty=1.8
            const c3 = clip.attach(sprite4Sym, "drop3", 3, ctx);
            c3.x = 7.35;
            c3.y = 1.8;
            c3.scaleX = 0.6192626953125;
            c3.scaleY = 0.6192626953125;

            // depth 5: scaleX=scaleY=0.293, tx=-21.15, ty=1.9
            const c5 = clip.attach(sprite4Sym, "drop5", 5, ctx);
            c5.x = -21.15;
            c5.y = 1.9;
            c5.scaleX = 0.292877197265625;
            c5.scaleY = 0.292877197265625;

            // depth 7: scaleX=scaleY=0.293, tx=19.55, ty=0.25
            const c7 = clip.attach(sprite4Sym, "drop7", 7, ctx);
            c7.x = 19.55;
            c7.y = 0.25;
            c7.scaleX = 0.292877197265625;
            c7.scaleY = 0.292877197265625;

            // depth 9: scaleX=scaleY=0.207, tx=-11.25, ty=-5.2
            const c9 = clip.attach(sprite4Sym, "drop9", 9, ctx);
            c9.x = -11.25;
            c9.y = -5.2;
            c9.scaleX = 0.20703125;
            c9.scaleY = 0.20703125;

            // depth 11: scaleX=scaleY=0.293, tx=13.95, ty=-5.25
            const c11 = clip.attach(sprite4Sym, "drop11", 11, ctx);
            c11.x = 13.95;
            c11.y = -5.25;
            c11.scaleX = 0.292877197265625;
            c11.scaleY = 0.292877197265625;
          },
        ],
      ]),
    };

    // ---- sprite16 — rotating blob layer ------------------------
    // AS DefineSprite_16/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(30));
    const sprite16Sym: SymbolDefinition = {
      name: "sprite16",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_16/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
      },
    };

    // ---- sprite17 — blob flash layer ---------------------------
    // AS DefineSprite_17/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(30));
    const sprite17Sym: SymbolDefinition = {
      name: "sprite17",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_17/frame_1/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
      },
    };

    // ---- sprite18 — scaling glow ring --------------------------
    // AS DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as
    //   t = 80 + random(50); _xscale = t; _yscale = t;
    const sprite18Sym: SymbolDefinition = {
      name: "sprite18",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ---- sprite19 — pulsing blade ------------------------------
    // AS DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _rotation = random(360) - 90; _alpha = random(50) + 40; i = Math.random()*6;
    // AS DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _xscale = 100 * Math.sin(i += 0.1);
    const sprite19Sym: SymbolDefinition = {
      name: "sprite19",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_19/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        i += 0.1;
        clip.vars.i = i;
        clip.scaleX = (100 * Math.sin(i)) / 100;
      },
    };

    // ---- sprite20 — flickering glow (superseded) ----------------
    // AS DefineSprite_20/frame_1/PlaceObject2_16_1 had a standalone
    //   _alpha = random(170);
    // clip event, but the shipped model folds sprite20 into sprite21 as
    // its authored child (see the sprite21 block below), so the standalone
    // definition is not built — a second `sprite20` symbol would collide
    // by name in the registry.

    // ---- sprite21 — spiralling orb -----------------------------
    // AS DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(load).as
    //   p=0; i=0; v2=0.067+0.067*Math.random(); _rotation=random(360);
    //   _alpha=120; _parent._alpha=10; v=0.3+0.67*Math.random();
    // AS DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if (_Y > -50 & _parent._alpha < 100) { _parent._alpha += 6.67; }
    //   if (_Y < -50) { _parent._alpha -= 6.67;
    //     if (_parent._alpha < 0) { _parent._visible=0; this.stop=1;
    //                               _parent.removeMovieClip(); } }
    //   _rotation = _rotation + 1.33;
    //   _Y = 5*Math.cos(i) + (p -= v);
    //   _X = 25*Math.sin(i += v2);
    //   if (Math.cos(i) < 0) { _alpha = 80*Math.cos(i)+100; }
    //
    // Note: sprite21's child inside sprite20 holds these handlers.
    // The outer sprite20 clip is the _parent referenced for _alpha/_visible.
    // We model this by having sprite20 as the wrapping sym and sprite21
    // inside it — but since the runtime attaches sprite21 at depths 14/16/18
    // of sprite22 (parentSpriteId=22 in manifest), and the sprite20 wrapper
    // is placed inside sprite21 (parentSpriteId=21), we build the nesting:
    //   sprite22 → sprite21 (the outer wrapper) → sprite20 (the content, 
    //                placed at depth 1 in sprite21's authored timeline)
    //
    // In AS the clip with the enterFrame IS the sprite20 child placed inside
    // sprite21. The _parent references sprite21. We replicate: sprite20 onLoad
    // and onEnterFrame operate on sprite20 clip; _parent = sprite21 clip.

    const sprite20Sym: SymbolDefinition = {
      name: "sprite20",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(load).as
        // (sprite20 is the child placed inside sprite21; _parent === sprite21)
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.067 + 0.067 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        // _parent._alpha = 10
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.67 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const parent = clip.parent;
        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v2 = clip.vars.v2 as number;
        const v = clip.vars.v as number;

        if (clip.y > -50 && parent && parent.alpha < 100 / 100) {
          parent.alpha += 6.67 / 100;
        }
        if (clip.y < -50 && parent) {
          parent.alpha -= 6.67 / 100;
          if (parent.alpha < 0) {
            parent.visible = false;
            parent.remove();
          }
        }
        // _rotation = _rotation + 1.33 (degrees)
        clip.rotation += (1.33 * Math.PI) / 180;
        p -= v;
        clip.vars.p = p;
        // _Y = 5*Math.cos(i) + p
        clip.y = 5 * Math.cos(i) + p;
        // _X = 25*Math.sin(i += v2)
        i += v2;
        clip.vars.i = i;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // _alpha = 80*Math.cos(i)+100 (AS 0-100 scale)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
      onEnterFrame_dummy: undefined as unknown,
    } as unknown as SymbolDefinition;

    // Rebuild without dummy field — TypeScript spread workaround
    const sprite20SymClean: SymbolDefinition = {
      name: sprite20Sym.name,
      totalFrames: sprite20Sym.totalFrames,
      frames: sprite20Sym.frames,
      anchorX: sprite20Sym.anchorX,
      anchorY: sprite20Sym.anchorY,
      onLoad: sprite20Sym.onLoad,
      onEnterFrame: sprite20Sym.onEnterFrame,
    };

    // ---- sprite21 — outer orb wrapper  -------------------------
    // directlyDynamic: true in manifest but its scripts dir is actually
    // DefineSprite_21 which holds PlaceObject2_20_1 (sprite20) handlers above.
    // sprite21 itself places sprite20 at depth 1 (scale 0.625) in its own
    // frame_1 timeline. No own onLoad/onEnterFrame on sprite21 itself.
    const sprite21Sym: SymbolDefinition = {
      name: "sprite21",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Placement from manifest: sprite20 at depth 1 inside sprite21.
            // matrix: scaleX=scaleY=0.625, tx=-0.05, ty=-0.1
            const child = clip.attach(sprite20SymClean, "inner", 1, ctx);
            child.x = -0.05;
            child.y = -0.1;
            child.scaleX = 0.625;
            child.scaleY = 0.625;
          },
        ],
      ]),
    };

    // ---- sprite22 — outermost 306-frame container --------------
    // Hosts the whole spell. Placements from manifest:
    //   depth 2:  sprite5  at frame 3, alpha-tweened 3→198
    //   depth 14: sprite21 at frame 3
    //   depth 16: sprite21 at frame 24
    //   depth 18: sprite21 at frame 48
    // plus implicit placements for sprite16/17/18/19 carried in the authored
    // anim1 composite SVG frames (we don't need to attach those via frameScripts
    // since they are pre-rendered in anim1; however the directlyDynamic variants
    // must be live-attached so their clip events run).
    //
    // For the dynamically-placed children (directlyDynamic) we attach them at
    // the correct parent frames via frameScripts. The alpha tween for sprite5
    // (depth 2) is applied each tick via the onEnterFrame handler on sprite22
    // looking up the SPRITE5_ALPHA_TWEEN schedule.
    //
    // Frame scripts (0-based):
    //   frame 2  (AS frame 3)  → attach sprite5 + sprite21 (depth 14)
    //   frame 18 (AS frame 19) → playSound + signalHit
    //   frame 23 (AS frame 24) → attach sprite21 (depth 16)
    //   frame 47 (AS frame 48) → attach sprite21 (depth 18)
    //   frame 105 (AS frame 106) → playSound
    //   frame 195 (AS frame 196) → playSound
    //   frame 303 (AS frame 304) → _parent.removeMovieClip() → complete()

    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 306,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor({
        width: 58.95,
        height: 46.3,
        offsetX: -22.6,
        offsetY: -30.3,
      }).x,
      anchorY: calculateAnchor({
        width: 58.95,
        height: 46.3,
        offsetX: -22.6,
        offsetY: -30.3,
      }).y,
      onEnterFrame: (clip) => {
        // Drive the alpha tween on the sprite5 child (depth 2).
        // The manifest encodes a PlaceObject2 colorTransform alphaMult
        // schedule; we reproduce it by looking up the current frame.
        const sprite5Child = clip.children.get("sprite5_d2");
        if (sprite5Child) {
          const alphaMult = SPRITE5_ALPHA_TWEEN.get(clip.currentFrame);
          if (alphaMult !== undefined) {
            sprite5Child.alpha = alphaMult / 256;
          }
        }
      },
      frameScripts: new Map([
        [
          2,
          (clip, ctx) => {
            // AS frame 3: place sprite5 at depth 2; place sprite21 at depth 14.
            // sprite5 initial alpha = alphaMult=13/256 (from placements[0])
            const s5 = clip.attach(sprite5Sym, "sprite5_d2", 2, ctx);
            s5.x = -0.6;
            s5.y = -1.4;
            s5.alpha = 13 / 256;

            // sprite21 at depth 14; matrix tx=-0.05, ty=-0.1
            const s21a = clip.attach(sprite21Sym, "sprite21_d14", 14, ctx);
            s21a.x = -0.05;
            s21a.y = -0.1;
          },
        ],
        [
          18,
          () => {
            // AS DefineSprite_22/frame_19/DoAction.as
            // SOMA.playSound("sacrieur_1054");
            this.playSound?.("sacrieur_1054");
            this.runtime.signalHit();
          },
        ],
        [
          23,
          (clip, ctx) => {
            // AS frame 24: place sprite21 at depth 16
            const s21b = clip.attach(sprite21Sym, "sprite21_d16", 16, ctx);
            s21b.x = -0.05;
            s21b.y = -0.1;
          },
        ],
        [
          47,
          (clip, ctx) => {
            // AS frame 48: place sprite21 at depth 18
            const s21c = clip.attach(sprite21Sym, "sprite21_d18", 18, ctx);
            s21c.x = -0.05;
            s21c.y = -0.1;
          },
        ],
        [
          105,
          () => {
            // AS DefineSprite_22/frame_106/DoAction.as
            // SOMA.playSound("sacrieur_1054");
            this.playSound?.("sacrieur_1054");
          },
        ],
        [
          195,
          () => {
            // AS DefineSprite_22/frame_196/DoAction.as
            // SOMA.playSound("sacrieur_1054");
            this.playSound?.("sacrieur_1054");
          },
        ],
        [
          303,
          (clip) => {
            // AS DefineSprite_22/frame_304/DoAction.as
            // _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(sprite4Sym);
    this.registry.register(sprite5Sym);
    this.registry.register(sprite16Sym);
    this.registry.register(sprite17Sym);
    this.registry.register(sprite18Sym);
    this.registry.register(sprite19Sym);
    this.registry.register(sprite20SymClean);
    this.registry.register(sprite21Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture callbacks.playSound so frameScripts inside sprite22 can use it.
    this.playSound = callbacks.playSound;
    // Attach the outermost sprite22 container at root.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
