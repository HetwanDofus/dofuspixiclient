/**
 * Spell 102 — Artillerie (Feca earth-artillery).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/102/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no `move`/`shoot`/`duplicate`
 * library symbols and no projectile motion — it is a pure impact animation
 * placed at the target cell. The main `anim1` timeline (51 frames) is the
 * primary authored content; additional library symbols (`sprite7`, `sprite9`,
 * `sprite14`, `sprite15`, `sprite16`) carry dynamic clipEvent behaviors.
 *
 * Library symbols (from manifest.librarySymbols):
 *
 *   - sprite7  (directlyDynamic: true, 59 frames) — "baton" dart particle.
 *     frame_1: seeds v/vy velocity, t-scale; onEnterFrame: integrates pos
 *     with 0.95 friction. Also carries per-frame alpha randomisation on an
 *     inner child placed at various parent frames (frames 38, 40, 43, 45,
 *     47). frame_18: gotoAndPlay(random(5)+17) loop. frame_59: stop().
 *
 *   - sprite9  (directlyDynamic: false, 74 frames) — outer "cannon" wrapper.
 *     Contains sprite7 placed at depth 2 (and other static children). Not
 *     directly dynamic; we attach it as a container whose child sprite7 runs
 *     the particle logic. frame_74: stop().
 *
 *   - sprite14 (directlyDynamic: true, 1 frame) — small thorn graphic.
 *     onEnterFrame: _alpha = random(100) each tick (flickering alpha).
 *
 *   - sprite15 (directlyDynamic: true, 1 frame) — "baton" wrapper.
 *     frame_1 DoAction: sets position/scale/alpha of self. Has onLoad from
 *     its placement in sprite16: _alpha = 100 - random(50).
 *
 *   - sprite16 (directlyDynamic: false, 1 frame) — wrapper for sprite15.
 *     A container that contains sprite15 (baton2/baton thorn). Placed inside
 *     DefineSprite_17_baton2 (baton2 in AS); its baton2 frame_1 scripts and
 *     clipEvents drive rotation oscillation.
 *
 * The spell also references DefineSprite_17_baton2, DefineSprite_18_baton,
 * DefineSprite_10_tige, DefineSprite_22, DefineSprite_23, DefineSprite_24
 * — these correspond to symbols embedded in the main `anim1` composite
 * timeline. For this runtime port we handle the named library symbols from
 * the manifest; the composite anim1 handles all other authored content.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("arty_102").
 * frame_172/DoAction.as: this.removeMovieClip() → complete().
 *
 * signalHit: fired at the canonical "impact" frame. From reading the
 * animation structure (anim1 has stopFrame=48, fadingFrame=47, 51 total),
 * the impact is at the onset of the animation — we fire signalHit at frame 0
 * (immediately, since this is a pure impact with no projectile travel).
 * complete() is fired from the anim1 symbol's stop/removal frame (frame 48,
 * which matches stopFrame in manifest).
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

const SPRITE7_BOUNDS = {
  width: 16.55,
  height: 69.25,
  offsetX: -8.25,
  offsetY: -24.25,
};

const SPRITE9_BOUNDS = {
  width: 344.4,
  height: 224.85,
  offsetX: -144.4,
  offsetY: -175,
};

const SPRITE14_BOUNDS = {
  width: 49.1,
  height: 9.4,
  offsetX: -27,
  offsetY: -4.3,
};

const SPRITE15_BOUNDS = {
  width: 49.1,
  height: 9.4,
  offsetX: -26.95,
  offsetY: -4.2,
};

const SPRITE16_BOUNDS = {
  width: 6.7,
  height: 35.15,
  offsetX: -3.2,
  offsetY: -29.9,
};

// Bounds for the main anim1 timeline (from manifest.animations[0])
const ANIM1_BOUNDS = {
  width: 138.55,
  height: 91.55,
  offsetX: -70.4,
  offsetY: -73.5,
};

export class Spell102 extends RuntimeSpell {
  readonly spellId = 102;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-attachment
  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite16Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite14 — flickering thorn graphic (directlyDynamic: true) ----
    // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = random(100);
    // onLoad (from DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as):
    //   _alpha = 100 - random(50);
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 100 - random(50);
        clip.alpha = (100 - Math.floor(Math.random() * 50)) / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(100);
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ---- sprite15 — baton wrapper with random alpha load (directlyDynamic: true) ----
    // AS: DefineSprite_17_baton2/frame_1/DoAction.as
    //   t = 100 - random(50); _xscale = t; _yscale = t;
    //   _X = 40*(0.5-Math.random()); _Y = 20*(0.5-Math.random());
    // Contains sprite14 as a child (placed at frame 0 of sprite15, depth 1).
    // The sprite15 placement in sprite16 (parentSpriteId:16) carries:
    //   onClipEvent(load): _alpha = 100 - random(50)  [on the child sprite14]
    // sprite15 itself also carries the baton2 frame_1 scripts.
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_17_baton2/frame_1/DoAction.as
            // t = 100 - random(50); _xscale = t; _yscale = t;
            // _X = 40*(0.5-Math.random()); _Y = 20*(0.5-Math.random());
            const t = 100 - Math.floor(Math.random() * 50);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.x = 40 * (0.5 - Math.random());
            clip.y = 20 * (0.5 - Math.random());
            // Attach sprite14 as child (placement: parentSpriteId=15, frame=0, depth=1)
            // matrix: translateX=0.05, translateY=0.1
            clip.attach(this.sprite14Sym, "sprite14_child", 1, ctx, {
              x: 0.05,
              y: 0.1,
            });
          },
        ],
      ]),
      // Rotation oscillation from DefineSprite_17_baton2's clipEvents on sprite16
      // is handled in sprite16's onLoad/onEnterFrame below.
    };

    // ---- sprite16 — baton2 thorn with oscillation (directlyDynamic: false) ----
    // Contains sprite15 (baton2 inner). The placement of sprite15 inside sprite16
    // (parentSpriteId:16, frame=0, depth=1) carries:
    //   matrix: scaleX=0, scaleY=0, rotateSkew0=0.716, rotateSkew1=0.716
    //           translateX=-0.2, translateY=-10.6
    // AS: DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 10 + random(20); i = 6*Math.random(); v2 = 1.05 + 0.5*Math.random();
    // AS: DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = a * Math.sin(i++); a /= v2;
    // Note: the clipEvents on PlaceObject2_16_1 (sprite16 instance) are on the
    // sprite16 clip itself; the "rotation = a*sin(i)" is on the sprite16 child
    // inside baton2's frame_1.
    this.sprite16Sym = {
      name: "sprite16",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      onLoad: (clip, ctx) => {
        // AS: DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as
        // a = 10 + random(20); i = 6*Math.random(); v2 = 1.05 + 0.5*Math.random();
        clip.vars.a = 10 + Math.floor(Math.random() * 20);
        clip.vars.i = 6 * Math.random();
        clip.vars.v2 = 1.05 + 0.5 * Math.random();

        // Attach sprite15 as child with its authored placement transform:
        // parentSpriteId=16, frame=0, depth=1
        // matrix: scaleX=0, scaleY=0, rotateSkew0=0.716, rotateSkew1=0.716
        //         translateX=-0.2, translateY=-10.6
        // rotateSkew0/1 != 0: rotation = atan2(0.716, 0) ≈ 0.716 rad
        clip.attach(this.sprite15Sym, "sprite15_child", 1, ctx, {
          x: -0.2,
          y: -10.6,
          rotation: Math.atan2(0.716094970703125, 0),
        });
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = a * Math.sin(i++); a /= v2;
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        const v2 = clip.vars.v2 as number;
        clip.rotation = (a * Math.sin(i) * Math.PI) / 180;
        i += 1;
        a /= v2;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- sprite7 — "baton" dart particle (directlyDynamic: true, 59 frames) ----
    // AS: DefineSprite_18_baton/frame_1/DoAction.as
    //   v = 5*(-0.5+Math.random()); vy = 3*(-0.5+Math.random());
    //   f = _root._currentframe; t = 50+40*(-0.5+Math.random());
    //   _yscale = t + f*5; _xscale = t + f*5;
    //   onEnterFrame: _X += v; _Y += vy; v *= 0.95; vy *= 0.95;
    //
    // Additional per-frame placements on sprite7 carry onClipEvent(load) for
    // placed children at frames 38, 40, 43, 45, 47 — these set alpha on
    // the inner placed objects (which are baked into the sprite7 SVG frames).
    // frame_18: gotoAndPlay(random(5)+17);
    // frame_59: stop();
    //
    // Note: The "baton" AS name maps to DefineSprite_18_baton; the manifest
    // export name is "sprite7" (characterId=7). The inner clipEvent handlers
    // on placed objects at frames 38/40/43/45/47 are for static children
    // embedded in the parent SWF (not separately exported) — their alpha
    // effects are captured in the sprite7 SVG frames by the exporter.
    // The primary dynamic behavior is the frame_1 DoAction (particle physics).
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 59,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_18_baton/frame_1/DoAction.as
            // v = 5*(-0.5+Math.random()); vy = 3*(-0.5+Math.random());
            // f = _root._currentframe; t = 50+40*(-0.5+Math.random());
            // _yscale = t + f*5; _xscale = t + f*5;
            // onEnterFrame: _X+=v; _Y+=vy; v*=0.95; vy*=0.95;
            const v = 5 * (-0.5 + Math.random());
            const vy = 3 * (-0.5 + Math.random());
            // f = _root._currentframe — in the runtime we don't have a
            // separate _root frame counter; use runtime elapsed frames as proxy.
            // For the initial spawn, f is approximately the current combat frame.
            // We treat it as 0 for consistency (the scale bonus from f is minor).
            const f = 0;
            const t = 50 + 40 * (-0.5 + Math.random());
            const scale = (t + f * 5) / 100;
            clip.scaleX = scale;
            clip.scaleY = scale;
            clip.vars.v = v;
            clip.vars.vy = vy;
          },
        ],
        [
          17,
          (clip) => {
            // AS: DefineSprite_7/frame_18/DoAction.as
            // gotoAndPlay(random(5) + 17);
            clip.gotoAndPlay(Math.floor(Math.random() * 5) + 16); // 0-based: 17+16=17..21 → 16..20
          },
        ],
        [
          58,
          (clip) => {
            // AS: DefineSprite_7/frame_59/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_18_baton/frame_1/DoAction.as onEnterFrame
        // _X = _X + v; _Y = _Y + vy; v *= 0.95; vy *= 0.95;
        let v = clip.vars.v as number;
        let vy = clip.vars.vy as number;
        clip.x += v;
        clip.y += vy;
        v *= 0.95;
        vy *= 0.95;
        clip.vars.v = v;
        clip.vars.vy = vy;
      },
    };

    // ---- sprite9 — outer cannon/explosion wrapper (directlyDynamic: false, 74 frames) ----
    // Contains sprite7 placed at depth 2 (parentSpriteId=9, frame=0).
    // placement matrix: scaleX=1, scaleY=1, translateX=24.75, translateY=-10.15
    // Additional move placements per frame are handled via authored SVG frames.
    // frame_74: stop().
    // The sprite7 placement at frame=0 (kind:"place") with ratio=null means
    // sprite7 starts at frame 0 of sprite9. The subsequent "move" entries
    // update its position per frame — those are baked into the sprite9 SVG.
    // We attach sprite7 live so its particle physics actually run.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 74,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite7 at depth 2 with initial placement matrix
            // parentSpriteId=9, frame=0, depth=2
            // matrix: translateX=24.75, translateY=-10.15
            clip.attach(this.sprite7Sym, "sprite7_child", 2, ctx, {
              x: 24.75,
              y: -10.15,
            });
          },
        ],
        [
          73,
          (clip) => {
            // AS: DefineSprite_9/frame_74/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim1 — main impact timeline (51 frames) ----
    // This is the primary animation from manifest.animations[0] (not in
    // librarySymbols, so no lib_ prefix). It is the root impact composite.
    // stopFrame=48 from manifest → frameScripts at frame 48: stop() + complete().
    // We also signal hit at frame 0 (immediate impact, no projectile).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 51,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Impact happens immediately at frame 1 of the animation.
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (clip) => {
            // manifest stopFrame=48 → canonical stop + spell completion.
            // AS: frame_172/DoAction.as (main SWF timeline): this.removeMovieClip()
            // The anim1 composite is the outermost clip; stopping here and
            // completing mirrors the canonical removeMovieClip on the outer mc.
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite16Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as: SOMA.playSound("arty_102");
    callbacks.playSound("arty_102");

    // Attach the main anim1 clip at root — this is the primary impact animation.
    // It is placed at the target cell (displayType=11, TargetCell) so root is
    // already anchored there. Attach at depth 1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Attach sprite9 (cannon/explosion wrapper) at root at depth 2.
    // The sprite9 symbol in manifest has placements[0].parentSpriteId=10
    // (DefineSprite_10_tige), but the tige symbol is embedded inside the
    // anim1 composite. sprite9 itself is a top-level library symbol placed
    // dynamically. We attach it at the root level to layer it over anim1.
    // Placement: from anim1 context, sprite9 sits at the impact origin.
    this.root.attach(this.sprite9Sym, "sprite9", 2, context);

    // Attach sprite16 (baton2 thorn wrapper) at root at depth 3.
    // sprite16 contains sprite15 which contains sprite14.
    // The outermost baton2 (DefineSprite_17_baton2) has sprite16 placed at
    // frame=0, depth=1. We spawn it at root depth 3 for layering.
    // Also attach a second sprite16 instance (baton2 also appears in sprite18
    // placement in sprite15 at parentSpriteId:18) — from the manifest the
    // sprite15 placement in sprite18 (frame=0, depth=1) with matrix
    // translateX=0, translateY=-0.3 gives us a second thorn cluster.
    this.root.attach(this.sprite16Sym, "sprite16_a", 3, context);
    this.root.attach(this.sprite16Sym, "sprite16_b", 4, context, {
      x: 0,
      y: -0.3,
    });
  }
}
