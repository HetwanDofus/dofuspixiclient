/**
 * Spell 403 — Lakam (Earth impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/403/scripts/scripts/
 *
 * displayType=11 (TargetCell). Single animated composite (anim1, 84 frames)
 * plays at the target cell. No projectile, no caster reference — classic
 * impact-at-target pattern.
 *
 * Library symbols:
 *   - sprite6 (directlyDynamic: true) — particle sprite with clip events.
 *       Two onClipEvent(load) handlers seed rotation, scale, and vx.
 *       onClipEvent(enterFrame) shrinks yscale by /1.1, decrements alpha by
 *       2.3/100, and drifts X by (vx *= 0.97) per tick.
 *   - sprite7 (directlyDynamic: false) — wrapper sprite, attaches sprite6
 *       children at depths 3, 5, 7 from frame 0.
 *
 * Main timeline (DefineSprite_9):
 *   - frame_1: t = 17 (local var, unused at outer level; inner clip context).
 *   - frame_82: _parent.removeMovieClip(); stop() → spell complete.
 *
 * DefineSprite_9 also has sprite7 placed at frame 3 (depth 1, 9, 17) per
 * placements[]. DefineSprite_5/frame_1 rotates a child randomly.
 * DefineSprite_2/frame_13 stops.
 *
 * Main timeline frame_1: SOMA.playSound("lakam_401b").
 *
 * The anim1 animation is the primary visual (84 frames, stopFrame=81).
 * We model the whole thing as the anim1 symbol registered and attached
 * to root, with the sprite7 → sprite6 particle chain also live so the
 * dynamic clip handlers run correctly.
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

// ---- Manifest bounds for library symbols ----
const SPRITE6_BOUNDS = {
  width: 60.45,
  height: 105.45,
  offsetX: -29.95,
  offsetY: -52.65,
};
const SPRITE7_BOUNDS = {
  width: 60.45,
  height: 105.45,
  offsetX: -30.2,
  offsetY: -52.7,
};
// anim1 bounds (main composite animation)
const ANIM1_BOUNDS = {
  width: 145.25,
  height: 145.25,
  offsetX: -47.95,
  offsetY: -69.45,
};

export class Spell403 extends RuntimeSpell {
  readonly spellId = 403;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite6 — directlyDynamic particle sprite ---------------
    // AS: scripts/DefineSprite_6/frame_1/PlaceObject2_5_1/
    //       CLIPACTIONRECORD onClipEvent(load).as   (first load handler)
    //       CLIPACTIONRECORD onClipEvent(load)_2.as (second load handler)
    //       CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Two onClipEvent(load) handlers both fire at attach time. We merge
    // them into a single onLoad that applies all init from both scripts.
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_6/.../CLIPACTIONRECORD onClipEvent(load).as:
        //   _rotation = random(360);
        //   t = random(50) + 20;
        //   _xscale = t;
        //   _yscale = t;
        const rotDeg = Math.floor(Math.random() * 360);
        clip.rotation = (rotDeg * Math.PI) / 180;
        const t = Math.floor(Math.random() * 50) + 20;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.scaleYPercent = t;

        // AS DefineSprite_6/.../CLIPACTIONRECORD onClipEvent(load)_2.as:
        //   vx = 1.65 + 5 * Math.random();
        clip.vars.vx = 1.65 + 5 * Math.random();

        // Track alpha in Flash 0-100 units for correct 2.3 decrement
        clip.vars.alphaPercent = 100;
      },

      onEnterFrame: (clip) => {
        // AS DefineSprite_6/.../CLIPACTIONRECORD onClipEvent(enterFrame).as:
        //   _yscale = _yscale / 1.1;
        //   _alpha = _alpha - 2.3;
        //   _X = _X + (vx *= 0.97);
        let scaleYPercent = clip.vars.scaleYPercent as number;
        scaleYPercent = scaleYPercent / 1.1;
        clip.scaleY = scaleYPercent / 100;
        clip.vars.scaleYPercent = scaleYPercent;

        let alphaPercent = clip.vars.alphaPercent as number;
        alphaPercent = alphaPercent - 2.3;
        clip.alpha = alphaPercent / 100;
        clip.vars.alphaPercent = alphaPercent;

        let vx = clip.vars.vx as number;
        vx = vx * 0.97;
        clip.x = clip.x + vx;
        clip.vars.vx = vx;
      },
    };

    // ---- sprite7 — directlyDynamic: false wrapper ----------------
    // AS: no clip events of its own. Attaches three sprite6 instances
    // at depths 3, 5, 7 on its frame 0. Each placement has matrix:
    //   translateX: -0.25, translateY: -0.05 (near-zero offset).
    // Placements all have parentSpriteId === 7 (this sprite), frame 0.
    // DefineSprite_5/frame_1: _rotation = random(360) — this is the
    // frame_1 script of sprite5 (characterId 5), which is sprite7's
    // child visual. We model it as a frameScripts[0] randomising rotation.
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: sprite7 places sprite6 at depths 3, 5, 7 on its frame 0
            // (placements[0,1,2] all parentSpriteId=7, frame=0, kind="place")
            // matrix: translateX=-0.25, translateY=-0.05
            // Each gets independent onLoad var state.

            // depth 3
            clip.attach(this.sprite6Sym, "sprite6_d3", 3, ctx, {
              x: -0.25,
              y: -0.05,
            });
            // depth 5
            clip.attach(this.sprite6Sym, "sprite6_d5", 5, ctx, {
              x: -0.25,
              y: -0.05,
            });
            // depth 7
            clip.attach(this.sprite6Sym, "sprite6_d7", 7, ctx, {
              x: -0.25,
              y: -0.05,
            });

            // AS DefineSprite_5/frame_1/DoAction.as:
            //   _rotation = random(360);
            // sprite5 is the visual child placed inside sprite7 at depth
            // known from the SWF structure. We apply a random rotation
            // to this container itself to mirror the authored behavior.
            const rotDeg = Math.floor(Math.random() * 360);
            clip.rotation = (rotDeg * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- anim1 — main 84-frame composite at target ---------------
    // DefineSprite_9:
    //   frame_1 (index 0): t = 17  (local var; no visual effect at root)
    //   frame_82 (index 81): _parent.removeMovieClip(); stop()
    //                         → outer mc removal → spell complete
    //   frame_3 (index 2): sprite7 placed at depths 1, 9, 17
    //                       (placements parentSpriteId=9, frame=3)
    //   stopFrame=81, fadingFrame=80 per manifest.
    //
    // sprite7 placements on DefineSprite_9, frame=3 (index 2), depths 1/9/17:
    //   matrix: translateX=21.35, translateY=0.7, scale≈1
    const anim1Frames = textures.getFrames("anim1");

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 84,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_9/frame_1/DoAction.as: t = 17;
            // Local clip variable — stored in vars for completeness.
            clip.vars.t = 17;
          },
        ],
        [
          2,
          (clip, ctx) => {
            // DefineSprite_9, frame index 2 (AS frame_3):
            // sprite7 placed at depths 1, 9, 17 with matrix
            // translateX=21.35, translateY=0.7, scale≈1 (ratio=3 = phase offset).
            // Each is an independent wrapper instance spawning its own sprite6s.

            // depth 1
            clip.attach(this.sprite7Sym, "sprite7_d1", 1, ctx, {
              x: 21.35,
              y: 0.7,
            });
            // depth 9
            clip.attach(this.sprite7Sym, "sprite7_d9", 9, ctx, {
              x: 21.35,
              y: 0.7,
            });
            // depth 17
            clip.attach(this.sprite7Sym, "sprite7_d17", 17, ctx, {
              x: 21.35,
              y: 0.7,
            });
          },
        ],
        [
          81,
          (clip) => {
            // AS DefineSprite_9/frame_82/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Also register DefineSprite_2 (frame_13 → stop). This is an inner
    // sprite referenced by the composite. Its stopFrame=13 behavior
    // is captured via anim1's frames; we register a minimal symbol
    // in case the harness or anim1 frameScripts reference it.
    // The canonical AS: DefineSprite_2/frame_13/DoAction.as → stop().
    // This sprite is part of the composite anim1 rendering; no
    // additional runtime attachment is needed beyond what anim1 provides.

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_401b");
    callbacks.playSound("lakam_401b");

    // Attach the main anim1 composite to root so it starts ticking.
    // displayType=11 (TargetCell): root is already positioned at target cell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // signalHit at the impact frame. The canonical impact is when the
    // anim1 visual strikes — frame_1 of DefineSprite_9 is effectively
    // the start of the burst. We fire signalHit immediately (frame 0 of
    // the anim1 frameScripts) via a deferred call so the runtime has
    // started. Use the runtime directly here since we're inside
    // onSpellStart (safe: runtime is assigned before onSpellStart fires).
    this.runtime.signalHit();
  }
}
