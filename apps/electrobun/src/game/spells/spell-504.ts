/**
 * Spell 504 — Maны (many_504).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/504/scripts/scripts/
 *
 * displayType=11 (TargetCell). No `move`/`shoot`/`duplicate` symbols, no
 * caster-reference logic, no ballistic arc. A single `anim1` composite
 * plays at the target cell. The main timeline plays the sound and the
 * outer DefineSprite_15 timeline runs 244 frames before removing the
 * parent (= signalling complete).
 *
 * Library symbols (all "clipEvent" kind, all directly or indirectly
 * dynamic):
 *
 *   sprite3  (characterId 3, directlyDynamic: true)
 *            — small star/spark particle. onLoad seeds v=0. onEnterFrame
 *              integrates gravity (v += 0.6) with floor-bounce at _Y=0
 *              (v = -5*random, vx = random scatter). No explicit removal;
 *              parent eventually removes the whole tree.
 *
 *   sprite4  (characterId 4, directlyDynamic: false)
 *            — wrapper that statically holds 6 sprite3 instances placed
 *              at different depths/transforms. No clip-event handlers of
 *              its own. Attached from sprite15's frameScripts at multiple
 *              frames (3, 24, 48) with a long alpha-tween schedule encoded
 *              in placement `kind: "move"` entries (fade-in frames 3-18,
 *              fade-out frames 130-156).
 *
 *   sprite9  (characterId 9, directlyDynamic: true)
 *            — "rond" oscillating ellipse. PlaceObject2_8_3 onClipEvent(load):
 *              seeds scale t ∈ [80,130]. No enterFrame of its own — alpha
 *              handled by parent sprite10's onEnterFrame watching _parent._xscale.
 *              PlaceObject2_6_1 onClipEvent(enterFrame): alpha = abs(_parent._xscale)
 *              when > 95, else 0.
 *
 *   sprite10 (characterId 10, directlyDynamic: true)
 *            — spinning/oscillating ring wrapper. onLoad: random rotation
 *              offset, random alpha, phase i. onEnterFrame: _xscale oscillates
 *              as 100*sin(i += 0.06). Holds one sprite9 child ("rond").
 *
 *   sprite13 (characterId 13, directlyDynamic: true)
 *            — random-alpha shimmer containing one sprite10. onEnterFrame:
 *              _alpha = random(170).
 *
 *   sprite14 (characterId 14, directlyDynamic: true)
 *            — floating spiral element. onLoad seeds spiral params (v, v2,
 *              rotation, _parent._alpha=10). onEnterFrame: spirals upward
 *              (_Y = 5*cos(i) + (p -= v), _X = 25*sin(i += v2)), fades
 *              parent in/out, removes parent when _Y < -100 and alpha drops
 *              below 0.
 *
 *   sprite15 (characterId 15, not in librarySymbols — it IS the main animation
 *            container anim1, DefineSprite_15 in AS). frame_244: removeMovieClip
 *            + stop → spells complete.
 *
 * Main timeline frame_1: SOMA.playSound("many_504").
 * The main animation "anim1" is the DefineSprite_15 composite and is the
 * top-level child attached from onSpellStart. It has a 246-frame authored
 * timeline; frame_244 (0-based: 243) fires the completion script.
 *
 * Alpha-tween for sprite4 instances: the placements array encodes a
 * per-frame alpha schedule (frames 3→18 fade in, frames 130→156 fade out).
 * We drive this through the parent (anim1/sprite15) frameScripts at the
 * key frames rather than trying to enumerate every "move" entry, instead
 * using the encoded alphaMult values at the boundary keyframes and
 * interpolating linearly in an onEnterFrame on the anim1 clip.
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

// ── Manifest bounds ────────────────────────────────────────────────────────

const SPRITE3_BOUNDS = {
  width: 5.75,
  height: 4.5,
  offsetX: -2.85,
  offsetY: -2.25,
};

const SPRITE4_BOUNDS = {
  width: 42.4,
  height: 9.9,
  offsetX: -22,
  offsetY: -5.9,
};

const SPRITE9_BOUNDS = {
  width: 74.85,
  height: 39.75,
  offsetX: -14.95,
  offsetY: -19.35,
};

const SPRITE10_BOUNDS = {
  width: 74.85,
  height: 39.75,
  offsetX: -14.85,
  offsetY: -19.35,
};

const SPRITE13_BOUNDS = {
  width: 82.5,
  height: 60.8,
  offsetX: -21.95,
  offsetY: -39.9,
};

const SPRITE14_BOUNDS = {
  width: 51.55,
  height: 38,
  offsetX: -13.75,
  offsetY: -25.05,
};

// anim1 bounds (from manifest animations[0])
const ANIM1_BOUNDS = {
  width: 60.35,
  height: 38,
  offsetX: -22.6,
  offsetY: -25.15,
};

// ── Alpha-tween schedule for sprite4 instances ────────────────────────────
// Encoded from placement "move" entries in manifest.librarySymbols[sprite4].
// fade-in: frames 3→18 (alphaMult 13→256 in steps of ~16),
// hold:    frames 18→130 (alphaMult 256),
// fade-out: frames 130→156 (alphaMult 247→13 in steps of ~9).
// We store the keyframes as [parentFrame, alphaNormalized] pairs for
// interpolation inside the anim1 onEnterFrame.

// (This is used to animate each sprite4 instance's alpha based on how
//  many frames have elapsed since that instance was first placed.)
function sprite4AlphaForAge(age: number): number {
  // age = frames elapsed since placement (0-indexed)
  // fade-in: age 0 (frame 3) → age 15 (frame 18)
  if (age <= 0) {
    return 13 / 256;
  }
  if (age < 15) {
    // linear from 13/256 to 256/256 over 15 frames
    return (13 + (256 - 13) * (age / 15)) / 256;
  }
  // hold: age 15 → 127 (frame 18 → 130)
  if (age <= 127) {
    return 256 / 256;
  }
  // fade-out: age 127 → 153 (frame 130 → 156)
  if (age < 153) {
    return (256 - (256 - 13) * ((age - 127) / 26)) / 256;
  }
  return 13 / 256;
}

export class Spell504 extends RuntimeSpell {
  readonly spellId = 504;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so onSpellStart can attach anim1 which then
  // attaches sprite4/sprite14 etc. via its own frameScripts.
  private sprite3Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private sprite14Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite3Anchor = calculateAnchor(SPRITE3_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite13Anchor = calculateAnchor(SPRITE13_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ── sprite3 — gravity-bounce spark particle ──────────────────────────
    // directlyDynamic: true
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.sprite3Sym = {
      name: "sprite3",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite3"),
      anchorX: sprite3Anchor.x,
      anchorY: sprite3Anchor.y,
      onLoad: (clip) => {
        // AS: v = 0;
        clip.vars.v = 0;
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

    // ── sprite4 — static wrapper holding 6 sprite3 instances ─────────────
    // directlyDynamic: false
    // Placements from manifest.librarySymbols[sprite4].placements (all parentSpriteId=4, frame=0):
    //   depth 1:  scale=0.619, tx=-11,   ty=2.6
    //   depth 3:  scale=0.395, tx=-15.7, ty=-1.8
    //   depth 5:  scale=0.619, tx=7.35,  ty=1.8
    //   depth 7:  scale=0.293, tx=-21.15,ty=1.9
    //   depth 9:  scale=0.293, tx=19.55, ty=0.25
    //   depth 11: scale=0.293, tx=13.95, ty=-5.25
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
            // Attach 6 sprite3 instances at their authored placements.
            // Each instance gets independent var state (v, vx) via onLoad.

            // depth 1: scale=0.619, tx=-11, ty=2.6
            const s3a = clip.attach(this.sprite3Sym, "s3_d1", 1, ctx);
            s3a.x = -11;
            s3a.y = 2.6;
            s3a.scaleX = 0.6192626953125;
            s3a.scaleY = 0.6192626953125;

            // depth 3: scale=0.395, tx=-15.7, ty=-1.8
            const s3b = clip.attach(this.sprite3Sym, "s3_d3", 3, ctx);
            s3b.x = -15.7;
            s3b.y = -1.8;
            s3b.scaleX = 0.395050048828125;
            s3b.scaleY = 0.395050048828125;

            // depth 5: scale=0.619, tx=7.35, ty=1.8
            const s3c = clip.attach(this.sprite3Sym, "s3_d5", 5, ctx);
            s3c.x = 7.35;
            s3c.y = 1.8;
            s3c.scaleX = 0.6192626953125;
            s3c.scaleY = 0.6192626953125;

            // depth 7: scale=0.293, tx=-21.15, ty=1.9
            const s3d = clip.attach(this.sprite3Sym, "s3_d7", 7, ctx);
            s3d.x = -21.15;
            s3d.y = 1.9;
            s3d.scaleX = 0.292877197265625;
            s3d.scaleY = 0.292877197265625;

            // depth 9: scale=0.293, tx=19.55, ty=0.25
            const s3e = clip.attach(this.sprite3Sym, "s3_d9", 9, ctx);
            s3e.x = 19.55;
            s3e.y = 0.25;
            s3e.scaleX = 0.292877197265625;
            s3e.scaleY = 0.292877197265625;

            // depth 11: scale=0.293, tx=13.95, ty=-5.25
            const s3f = clip.attach(this.sprite3Sym, "s3_d11", 11, ctx);
            s3f.x = 13.95;
            s3f.y = -5.25;
            s3f.scaleX = 0.292877197265625;
            s3f.scaleY = 0.292877197265625;
          },
        ],
      ]),
    };

    // ── sprite9 — oscillating ellipse ("rond") ───────────────────────────
    // directlyDynamic: true
    // PlaceObject2_8_3 onClipEvent(load):  seeds _xscale/_yscale = 80+random(50)
    // PlaceObject2_6_1 onClipEvent(enterFrame): alpha mirrors abs(_parent._xscale) when > 95
    //
    // sprite9 is placed INSIDE sprite10 at depth 1, named "rond".
    // Its onLoad is PlaceObject2_8_3 (depth 3 in sprite9's own internal
    // content — but the CLIPACTIONRECORD scripts directory structure tells
    // us it lives at DefineSprite_9/frame_1/PlaceObject2_8_3).
    //
    // NOTE: the "enterFrame" script (PlaceObject2_6_1) reads _parent._xscale —
    // _parent here is sprite10 (the container). We access clip.parent.scaleX.
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_3/CLIPACTIONRECORD onClipEvent(load).as
        // t = 80 + random(50); _xscale = t; _yscale = t;
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(Math.abs(_parent._xscale) > 95) { _alpha = Math.abs(_parent._xscale); }
        // else { _alpha = 0; }
        // _parent is sprite10 — its scaleX oscillates via its own onEnterFrame
        const parentScaleX = clip.parent ? Math.abs(clip.parent.scaleX) * 100 : 0;
        if (parentScaleX > 95) {
          clip.alpha = parentScaleX / 100;
        } else {
          clip.alpha = 0;
        }
      },
    };

    // ── sprite10 — spinning/oscillating ring ─────────────────────────────
    // directlyDynamic: true
    // onLoad: random rotation, random alpha, phase i
    // onEnterFrame: _xscale = 100 * sin(i += 0.06)
    // Contains sprite9 at depth 1 named "rond" (placed at frame 0, tx=0.1).
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = random(360) - 90;
        // _alpha = random(50) + 40;
        // i = Math.random() * 6;
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;

        // Place sprite9 ("rond") at depth 1, tx=0.1
        const rond = clip.attach(this.sprite9Sym, "rond", 1, ctx);
        rond.x = 0.1;
        rond.y = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _xscale = 100 * Math.sin(i += 0.06);
        let i = clip.vars.i as number;
        i += 0.06;
        clip.scaleX = Math.sin(i);
        clip.vars.i = i;
      },
    };

    // ── sprite13 — random-alpha shimmer container ─────────────────────────
    // directlyDynamic: true
    // onEnterFrame: _alpha = random(170)
    // Contains two sprite10 instances (depths 1 and 3) from placements.
    // depth 1: scale=1, tx=0.55, ty=0.05
    // depth 3: scale=0, rotateSkew0/1=±0.668, tx=-0.05, ty=0.2
    //   (the depth-3 sprite10 starts at scale 0 with a skew/rotation transform)
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      onLoad: (clip, ctx) => {
        // depth 1: scale=1, tx=0.55, ty=0.05
        const s10a = clip.attach(this.sprite10Sym, "s10_d1", 1, ctx);
        s10a.x = 0.55;
        s10a.y = 0.05;
        s10a.scaleX = 1;
        s10a.scaleY = 1;

        // depth 3: scaleX/Y=0 initially, with rotation from skew
        // rotateSkew0 = -0.668, rotateSkew1 = 0.668 → rotation ≈ atan2(skew0, scale) but
        // since scaleX=scaleY=0 in the matrix, the rotation is encoded in the skew fields.
        // atan2(rotateSkew1, scaleX) = atan2(0.668, 0) = PI/2
        const s10b = clip.attach(this.sprite10Sym, "s10_d3", 3, ctx);
        s10b.x = -0.05;
        s10b.y = 0.2;
        s10b.scaleX = 0;
        s10b.scaleY = 0;
        s10b.rotation = Math.atan2(0.6684417724609375, 0);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_13/frame_1/PlaceObject2_12_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _alpha = random(170);
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ── sprite14 — floating spiral element ───────────────────────────────
    // directlyDynamic: true
    // Contains sprite13 at depth 1, scale=0.625, tx=-0.05, ty=-0.1
    // onLoad seeds spiral + fades parent in
    // onEnterFrame spirals upward, fades parent, removes when too high
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as
        // p = 0; i = 0;
        // v2 = 0.016 + 0.03 * Math.random();
        // _rotation = random(360);
        // _alpha = 120;
        // _parent._alpha = 10;
        // v = 0.3 + 0.6 * Math.random();
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.016 + 0.03 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 120 / 100;
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.6 * Math.random();

        // Place sprite13 at depth 1, scale=0.625, tx=-0.05, ty=-0.1
        const s13 = clip.attach(this.sprite13Sym, "s13", 1, ctx);
        s13.x = -0.05;
        s13.y = -0.1;
        s13.scaleX = 0.625;
        s13.scaleY = 0.625;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const parent = clip.parent;
        if (!parent) {
          return;
        }

        // if(_Y > -100 & _parent._alpha < 100) { _parent._alpha += 40; }
        if (clip.y > -100 && parent.alpha < 1.0) {
          parent.alpha = Math.min(1.0, parent.alpha + 40 / 100);
        }

        // if(_Y < -100) { _parent._alpha -= 10; if(_parent._alpha < 0) { remove } }
        if (clip.y < -100) {
          parent.alpha -= 10 / 100;
          if (parent.alpha < 0) {
            parent.visible = false;
            parent.remove();
            return;
          }
        }

        // _rotation = _rotation + 3;
        clip.rotation += (3 * Math.PI) / 180;

        // _Y = 5 * Math.cos(i) + (p -= v);
        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;

        p -= v;
        clip.vars.p = p;

        // _X = 25 * Math.sin(i += v2);
        i += v2;
        clip.vars.i = i;

        clip.y = 5 * Math.cos(i) + p;
        clip.x = 25 * Math.sin(i);

        // if(Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        if (Math.cos(i) < 0) {
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };

    // ── anim1 / DefineSprite_15 — main 246-frame composite container ──────
    // Not in librarySymbols[] directly (it IS the main animation). We model
    // it as a library symbol so we can attach it from onSpellStart and wire
    // all the internal placements through its frameScripts.
    //
    // Internal placements (from manifest.librarySymbols):
    //   sprite4  placed at frames 3, 24, 48 (depths 1, 15, 17 respectively)
    //            each with an alpha-tween encoded in "move" entries.
    //   sprite14 placed at frames 3, 24, 48 (depths 13, 15(alt), 17(alt))
    //            — wait, re-reading manifest: sprite14 placements are at
    //            frame 3 depth 13, frame 24 depth 15, frame 48 depth 17.
    //
    // The per-instance alpha tween is driven by age (frames since placement).
    // We track each sprite4 instance's birth frame and update alpha in
    // onEnterFrame on the anim1 clip.

    const anim1Frames = textures.getFrames("anim1");
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 246,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onEnterFrame: (clip) => {
        // Drive alpha tween for each sprite4 instance based on its birth frame.
        const frame = clip.currentFrame;

        // sprite4 instance at depth 1, born at frame 3 (0-based: 2→placed, starts ticking at 3)
        const sp4a = clip.children.get("sp4_d1");
        if (sp4a) {
          const age = frame - 3;
          if (age >= 0) {
            sp4a.alpha = sprite4AlphaForAge(age);
          }
        }

        // sprite4 instance at depth 15, born at frame 24 (0-based: 23)
        const sp4b = clip.children.get("sp4_d15");
        if (sp4b) {
          const age = frame - 24;
          if (age >= 0) {
            sp4b.alpha = sprite4AlphaForAge(age);
          }
        }

        // sprite4 instance at depth 17, born at frame 48 (0-based: 47)
        const sp4c = clip.children.get("sp4_d17");
        if (sp4c) {
          const age = frame - 48;
          if (age >= 0) {
            sp4c.alpha = sprite4AlphaForAge(age);
          }
        }
      },
      frameScripts: new Map([
        [
          // frame_4 (0-based: 3) — place sprite4 at depth 1 + sprite14 at depth 13
          3,
          (clip, ctx) => {
            // sprite4 depth 1: tx=-0.6, ty=-1.4, alpha=13/256 initially
            const sp4a = clip.attach(this.sprite4Sym, "sp4_d1", 1, ctx);
            sp4a.x = -0.6;
            sp4a.y = -1.4;
            sp4a.alpha = 13 / 256;

            // sprite14 depth 13: tx=-0.05, ty=-0.1
            const sp14a = clip.attach(this.sprite14Sym, "sp14_d13", 13, ctx);
            sp14a.x = -0.05;
            sp14a.y = -0.1;
          },
        ],
        [
          // frame_25 (0-based: 24) — place sprite4 at depth 15 + sprite14 at depth 15(alt)
          24,
          (clip, ctx) => {
            // sprite14 depth 15: tx=-0.05, ty=-0.1
            const sp14b = clip.attach(this.sprite14Sym, "sp14_d15", 15, ctx);
            sp14b.x = -0.05;
            sp14b.y = -0.1;

            // sprite4 depth 15 (using a different name to avoid collision):
            // The manifest shows sprite14 at depth 15 for frame 24, and sprite4 at depth 1.
            // Re-reading: sprite4 placements are depth 1 (frame 3), depth 15 (frame 24),
            // depth 17 (frame 48). sprite14 placements are depth 13 (frame 3), depth 15
            // (frame 24), depth 17 (frame 48). There's a depth collision at 15 between
            // sprite4 and sprite14 at frame 24. In Flash, same depth = later placement
            // replaces earlier. sprite14 is placed first (lower characterId in iteration?),
            // sprite4 second. We give them distinct instance names to allow both to coexist
            // since the runtime uses names not depths for the children map.
            const sp4b = clip.attach(this.sprite4Sym, "sp4_d15", 15, ctx);
            sp4b.x = -0.6;
            sp4b.y = -1.4;
            sp4b.alpha = 13 / 256;
          },
        ],
        [
          // frame_49 (0-based: 48) — place sprite4 at depth 17 + sprite14 at depth 17(alt)
          48,
          (clip, ctx) => {
            const sp14c = clip.attach(this.sprite14Sym, "sp14_d17", 17, ctx);
            sp14c.x = -0.05;
            sp14c.y = -0.1;

            const sp4c = clip.attach(this.sprite4Sym, "sp4_d17", 17, ctx);
            sp4c.x = -0.6;
            sp4c.y = -1.4;
            sp4c.alpha = 13 / 256;
          },
        ],
        [
          // frame_244 (0-based: 243) — DefineSprite_15/frame_244/DoAction.as:
          //   _parent.removeMovieClip(); stop();
          243,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Signal hit at the first meaningful impact frame. The animation
    // "arrives" at the target immediately (TargetCell, no projectile).
    // Canonical practice: signal hit when the effect visually peaks —
    // we use frame 13 (0-based: 12), roughly when sprite14 first starts
    // spiraling and the burst is at full alpha.
    // We wire this into anim1's frameScripts below.
    // (Appended to the existing Map via a second registration pass.)
    const existingScripts = this.anim1Sym.frameScripts as Map<
      number,
      (clip: ReturnType<typeof this.root.attach>, ctx: SpellContext) => void
    >;
    existingScripts.set(12, (_clip) => {
      this.runtime.signalHit();
    });

    this.registry.register(this.sprite3Sym);
    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Main timeline frame_1/DoAction.as: SOMA.playSound("many_504");
    callbacks.playSound("many_504");

    // Attach the main animation container at depth 1 on root.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
