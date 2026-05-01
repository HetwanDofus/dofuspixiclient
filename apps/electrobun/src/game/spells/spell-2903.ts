/**
 * Spell 2903 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2903/scripts/scripts/
 *
 * displayType=11 (TargetCell). Pure impact at target cell — no projectile motion.
 * DefineSprite_31 is the outer 97-frame container. It runs a fireworks rocket (boule /
 * sprite26) that travels upward via an authored keyframe tween, then at frame 76 the
 * boule onLoad attaches `feux` burst instances. Each `feux` (DefineSprite_23) selects
 * one of five inner particle variants based on level (gotoAndStop(level+1)), and those
 * inner particles spawn minifeux/minifeux2/minifeux3/minifeux4 sub-sparks at the sprite31
 * grandparent level.
 *
 * Library symbols registered:
 *   - minifeux  (DefineSprite_8)  — 36fr spark. alpha=150 fade 3.34/frame, x drift.
 *   - minifeux2 (DefineSprite_7)  — 36fr spark. alpha=random(150) fade 3.34/frame, x drift.
 *   - minifeux3 (DefineSprite_6)  — 78fr trail. alpha flicker on parent, fade 1.6/frame,
 *                                   x drift with 0.85 friction.
 *   - minifeux4 (DefineSprite_3)  — 78fr large particle. angle/rotation physics,
 *                                   alpha decay, spiral drift.
 *   - feux      (DefineSprite_23) — 16fr burst. frame_1 gotoAndStop(level+1), attaches
 *                                   one of five inner dynamic sub-clips.
 *   - sprite26  (DefineSprite_26) — boule rocket. onLoad: c=1 + attaches feux children
 *                                   (from DefineSprite_31/frame_76 placement onLoad).
 *                                   onEnterFrame: randomly rotates +100deg, spawns minifeux.
 *   - sprite31  (DefineSprite_31) — outer 97fr container, main orchestrator.
 *
 * signalHit: frame_70 (explosion sound).
 * complete:  frame_97 (stop()).
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

const MINIFEUX_BOUNDS  = { width: 2.45,  height: 2.05,  offsetX:  0.2,   offsetY: -1.2  };
const MINIFEUX2_BOUNDS = { width: 2.45,  height: 2.05,  offsetX:  0.2,   offsetY: -1.2  };
const MINIFEUX3_BOUNDS = { width: 2.45,  height: 2.05,  offsetX:  0.2,   offsetY: -1.2  };
const MINIFEUX4_BOUNDS = { width: 5.35,  height: 6.6,   offsetX: -1.25,  offsetY: -2.85 };
const FEUX_BOUNDS      = { width: 48.25, height: 53.3,  offsetX: -18.65, offsetY: -26.75 };
const SPRITE26_BOUNDS  = { width: 3.75,  height: 3.75,  offsetX: -1.4,   offsetY: -1.85 };

/** Authored tween keyframes for the boule (sprite26) inside DefineSprite_31. */
const BOULE_TWEEN: ReadonlyArray<{ f: number; x: number; y: number; sx: number; sy: number }> = [
  { f: 0,  x: -0.75, y: -53.25,  sx: 0.574462890625,      sy: 12.94549560546875   },
  { f: 3,  x: -0.75, y: -85.25,  sx: 0.574462890625,      sy: 2.739013671875      },
  { f: 4,  x: -0.8,  y: -87.65,  sx: 0.594482421875,      sy: 2.6572265625        },
  { f: 5,  x: -0.8,  y: -89.95,  sx: 0.6140289306640625,  sy: 2.5773468017578125  },
  { f: 6,  x: -0.85, y: -92.2,   sx: 0.633087158203125,   sy: 2.49945068359375    },
  { f: 7,  x: -0.85, y: -94.45,  sx: 0.6516571044921875,  sy: 2.423553466796875   },
  { f: 8,  x: -0.85, y: -96.55,  sx: 0.6697540283203125,  sy: 2.3496246337890625  },
  { f: 9,  x: -0.9,  y: -98.6,   sx: 0.6873626708984375,  sy: 2.27764892578125    },
  { f: 10, x: -0.9,  y: -100.6,  sx: 0.7044830322265625,  sy: 2.2076416015625     },
  { f: 11, x: -0.9,  y: -102.55, sx: 0.72113037109375,    sy: 2.1396484375        },
  { f: 12, x: -0.95, y: -104.45, sx: 0.7372894287109375,  sy: 2.0736083984375     },
  { f: 13, x: -0.95, y: -106.3,  sx: 0.7529754638671875,  sy: 2.0095062255859375  },
  { f: 14, x: -1.0,  y: -108.1,  sx: 0.7681732177734375,  sy: 1.9473876953125     },
  { f: 15, x: -1.0,  y: -109.85, sx: 0.78289794921875,    sy: 1.8872528076171875  },
  { f: 16, x: -1.0,  y: -111.5,  sx: 0.797119140625,      sy: 1.8291168212890625  },
  { f: 17, x: -1.05, y: -113.15, sx: 0.8108673095703125,  sy: 1.77294921875       },
  { f: 18, x: -1.1,  y: -114.7,  sx: 0.8241424560546875,  sy: 1.718658447265625   },
  { f: 19, x: -1.05, y: -116.15, sx: 0.8369293212890625,  sy: 1.6664581298828125  },
  { f: 20, x: -1.05, y: -117.65, sx: 0.8492279052734375,  sy: 1.616180419921875   },
  { f: 21, x: -1.1,  y: -119.05, sx: 0.861053466796875,   sy: 1.5678253173828125  },
  { f: 22, x: -1.1,  y: -120.35, sx: 0.87237548828125,    sy: 1.5215606689453125  },
  { f: 23, x: -1.1,  y: -121.6,  sx: 0.88323974609375,    sy: 1.4771270751953125  },
  { f: 24, x: -1.1,  y: -122.85, sx: 0.89361572265625,    sy: 1.43475341796875    },
  { f: 25, x: -1.2,  y: -124.05, sx: 0.90350341796875,    sy: 1.3943328857421875  },
  { f: 26, x: -1.15, y: -125.15, sx: 0.9129180908203125,  sy: 1.355926513671875   },
  { f: 27, x: -1.15, y: -126.15, sx: 0.921844482421875,   sy: 1.3194427490234375  },
  { f: 28, x: -1.15, y: -127.2,  sx: 0.9302825927734375,  sy: 1.284912109375      },
  { f: 29, x: -1.2,  y: -128.15, sx: 0.9382476806640625,  sy: 1.2523956298828125  },
  { f: 30, x: -1.2,  y: -129.0,  sx: 0.9457244873046875,  sy: 1.2218017578125     },
  { f: 31, x: -1.2,  y: -129.85, sx: 0.9527130126953125,  sy: 1.1932220458984375  },
  { f: 32, x: -1.2,  y: -130.55, sx: 0.959228515625,      sy: 1.166595458984375   },
  { f: 33, x: -1.2,  y: -131.3,  sx: 0.9652557373046875,  sy: 1.1419830322265625  },
  { f: 34, x: -1.2,  y: -131.95, sx: 0.9708099365234375,  sy: 1.119293212890625   },
  { f: 35, x: -1.2,  y: -132.55, sx: 0.9758758544921875,  sy: 1.098602294921875   },
  { f: 36, x: -1.3,  y: -133.05, sx: 0.98046875,          sy: 1.0798797607421875  },
  { f: 37, x: -1.25, y: -133.6,  sx: 0.98455810546875,    sy: 1.0631103515625     },
  { f: 38, x: -1.25, y: -134.0,  sx: 0.9881744384765625,  sy: 1.0483245849609375  },
  { f: 39, x: -1.25, y: -134.4,  sx: 0.9913177490234375,  sy: 1.035491943359375   },
  { f: 40, x: -1.25, y: -134.7,  sx: 0.9939727783203125,  sy: 1.024658203125      },
  { f: 41, x: -1.25, y: -134.9,  sx: 0.9961395263671875,  sy: 1.01580810546875    },
  { f: 42, x: -1.25, y: -135.1,  sx: 0.997833251953125,   sy: 1.0088653564453125  },
  { f: 43, x: -1.25, y: -135.3,  sx: 0.9990386962890625,  sy: 1.0039825439453125  },
  { f: 44, x: -1.25, y: -135.3,  sx: 0.999755859375,      sy: 1.0009613037109375  },
  { f: 45, x: -1.25, y: -135.35, sx: 1,                   sy: 1                   },
  { f: 47, x: -1.25, y: -135.3,  sx: 1,                   sy: 1                   },
  { f: 48, x: -1.25, y: -135.25, sx: 1,                   sy: 1                   },
  { f: 49, x: -1.25, y: -135.2,  sx: 1,                   sy: 1                   },
  { f: 50, x: -1.25, y: -135.15, sx: 1,                   sy: 1                   },
  { f: 51, x: -1.25, y: -135.05, sx: 1,                   sy: 1                   },
  { f: 52, x: -1.25, y: -134.9,  sx: 1,                   sy: 1                   },
  { f: 53, x: -1.25, y: -134.8,  sx: 1,                   sy: 1                   },
  { f: 54, x: -1.25, y: -134.65, sx: 1,                   sy: 1                   },
  { f: 55, x: -1.25, y: -134.45, sx: 1,                   sy: 1                   },
  { f: 56, x: -1.25, y: -134.3,  sx: 1,                   sy: 1                   },
  { f: 57, x: -1.25, y: -134.1,  sx: 1,                   sy: 1                   },
  { f: 58, x: -1.25, y: -133.85, sx: 1,                   sy: 1                   },
  { f: 59, x: -1.25, y: -133.65, sx: 1,                   sy: 1                   },
  { f: 60, x: -1.25, y: -133.35, sx: 1,                   sy: 1                   },
  { f: 61, x: -1.25, y: -133.1,  sx: 1,                   sy: 1                   },
  { f: 62, x: -1.25, y: -132.8,  sx: 1,                   sy: 1                   },
  { f: 63, x: -1.25, y: -132.5,  sx: 1,                   sy: 1                   },
  { f: 64, x: -1.25, y: -132.2,  sx: 1,                   sy: 1                   },
  { f: 65, x: -1.25, y: -131.85, sx: 1,                   sy: 1                   },
  { f: 66, x: -1.25, y: -131.5,  sx: 1,                   sy: 1                   },
  { f: 67, x: -1.25, y: -131.1,  sx: 1,                   sy: 1                   },
  { f: 68, x: -1.25, y: -130.7,  sx: 1,                   sy: 1                   },
  { f: 69, x: -1.25, y: -130.3,  sx: 1,                   sy: 1                   },
  { f: 70, x: -1.25, y: -129.85, sx: 1,                   sy: 1                   },
  { f: 71, x: -1.25, y: -129.4,  sx: 1,                   sy: 1                   },
  { f: 72, x: -1.25, y: -128.95, sx: 1,                   sy: 1                   },
];

