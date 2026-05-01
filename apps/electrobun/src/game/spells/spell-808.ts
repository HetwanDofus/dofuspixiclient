/**
 * Spell 808 — Earth explosion with bouncing stone particles.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/808/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single impact at target cell, no projectile,
 * no caster reference. The entire animation plays at the target cell.
 *
 * SWF structure:
 *   - DefineSprite_16 — outer 178-frame container (modelled as "anim1").
 *     Places sprite15 instances at frames 1, 7, and 13 (0-based: 0, 6, 12).
 *     frame_178 (0-based: 177) calls _parent.removeMovieClip() + stop()
 *     → this.runtime.complete().
 *   - DefineSprite_13 — 46-frame impact burst placed inside DefineSprite_16.
 *     frame_1: SOMA.playSound("explosion"); frame_46: stop().
 *     Its visual timeline is part of the composite anim1 SVG frames.
 *   - DefineSprite_7 — randomised sub-sprite inside DefineSprite_13.
 *     frame_1: gotoAndPlay(random(45)+2); frame_106: stop().
 *     Its visual timeline is part of the composite anim1 SVG frames.
 *   - DefineSprite_15 / sprite15 (directlyDynamic: true, kind: "clipEvent"):
 *     onClipEvent(load): attaches 3 "pierres" stone particle children.
 *     This MUST be ported to onLoad — it is NOT captured in pre-rendered SVGs.
 *   - DefineSprite_3_pierres / pierres — stone particle (1 frame).
 *     onClipEvent(load): seeds vx, vy, scatter position, scale, alpha, v, vr.
 *     onClipEvent(enterFrame): integrates ballistic motion with bounce at y=0.
 *     Both MUST be ported to onLoad/onEnterFrame — they are NOT captured in
 *     pre-rendered SVGs and drive all dynamic particle movement at runtime.
 *
 * Library symbols:
 *   - pierres — stone particle. onLoad seeds physics vars. onEnterFrame
 *     integrates ballistic drift + vertical bounce + settling.
 *   - sprite15 — clipEvent wrapper. onLoad attaches 3 "pierres" children.
 *   - anim1 — outer 178-frame container. frameScripts place sprite15 at
 *     the canonical frames and signal completion at frame 178.
 *
 * signalHit: fired at anim1 frameScripts[0] (frame_1 of DefineSprite_16),
 * which is the canonical explosion impact moment.
 *
 * Main timeline: onSpellStart plays "explosion" sound and attaches anim1.
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

const PIERRES_BOUNDS = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

const SPRITE15_BOUNDS = {
  width: 145.85,
  height: 437.15,
  offsetX: -54.25,
  offsetY: -418.2,
};

const ANIM1_BOUNDS = {
  width: 258.3,
  height: 480.45,
  offsetX: -133.35,
  offsetY: -432.8,
};

export class Spell808 extends RuntimeSpell {
  readonly spellId = 808;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- pierres — stone particle with full ballistic physics ------
    // The onLoad and onEnterFrame below port the canonical CLIPACTIONRECORD
    // scripts verbatim. These handlers run at runtime per-tick and are the
    // sole source of particle motion — they are NOT represented in the
    // pre-rendered SVG frames in any way.
    //
    // Note on AS structure: the CLIPACTIONRECORD lives on PlaceObject2_2_1
    // INSIDE DefineSprite_3_pierres. In AS terms "this" = the inner placed
    // child, "_parent" = the pierres sprite container. The inner child's
    // _Y / _rotation are the vertical bounce state; _parent._x/_y are the
    // horizontal scatter drift. We model this by tracking driftX/driftY
    // separately from innerY/innerRotation and composing them onto clip.x/y.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //
        // vx = 5 * (Math.random() - 0.5);
        // vy = 2 * (Math.random() - 0.5);
        // _parent._x = 20 * (Math.random() - 0.5);
        // _parent._y = 10 * (Math.random() - 0.5);
        // t = 60 + 40 * Math.random();
        // _xscale = t; _yscale = t;
        // _alpha = 20 + random(90);
        // v = -12 * Math.random() - 3;
        // vr = 40 * (-0.5 + Math.random());
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        const driftX = 20 * (Math.random() - 0.5);
        const driftY = 10 * (Math.random() - 0.5);
        clip.vars.driftX = driftX;
        clip.vars.driftY = driftY;
        clip.x = driftX;
        clip.y = driftY;
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -12 * Math.random() - 3;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // innerY / innerRotation model the inner placed child's _Y / _rotation
        clip.vars.innerY = 0;
        clip.vars.innerRotation = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //
        // _parent._x += vx;
        // _parent._y += vy;
        // if (t != 1) {
        //   _Y = _Y + v;
        //   _rotation = _rotation + vr;
        //   v += 1.5;
        //   if (_Y > 0) {
        //     vx /= 2; vy /= 2;
        //     _rotation = 0; _Y = 0;
        //     v = (-v) / 4;
        //     if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
        //   }
        // }
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let t = clip.vars.t as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;
        let innerY = clip.vars.innerY as number;
        let innerRotation = clip.vars.innerRotation as number;
        let driftX = clip.vars.driftX as number;
        let driftY = clip.vars.driftY as number;

        // _parent._x += vx; _parent._y += vy;
        driftX += vx;
        driftY += vy;

        if (t !== 1) {
          innerY += v;
          innerRotation += vr;
          v += 1.5;

          if (innerY > 0) {
            vx /= 2;
            vy /= 2;
            innerRotation = 0;
            innerY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              t = 1;
            }
          }
        }

        // Compose scatter drift + vertical bounce into clip position/rotation
        clip.x = driftX;
        clip.y = driftY + innerY;
        clip.rotation = (innerRotation * Math.PI) / 180;

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.t = t;
        clip.vars.v = v;
        clip.vars.innerY = innerY;
        clip.vars.innerRotation = innerRotation;
        clip.vars.driftX = driftX;
        clip.vars.driftY = driftY;
      },
    };

    // ---- sprite15 — clipEvent wrapper, onLoad attaches 3 pierres ---
    // directlyDynamic: true. The CLIPACTIONRECORD onClipEvent(load) on
    // PlaceObject2_14_17 inside DefineSprite_15 attaches 3 "pierres"
    // children. This runs at runtime via onLoad and is NOT present in
    // any pre-rendered SVG frame.
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_15/frame_1/PlaceObject2_14_17/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //
        // c = 0;
        // while (c < 3) {
        //   this.attachMovie("pierres", "pierres" + c, c);
        //   c++;
        // }
        for (let c = 0; c < 3; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- anim1 — outer 178-frame container (DefineSprite_16) -------
    // Models the outermost authored sprite. Its SVG frames carry the
    // authored static visual content of the explosion burst timeline.
    // The dynamic sprite15 particle instances are attached via frameScripts
    // at the canonical placement frames.
    //
    // Placement schedule from manifest librarySymbols[1] (sprite15):
    //   frame 0  (AS frame_1):  depth 19, scaleX 1.19085, x=15.85,  y=-11.8
    //   frame 6  (AS frame_7):  depth 1,  scaleX 1.15904, x=-70.45, y=-14.6
    //   frame 12 (AS frame_13): depth 37, scaleX 1.15904, x=-9.25,  y=28.7
    //
    // frame_178 (0-based 177): _parent.removeMovieClip() → complete().
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 180,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_16 places sprite15 at depth 19 on frame_1.
            // matrix: {scaleX:1.19085693359375, scaleY:1, rotateSkew0:0,
            //          rotateSkew1:0, translateX:15.85, translateY:-11.8}
            // Also: DefineSprite_13/frame_1/DoAction.as fires playSound —
            // handled in onSpellStart. Signal hit at this canonical impact frame.
            const inst = clip.attach(
              this.sprite15Sym,
              "sprite15_d19",
              19,
              ctx
            );
            inst.x = 15.85;
            inst.y = -11.8;
            inst.scaleX = 1.19085693359375;
            inst.scaleY = 1;
            this.runtime.signalHit();
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS: DefineSprite_16 places sprite15 at depth 1 on frame_7.
            // matrix: {scaleX:1.1590423583984375, scaleY:1, rotateSkew0:0,
            //          rotateSkew1:0, translateX:-70.45, translateY:-14.6}
            const inst = clip.attach(
              this.sprite15Sym,
              "sprite15_d1",
              1,
              ctx
            );
            inst.x = -70.45;
            inst.y = -14.6;
            inst.scaleX = 1.1590423583984375;
            inst.scaleY = 1;
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS: DefineSprite_16 places sprite15 at depth 37 on frame_13.
            // matrix: {scaleX:1.1590423583984375, scaleY:1, rotateSkew0:0,
            //          rotateSkew1:0, translateX:-9.25, translateY:28.7}
            const inst = clip.attach(
              this.sprite15Sym,
              "sprite15_d37",
              37,
              ctx
            );
            inst.x = -9.25;
            inst.y = 28.7;
            inst.scaleX = 1.1590423583984375;
            inst.scaleY = 1;
          },
        ],
        [
          177,
          (clip) => {
            // AS: DefineSprite_16/frame_178/DoAction.as
            //   _parent.removeMovieClip();
            //   stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: DefineSprite_13/frame_1/DoAction.as — SOMA.playSound("explosion")
    // DefineSprite_13 is placed on frame_1 of DefineSprite_16; its frame_1
    // fires the sound. We fire it here at spell start matching canonical timing.
    callbacks.playSound("explosion");

    // Attach the outer anim1 container (DefineSprite_16) at the root.
    // This mirrors the canonical main SWF timeline placing DefineSprite_16
    // at depth 1 on frame_1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
