/**
 * Spell 2901 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2901/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a fireworks burst anchored at the
 * target cell. The outer container (DefineSprite_31) is a 97-frame sprite that:
 *   - frame_1:  plays sound "fireworks01", sets scale/rotation, places boule (sprite26)
 *   - frame_70: plays sound "explo_fireworks" → signalHit
 *   - frame_76: boule's onClipEvent(load) spawns feux*N inside boule
 *   - frame_97: stop() → complete()
 *
 * The "boule" (sprite26) rises via an authored per-frame tween (placements[]) and
 * has a clipEvent that randomly spawns minifeux sparks at the outer container level.
 *
 * The "feux" (DefineSprite_23) explosion composite uses gotoAndStop(level+1) to
 * select which particle emitter variant to activate, then has internal dynamic
 * children placed at frames 2, 5, 8, 11, 14 that spawn minifeux/minifeux2/
 * minifeux3/minifeux4 sub-particles at the outer container level.
 *
 * Library symbols:
 *   - lib_minifeux  — 36-frame spark, alpha from 150, fades -3.34/tick, drifts +v right. frame_34 removes.
 *   - lib_minifeux2 — 36-frame spark, alpha random(150), same physics. frame_34 removes.
 *   - lib_minifeux3 — 78-frame spark, alpha fades -1.6/tick, v*=0.85 drift, parent alpha flickers. frame_76 removes.
 *   - lib_minifeux4 — 78-frame ember, angle-based spiral, parent alpha flickers. frame_76 removes.
 *   - lib_feux      — 16-frame explosion composite with 5 internal dynamic child emitters.
 *   - lib_sprite26  — the "boule" rising ball with authored tween + clipEvent spark spawner.
 *
 * signalHit fires at the outer container's frame_70 (explo_fireworks moment).
 * complete() fires at the outer container's frame_96 (stop() = frame_97 in AS).
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

const MINIFEUX_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};
const MINIFEUX3_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};
const MINIFEUX4_BOUNDS = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};
const FEUX_BOUNDS = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};
const SPRITE26_BOUNDS = {
  width: 3.75,
  height: 3.75,
  offsetX: -1.4,
  offsetY: -1.85,
};

// Authored tween keyframes for the boule (sprite26) from manifest placements[].
// Each entry = { frame (0-based), translateX, translateY, scaleX, scaleY }
const BOULE_TWEEN: Array<{ f: number; tx: number; ty: number; sx: number; sy: number }> = [
  { f: 0,  tx: -0.75,  ty: -53.25,   sx: 0.574462890625,     sy: 12.94549560546875 },
  { f: 3,  tx: -0.75,  ty: -85.25,   sx: 0.574462890625,     sy: 2.739013671875 },
  { f: 4,  tx: -0.8,   ty: -87.65,   sx: 0.594482421875,     sy: 2.6572265625 },
  { f: 5,  tx: -0.8,   ty: -89.95,   sx: 0.6140289306640625, sy: 2.5773468017578125 },
  { f: 6,  tx: -0.85,  ty: -92.2,    sx: 0.633087158203125,  sy: 2.49945068359375 },
  { f: 7,  tx: -0.85,  ty: -94.45,   sx: 0.6516571044921875, sy: 2.423553466796875 },
  { f: 8,  tx: -0.85,  ty: -96.55,   sx: 0.6697540283203125, sy: 2.3496246337890625 },
  { f: 9,  tx: -0.9,   ty: -98.6,    sx: 0.6873626708984375, sy: 2.27764892578125 },
  { f: 10, tx: -0.9,   ty: -100.6,   sx: 0.7044830322265625, sy: 2.2076416015625 },
  { f: 11, tx: -0.9,   ty: -102.55,  sx: 0.72113037109375,   sy: 2.1396484375 },
  { f: 12, tx: -0.95,  ty: -104.45,  sx: 0.7372894287109375, sy: 2.0736083984375 },
  { f: 13, tx: -0.95,  ty: -106.3,   sx: 0.7529754638671875, sy: 2.0095062255859375 },
  { f: 14, tx: -1.0,   ty: -108.1,   sx: 0.7681732177734375, sy: 1.9473876953125 },
  { f: 15, tx: -1.0,   ty: -109.85,  sx: 0.78289794921875,   sy: 1.8872528076171875 },
  { f: 16, tx: -1.0,   ty: -111.5,   sx: 0.797119140625,     sy: 1.8291168212890625 },
  { f: 17, tx: -1.05,  ty: -113.15,  sx: 0.8108673095703125, sy: 1.77294921875 },
  { f: 18, tx: -1.1,   ty: -114.7,   sx: 0.8241424560546875, sy: 1.718658447265625 },
  { f: 19, tx: -1.05,  ty: -116.15,  sx: 0.8369293212890625, sy: 1.6664581298828125 },
  { f: 20, tx: -1.05,  ty: -117.65,  sx: 0.8492279052734375, sy: 1.616180419921875 },
  { f: 21, tx: -1.1,   ty: -119.05,  sx: 0.861053466796875,  sy: 1.5678253173828125 },
  { f: 22, tx: -1.1,   ty: -120.35,  sx: 0.87237548828125,   sy: 1.5215606689453125 },
  { f: 23, tx: -1.1,   ty: -121.6,   sx: 0.88323974609375,   sy: 1.4771270751953125 },
  { f: 24, tx: -1.1,   ty: -122.85,  sx: 0.89361572265625,   sy: 1.43475341796875 },
  { f: 25, tx: -1.2,   ty: -124.05,  sx: 0.90350341796875,   sy: 1.3943328857421875 },
  { f: 26, tx: -1.15,  ty: -125.15,  sx: 0.9129180908203125, sy: 1.355926513671875 },
  { f: 27, tx: -1.15,  ty: -126.15,  sx: 0.921844482421875,  sy: 1.3194427490234375 },
  { f: 28, tx: -1.15,  ty: -127.2,   sx: 0.9302825927734375, sy: 1.284912109375 },
  { f: 29, tx: -1.2,   ty: -128.15,  sx: 0.9382476806640625, sy: 1.2523956298828125 },
  { f: 30, tx: -1.2,   ty: -129.0,   sx: 0.9457244873046875, sy: 1.2218017578125 },
  { f: 31, tx: -1.2,   ty: -129.85,  sx: 0.9527130126953125, sy: 1.1932220458984375 },
  { f: 32, tx: -1.2,   ty: -130.55,  sx: 0.959228515625,     sy: 1.166595458984375 },
  { f: 33, tx: -1.2,   ty: -131.3,   sx: 0.9652557373046875, sy: 1.1419830322265625 },
  { f: 34, tx: -1.2,   ty: -131.95,  sx: 0.9708099365234375, sy: 1.119293212890625 },
  { f: 35, tx: -1.2,   ty: -132.55,  sx: 0.9758758544921875, sy: 1.098602294921875 },
  { f: 36, tx: -1.3,   ty: -133.05,  sx: 0.98046875,         sy: 1.0798797607421875 },
  { f: 37, tx: -1.25,  ty: -133.6,   sx: 0.98455810546875,   sy: 1.0631103515625 },
  { f: 38, tx: -1.25,  ty: -134.0,   sx: 0.9881744384765625, sy: 1.0483245849609375 },
  { f: 39, tx: -1.25,  ty: -134.4,   sx: 0.9913177490234375, sy: 1.035491943359375 },
  { f: 40, tx: -1.25,  ty: -134.7,   sx: 0.9939727783203125, sy: 1.024658203125 },
  { f: 41, tx: -1.25,  ty: -134.9,   sx: 0.9961395263671875, sy: 1.01580810546875 },
  { f: 42, tx: -1.25,  ty: -135.1,   sx: 0.997833251953125,  sy: 1.0088653564453125 },
  { f: 43, tx: -1.25,  ty: -135.3,   sx: 0.9990386962890625, sy: 1.0039825439453125 },
  { f: 44, tx: -1.25,  ty: -135.3,   sx: 0.999755859375,     sy: 1.0009613037109375 },
  { f: 45, tx: -1.25,  ty: -135.35,  sx: 1.0,                sy: 1.0 },
  { f: 47, tx: -1.25,  ty: -135.3,   sx: 1.0,                sy: 1.0 },
  { f: 48, tx: -1.25,  ty: -135.25,  sx: 1.0,                sy: 1.0 },
  { f: 49, tx: -1.25,  ty: -135.2,   sx: 1.0,                sy: 1.0 },
  { f: 50, tx: -1.25,  ty: -135.15,  sx: 1.0,                sy: 1.0 },
  { f: 51, tx: -1.25,  ty: -135.05,  sx: 1.0,                sy: 1.0 },
  { f: 52, tx: -1.25,  ty: -134.9,   sx: 1.0,                sy: 1.0 },
  { f: 53, tx: -1.25,  ty: -134.8,   sx: 1.0,                sy: 1.0 },
  { f: 54, tx: -1.25,  ty: -134.65,  sx: 1.0,                sy: 1.0 },
  { f: 55, tx: -1.25,  ty: -134.45,  sx: 1.0,                sy: 1.0 },
  { f: 56, tx: -1.25,  ty: -134.3,   sx: 1.0,                sy: 1.0 },
  { f: 57, tx: -1.25,  ty: -134.1,   sx: 1.0,                sy: 1.0 },
  { f: 58, tx: -1.25,  ty: -133.85,  sx: 1.0,                sy: 1.0 },
  { f: 59, tx: -1.25,  ty: -133.65,  sx: 1.0,                sy: 1.0 },
  { f: 60, tx: -1.25,  ty: -133.35,  sx: 1.0,                sy: 1.0 },
  { f: 61, tx: -1.25,  ty: -133.1,   sx: 1.0,                sy: 1.0 },
  { f: 62, tx: -1.25,  ty: -132.8,   sx: 1.0,                sy: 1.0 },
  { f: 63, tx: -1.25,  ty: -132.5,   sx: 1.0,                sy: 1.0 },
  { f: 64, tx: -1.25,  ty: -132.2,   sx: 1.0,                sy: 1.0 },
  { f: 65, tx: -1.25,  ty: -131.85,  sx: 1.0,                sy: 1.0 },
  { f: 66, tx: -1.25,  ty: -131.5,   sx: 1.0,                sy: 1.0 },
  { f: 67, tx: -1.25,  ty: -131.1,   sx: 1.0,                sy: 1.0 },
  { f: 68, tx: -1.25,  ty: -130.7,   sx: 1.0,                sy: 1.0 },
  { f: 69, tx: -1.25,  ty: -130.3,   sx: 1.0,                sy: 1.0 },
  { f: 70, tx: -1.25,  ty: -129.85,  sx: 1.0,                sy: 1.0 },
  { f: 71, tx: -1.25,  ty: -129.4,   sx: 1.0,                sy: 1.0 },
  { f: 72, tx: -1.25,  ty: -128.95,  sx: 1.0,                sy: 1.0 },
];

export class Spell2901 extends RuntimeSpell {
  readonly spellId = 2901;
  readonly displayType = SpellDisplayType.TargetCell;

  private minifeux1Sym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;
  private sprite26Sym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const minifeux1Anchor = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);
    const sprite26Anchor = calculateAnchor(SPRITE26_BOUNDS);

    // ---- lib_minifeux — short spark, alpha starts at 150, fades -3.34/tick, drifts right ----
    // AS: DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_8_minifeux/frame_1/DoAction.as
    //     DefineSprite_8_minifeux/frame_34/DoAction.as
    this.minifeux1Sym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeux1Anchor.x,
      anchorY: minifeux1Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 150; v = Math.random()
        clip.vars.alphaVal = 150;
        clip.alpha = 150 / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha -= 3.34; _X += v
        let alphaVal = clip.vars.alphaVal as number;
        alphaVal -= 3.34;
        clip.vars.alphaVal = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;
        clip.x += clip.vars.v as number;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as
            // _rotation = random(360)
            // _X = _parent.boule._x  (caller sets x/y via attach transform)
            // _Y = _parent.boule._y
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux2 — spark variant, alpha random(150), same drift physics ----
    // AS: DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_7_minifeux2/frame_1/DoAction.as
    //     DefineSprite_7_minifeux2/frame_34/DoAction.as
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux1Anchor.x,
      anchorY: minifeux1Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = random(150); v = Math.random()
        const alphaInit = Math.floor(Math.random() * 150);
        clip.vars.alphaVal = alphaInit;
        clip.alpha = alphaInit / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha -= 3.34; _X += v
        let alphaVal = clip.vars.alphaVal as number;
        alphaVal -= 3.34;
        clip.vars.alphaVal = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;
        clip.x += clip.vars.v as number;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_1/DoAction.as: _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux3 — longer spark, v*=0.85 drift, parent alpha flickers ----
    // AS: DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_6_minifeux3/frame_1/DoAction.as
    //     DefineSprite_6_minifeux3/frame_76/DoAction.as
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = random(150); v = 0.67 + 1 * Math.random()
        const alphaInit = Math.floor(Math.random() * 150);
        clip.vars.alphaVal = alphaInit;
        clip.alpha = alphaInit / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha = random(100); _alpha -= 1.6; _X += (v *= 0.85)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        let alphaVal = clip.vars.alphaVal as number;
        alphaVal -= 1.6;
        clip.vars.alphaVal = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;
        let v = clip.vars.v as number;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_1/DoAction.as: _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_minifeux4 — floating ember with angle-based spiral, parent alpha flickers ----
    // AS: DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_3_minifeux4/frame_1/DoAction.as (empty)
    //     DefineSprite_3_minifeux4/frame_76/DoAction.as
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // angle = 90 (radians context: AS stores this as a raw number used in sin/cos,
        //   then multiplies by 57.29... to assign _rotation in degrees)
        // _alpha = random(150); v = -1.6 - 3.34*Math.random(); vr = -0.5 + Math.random()
        clip.vars.angle = 90;
        const alphaInit = Math.floor(Math.random() * 150);
        clip.vars.alphaVal = alphaInit;
        clip.alpha = alphaInit / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = angle * 57.29746936176985  → angle (radians) * (180/PI) = degrees for Flash
        //   In TS: clip.rotation = angle (since angle is already in radians units here)
        // angle += vr
        // _parent._alpha = random(100)
        // _alpha -= 1.6
        // _Y += (v *= 0.85)
        // vx = v * cos(angle); vy = v * sin(angle)
        // _X += vx; _Y += vy
        let angle = clip.vars.angle as number;
        const vr = clip.vars.vr as number;
        // angle * 57.29... converts radians to degrees for Flash _rotation.
        // We set clip.rotation = the radian value directly.
        clip.rotation = angle;
        angle += vr;
        clip.vars.angle = angle;
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        let alphaVal = clip.vars.alphaVal as number;
        alphaVal -= 1.6;
        clip.vars.alphaVal = alphaVal;
        clip.alpha = Math.max(0, alphaVal) / 100;
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
          0,
          (_clip) => {
            // AS DefineSprite_3_minifeux4/frame_1/DoAction.as — empty
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- Internal feux child symbols — placed dynamically inside DefineSprite_23_feux ----
    // These are not named library exports; we model them as inline SymbolDefinitions
    // attached from the feux symbol's frameScripts.

    // feux internal child at frame_2 — spiral emitter, removes parent when alpha < 0
    // AS: DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxChild2Sym: SymbolDefinition = {
      name: "_feuxChild2",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
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
        // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = random(360); t = 20+random(80); _xscale = t; _yscale = t
        // _parent._y += g; _alpha = 150 - (va += vacc); _X -= (_X - d)/acc
        // if(_alpha < 0) _parent.removeMovieClip()
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        const tVal = 20 + Math.floor(Math.random() * 80);
        clip.scaleX = tVal / 100;
        clip.scaleY = tVal / 100;
        const g = clip.vars.g as number;
        if (clip.parent) {
          clip.parent.y += g;
        }
        let va = clip.vars.va as number;
        const vacc = clip.vars.vacc as number;
        va += vacc;
        clip.vars.va = va;
        const alphaVal = 150 - va;
        clip.alpha = Math.max(0, alphaVal) / 100;
        const d = clip.vars.d as number;
        const acc = clip.vars.acc as number;
        clip.x -= (clip.x - d) / acc;
        if (alphaVal < 0) {
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // feux internal child at frame_5 — slow rotating ember, removes parent when t < 0
    // AS: DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxChild5Sym: SymbolDefinition = {
      name: "_feuxChild5",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
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
        // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation += t/6; t--; _xscale = t/3; _yscale = t/3
        // _parent._y += g; _X -= (_X-d)/acc; if(t<0) _parent.removeMovieClip()
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
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // feux internal child at frame_8 — scatter spark emitter, spawns minifeux2 at grandparent
    // AS: DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxChild8Sym: SymbolDefinition = {
      name: "_feuxChild8",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
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
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(random(15)==1) spawn minifeux2 at _parent._parent
        // _rotation += t/3; t--; _xscale = t/3; _yscale = t/3
        // _parent._y += g; _X += (vx*=accx); _Y += (vy*=accy)
        // if(t<0) _parent.removeMovieClip()
        if (Math.floor(Math.random() * 15) === 1) {
          const feuxClip = clip.parent;
          const outerContainer = feuxClip?.parent;
          if (outerContainer) {
            let c = clip.vars.c as number;
            const compte = clip.vars.compte as number;
            const spawnedAlpha = 100 - c;
            c++;
            clip.vars.c = c;
            const spawned = outerContainer.attach(
              this.minifeux2Sym,
              `minifeux2_${compte}`,
              compte,
              ctx,
            );
            spawned.x = clip.x;
            spawned.y = clip.y + (feuxClip?.y ?? 0);
            spawned.alpha = Math.max(0, spawnedAlpha) / 100;
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
          if (clip.parent) {
            clip.parent.remove();
          }
        }
      },
    };

    // feux internal child at frame_11 — burst emitter, spawns minifeux3, then removes parent
    // AS: DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxChild11Sym: SymbolDefinition = {
      name: "_feuxChild11",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
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
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(t<150) play(); if(t<135) spawn 9 minifeux3 and _parent.removeMovieClip()
        const t = clip.vars.t as number;
        if (t < 150) {
          clip.play();
        }
        if (t < 135) {
          const feuxClip = clip.parent;
          const outerContainer = feuxClip?.parent;
          if (outerContainer) {
            let c = clip.vars.c as number;
            for (let nbr = 1; nbr < 10; nbr++) {
              const compte = Math.floor(Math.random() * 200000);
              const spawnedAlpha = 100 - c;
              c++;
              const spawned = outerContainer.attach(
                this.minifeux3Sym,
                `minifeux3_${compte}`,
                compte,
                ctx,
              );
              spawned.x = clip.x;
              spawned.y = clip.y + (feuxClip?.y ?? 0);
              spawned.alpha = Math.max(0, spawnedAlpha) / 100;
            }
            clip.vars.c = c;
          }
          if (clip.parent) {
            clip.parent.remove();
          }
          return;
        }
        clip.rotation += ((t / 3) * Math.PI) / 180;
        clip.vars.t = t - 1;
        const newT = clip.vars.t as number;
        clip.scaleX = newT / 3 / 100;
        clip.scaleY = newT / 3 / 100;
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

    // feux internal child at frame_14 — minifeux4 spawner + spiral motion, spawns minifeux3 on death
    // AS: DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const feuxChild14Sym: SymbolDefinition = {
      name: "_feuxChild14",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
        // nbr<2 → loop runs once spawning 1 minifeux4 at _parent._parent
        const feuxClip = clip.parent;
        const outerContainer = feuxClip?.parent;
        if (outerContainer) {
          const compte = Math.floor(Math.random() * 300000);
          const spawned = outerContainer.attach(
            this.minifeux4Sym,
            `minifeux4_${compte}`,
            compte,
            ctx,
          );
          spawned.x = clip.x;
          spawned.y = clip.y + (feuxClip?.y ?? 0);
        }
        clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
        clip.vars.vit = 2 + 10 * Math.random();
        clip.stop();
        clip.vars.frein = 0.9 + 0.05 * Math.random();
        clip.vars.vr = 0;
        clip.vars.sz = 240 + Math.floor(Math.random() * 120);
        clip.vars.frangle = 1.2;
        // t starts high so the t<150/t<135 death checks don't fire immediately
        clip.vars.t = 200;
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let angle = clip.vars.angle as number;
        clip.rotation = angle;
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
          clip.vars.vr = vr;
        }
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
          const outerContainer = feuxClip?.parent;
          if (outerContainer) {
            let c = clip.vars.c as number;
            for (let nbr = 1; nbr < 10; nbr++) {
              const compte = Math.floor(Math.random() * 300000);
              const spawnedAlpha = 100 - c;
              c++;
              const spawned = outerContainer.attach(
                this.minifeux3Sym,
                `minifeux3_${compte}`,
                compte,
                ctx,
              );
              spawned.x = clip.x;
              spawned.y = clip.y + (feuxClip?.y ?? 0);
              spawned.alpha = Math.max(0, spawnedAlpha) / 100;
            }
            clip.vars.c = c;
          }
          if (clip.parent) {
            clip.parent.remove();
          }
          return;
        }
        clip.vars.t = t - 1;
      },
    };

    // ---- lib_feux — 16-frame explosion composite ----
    // AS: DefineSprite_23_feux/frame_1/DoAction.as: gotoAndStop(_parent._parent._parent.level + 1)
    // Internal children are placed at frames 2,5,8,11,14 of feux's timeline.
    // Since gotoAndStop is called in frame_1, we attach all relevant children immediately
    // based on the level-derived stop frame.
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
            // AS DefineSprite_23_feux/frame_1/DoAction.as
            // gotoAndStop(_parent._parent._parent.level + 1)
            // _parent = boule, _parent._parent = outer container, _parent._parent._parent = root
            const outerContainer = clip.parent?.parent;
            const level = (outerContainer?.vars.level as number) ?? 1;
            const targetFrame = level + 1; // 1-based AS frame
            clip.gotoAndStop(targetFrame - 1); // convert to 0-based

            // Attach internal dynamic children for all frames up to targetFrame.
            // In canonical Flash the playhead reaching each frame triggers PlaceObject2.
            // Since we stopped at targetFrame, we eagerly attach all relevant children.
            if (targetFrame >= 2) {
              clip.attach(feuxChild2Sym, "child_f2", 2, ctx);
            }
            if (targetFrame >= 5) {
              clip.attach(feuxChild5Sym, "child_f5", 5, ctx);
            }
            if (targetFrame >= 8) {
              clip.attach(feuxChild8Sym, "child_f8", 8, ctx);
            }
            if (targetFrame >= 11) {
              clip.attach(feuxChild11Sym, "child_f11", 11, ctx);
            }
            if (targetFrame >= 14) {
              clip.attach(feuxChild14Sym, "child_f14", 14, ctx);
            }
          },
        ],
      ]),
    };

    // ---- lib_sprite26 — the "boule" rising ball ----
    // AS: DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // The boule's per-frame position is driven by the outer container's authored tween
    // (applied in the outer container's onEnterFrame).
    // The boule's own clipEvent randomly rotates +100° and spawns minifeux at the outer container.
    this.sprite26Sym = {
      name: "sprite26",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite26"),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(load).as
        // c = 1
        clip.vars.c = 1;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_26/frame_1/PlaceObject2_25_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(random(2)==1) { _rotation += 100; _parent._parent.attachMovie("minifeux","minifeux"+c,c); c++ }
        if (Math.floor(Math.random() * 2) === 1) {
          clip.rotation += (100 * Math.PI) / 180;
          // _parent = outerSym instance, _parent._parent = root
          const outerContainer = clip.parent;
          if (outerContainer) {
            let c = clip.vars.c as number;
            const spawned = outerContainer.attach(
              this.minifeux1Sym,
              `minifeux${c}`,
              c,
              ctx,
            );
            // AS: minifeux frame_1 DoAction: _X = _parent.boule._x; _Y = _parent.boule._y
            // boule IS clip, so we use clip's current position within outerContainer.
            spawned.x = clip.x;
            spawned.y = clip.y;
            c++;
            clip.vars.c = c;
          }
        }
      },
    };

    // Build the boule tween lookup map for the outer container's onEnterFrame.
    const bouleFrameMap = new Map<number, { tx: number; ty: number; sx: number; sy: number }>();
    for (const p of BOULE_TWEEN) {
      bouleFrameMap.set(p.f, { tx: p.tx, ty: p.ty, sx: p.sx, sy: p.sy });
    }

    // ---- outer container (DefineSprite_31) — 97-frame main spell container ----
    // AS: DefineSprite_31/frame_1/DoAction.as + DoAction_2.as
    //     DefineSprite_31/frame_70/DoAction.as
    //     DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_31/frame_97/DoAction.as
    // The boule authored tween is applied in onEnterFrame by reading bouleFrameMap.
    this.outerSym = {
      name: "outer",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // Apply the authored per-frame tween to the boule child each tick.
        const outerFrame = clip.currentFrame;
        const boule = clip.children.get("boule");
        if (boule) {
          const tweenEntry = bouleFrameMap.get(outerFrame);
          if (tweenEntry) {
            boule.x = tweenEntry.tx;
            boule.y = tweenEntry.ty;
            boule.scaleX = tweenEntry.sx;
            boule.scaleY = tweenEntry.sy;
          }
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
            // AS DefineSprite_31/frame_1/DoAction_2.as:
            //   taille = 80+random(40); _xscale = taille; _yscale = taille
            //   _rotation = -20+random(40); compte=1
            this.soundCallback?.("fireworks01");
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
            // Place the boule at its initial tween position (frame 0)
            const initEntry = bouleFrameMap.get(0)!;
            const bouleClip = clip.attach(
              this.sprite26Sym,
              "boule",
              1,
              ctx,
              {
                x: initEntry.tx,
                y: initEntry.ty,
              },
            );
            bouleClip.scaleX = initEntry.sx;
            bouleClip.scaleY = initEntry.sy;
          },
        ],
        [
          69,
          (_clip) => {
            // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
            // + canonical hit signal at explosion moment
            this.soundCallback?.("explo_fireworks");
            this.runtime.signalHit();
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
            // sz = 60 + 20*((level-1)%3); attach feux*1..N inside boule
            const level = (clip.vars.level as number) ?? 1;
            const sz = 60 + 20 * ((level - 1) % 3);
            const boule = clip.children.get("boule");
            if (boule) {
              boule.scaleX = sz / 100;
              boule.scaleY = sz / 100;
              const maxI = 6 + 7 * ((level - 1) % 3);
              for (let i = 1; i < maxI; i++) {
                boule.attach(this.feuxSym, `feux${i}`, i, ctx);
              }
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_31/frame_97/DoAction.as: stop()
            // Main SWF frame_319/DoAction.as: _parent.removeMovieClip() → complete
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.minifeux1Sym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.sprite26Sym);
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use from within frame scripts.
    this.soundCallback = callbacks.playSound;
    // Attach the outer 97-frame container at the root.
    // The root is at the target cell (displayType=11).
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