const BOULE_TWEEN_MAP = new Map<number, { x: number; y: number; sx: number; sy: number }>();
for (const e of BOULE_TWEEN) {
  BOULE_TWEEN_MAP.set(e.f, e);
}

export class Spell2903 extends RuntimeSpell {
  readonly spellId = 2903;
  readonly displayType = SpellDisplayType.TargetCell;

  private minifeuxSym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private sprite31Sym!: SymbolDefinition;

  private playSoundFn: ((id: string) => void) | null = null;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const minifeuxAnchor  = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const feuxAnchor      = calculateAnchor(FEUX_BOUNDS);
    const sprite26Anchor  = calculateAnchor(SPRITE26_BOUNDS);

    // ----------------------------------------------------------------
    // lib_minifeux — DefineSprite_8_minifeux
    // AS: DefineSprite_8_minifeux/frame_1/DoAction.as
    //     DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_8_minifeux/frame_34/DoAction.as
    // ----------------------------------------------------------------
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): _alpha = 150; v = Math.random();
        clip.alpha = 150 / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _alpha -= 3.34; _X += v;
        clip.alpha -= 3.34 / 100;
        const v = clip.vars.v as number;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as:
            // _rotation = random(360);
            // _X = _parent.boule._x; _Y = _parent.boule._y;
            // (position set by spawner; only rotation here)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux2 — DefineSprite_7_minifeux2
    // AS: DefineSprite_7_minifeux2/frame_1/DoAction.as
    //     DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_7_minifeux2/frame_34/DoAction.as
    // ----------------------------------------------------------------
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): _alpha = random(150); v = Math.random();
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _alpha -= 3.34; _X += v;
        clip.alpha -= 3.34 / 100;
        const v = clip.vars.v as number;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_1/DoAction.as: _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux3 — DefineSprite_6_minifeux3
    // AS: DefineSprite_6_minifeux3/frame_1/DoAction.as
    //     DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_6_minifeux3/frame_76/DoAction.as
    // ----------------------------------------------------------------
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): _alpha = random(150); v = 0.67 + 1 * Math.random();
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _parent._alpha = random(100);
        //   _alpha -= 1.6;
        //   _X += (v *= 0.85);
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        clip.alpha -= 1.6 / 100;
        let v = clip.vars.v as number;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_1/DoAction.as: _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux4 — DefineSprite_3_minifeux4
    // AS: DefineSprite_3_minifeux4/frame_1/DoAction.as (empty)
    //     DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_3_minifeux4/frame_76/DoAction.as
    // ----------------------------------------------------------------
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   angle = 90; _alpha = random(150);
        //   v = -1.6 - 3.34 * Math.random();
        //   vr = -0.5 + Math.random();
        clip.vars.angle = 90;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _rotation = angle * 57.29746936176985;
        //   angle += vr;
        //   _parent._alpha = random(100);
        //   _alpha -= 1.6;
        //   _Y += (v *= 0.85);
        //   vx = v * Math.cos(angle); vy = v * Math.sin(angle);
        //   _X += vx; _Y += vy;
        // Note: angle is in radians; *57.29... converts to Flash degrees.
        // In our runtime clip.rotation is in radians, so clip.rotation = angle directly.
        let angle = clip.vars.angle as number;
        clip.rotation = angle;
        const vr = clip.vars.vr as number;
        angle += vr;
        clip.vars.angle = angle;
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        clip.alpha -= 1.6 / 100;
        let v = clip.vars.v as number;
        v *= 0.85;
        clip.vars.v = v;
        clip.y += v;
        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
      },
      frameScripts: new Map([
        [
          75,
          (clip) => {
            // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // Inner sub-clip symbols for DefineSprite_23_feux.
    // Each is a dynamic inner clip placed at a specific feux frame via
    // PlaceObject2 with onClipEvent handlers. Not in librarySymbols[].
    // ----------------------------------------------------------------

    // feux/frame_2 inner — PlaceObject2_12_1
    // AS: DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxInner2Sym: SymbolDefinition = {
      name: "_feuxInner2",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   _parent._rotation = random(360);
        //   vg=-6*random; g=1*random; va=0;
        //   t=100+random(100); scale=t;
        //   dmax=100; _X=10+random(20); d=dmax-random(70);
        //   acc=3.34+random*5; vacc=1+1*random;
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -6 * Math.random();
        clip.vars.g = 1 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 3.34 + Math.random() * 5;
        clip.vars.vacc = 1 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _rotation = random(360); t = 20+random(80);
        //   scale=t; _parent._y += g;
        //   _alpha = 150 - (va += vacc);
        //   _X -= (_X-d)/acc;
        //   if(_alpha < 0) _parent.removeMovieClip();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const t = 20 + Math.floor(Math.random() * 80);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        va += vacc;
        clip.vars.va = va;
        clip.alpha = (150 - va) / 100;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        clip.x -= (clip.x - d) / acc;
        if (clip.alpha < 0) {
          clip.parent?.remove();
        }
      },
    };

    // feux/frame_5 inner — PlaceObject2_14_1
    // AS: DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxInner5Sym: SymbolDefinition = {
      name: "_feuxInner5",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   _parent._rotation = random(360);
        //   vg=-9*random; g=0.6*random; va=0;
        //   t=200+random(100); scale=t;
        //   dmax=100; _X=10+random(20); d=dmax-random(70);
        //   acc=1.67+random*5; vacc=1+1*random;
        if (clip.parent) {
          clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        }
        clip.vars.vg = -9 * Math.random();
        clip.vars.g = 0.6 * Math.random();
        clip.vars.va = 0;
        const t = 200 + Math.floor(Math.random() * 100);
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = 10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 1.67 + Math.random() * 5;
        clip.vars.vacc = 1 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _rotation += t/6; t--;
        //   scale=t/3; _parent._y += g;
        //   _X -= (_X-d)/acc; if(t<0) _parent.removeMovieClip();
        let t = clip.vars.t as number;
        clip.rotation += ((t / 6) * Math.PI) / 180;
        t--;
        clip.vars.t = t;
        clip.scaleX = t / 3 / 100;
        clip.scaleY = t / 3 / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        clip.x -= (clip.x - d) / acc;
        if (t < 0) {
          clip.parent?.remove();
        }
      },
    };

    // feux/frame_8 inner — PlaceObject2_12_1
    // AS: DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxInner8Sym: SymbolDefinition = {
      name: "_feuxInner8",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   vg=-9*random; g=0.67*random; va=0;
        //   t=100+random(100); scale=t;
        //   dmax=100; d=dmax-random(70);
        //   acc=1.67+random*5; vacc=1+1*random;
        //   vx=10*(-0.5+random); vy=10*(-0.5+random);
        //   accx=0.8+0.1*random; accy=0.8+0.1*random; c=0;
        clip.vars.vg = -9 * Math.random();
        clip.vars.g = 0.67 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 1.67 + Math.random() * 5;
        clip.vars.vacc = 1 + 1 * Math.random();
        clip.vars.vx = 10 * (-0.5 + Math.random());
        clip.vars.vy = 10 * (-0.5 + Math.random());
        clip.vars.accx = 0.8 + 0.1 * Math.random();
        clip.vars.accy = 0.8 + 0.1 * Math.random();
        clip.vars.c = 0;
        clip.vars.compte = Math.floor(Math.random() * 200000);
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if(random(15)==1) { spawn minifeux2 at _parent._parent; compte=random(200000); }
        //   _rotation += t/3; t--; scale=t/3;
        //   _parent._y += g; _X+=(vx*=accx); _Y+=(vy*=accy);
        //   if(t<0) _parent.removeMovieClip();
        if (Math.floor(Math.random() * 15) === 1) {
          // From inner's perspective: _parent=feux, _parent._parent=boule, _parent._parent._parent=sprite31
          const feuxClip = clip.parent;
          const sprite31 = feuxClip?.parent?.parent;
          if (sprite31) {
            const compte = clip.vars.compte as number;
            let c = clip.vars.c as number;
            const spawned = sprite31.attach(
              this.minifeux2Sym,
              "minifeux2_" + compte,
              compte,
              this.runtime.context
            );
            spawned.x = clip.x;
            if (feuxClip) {
              spawned.y = clip.y + feuxClip.y;
            }
            spawned.alpha = (100 - c) / 100;
            c++;
            clip.vars.c = c;
            clip.vars.compte = Math.floor(Math.random() * 200000);
          }
        }
        let t = clip.vars.t as number;
        clip.rotation += ((t / 3) * Math.PI) / 180;
        t--;
        clip.vars.t = t;
        clip.scaleX = t / 3 / 100;
        clip.scaleY = t / 3 / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const accx = clip.vars.accx as number;
        const accy = clip.vars.accy as number;
        vx *= accx;
        vy *= accy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.x += vx;
        clip.y += vy;
        if (t < 0) {
          clip.parent?.remove();
        }
      },
    };

    // feux/frame_11 inner — PlaceObject2_19_1
    // AS: DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxInner11Sym: SymbolDefinition = {
      name: "_feuxInner11",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   stop(); vg=-9*random; g=0.67*random; va=0;
        //   t=100+random(100); scale=t; dmax=100;
        //   _X=-10+random(20); d=dmax-random(70);
        //   acc=1.67+random*5; vacc=1.5+1.5*random;
        //   vx=20*(-0.5+random); vy=20*(-0.5+random);
        //   accx=0.8+0.1*random; accy=0.8+0.1*random; c=0;
        clip.stop();
        clip.vars.vg = -9 * Math.random();
        clip.vars.g = 0.67 * Math.random();
        clip.vars.va = 0;
        const t = 100 + Math.floor(Math.random() * 100);
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.dmax = 100;
        clip.x = -10 + Math.floor(Math.random() * 20);
        clip.vars.d = 100 - Math.floor(Math.random() * 70);
        clip.vars.acc = 1.67 + Math.random() * 5;
        clip.vars.vacc = 1.5 + 1.5 * Math.random();
        clip.vars.vx = 20 * (-0.5 + Math.random());
        clip.vars.vy = 20 * (-0.5 + Math.random());
        clip.vars.accx = 0.8 + 0.1 * Math.random();
        clip.vars.accy = 0.8 + 0.1 * Math.random();
        clip.vars.c = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   if(t<150) play(); if(t<135) { spawn 9 minifeux3; _parent.removeMovieClip(); }
        //   _rotation += t/3; t--; scale=t/3;
        //   _parent._y += g; _X+=(vx*=accx); _Y+=(vy*=accy);
        let t = clip.vars.t as number;
        if (t < 150) {
          clip.play();
        }
        if (t < 135) {
          const feuxClip = clip.parent;
          const sprite31 = feuxClip?.parent?.parent;
          if (sprite31) {
            let c = clip.vars.c as number;
            for (let nbr = 1; nbr < 10; nbr++) {
              const compte = Math.floor(Math.random() * 200000);
              const spawned = sprite31.attach(
                this.minifeux3Sym,
                "minifeux3_" + compte,
                compte,
                this.runtime.context
              );
              spawned.x = clip.x;
              if (feuxClip) {
                spawned.y = clip.y + feuxClip.y;
              }
              spawned.alpha = (100 - c) / 100;
              c++;
            }
            clip.vars.c = c;
          }
          clip.parent?.remove();
          return;
        }
        clip.rotation += ((t / 3) * Math.PI) / 180;
        t--;
        clip.vars.t = t;
        clip.scaleX = t / 3 / 100;
        clip.scaleY = t / 3 / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const accx = clip.vars.accx as number;
        const accy = clip.vars.accy as number;
        vx *= accx;
        vy *= accy;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.x += vx;
        clip.y += vy;
      },
    };

    // feux/frame_14 inner — PlaceObject2_22_1
    // AS: DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxInner14Sym: SymbolDefinition = {
      name: "_feuxInner14",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   nbr=1; while(nbr<2) { spawn minifeux4 at _parent._parent; nbr++; }
        //   angle=-1.1415+0.2*(-0.5+random); vit=2+10*random;
        //   stop(); frein=0.9+0.05*random; vr=0; sz=240+random(120); frangle=1.2;
        const feuxClip = clip.parent;
        const sprite31 = feuxClip?.parent?.parent;
        if (sprite31) {
          for (let nbr = 1; nbr < 2; nbr++) {
            const compte = Math.floor(Math.random() * 300000);
            const spawned = sprite31.attach(
              this.minifeux4Sym,
              "minifeux4_" + compte,
              compte,
              this.runtime.context
            );
            spawned.x = clip.x;
            if (feuxClip) {
              spawned.y = clip.y + feuxClip.y;
            }
          }
        }
        clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
        clip.vars.vit = 2 + 10 * Math.random();
        clip.stop();
        clip.vars.frein = 0.9 + 0.05 * Math.random();
        clip.vars.vr = 0;
        clip.vars.sz = 240 + Math.floor(Math.random() * 120);
        clip.vars.frangle = 1.2;
        clip.vars.c = 0;
        // t is checked in enterFrame but not set in onLoad in canonical AS —
        // initialise high so conditions don't fire prematurely.
        clip.vars.t = 9999;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _rotation = angle*57.29...; _alpha=50+random(60);
        //   sz *= (frein+0.02); scale=sz;
        //   if(random(24)==1) vr = 0.67*(-0.5+random);
        //   angle += vr*frangle; frangle *= frein;
        //   vx=vit*cos(angle); vy=vit*sin(angle); _X+=vx; _Y+=vy; vit*=frein;
        //   if(t<150) play(); if(t<135) { spawn 9 minifeux3; _parent.removeMovieClip(); }
        let angle = clip.vars.angle as number;
        clip.rotation = angle; // angle in radians → direct assignment
        clip.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
        let sz = clip.vars.sz as number;
        const frein = clip.vars.frein as number;
        sz *= frein + 0.02;
        clip.vars.sz = sz;
        clip.scaleX = sz / 100;
        clip.scaleY = sz / 100;
        let vr = clip.vars.vr as number;
        if (Math.floor(Math.random() * 24) === 1) {
          vr = 0.67 * (-0.5 + Math.random());
        }
        clip.vars.vr = vr;
        let frangle = clip.vars.frangle as number;
        angle += vr * frangle;
        frangle *= frein;
        clip.vars.angle = angle;
        clip.vars.frangle = frangle;
        let vit = clip.vars.vit as number;
        const vx = vit * Math.cos(angle);
        const vy = vit * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
        vit *= frein;
        clip.vars.vit = vit;
        const t = clip.vars.t as number;
        if (t < 150) {
          clip.play();
        }
        if (t < 135) {
          const feuxClip = clip.parent;
          const sprite31 = feuxClip?.parent?.parent;
          if (sprite31) {
            let c = clip.vars.c as number;
            for (let nbr = 1; nbr < 10; nbr++) {
              const compte = Math.floor(Math.random() * 300000);
              const spawned = sprite31.attach(
                this.minifeux3Sym,
                "minifeux3_f14_" + compte,
                compte,
                this.runtime.context
              );
              spawned.x = clip.x;
              if (feuxClip) {
                spawned.y = clip.y + feuxClip.y;
              }
              spawned.alpha = (100 - c) / 100;
              c++;
            }
            clip.vars.c = c;
          }
          clip.parent?.remove();
        }
      },
    };

    // ----------------------------------------------------------------
    // lib_feux — DefineSprite_23_feux (16-frame burst)
    // AS: DefineSprite_23_feux/frame_1/DoAction.as:
    //     gotoAndStop(_parent._parent._parent.level + 1)
    // Chain: inner → feux → boule(sprite26) → sprite31 → root
    // So from feux frame_1: _parent = boule, _parent._parent = sprite31,
    // _parent._parent._parent = root (which has .level on vars).
    // ----------------------------------------------------------------
    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_23_feux/frame_1/DoAction.as:
            // gotoAndStop(_parent._parent._parent.level + 1)
            // feux._parent = boule, boule._parent = sprite31, sprite31._parent = root
            const level = (clip.parent?.parent?.parent?.vars.level as number) ?? 1;
            const targetFrameAS = level + 1; // 1-based AS frame
            clip.gotoAndStop(targetFrameAS - 1); // 0-based
            // Attach the inner dynamic clip for this level-selected frame.
            // AS frames 2,5,8,11,14 (1-based) → 0-based 1,4,7,10,13
            const f = clip.currentFrame;
            if (f === 1) {
              clip.attach(feuxInner2Sym, "inner", 1, ctx);
            } else if (f === 4) {
              clip.attach(feuxInner5Sym, "inner", 1, ctx);
            } else if (f === 7) {
              clip.attach(feuxInner8Sym, "inner", 1, ctx);
            } else if (f === 10) {
              clip.attach(feuxInner11Sym, "inner", 1, ctx);
            } else if (f === 13) {
              clip.attach(feuxInner14Sym, "inner", 1, ctx);
            } else {
              // Unknown level — fallback to frame_5 inner (level 4)
              clip.attach(feuxInner5Sym, "inner", 1, ctx);
            }
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite26 — DefineSprite_26 boule rocket (directlyDynamic)
    // AS: DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // PLUS when placed at sprite31/frame_76, PlaceObject2_28_3 onClipEvent(load) runs:
    //   sz = 60 + 20 * ((level-1) % 3); scale = sz;
    //   i=1; while(i < 6 + 7*((level-1)%3)) { this.attachMovie("feux","feux"+i,i); i++ }
    // We fold the frame_76 placement onLoad into the boule's onLoad since it is only
    // ever placed there.
    // ----------------------------------------------------------------
    const sprite26Sym: SymbolDefinition = {
      name: "sprite26",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(load).as
        // c = 1;
        clip.vars.c = 1;

        // AS DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
        // sprite26._parent = sprite31; sprite31._parent = root
        const sprite31 = clip.parent;
        const level = (sprite31?.parent?.vars.level as number) ?? 1;
        const sz = 60 + 20 * ((level - 1) % 3);
        clip.scaleX = sz / 100;
        clip.scaleY = sz / 100;
        const feuxCount = 6 + 7 * ((level - 1) % 3);
        for (let i = 1; i < feuxCount; i++) {
          clip.attach(this.feuxSym, "feux" + i, i, ctx);
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(random(2)==1) { _rotation += 100; _parent._parent.attachMovie("minifeux","minifeux"+c,c); c++; }
        // From the inner PlaceObject2's perspective: _parent=sprite26, _parent._parent=sprite31
        if (Math.floor(Math.random() * 2) === 1) {
          clip.rotation += (100 * Math.PI) / 180;
          const sprite31 = clip.parent;
          if (sprite31) {
            let c = clip.vars.c as number;
            const spawned = sprite31.attach(
              this.minifeuxSym,
              "minifeux" + c,
              c,
              this.runtime.context
            );
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as:
            // _X = _parent.boule._x; _Y = _parent.boule._y;
            spawned.x = clip.x;
            spawned.y = clip.y;
            c++;
            clip.vars.c = c;
          }
        }
      },
    };

    // ----------------------------------------------------------------
    // sprite31 — DefineSprite_31 (outer 97-frame container)
    // AS: DefineSprite_31/frame_1/DoAction.as   → SOMA.playSound("fireworks01")
    //     DefineSprite_31/frame_1/DoAction_2.as → taille/scale/rotation/compte
    //     DefineSprite_31/frame_70/DoAction.as  → SOMA.playSound("explo_fireworks")
    //     DefineSprite_31/frame_76             → places boule (sprite26) at depth 3
    //     DefineSprite_31/frame_97/DoAction.as  → stop()
    // The boule's authored tween (BOULE_TWEEN_MAP) updates boule.x/y/scaleX/scaleY
    // each frame via sprite31's onEnterFrame.
    // ----------------------------------------------------------------
    this.sprite31Sym = {
      name: "sprite31",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // Apply the authored tween for the boule if it exists.
        // The tween table uses local frame indices 0-72 relative to the boule's
        // placement, but the boule is placed at sprite31 frame_76 (0-based: 75).
        // So tween frame = sprite31.currentFrame - 75.
        const boule = clip.children.get("boule");
        if (boule) {
          const tweenFrame = clip.currentFrame - 75;
          const entry = BOULE_TWEEN_MAP.get(tweenFrame);
          if (entry) {
            boule.x = entry.x;
            boule.y = entry.y;
            boule.scaleX = entry.sx;
            boule.scaleY = entry.sy;
          }
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01");
            // (sound played from onSpellStart — already fired before sprite31 starts ticking)
            // AS DefineSprite_31/frame_1/DoAction_2.as:
            //   taille = 80 + random(40);
            //   _xscale = taille; _yscale = taille;
            //   _rotation = -20 + random(40);
            //   compte = 1;
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks");
            this.playSoundFn?.("explo_fireworks");
            this.runtime.signalHit();
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS DefineSprite_31/frame_76: PlaceObject2 places boule at depth 3.
            // Initial tween entry at tweenFrame=0 → BOULE_TWEEN_MAP.get(0).
            const entry = BOULE_TWEEN_MAP.get(0);
            clip.attach(sprite26Sym, "boule", 3, ctx, {
              x: entry?.x ?? -0.75,
              y: entry?.y ?? -53.25,
            });
            // Apply initial scale (authored tween frame 0 has extreme scaleY for trail effect).
            const boule = clip.children.get("boule");
            if (boule && entry) {
              boule.scaleX = entry.sx;
              boule.scaleY = entry.sy;
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_31/frame_97/DoAction.as: stop();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.minifeuxSym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.sprite31Sym);
    // sprite26Sym is used locally inside sprite31's frameScripts; we also register
    // it so the registry is complete if any code resolves it by name.
    this.registry.register(sprite26Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture sound callback for use in frame scripts (frame_70 explo sound).
    this.playSoundFn = callbacks.playSound;

    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01");
    callbacks.playSound("fireworks01");

    // Attach the outer sprite31 container at root. This starts the 97-frame
    // timeline ticking from the next runtime frame.
    this.root.attach(this.sprite31Sym, "sprite31", 1, context);
  }
}
