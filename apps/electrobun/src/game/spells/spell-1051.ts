/**
 * Spell 1051 — Sacrieur blood/sacrifice spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1051/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * and no dual-anchor logic. The single sprite_6 animation plays at the target cell.
 *
 * Layout:
 *   - Main timeline (47 frames):
 *       frame_1:  SOMA.playSound("sacrieur_1051"); play();
 *       frame_47: this.removeMovieClip() → spell complete.
 *     The main timeline also places a PlaceObject2_1_1 (sprite_8, the outer container
 *     that holds all the sprite7 "ray" instances) with an onClipEvent(enterFrame)
 *     that randomly pulses its alpha, scale, and rotation every tick.
 *
 *   - sprite7 (lib_sprite7, characterId=7, kind="clipEvent", directlyDynamic=true):
 *       A single-frame library symbol representing one "ray" of the circular burst.
 *       It is placed 16 times inside sprite_8 (parentSpriteId=8) at frame 0, each
 *       at a different rotation/scale via the placement matrix.
 *       onClipEvent(load): gotoAndPlay(random(20)) — stagger the animation phase.
 *       The sprite7 instances each play through their own sprite_6 animation frames.
 *
 *   - sprite_6 (DefineSprite_6, the animated "ray" content):
 *       40-frame animation.
 *       frame_1/DoAction.as: t = 20 + random(80); _xscale = t; _yscale = t;
 *       frame_39/DoAction.as: stop();
 *
 *   - sprite_8 (the outer container that holds all 16 sprite7 ray instances):
 *       Has an onClipEvent(enterFrame) on the PlaceObject2_1_1 placement:
 *         _alpha = -20 + random(80);
 *         t = 10 * Math.random() + 90;
 *         _xscale = t; _yscale = t;
 *         _rotation = random(360);
 *
 * The manifest has librarySymbols: [{name:"sprite7", characterId:7}] with 16
 * placements inside parentSpriteId=8 (sprite_8). Since sprite7 has
 * directlyDynamic=true, its own onClipEvent(load) is ported to SymbolDefinition.onLoad.
 *
 * sprite_8 is the outermost container placed on the main timeline (PlaceObject2_1_1).
 * Its enterFrame handler pulses alpha/scale/rotation. We model sprite_8 as a
 * container-only symbol with a frameScripts.set(0,...) that attaches all 16 sprite7
 * instances at their canonical placement matrices, plus an onEnterFrame that pulses
 * the container.
 *
 * sprite_6 is the animated content inside each sprite7 instance (the actual ray art).
 * We model it as a SymbolDefinition with the 40 frames from "sprite_6", with
 * frame_1 seeding scale and frame_39 calling stop().
 *
 * The main timeline's frame_47 removes the outer mc → runtime.complete().
 * signalHit is fired at the first visible impact frame (frame_1 / immediately on
 * attach, since the spell is an instant impact at target cell).
 *
 * Library symbols:
 *   - sprite6 — 40-frame animated ray content. frame_1 seeds random scale [20,100]%.
 *                frame_39 stops. textures from "sprite_6" (in animations[], no lib_ prefix).
 *   - sprite7 — single-frame ray wrapper (directlyDynamic). onLoad: gotoAndPlay(random(20)).
 *                textures from "lib_sprite7". Placed 16× inside sprite8 with varying
 *                rotation/scale matrices.
 *   - sprite8 — container-only. onEnterFrame: pulse alpha/scale/rotation.
 *                frameScripts[0]: attach 16 sprite7 instances with canonical matrices.
 *
 * Main timeline: frame_1 plays sound + play(); frame_47 removes mc → complete().
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

// Bounds from manifest.json librarySymbols[0] (sprite7, characterId=7)
const SPRITE7_BOUNDS = {
  width: 145.2,
  height: 102,
  offsetX: -7.55,
  offsetY: -50.75,
};

// Bounds from manifest.json animations[0] (sprite_6)
const SPRITE6_BOUNDS = {
  width: 145.2,
  height: 102,
  offsetX: -7.9,
  offsetY: -51.1,
};

// The 16 placement matrices for sprite7 instances inside sprite8
// (from manifest.json librarySymbols[0].placements, all at parentSpriteId=8, frame=0)
// Each entry: { depth, scaleX, scaleY, rotateSkew0, rotateSkew1, translateX, translateY, alphaMult }
const SPRITE7_PLACEMENTS = [
  { depth: 1,  scaleX: 0,                  scaleY: 0,                  rotateSkew0: -1,                  rotateSkew1: 1,                  translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 3,  scaleX: 0.3908843994140625, scaleY: 0.3908843994140625, rotateSkew0: -0.919158935546875,  rotateSkew1: 0.919158935546875,  translateX: 0, translateY: 0, alphaMult: 200 },
  { depth: 5,  scaleX: 0.7071075439453125, scaleY: 0.7071075439453125, rotateSkew0: -0.7071075439453125, rotateSkew1: 0.7071075439453125, translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 7,  scaleX: 0.9263458251953125, scaleY: 0.9263458251953125, rotateSkew0: -0.3735504150390625, rotateSkew1: 0.3735504150390625, translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 9,  scaleX: 1,                  scaleY: 1,                  rotateSkew0: 0,                   rotateSkew1: 0,                  translateX: 0, translateY: 0, alphaMult: 205 },
  { depth: 11, scaleX: 0.919158935546875,  scaleY: 0.919158935546875,  rotateSkew0: 0.3908843994140625,  rotateSkew1: -0.3908843994140625, translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 13, scaleX: 0.7071075439453125, scaleY: 0.7071075439453125, rotateSkew0: 0.7071075439453125,  rotateSkew1: -0.7071075439453125, translateX: 0, translateY: 0, alphaMult: 200 },
  { depth: 15, scaleX: 0.3735504150390625, scaleY: 0.3735504150390625, rotateSkew0: 0.9263458251953125,  rotateSkew1: -0.9263458251953125, translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 17, scaleX: 0,                  scaleY: 0,                  rotateSkew0: 1,                   rotateSkew1: -1,                  translateX: 0, translateY: 0, alphaMult: 205 },
  { depth: 19, scaleX: -0.3908843994140625, scaleY: -0.3908843994140625, rotateSkew0: 0.919158935546875, rotateSkew1: -0.919158935546875,  translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 21, scaleX: -0.7071075439453125, scaleY: -0.7071075439453125, rotateSkew0: 0.7071075439453125, rotateSkew1: -0.7071075439453125, translateX: 0, translateY: 0, alphaMult: 200 },
  { depth: 23, scaleX: -0.9263458251953125, scaleY: -0.9263458251953125, rotateSkew0: 0.3735504150390625, rotateSkew1: -0.3735504150390625, translateX: 0, translateY: 0, alphaMult: 205 },
  { depth: 25, scaleX: -1,                  scaleY: -1,                  rotateSkew0: 0,                  rotateSkew1: 0,                   translateX: 0, translateY: 0, alphaMult: 205 },
  { depth: 27, scaleX: -0.919158935546875,  scaleY: -0.919158935546875,  rotateSkew0: -0.3908843994140625, rotateSkew1: 0.3908843994140625, translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 29, scaleX: -0.7071075439453125, scaleY: -0.7071075439453125, rotateSkew0: -0.7071075439453125, rotateSkew1: 0.7071075439453125, translateX: 0, translateY: 0, alphaMult: 256 },
  { depth: 31, scaleX: -0.3735504150390625, scaleY: -0.3735504150390625, rotateSkew0: -0.9263458251953125, rotateSkew1: 0.9263458251953125, translateX: 0, translateY: 0, alphaMult: 205 },
] as const;

export class Spell1051 extends RuntimeSpell {
  readonly spellId = 1051;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);

    // ---- sprite6 — 40-frame animated ray content -----------------
    // Canonical: DefineSprite_6 with frame_1/DoAction.as and frame_39/DoAction.as.
    // Note: "sprite_6" is in animations[] (no librarySymbols entry),
    // so we use "sprite_6" as the texture key (NO lib_ prefix).
    const sprite6Frames = textures.getFrames("sprite_6");
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 40,
      frames: sprite6Frames,
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // t = 20 + random(80); _xscale = t; _yscale = t;
            const t = 20 + Math.floor(Math.random() * 80);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          38,
          (clip) => {
            // AS: DefineSprite_6/frame_39/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite7 — single-frame ray wrapper (directlyDynamic) ----
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    // onLoad: gotoAndPlay(random(20));
    // Textures from librarySymbols entry → use "lib_sprite7" prefix.
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(20));
        // The sprite7 instances contain a sprite6 child (the animated ray).
        // The canonical AS gotoAndPlay here staggered the sub-animation phase.
        // We stagger the clip itself (which wraps sprite6).
        clip.gotoAndPlay(Math.floor(Math.random() * 20));
      },
    };

    // ---- sprite8 — container holding 16 sprite7 ray instances ----
    // PlaceObject2_1_1 is placed on the main timeline (frame_1) with
    // onClipEvent(enterFrame) that pulses alpha/scale/rotation.
    // AS: frame_1/PlaceObject2_1_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = -20 + random(80);
    //   t = 10 * Math.random() + 90;
    //   _xscale = t; _yscale = t;
    //   _rotation = random(360);
    //
    // frameScripts[0] attaches all 16 sprite7 instances at their
    // canonical placement matrices from manifest placements[].
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 47,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: frame_1/PlaceObject2_1_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = -20 + random(80);
        // t = 10 * Math.random() + 90;
        // _xscale = t; _yscale = t;
        // _rotation = random(360);
        const alphaVal = -20 + Math.floor(Math.random() * 80);
        clip.alpha = alphaVal / 100;
        const t = 10 * Math.random() + 90;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach all 16 sprite7 instances at their canonical placement matrices.
            // Each placement is at parentSpriteId=8 (= this sprite8 clip), frame=0,
            // with a distinct depth and rotation/scale transform derived from the matrix.
            for (let i = 0; i < SPRITE7_PLACEMENTS.length; i++) {
              const p = SPRITE7_PLACEMENTS[i];
              // Derive rotation from the Flash matrix skew components.
              // The canonical Flash matrix has scaleX/scaleY as the scaled cosine,
              // and rotateSkew0/1 as the scaled sine. We extract rotation via atan2.
              const rotation = Math.atan2(p.rotateSkew1, p.scaleX);
              // Derive scale magnitude from the matrix column lengths.
              const scale = Math.sqrt(p.scaleX * p.scaleX + p.rotateSkew1 * p.rotateSkew1);
              const child = clip.attach(
                this.sprite7Sym,
                `sprite7_${p.depth}`,
                p.depth,
                ctx,
                {
                  x: p.translateX,
                  y: p.translateY,
                  rotation: rotation,
                },
              );
              // Apply scale from placement matrix.
              child.scaleX = scale;
              child.scaleY = scale;
              // Apply alpha from colorTransform (alphaMult / 256).
              child.alpha = p.alphaMult / 256;
              // Each sprite7 wraps a sprite6 animated content child.
              // Attach sprite6 inside sprite7 at depth 1.
              child.attach(this.sprite6Sym, "sprite6", 1, ctx);
            }
          },
        ],
        [
          46,
          (clip) => {
            // AS: frame_47/DoAction.as
            // this.removeMovieClip();
            // This fires at the outer mc level → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("sacrieur_1051");
    callbacks.playSound("sacrieur_1051");

    // AS: frame_1/DoAction_2.as → play();
    // The main timeline plays from frame_1 onward. We attach sprite8
    // here (the PlaceObject2_1_1 placement on the main timeline frame_1)
    // so it starts ticking immediately. It will run until frame_47
    // where removeMovieClip fires.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);

    // Signal hit immediately — this is an instant impact spell at the
    // target cell (no projectile). The visual starts on frame_1.
    this.runtime.signalHit();
  }
}
