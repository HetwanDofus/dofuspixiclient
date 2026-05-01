/**
 * Spell 314 — (Iop/Feca shield-type impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/314/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no move/shoot/duplicate symbols,
 * no caster-relative logic, and no dual-anchored timelines. The spell is a
 * single impact animation at the target cell — the outer composite `anim1`
 * plays 84 frames then removes itself via DefineSprite_20/frame_82 which
 * calls `_parent.removeMovieClip()`. The `anim1` animation is the outer
 * sprite (DefineSprite_20); inside it, DefineSprite_18 is a container that
 * statically places 6 instances of DefineSprite_17 at different depths
 * (depths 1, 7, 13, 19, 25, 31). Each DefineSprite_17 instance has an
 * `onClipEvent(load)` that calls `gotoAndPlay(random(N))` to stagger its
 * start frame, and DefineSprite_17 itself has a frame_1 DoAction that
 * installs an `onEnterFrame` which does a speed-ramped loop playback.
 *
 * Library symbols:
 *   - sprite17 (DefineSprite_17) — directlyDynamic:true. Single-frame
 *     visual particle. onLoad (from PlaceObject2 clipEvents) calls
 *     gotoAndPlay(random(N)) to stagger. frame_1 DoAction installs an
 *     onEnterFrame that accelerates playback: every 20 ticks it increments
 *     speed `t`, then jumps `f = currentFrame + t` frames ahead.
 *   - sprite18 (DefineSprite_18) — directlyDynamic:false. Container that
 *     at frame_1 places 6 sprite17 instances at depths 1,7,13,19,25,31
 *     with their respective transforms (all at translateY=-10 per manifest
 *     placement matrix). frame_1 frameScripts attaches all 6.
 *
 * The outer DefineSprite_20 (anim1, 84 frames) places sprite19 at frame 3
 * (depth 1) with a scale/alpha tween through frame 78. We model this as
 * sprite19 being attached in onSpellStart (it lives at root/anim1 level)
 * with the anim1 composite frames providing the visual. The signalHit is
 * fired at frame 3 (first visible frame of sprite19 appearing = impact).
 *
 * The completion signal comes from DefineSprite_20/frame_82:
 *   `_parent.removeMovieClip()` → this.runtime.complete() at frame 82
 *   (0-based index 81).
 *
 * Since `anim1` in the manifest has no librarySymbols prefix (it's in
 * animations[], not librarySymbols[]), textures use bare "anim1" key.
 * sprite18 and sprite17 appear in librarySymbols[] so they use "lib_sprite18"
 * and "lib_sprite17" keys respectively.
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

// Bounds from manifest librarySymbols[0] (sprite18, characterId=18)
const SPRITE18_BOUNDS = {
  width: 132.1,
  height: 100.35,
  offsetX: -65.2,
  offsetY: -54.85,
};

// Bounds from manifest librarySymbols[1] (sprite19, characterId=19)
// sprite19 wraps sprite18 with the outer tween envelope
const SPRITE19_BOUNDS = {
  width: 132.1,
  height: 100.35,
  offsetX: -65.2,
  offsetY: -64.85,
};

// anim1 bounds from manifest animations[0]
const ANIM1_BOUNDS = {
  width: 193.45,
  height: 186.35,
  offsetX: -95.55,
  offsetY: -149.35,
};

export class Spell314 extends RuntimeSpell {
  readonly spellId = 314;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold symbol refs for cross-attachment
  private sprite17Sym!: SymbolDefinition;
  private sprite18Sym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite18Anchor = calculateAnchor(SPRITE18_BOUNDS);
    const sprite19Anchor = calculateAnchor(SPRITE19_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite17 (DefineSprite_17) — animated particle tile ----
    // AS: DefineSprite_17/frame_1/DoAction.as
    // Installs a self-accelerating playback loop via onEnterFrame.
    // The `a` counter ticks up each frame; every 20th tick `t` (speed)
    // increments by 1. Each tick the clip jumps forward `t` extra frames,
    // causing playback to accelerate over time.
    //
    // onLoad comes from 6 PlaceObject2 clipEvent scripts, each calling:
    //   gotoAndPlay(random(20))  or  gotoAndPlay(random(30))
    // These are applied per-instance via the depth-keyed attach in sprite18.
    this.sprite17Sym = {
      name: "sprite17",
      totalFrames: 84,
      frames: textures.getFrames("lib_sprite18"), // sprite17 visual = sprite18 frames (same characterId 18 visual)
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          0,
          // AS: DefineSprite_17/frame_1/DoAction.as
          // Installs onEnterFrame on the clip itself to drive accelerated looping.
          (clip) => {
            // Seed counters used by the onEnterFrame below
            clip.vars.a = 0;
            clip.vars.t = 1;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_17/frame_1/DoAction.as
        //   f = _currentframe + t;
        //   if(f > _totalframes) { f -= _totalframes; }
        //   gotoAndPlay(f);
        //   if(a++ % 20 == 1) { t += 1; }
        let a = clip.vars.a as number;
        const t = clip.vars.t as number;

        // AS _currentframe is 1-based; our currentFrame is 0-based.
        // Convert: AS _currentframe = currentFrame + 1
        // f = (_currentframe + t), then gotoAndPlay(f) which is 1-based → gotoAndPlay(f-1) in 0-based
        let f = (clip.currentFrame + 1) + t;
        const totalFrames = clip.totalFrames;
        if (f > totalFrames) {
          f -= totalFrames;
        }
        // AS gotoAndPlay(f) where f is 1-based → 0-based: f - 1
        clip.gotoAndPlay(f - 1);

        if (a % 20 === 1) {
          clip.vars.t = t + 1;
        }
        clip.vars.a = a + 1;
      },
    };

    // ---- sprite18 (DefineSprite_18) — container placing 6 sprite17 instances ----
    // directlyDynamic: false — no handlers of its own.
    // At frame_1 it places 6 instances of sprite17 (characterId=17 / DefineSprite_17)
    // at depths 1, 7, 13, 19, 25, 31 with translateY=-10 (per manifest placement matrix).
    //
    // Per the PlaceObject2 clipEvent scripts:
    //   depths 1,13,19,25 (PlaceObject2_17_1, _13, _19, _25): gotoAndPlay(random(20))
    //   depth 7  (PlaceObject2_17_7): gotoAndPlay(random(30))
    //   depth 31 (PlaceObject2_17_31): gotoAndPlay(random(20))
    //
    // We implement this by giving each instance an onLoad that randomizes its
    // start via gotoAndPlay. Since all 6 are from the same symbol definition
    // but need different random ranges at depth 7, we handle that by checking
    // a per-instance var set before attach, or by using two symbol variants.
    // The cleanest approach: use two symbol definitions sharing the same
    // sprite17 visual but with different onLoad random bounds.
    const sprite17Rand20Sym: SymbolDefinition = {
      name: "sprite17_r20",
      totalFrames: this.sprite17Sym.totalFrames,
      frames: this.sprite17Sym.frames,
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: this.sprite17Sym.frameScripts,
      onEnterFrame: this.sprite17Sym.onEnterFrame,
      onLoad: (clip) => {
        // AS: PlaceObject2_17_1/25/13/19/31 onClipEvent(load) → gotoAndPlay(random(20))
        clip.vars.a = 0;
        clip.vars.t = 1;
        const startFrame = Math.floor(Math.random() * 20);
        clip.gotoAndPlay(startFrame);
      },
    };
    this.registry.register(sprite17Rand20Sym);

    const sprite17Rand30Sym: SymbolDefinition = {
      name: "sprite17_r30",
      totalFrames: this.sprite17Sym.totalFrames,
      frames: this.sprite17Sym.frames,
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: this.sprite17Sym.frameScripts,
      onEnterFrame: this.sprite17Sym.onEnterFrame,
      onLoad: (clip) => {
        // AS: PlaceObject2_17_7 onClipEvent(load) → gotoAndPlay(random(30))
        clip.vars.a = 0;
        clip.vars.t = 1;
        const startFrame = Math.floor(Math.random() * 30);
        clip.gotoAndPlay(startFrame);
      },
    };
    this.registry.register(sprite17Rand30Sym);

    this.sprite18Sym = {
      name: "sprite18",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          0,
          // AS: DefineSprite_18/frame_1 places 6 sprite17 instances at varying depths
          // with translateY = -10 from manifest placement matrix.
          // Each gets its random start phase from its onLoad (above).
          (clip, ctx) => {
            // depth 1 — random(20)
            // AS: PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load) → gotoAndPlay(random(20))
            clip.attach(sprite17Rand20Sym, "p1", 1, ctx, { x: 0, y: -10 });
            // depth 7 — random(30)
            // AS: PlaceObject2_17_7/CLIPACTIONRECORD onClipEvent(load) → gotoAndPlay(random(30))
            clip.attach(sprite17Rand30Sym, "p7", 7, ctx, { x: 0, y: -10 });
            // depth 13 — random(20)
            // AS: PlaceObject2_17_13/CLIPACTIONRECORD onClipEvent(load) → gotoAndPlay(random(20))
            clip.attach(sprite17Rand20Sym, "p13", 13, ctx, { x: 0, y: -10 });
            // depth 19 — random(20)
            // AS: PlaceObject2_17_19/CLIPACTIONRECORD onClipEvent(load) → gotoAndPlay(random(20))
            clip.attach(sprite17Rand20Sym, "p19", 19, ctx, { x: 0, y: -10 });
            // depth 25 — random(20)
            // AS: PlaceObject2_17_25/CLIPACTIONRECORD onClipEvent(load) → gotoAndPlay(random(20))
            clip.attach(sprite17Rand20Sym, "p25", 25, ctx, { x: 0, y: -10 });
            // depth 31 — random(20)
            // AS: PlaceObject2_17_31/CLIPACTIONRECORD onClipEvent(load) → gotoAndPlay(random(20))
            clip.attach(sprite17Rand20Sym, "p31", 31, ctx, { x: 0, y: -10 });
          },
        ],
      ]),
    };

    // ---- sprite19 (DefineSprite_19) — wrapper around sprite18 with scale/alpha tween ----
    // directlyDynamic: false. Places sprite18 at depth 1 with translateY=-10.
    // The outer DefineSprite_20 (anim1) animates sprite19 via PlaceObject2 tween
    // (scale ramps 0.571→1.464, alpha ramps 20/256→20/256 over frames 3-78).
    // We attach sprite18 inside sprite19 at frame_1.
    this.sprite19Sym = {
      name: "sprite19",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite19"),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      frameScripts: new Map([
        [
          0,
          // sprite19 places sprite18 (characterId=18) at depth=1, translateY=-10
          // per manifest librarySymbols[0].placements[0].matrix.translateY = -10
          (clip, ctx) => {
            clip.attach(this.sprite18Sym, "sprite18", 1, ctx, { x: 0, y: -10 });
          },
        ],
      ]),
    };

    // ---- anim1 (DefineSprite_20, 84 frames) — outer composite ----
    // Hosts the sprite19 tween (place at frame 3, scale/alpha tween through frame 78).
    // frame_82 (0-based 81): _parent.removeMovieClip() → runtime.complete()
    //
    // The manifest shows sprite19 placed at parent frame 3 (0-based: index 3)
    // with scale=0.571, alpha=20/256. We model this by attaching sprite19 at
    // frame 3 and then updating its transform per-frame via onEnterFrame
    // interpolation through the tween keyframes from the manifest placements[].
    //
    // For signalHit: frame 3 is the first time sprite19 appears → impact moment.
    // We fire signalHit at frameScripts index 3 (AS frame_4 = first visible impact).
    // Actually the placement is at frame index 3 (0-based) which is AS frame_4.
    // Per the manifest: placements[0] frame=3 (0-indexed) = AS frame_4.
    // We signal hit when sprite19 first attaches (frame index 3).

    // Pre-compute the tween table from manifest placements for sprite19 in DefineSprite_20.
    // Format: [frameIndex, scaleX/Y, translateY, alphaMult/256]
    // Using the placements data from the manifest (sprite19's placements array).
    const sprite19Tween: Array<{
      frame: number;
      scale: number;
      y: number;
      alpha: number;
    }> = [
      { frame: 3, scale: 0.5710296630859375, y: 9, alpha: 20 / 256 },
      { frame: 4, scale: 0.6263275146484375, y: 6.2, alpha: 50 / 256 },
      { frame: 5, scale: 0.67779541015625, y: 3.65, alpha: 79 / 256 },
      { frame: 6, scale: 0.7254638671875, y: 1.25, alpha: 105 / 256 },
      { frame: 7, scale: 0.7693023681640625, y: -1.05, alpha: 129 / 256 },
      { frame: 8, scale: 0.8093414306640625, y: -3.05, alpha: 151 / 256 },
      { frame: 9, scale: 0.8455657958984375, y: -4.85, alpha: 171 / 256 },
      { frame: 10, scale: 0.8779754638671875, y: -6.5, alpha: 189 / 256 },
      { frame: 11, scale: 0.906585693359375, y: -7.95, alpha: 205 / 256 },
      { frame: 12, scale: 0.931365966796875, y: -9.15, alpha: 218 / 256 },
      { frame: 13, scale: 0.95233154296875, y: -10.25, alpha: 230 / 256 },
      { frame: 14, scale: 0.9694976806640625, y: -11.05, alpha: 239 / 256 },
      { frame: 15, scale: 0.98284912109375, y: -11.75, alpha: 247 / 256 },
      { frame: 16, scale: 0.99237060546875, y: -12.25, alpha: 252 / 256 },
      { frame: 17, scale: 0.9980926513671875, y: -12.55, alpha: 255 / 256 },
      { frame: 18, scale: 1, y: -12.5, alpha: 256 / 256 },
      // frames 19 (no entry) through 59: scale=1, alpha=1, y varies
      { frame: 20, scale: 1, y: -12.45, alpha: 1 },
      { frame: 21, scale: 1, y: -12.4, alpha: 1 },
      { frame: 22, scale: 1, y: -12.3, alpha: 1 },
      { frame: 23, scale: 1, y: -12.2, alpha: 1 },
      { frame: 24, scale: 1, y: -12.05, alpha: 1 },
      { frame: 25, scale: 1, y: -11.85, alpha: 1 },
      { frame: 26, scale: 1, y: -11.65, alpha: 1 },
      { frame: 27, scale: 1, y: -11.45, alpha: 1 },
      { frame: 28, scale: 1, y: -11.2, alpha: 1 },
      { frame: 29, scale: 1, y: -10.95, alpha: 1 },
      { frame: 30, scale: 1, y: -10.65, alpha: 1 },
      { frame: 31, scale: 1, y: -10.3, alpha: 1 },
      { frame: 32, scale: 1, y: -9.95, alpha: 1 },
      { frame: 33, scale: 1, y: -9.6, alpha: 1 },
      { frame: 34, scale: 1, y: -9.2, alpha: 1 },
      { frame: 35, scale: 1, y: -8.75, alpha: 1 },
      { frame: 36, scale: 1, y: -8.3, alpha: 1 },
      { frame: 37, scale: 1, y: -7.85, alpha: 1 },
      { frame: 38, scale: 1, y: -7.35, alpha: 1 },
      { frame: 39, scale: 1, y: -6.8, alpha: 1 },
      { frame: 40, scale: 1, y: -6.05, alpha: 1 },
      { frame: 41, scale: 1, y: -5.3, alpha: 1 },
      { frame: 42, scale: 1, y: -4.6, alpha: 1 },
      { frame: 43, scale: 1, y: -3.95, alpha: 1 },
      { frame: 44, scale: 1, y: -3.3, alpha: 1 },
      { frame: 45, scale: 1, y: -2.75, alpha: 1 },
      { frame: 46, scale: 1, y: -2.2, alpha: 1 },
      { frame: 47, scale: 1, y: -1.7, alpha: 1 },
      { frame: 48, scale: 1, y: -1.2, alpha: 1 },
      { frame: 49, scale: 1, y: -0.8, alpha: 1 },
      { frame: 50, scale: 1, y: -0.4, alpha: 1 },
      { frame: 51, scale: 1, y: 0, alpha: 1 },
      { frame: 52, scale: 1, y: 0.3, alpha: 1 },
      { frame: 53, scale: 1, y: 0.6, alpha: 1 },
      { frame: 54, scale: 1, y: 0.8, alpha: 1 },
      { frame: 55, scale: 1, y: 1.05, alpha: 1 },
      { frame: 56, scale: 1, y: 1.2, alpha: 1 },
      { frame: 57, scale: 1, y: 1.35, alpha: 1 },
      { frame: 58, scale: 1, y: 1.4, alpha: 1 },
      { frame: 59, scale: 1, y: 1.5, alpha: 1 },
      // frames 60: no entry (gap)
      { frame: 61, scale: 1.001434326171875, y: 1.3, alpha: 255 / 256 },
      { frame: 62, scale: 1.0057373046875, y: 0.8, alpha: 253 / 256 },
      { frame: 63, scale: 1.012908935546875, y: -0.05, alpha: 249 / 256 },
      { frame: 64, scale: 1.0229339599609375, y: -1.25, alpha: 244 / 256 },
      { frame: 65, scale: 1.0358428955078125, y: -2.85, alpha: 238 / 256 },
      { frame: 66, scale: 1.051605224609375, y: -4.7, alpha: 230 / 256 },
      { frame: 67, scale: 1.0702362060546875, y: -6.95, alpha: 220 / 256 },
      { frame: 68, scale: 1.09173583984375, y: -9.55, alpha: 209 / 256 },
      { frame: 69, scale: 1.1161041259765625, y: -12.5, alpha: 197 / 256 },
      { frame: 70, scale: 1.143341064453125, y: -15.75, alpha: 183 / 256 },
      { frame: 71, scale: 1.1734466552734375, y: -19.4, alpha: 168 / 256 },
      { frame: 72, scale: 1.2064208984375, y: -23.4, alpha: 151 / 256 },
      { frame: 73, scale: 1.24224853515625, y: -27.65, alpha: 133 / 256 },
      { frame: 74, scale: 1.28094482421875, y: -32.35, alpha: 113 / 256 },
      { frame: 75, scale: 1.322509765625, y: -37.3, alpha: 92 / 256 },
      { frame: 76, scale: 1.366943359375, y: -42.7, alpha: 70 / 256 },
      { frame: 77, scale: 1.41424560546875, y: -48.4, alpha: 45 / 256 },
      { frame: 78, scale: 1.46441650390625, y: -54.4, alpha: 20 / 256 },
    ];
    // Build a fast lookup map from frame index → tween entry
    const tweenMap = new Map<
      number,
      { scale: number; y: number; alpha: number }
    >();
    for (const entry of sprite19Tween) {
      tweenMap.set(entry.frame, { scale: entry.scale, y: entry.y, alpha: entry.alpha });
    }

    // Build frameScripts for anim1 (DefineSprite_20):
    const anim1FrameScripts = new Map<
      number,
      (clip: import("@dofus/spell-runtime").SpellClip, ctx: SpellContext) => void
    >();

    // frame 3 (0-based) = AS frame_4: place sprite19 for the first time
    anim1FrameScripts.set(3, (clip, ctx) => {
      // AS: PlaceObject2 places sprite19 at depth 1, frame 3 (0-indexed)
      // with initial scale=0.571, y=9, alpha=20/256
      const s19 = clip.attach(this.sprite19Sym, "sprite19", 1, ctx, {
        x: 0.05,
        y: 9,
      });
      s19.scaleX = 0.5710296630859375;
      s19.scaleY = 0.5710296630859375;
      s19.alpha = 20 / 256;
      // First visible frame of sprite19 = impact moment → signalHit
      this.runtime.signalHit();
    });

    // For each subsequent tween frame (frames 4-78), update sprite19 transform
    for (const entry of sprite19Tween) {
      if (entry.frame === 3) {
        continue; // Already handled above (place)
      }
      // Capture entry values in closure
      const { frame, scale, y, alpha } = entry;
      anim1FrameScripts.set(frame, (clip) => {
        // AS: PlaceObject2 move — update sprite19's matrix/colorTransform
        const s19 = clip.children.get("sprite19");
        if (s19) {
          s19.scaleX = scale;
          s19.scaleY = scale;
          s19.y = y;
          s19.alpha = alpha;
        }
      });
    }

    // frame 81 (0-based) = AS frame_82: _parent.removeMovieClip()
    // AS: DefineSprite_20/frame_82/DoAction.as → _parent.removeMovieClip()
    anim1FrameScripts.set(81, (clip) => {
      clip.remove();
      this.runtime.complete();
    });

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 84,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: anim1FrameScripts,
    };

    this.registry.register(this.sprite18Sym);
    this.registry.register(this.sprite19Sym);
    this.registry.register(this.anim1Sym);
    // sprite17_r20 and sprite17_r30 already registered above
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: attach anim1 (DefineSprite_20) at root depth 1.
    // No SOMA.playSound found in the canonical AS scripts for spell 314.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
