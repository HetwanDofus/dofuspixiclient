/**
 * Spell 104 — Artillerie (Feca earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/104/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell is a single impact animation
 * anchored at the target cell. There are no projectile motion symbols
 * (no "move"/"shoot" container names), no caster-relative positioning,
 * and no WorldAbsolute dual-anchoring. The main outer clip (DefineSprite_8)
 * plays a 130-frame timeline at the target cell, then signals completion.
 *
 * Library symbols:
 *   - sprite7 (characterId 7, directlyDynamic: false) — a 63-frame
 *     composite wrapper. Its frame_61 resets its own _rotation to -20°.
 *     It carries an onClipEvent(enterFrame) that increments _rotation by
 *     1° per tick. It is the outermost runtime-attached child of the
 *     main outer sprite (DefineSprite_8), placed at depth 1.
 *     sprite5 symbols are placed inside sprite7 at various parent frames.
 *
 *   - sprite5 (characterId 5, directlyDynamic: true) — a 30-frame
 *     particle-like sprite. Has an onClipEvent(load) that seeds `xs`
 *     (= _parent._xscale * 3) and `i` (= _parent.i). Has an
 *     onClipEvent(enterFrame) that sets _alpha = 30 + random(120) and
 *     _xscale = _yscale = 100 each tick, and stops at frame_28.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("arty_104").
 *
 * DefineSprite_8 is the outer main animation (anim1, 132 frames).
 * Its frame_130 calls this.end() (→ signalHit) then _parent.removeMovieClip()
 * (→ runtime.complete()).
 *
 * The harness for TargetCell just places root at target cell (0,0)
 * in container-local coords; we attach sprite7 (= DefineSprite_8's
 * placed child) from onSpellStart, which then drives sprite5 placements
 * from its own frameScripts.
 *
 * Note on the outer animation: the manifest shows `anim1` as a 132-frame
 * composite animation (the pre-rendered main timeline). DefineSprite_8
 * IS the main outer sprite that wraps everything. We model anim1 as the
 * root symbol itself — the root clip plays anim1 frames and runs the
 * frame_130 completion script. sprite7 is attached as a child and rotates
 * on every tick via its onEnterFrame.
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

// Bounds from manifest.json librarySymbols entries
const SPRITE5_BOUNDS = {
  width: 175.8,
  height: 121.15,
  offsetX: -86.4,
  offsetY: -57,
};

const SPRITE7_BOUNDS = {
  width: 130.85,
  height: 140.5,
  offsetX: -66.35,
  offsetY: -67.6,
};

// Bounds for the main animation (anim1) — used for the root symbol
const ANIM1_BOUNDS = {
  width: 188.95,
  height: 190.8,
  offsetX: -91.3,
  offsetY: -127.65,
};

export class Spell104 extends RuntimeSpell {
  readonly spellId = 104;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite5Anchor = calculateAnchor(SPRITE5_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite5 — directlyDynamic: true particle sprite ---------
    // AS DefineSprite_5/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   xs = _parent._xscale * 3;
    //   i = _parent.i;
    // AS DefineSprite_5/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   t = 100;
    //   _alpha = 30 + random(120);
    //   _xscale = t;
    //   _yscale = t;
    // AS DefineSprite_5/frame_28/DoAction.as:
    //   stop();
    this.sprite5Sym = {
      name: "sprite5",
      totalFrames: 30,
      frames: textures.getFrames("lib_sprite5"),
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // _parent._xscale is expressed as Flash percent; parent.scaleX is decimal.
        const parentScaleX = (clip.parent?.scaleX ?? 1) * 100;
        clip.vars.xs = parentScaleX * 3;
        clip.vars.i = clip.parent?.vars.i ?? 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // t = 100; _alpha = 30 + random(120); _xscale = t; _yscale = t;
        const t = 100;
        clip.alpha = (30 + Math.floor(Math.random() * 120)) / 100;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS DefineSprite_5/frame_28/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite7 — directlyDynamic: false wrapper ----------------
    // This is DefineSprite_7 which is NOT directly dynamic — it wraps
    // sprite5 placements inside it. It has:
    //   - An onClipEvent(enterFrame) (on itself, placed in DefineSprite_8)
    //     that does _rotation = _rotation + 1  (increments rotation 1° per tick)
    //   - A frame_61 script that resets _rotation = -20°
    //   - It places sprite5 at multiple frames with specific transforms
    //
    // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + 1;
    // AS DefineSprite_7/frame_61/DoAction.as:
    //   _rotation = -20;
    //
    // sprite5 placements inside sprite7 (parentSpriteId === 7):
    //   frame 0, depth 2, matrix: {scaleX: -0.3108, scaleY: 0.4037, ...tx: -25.3, ty: 26.9}
    //   frame 3, depth 4, matrix: {scaleX: -0.3572, scaleY: 0.6368, ...tx: -30.8, ty: 3.4}
    //   frame 6, depth 6, matrix: {scaleX: 0.6317, scaleY: 0.6317, ...tx: 4.5, ty: 19.5}
    //   frame 12, depth 8, matrix: {scaleX: -0.3108, scaleY: -0.4037, ...tx: -23.8, ty: -24.1}
    //   frame 15, depth 10, matrix: {scaleX: -0.3062, scaleY: -0.1602, ...tx: -0.3, ty: -24.1}
    //   frame 18, depth 12, matrix: {scaleX: -0.2306, scaleY: -0.1206, ...tx: -0.8, ty: -36.1}
    //   frame 24, depth 14, matrix: {scaleX: 0.0656, scaleY: 0.3296, ...tx: 25.2, ty: -21.6}
    //   frame 27, depth 16, matrix: {scaleX: 0.3488, scaleY: 0.6218, ...tx: 31.2, ty: 7.9}
    //   frame 30, depth 18, matrix: {scaleX: 0.0656, scaleY: -0.3296, ...tx: 23.7, ty: 26.9}
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 63,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 1  (degrees)
        clip.rotation += (1 * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite5 at depth 2 with the frame-0 placement transform.
            // matrix: scaleX: -0.310760, scaleY: 0.403671, rotateSkew0: -0.015335, rotateSkew1: 0.233047, tx: -25.3, ty: 26.9
            // rotation from atan2(rotateSkew1, scaleX) or atan2(rotateSkew0, scaleY)
            // For a general affine, we apply scale + rotation separately.
            // scaleX magnitude = sqrt((-0.3108)^2 + 0.2330^2), scaleY magnitude = sqrt((-0.0153)^2 + 0.4037^2)
            // rotation = atan2(rotateSkew1, scaleX) = atan2(0.2330, -0.3108)
            const s5_0 = clip.attach(this.sprite5Sym, "sprite5_d2", 2, ctx);
            s5_0.x = -25.3;
            s5_0.y = 26.9;
            s5_0.scaleX = Math.sqrt(
              Math.pow(-0.310760498046875, 2) +
                Math.pow(0.2330474853515625, 2),
            );
            s5_0.scaleY = Math.sqrt(
              Math.pow(-0.0153350830078125, 2) +
                Math.pow(0.4036712646484375, 2),
            );
            s5_0.rotation = Math.atan2(
              0.2330474853515625,
              -0.310760498046875,
            );
          },
        ],
        [
          3,
          (clip, ctx) => {
            // Place sprite5 at depth 4 (frame 3 = index 3, 0-based).
            // matrix: scaleX: -0.3572, scaleY: 0.6368, rotateSkew0: -0.2304, rotateSkew1: 0, tx: -30.8, ty: 3.4, ratio: 3
            const s5_3 = clip.attach(this.sprite5Sym, "sprite5_d4", 4, ctx);
            s5_3.x = -30.8;
            s5_3.y = 3.4;
            s5_3.scaleX = Math.sqrt(
              Math.pow(-0.3571929931640625, 2) + Math.pow(0, 2),
            );
            s5_3.scaleY = Math.sqrt(
              Math.pow(-0.23040771484375, 2) +
                Math.pow(0.6367950439453125, 2),
            );
            s5_3.rotation = Math.atan2(0, -0.3571929931640625);
            s5_3.vars.i = 3;
          },
        ],
        [
          6,
          (clip, ctx) => {
            // Place sprite5 at depth 6 (frame 6 = index 6, 0-based).
            // matrix: scaleX: 0.6317, scaleY: 0.6317, rotateSkew0: 0, rotateSkew1: 0, tx: 4.5, ty: 19.5, ratio: 6
            const s5_6 = clip.attach(this.sprite5Sym, "sprite5_d6", 6, ctx);
            s5_6.x = 4.5;
            s5_6.y = 19.5;
            s5_6.scaleX = 0.6317291259765625;
            s5_6.scaleY = 0.6317291259765625;
            s5_6.rotation = 0;
            s5_6.vars.i = 6;
          },
        ],
        [
          12,
          (clip, ctx) => {
            // Place sprite5 at depth 8 (frame 12 = index 12, 0-based).
            // matrix: scaleX: -0.3108, scaleY: -0.4037, rotateSkew0: 0.0153, rotateSkew1: 0.2330, tx: -23.8, ty: -24.1, ratio: 12
            const s5_12 = clip.attach(this.sprite5Sym, "sprite5_d8", 8, ctx);
            s5_12.x = -23.8;
            s5_12.y = -24.1;
            s5_12.scaleX = Math.sqrt(
              Math.pow(-0.310760498046875, 2) +
                Math.pow(0.2330474853515625, 2),
            );
            s5_12.scaleY = Math.sqrt(
              Math.pow(0.0153350830078125, 2) +
                Math.pow(-0.4036712646484375, 2),
            );
            s5_12.rotation = Math.atan2(
              0.2330474853515625,
              -0.310760498046875,
            );
            s5_12.vars.i = 12;
          },
        ],
        [
          15,
          (clip, ctx) => {
            // Place sprite5 at depth 10 (frame 15 = index 15, 0-based).
            // matrix: scaleX: -0.3062, scaleY: -0.1602, rotateSkew0: -0.2774, rotateSkew1: 0.5979, tx: -0.3, ty: -24.1, ratio: 15
            const s5_15 = clip.attach(
              this.sprite5Sym,
              "sprite5_d10",
              10,
              ctx,
            );
            s5_15.x = -0.3;
            s5_15.y = -24.1;
            s5_15.scaleX = Math.sqrt(
              Math.pow(-0.306182861328125, 2) +
                Math.pow(0.5978851318359375, 2),
            );
            s5_15.scaleY = Math.sqrt(
              Math.pow(-0.2773895263671875, 2) +
                Math.pow(-0.1602020263671875, 2),
            );
            s5_15.rotation = Math.atan2(
              0.5978851318359375,
              -0.306182861328125,
            );
            s5_15.vars.i = 15;
          },
        ],
        [
          18,
          (clip, ctx) => {
            // Place sprite5 at depth 12 (frame 18 = index 18, 0-based).
            // matrix: scaleX: -0.2306, scaleY: -0.1206, rotateSkew0: -0.2089, rotateSkew1: 0.4502, tx: -0.8, ty: -36.1, ratio: 18
            const s5_18 = clip.attach(
              this.sprite5Sym,
              "sprite5_d12",
              12,
              ctx,
            );
            s5_18.x = -0.8;
            s5_18.y = -36.1;
            s5_18.scaleX = Math.sqrt(
              Math.pow(-0.2305755615234375, 2) +
                Math.pow(0.450225830078125, 2),
            );
            s5_18.scaleY = Math.sqrt(
              Math.pow(-0.2089080810546875, 2) +
                Math.pow(-0.120635986328125, 2),
            );
            s5_18.rotation = Math.atan2(
              0.450225830078125,
              -0.2305755615234375,
            );
            s5_18.vars.i = 18;
          },
        ],
        [
          24,
          (clip, ctx) => {
            // Place sprite5 at depth 14 (frame 24 = index 24, 0-based).
            // matrix: scaleX: 0.0656, scaleY: 0.3296, rotateSkew0: -0.3041, rotateSkew1: 0.3296, tx: 25.2, ty: -21.6, ratio: 24
            const s5_24 = clip.attach(
              this.sprite5Sym,
              "sprite5_d14",
              14,
              ctx,
            );
            s5_24.x = 25.2;
            s5_24.y = -21.6;
            s5_24.scaleX = Math.sqrt(
              Math.pow(0.0656280517578125, 2) +
                Math.pow(0.32958984375, 2),
            );
            s5_24.scaleY = Math.sqrt(
              Math.pow(-0.30413818359375, 2) +
                Math.pow(0.32958984375, 2),
            );
            s5_24.rotation = Math.atan2(
              0.32958984375,
              0.0656280517578125,
            );
            s5_24.vars.i = 24;
          },
        ],
        [
          27,
          (clip, ctx) => {
            // Place sprite5 at depth 16 (frame 27 = index 27, 0-based).
            // matrix: scaleX: 0.3488, scaleY: 0.6218, rotateSkew0: -0.2250, rotateSkew1: 0, tx: 31.2, ty: 7.9, ratio: 27
            const s5_27 = clip.attach(
              this.sprite5Sym,
              "sprite5_d16",
              16,
              ctx,
            );
            s5_27.x = 31.2;
            s5_27.y = 7.9;
            s5_27.scaleX = Math.sqrt(
              Math.pow(0.348785400390625, 2) + Math.pow(0, 2),
            );
            s5_27.scaleY = Math.sqrt(
              Math.pow(-0.2249908447265625, 2) +
                Math.pow(0.6218109130859375, 2),
            );
            s5_27.rotation = Math.atan2(0, 0.348785400390625);
            s5_27.vars.i = 27;
          },
        ],
        [
          30,
          (clip, ctx) => {
            // Place sprite5 at depth 18 (frame 30 = index 30, 0-based).
            // matrix: scaleX: 0.0656, scaleY: -0.3296, rotateSkew0: 0.3041, rotateSkew1: 0.3296, tx: 23.7, ty: 26.9, ratio: 30
            const s5_30 = clip.attach(
              this.sprite5Sym,
              "sprite5_d18",
              18,
              ctx,
            );
            s5_30.x = 23.7;
            s5_30.y = 26.9;
            s5_30.scaleX = Math.sqrt(
              Math.pow(0.0656280517578125, 2) +
                Math.pow(0.32958984375, 2),
            );
            s5_30.scaleY = Math.sqrt(
              Math.pow(0.30413818359375, 2) +
                Math.pow(-0.32958984375, 2),
            );
            s5_30.rotation = Math.atan2(
              0.32958984375,
              0.0656280517578125,
            );
            s5_30.vars.i = 30;
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_7/frame_61/DoAction.as: _rotation = -20;
            clip.rotation = (-20 * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- anim1 — the outer main animation (DefineSprite_8 equivalent) ----
    // This is the primary 132-frame timeline that renders the main earth
    // impact visual. frame_130 (AS frame_130) calls this.end() +
    // _parent.removeMovieClip().
    //
    // AS DefineSprite_8/frame_130/DoAction.as:
    //   this.end();
    //   _parent.removeMovieClip();
    //
    // sprite7 is placed inside DefineSprite_8 at frame 0, depth 1, with
    // the placement matrix from placements[0] (parentSpriteId === 8):
    //   matrix: {scaleX: 0.7934, scaleY: 0.7934, rotateSkew0: -0.6061, rotateSkew1: 0.6061, tx: 2.3, ty: -34.9}
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 132,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_8: sprite7 placed at depth 1, frame 0.
            // placement matrix: scaleX: 0.7934, scaleY: 0.7934,
            //   rotateSkew0: -0.6061, rotateSkew1: 0.6061, tx: 2.3, ty: -34.9
            const s7 = clip.attach(this.sprite7Sym, "sprite7", 1, ctx);
            s7.x = 2.3;
            s7.y = -34.9;
            // Decompose the affine matrix for scale and rotation:
            // a = 0.7934, b = -0.6061 (rotateSkew0), c = 0.6061 (rotateSkew1), d = 0.7934
            // scaleX = sqrt(a^2 + c^2), scaleY = sqrt(b^2 + d^2)
            // rotation = atan2(c, a)
            s7.scaleX = Math.sqrt(
              Math.pow(0.79339599609375, 2) +
                Math.pow(0.606109619140625, 2),
            );
            s7.scaleY = Math.sqrt(
              Math.pow(-0.606109619140625, 2) +
                Math.pow(0.79339599609375, 2),
            );
            s7.rotation = Math.atan2(
              0.606109619140625,
              0.79339599609375,
            );
          },
        ],
        [
          129,
          (clip) => {
            // AS DefineSprite_8/frame_130/DoAction.as:
            //   this.end();          → signalHit
            //   _parent.removeMovieClip(); → complete
            this.runtime.signalHit();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("arty_104");
    callbacks.playSound("arty_104");

    // Attach the main anim1 timeline clip to the root so it starts ticking.
    // For TargetCell (displayType=11) the root is already at the target cell,
    // so we place anim1 at (0,0) within the container.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
