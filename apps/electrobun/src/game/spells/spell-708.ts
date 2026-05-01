/**
 * Spell 708 — Grina (Sadida/Osamodas vine whip effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 *
 * Canonical AS layout (`tools/combat-exporter/output/spell-anims/708/scripts/scripts/`):
 *
 *   - main timeline frame_1: SOMA.playSound("grina_701") — no stop(), so the
 *     main timeline plays freely through its authored frames.
 *
 *   - DefineSprite_22 (103-frame outer container, parent of sprite21):
 *       frame_103/DoAction.as: _parent.removeMovieClip() → spell complete.
 *       The manifest placements for sprite21 inside sprite22 carry a
 *       fade-in (frames 0-12, alphaMult 56→256) and a fade-out
 *       (frames 88-99, alphaMult 235→0) authored as PlaceObject2 "move"
 *       keyframes. We drive these via onEnterFrame on the sprite22 clip.
 *
 *   - DefineSprite_21 (sprite21, 1-frame, child of sprite22):
 *       Three instances of sprite20 are placed on its timeline at depth 3,
 *       7, and 11 (PlaceObject2_20_3, _7, _11). Each carries:
 *         onClipEvent(load): gotoAndPlay(random(_totalframes + 1))
 *       → sprite20 has totalFrames driven by sprite13 (see below).
 *
 *   - DefineSprite_20 (sprite20):
 *       frame_1/DoAction.as: _rotation = -random(180)
 *       → random initial rotation in [-179, 0] degrees.
 *       Contains sprite15 (rotating ring) via its placement matrix.
 *
 *   - DefineSprite_15 (sprite15, 1-frame, rotating ring):
 *       PlaceObject2_14_1/onClipEvent(enterFrame): _rotation += 1.6 deg/frame
 *       → continuously spins the ring visual.
 *
 *   - DefineSprite_13 (looping sub-animation, child inside sprite20):
 *       frame_1/DoAction.as: gotoAndPlay(random(31) + 2) → random start frame
 *       frame_52/DoAction.as: gotoAndPlay(2) → loop back to frame 2
 *
 * displayType=11 (TargetCell): single impact at target cell, no projectile,
 * no caster reference. The root container is anchored at the target cell by
 * the harness. sprite22 is the main authored timeline and gets attached to
 * root at onSpellStart.
 *
 * Library symbols:
 *   - lib_sprite15 — 1-frame rotating ring. onEnterFrame spins +1.6 deg/frame.
 *   - lib_sprite21 — 1-frame composite that holds three sprite20 instances.
 *     onLoad-equivalent handled via sprite21's frameScripts(0) attaching sprite20
 *     instances, each with gotoAndPlay(random(totalFrames+1)) in their onLoad.
 *   - sprite20 — container with random initial rotation. frame_1 sets rotation.
 *     Contains sprite15 (via placement matrix) and sprite13 (looping animation).
 *   - sprite13 — 51-frame looping animation: frame_1 jumps to random(31)+2,
 *     frame_52 loops back to 2.
 *   - sprite22 — 103-frame outer container. frame_103 removes parent and
 *     signals completion. onEnterFrame drives the alpha fade-in/fade-out
 *     schedule for the embedded sprite21 child.
 *
 * Main timeline: SOMA.playSound("grina_701") at frame_1.
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

const SPRITE15_BOUNDS = {
  width: 85.7,
  height: 85.7,
  offsetX: -42.85,
  offsetY: -42.85,
};

const SPRITE21_BOUNDS = {
  width: 138.75,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

export class Spell708 extends RuntimeSpell {
  readonly spellId = 708;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite22Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite21Anchor = calculateAnchor(SPRITE21_BOUNDS);

    // ---- lib_sprite15 — rotating ring particle --------------------
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 1.6;
    const sprite15Sym: SymbolDefinition = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      onEnterFrame: (clip) => {
        // AS: onClipEvent(enterFrame) { _rotation = _rotation + 1.6; }
        clip.rotation += (1.6 * Math.PI) / 180;
      },
    };

    // ---- sprite13 — 51-frame looping sub-animation ----------------
    // AS: DefineSprite_13/frame_1/DoAction.as: gotoAndPlay(random(31) + 2)
    // AS: DefineSprite_13/frame_52/DoAction.as: gotoAndPlay(2)
    // sprite13 is a child inside sprite20. The main animation frames for
    // the anim1 texture set are used here (51 frames, frame 0 jumps to
    // a random offset in [1..31], frame 51 loops back to frame 1).
    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 51,
      frames: textures.getFrames("anim1"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as:
            //   gotoAndPlay(random(31) + 2);
            const target = Math.floor(Math.random() * 31) + 2;
            clip.gotoAndPlay(target - 1);
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_13/frame_52/DoAction.as:
            //   gotoAndPlay(2);
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ---- sprite20 — rotating container with sprite15 + sprite13 --
    // AS: DefineSprite_20/frame_1/DoAction.as: _rotation = -random(180)
    // sprite20 contains sprite15 (the rotating ring, placed via matrix)
    // and sprite13 (the looping sub-anim).
    const sprite20Sym: SymbolDefinition = {
      name: "sprite20",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_20/frame_1/DoAction.as:
            //   _rotation = -random(180);
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;

            // Attach sprite15 (the ring) at depth 1 using the canonical
            // placement matrix from the manifest:
            // scaleX=0.757843, scaleY=0.386948, rotateSkew0=-0.407883,
            // rotateSkew1=0.743881, translateX=0, translateY=0
            // We apply translation (both 0) and let the anchor do the rest.
            // For the rotation/skew we use atan2 of the matrix values.
            const ring = clip.attach(sprite15Sym, "sprite15", 1, ctx, {
              x: 0,
              y: 0,
              rotation: Math.atan2(-0.4078826904296875, 0.757843017578125),
            });
            // Apply the matrix scale derived from the placement
            ring.scaleX = Math.sqrt(
              0.757843017578125 * 0.757843017578125 +
                (-0.4078826904296875) * (-0.4078826904296875),
            );
            ring.scaleY = Math.sqrt(
              0.7438812255859375 * 0.7438812255859375 +
                0.3869476318359375 * 0.3869476318359375,
            );

            // Attach sprite13 (the looping visual) at depth 2
            clip.attach(sprite13Sym, "sprite13", 2, ctx);
          },
        ],
      ]),
    };

    // ---- lib_sprite21 — 1-frame composite holding three sprite20s -
    // AS: DefineSprite_21/frame_1 places sprite20 at depths 3, 7, and 11.
    // Each placement has onClipEvent(load): gotoAndPlay(random(_totalframes+1))
    // We model this by giving sprite20 an onLoad that jumps to a random frame.
    // Since sprite20 itself has totalFrames=1, we integrate the load-phase
    // random-jump into the sprite20 onLoad. The three instances are attached
    // from sprite21's frameScripts at frame 0.
    //
    // The canonical "gotoAndPlay(random(_totalframes + 1))" on sprite20
    // instances effectively randomises their internal timeline start.
    // Because sprite20 only has 1 frame itself, the meaningful randomisation
    // is in the sprite13 child's frame_1 DoAction (which already randomises).
    // We model the load handler on sprite21's children by providing an onLoad
    // on sprite20Sym that adds a random phase to its child sprite13.
    const sprite20SymWithLoad: SymbolDefinition = {
      name: "sprite20",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_21/frame_1/PlaceObject2_20_{3,7,11}/
        //   CLIPACTIONRECORD onClipEvent(load).as:
        //   gotoAndPlay(random(_totalframes + 1))
        // sprite20 has 1 authored frame, so random(2) = 0 or 1.
        // gotoAndPlay(0) or gotoAndPlay(1) both resolve to frame 0 (1-based
        // frame 1 or 2, clamped to totalFrames). The net effect is the clip
        // starts playing from a random phase offset. Since totalFrames=1 and
        // 0-based gotoAndPlay(0) = frame 0, we just ensure isPlaying=true.
        clip.gotoAndPlay(0);
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_20/frame_1/DoAction.as: _rotation = -random(180)
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;

            // Attach sprite15 ring at depth 1 with canonical placement matrix
            const ring = clip.attach(sprite15Sym, "sprite15", 1, ctx, {
              x: 0,
              y: 0,
              rotation: Math.atan2(-0.4078826904296875, 0.757843017578125),
            });
            ring.scaleX = Math.sqrt(
              0.757843017578125 * 0.757843017578125 +
                (-0.4078826904296875) * (-0.4078826904296875),
            );
            ring.scaleY = Math.sqrt(
              0.7438812255859375 * 0.7438812255859375 +
                0.3869476318359375 * 0.3869476318359375,
            );

            // Attach sprite13 (the looping animation) at depth 2
            clip.attach(sprite13Sym, "sprite13", 2, ctx);
          },
        ],
      ]),
    };

    // lib_sprite21 — composite wrapper that places three sprite20 instances
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
            // AS: DefineSprite_21/frame_1 places sprite20 at depths 3, 7, 11.
            // Each carries onClipEvent(load): gotoAndPlay(random(_totalframes+1))
            // which is handled via onLoad on sprite20SymWithLoad.
            clip.attach(sprite20SymWithLoad, "sprite20_3", 3, ctx);
            clip.attach(sprite20SymWithLoad, "sprite20_7", 7, ctx);
            clip.attach(sprite20SymWithLoad, "sprite20_11", 11, ctx);
          },
        ],
      ]),
    };

    // ---- sprite22 — 103-frame outer container ---------------------
    // AS: DefineSprite_22/frame_103/DoAction.as: _parent.removeMovieClip()
    // sprite21 is placed inside sprite22 at depth 1 with a fade-in/fade-out
    // schedule authored as PlaceObject2 "move" keyframes:
    //   frames 0-12: alphaMult 56→256  (fade in)
    //   frames 12-88: alphaMult 256 (full opacity, held)
    //   frames 88-99: alphaMult 235→0 (fade out)
    //   frames 99+: invisible
    // We drive this alpha schedule via onEnterFrame on sprite22.
    // signalHit fires at frame 13 (full opacity reached = impact moment).
    this.sprite22Sym = {
      name: "sprite22",
      totalFrames: 103,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // Attach sprite21 at depth 1, initially at alphaMult=56/256
        const child = clip.attach(sprite21Sym, "sprite21", 1, ctx);
        child.alpha = 56 / 256;
        clip.vars.hitFired = false;
      },
      onEnterFrame: (clip) => {
        // Drive the authored alphaMult fade-in/fade-out schedule
        // from the manifest placements[] for sprite21 inside sprite22.
        // Fade-in: frames 0-12 (alphaMult 56 → 256)
        // Full: frames 12-88 (alphaMult 256)
        // Fade-out: frames 88-99 (alphaMult 235 → 0)
        // Frame indices are 0-based currentFrame after tick.
        const frame = clip.currentFrame;
        const child = clip.children.get("sprite21");
        if (!child) {
          return;
        }
        if (frame <= 12) {
          // Fade in: interpolate from 56 to 256 over frames 0..12
          const alpha = 56 + ((256 - 56) * frame) / 12;
          child.alpha = alpha / 256;
          if (frame === 12 && !(clip.vars.hitFired as boolean)) {
            clip.vars.hitFired = true;
            this.runtime.signalHit();
          }
        } else if (frame < 88) {
          child.alpha = 1;
          if (!(clip.vars.hitFired as boolean)) {
            clip.vars.hitFired = true;
            this.runtime.signalHit();
          }
        } else if (frame <= 99) {
          // Fade out: interpolate from 235 to 0 over frames 88..99
          const t = (frame - 88) / (99 - 88);
          const alpha = 235 * (1 - t);
          child.alpha = alpha / 256;
        } else {
          child.alpha = 0;
        }
      },
      frameScripts: new Map([
        [
          102,
          (clip) => {
            // AS DefineSprite_22/frame_103/DoAction.as:
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite15Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(sprite20SymWithLoad);
    this.registry.register(sprite21Sym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_701");
    callbacks.playSound("grina_701");

    // Attach sprite22 (the outer 103-frame container) at root, depth 1.
    // sprite22's onLoad attaches sprite21 and starts the alpha schedule.
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);
  }
}
