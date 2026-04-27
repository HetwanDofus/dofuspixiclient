/**
 * Spell 808 — (Earth impact / explosion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/808/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, no dual-anchored timelines — a single impact animation plays at
 * the target cell. The manifest has one `animations[]` entry (`anim1`, 180
 * frames) and one `librarySymbols[]` entry (`pierres`, a bouncing rock
 * particle). No `move`/`shoot`/`duplicate` symbols present.
 *
 * Canonical AS layout:
 *
 *   - DefineSprite_16 (outer wrapper, 178-frame container):
 *       frame_178: `_parent.removeMovieClip(); stop();` → spell complete.
 *
 *   - DefineSprite_13 (impact flash / sound trigger, 46 frames):
 *       frame_1:  SOMA.playSound("explosion")
 *       frame_46: stop()
 *
 *   - DefineSprite_7 (animated impact sprite, 106 frames):
 *       frame_1:  gotoAndPlay(random(45) + 2)  — starts at random frame 2-46
 *       frame_106: stop()
 *
 *   - DefineSprite_15 (pierres spawner, 1 frame):
 *       frame_1 PlaceObject2_14_17 onClipEvent(load):
 *         attaches 3 `pierres` instances (c=0,1,2)
 *
 *   - lib_pierres — single-frame bouncing rock particle:
 *       onClipEvent(load): seeds vx/vy/t/v/vr, positions parent at random offset
 *       onClipEvent(enterFrame): integrates position with gravity, bounce on Y=0,
 *         stops when velocity is negligible
 *
 * The anim1 animation (180 frames) is the main baked composite. The outer
 * DefineSprite_16 drives the spell lifetime to frame 178 where it removes
 * itself. signalHit is fired at frame 13 of DefineSprite_13 (the "explosion"
 * frame, i.e. when the sound plays and the impact flash begins — frame_1 of
 * that sprite fires the sound).
 *
 * Since the manifest's `librarySymbols` is sparse (only `pierres`), and the
 * other DefineSprites (7, 13, 15, 16) are not listed in librarySymbols, they
 * are represented as container-only SymbolDefinitions with `frames: []`.
 * The `anim1` animation is the top-level visual and is attached via onSpellStart.
 *
 * Library symbols:
 *   - lib_pierres — rock particle. onLoad seeds vx/vy/t/v/vr, positions
 *     _parent at random offset. onEnterFrame: gravity+bounce simulation,
 *     stops when settled.
 *   - sprite_15 (pierres spawner) — container, attaches 3 pierres on load.
 *   - sprite_13 (flash/sound) — 46-frame container, plays sound on frame_1,
 *     stop on frame_46. signalHit fired at frame_1 (impact moment).
 *   - sprite_7 (impact anim) — 106-frame container, random seek on frame_1,
 *     stop on frame_106.
 *   - sprite_16 (outer wrapper) — 178-frame container, removes outer mc and
 *     signals complete on frame_178.
 *   - anim1 — 180-frame baked composite, top-level visual.
 *
 * Main timeline: `onSpellStart` attaches sprite_16 at depth 1.
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
  private sprite13Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite16Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_pierres — bouncing rock particle --------------------
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   vx = 5 * (Math.random() - 0.5)
        //   vy = 2 * (Math.random() - 0.5)
        //   _parent._x = 20 * (Math.random() - 0.5)
        //   _parent._y = 10 * (Math.random() - 0.5)
        //   t = 60 + 40 * Math.random()
        //   _xscale = t; _yscale = t; _alpha = 20 + random(90)
        //   v = -12 * Math.random() - 3
        //   vr = 40 * (-0.5 + Math.random())
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y — pierres' parent is the pierres clip itself
        // in canonical AS the inner child's load event sets _parent._x/y,
        // meaning the pierres container (clip) gets repositioned.
        // In our model the clip IS the pierres instance (the sprite definition
        // already carries the visual). We apply the position offset directly
        // on the clip, mirroring the effect of _parent._x assignment.
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -12 * Math.random() - 3;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t = t;
        // Internal Y position for bounce simulation (separate from clip.y which
        // tracks the _parent._x/_y offset set in load). We track _Y as a var.
        clip.vars.localY = 0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _parent._x += vx; _parent._y += vy
        //   if(t != 1) {
        //     _Y += v; _rotation += vr; v += 1.5
        //     if(_Y > 0) { vx/=2; vy/=2; _rotation=0; _Y=0; v=(-v)/4;
        //       if(Math.abs(v)<1) { vx=0; vy=0; t=1; } } }
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const t = clip.vars.t as number;

        // _parent._x += vx — move the container (clip) in X/Y
        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          let v = clip.vars.v as number;
          let localY = clip.vars.localY as number;
          let vr = clip.vars.vr as number;

          localY += v;
          // AS rotation in degrees → radians delta
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (localY > 0) {
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            localY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t = 1;
            }
          }

          clip.vars.v = v;
          clip.vars.localY = localY;
          clip.vars.vr = vr;
        }
      },
    };

    // ---- sprite_15 — pierres spawner (1-frame container) ---------
    // AS: DefineSprite_15/frame_1/PlaceObject2_14_17/CLIPACTIONRECORD onClipEvent(load).as
    //   c=0; while(c<3) { this.attachMovie("pierres","pierres"+c,c); c++; }
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS onClipEvent(load) for PlaceObject2_14_17 inside DefineSprite_15
        for (let c = 0; c < 3; c++) {
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // ---- sprite_13 — impact flash / sound (46-frame container) --
    // AS: DefineSprite_13/frame_1/DoAction.as → SOMA.playSound("explosion")
    // AS: DefineSprite_13/frame_46/DoAction.as → stop()
    // signalHit is fired here at frame_1 (impact moment, sound plays).
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 46,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as: SOMA.playSound("explosion")
            // Sound is played via onSpellStart at the outer level (main timeline).
            // Here we signal hit as this is the canonical impact moment.
            this.runtime.signalHit();
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_13/frame_46/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_7 — impact animated sprite (106-frame container) -
    // AS: DefineSprite_7/frame_1/DoAction.as → gotoAndPlay(random(45) + 2)
    // AS: DefineSprite_7/frame_106/DoAction.as → stop()
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 106,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7/frame_1/DoAction.as: gotoAndPlay(random(45) + 2)
            // AS gotoAndPlay(N) → clip.gotoAndPlay(N - 1)
            // random(45) gives 0-44, +2 gives 2-46, -1 for 0-based gives 1-45
            clip.gotoAndPlay(Math.floor(Math.random() * 45) + 1);
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_7/frame_106/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_16 — outer wrapper (178-frame container) ---------
    // AS: DefineSprite_16/frame_178/DoAction.as → _parent.removeMovieClip(); stop()
    // This is the outermost container; its removal signals spell completion.
    // It also hosts sprite_13, sprite_7, sprite_15, and anim1 as children.
    this.sprite16Sym = {
      name: "sprite_16",
      totalFrames: 178,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          177,
          (clip) => {
            // AS DefineSprite_16/frame_178/DoAction.as: _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
      onLoad: (clip, ctx) => {
        // Attach child sprites that are placed on DefineSprite_16's timeline.
        // sprite_13 (sound/flash), sprite_7 (random-start anim), sprite_15
        // (pierres spawner), and anim1 (baked composite) are all children of
        // the outer wrapper in the canonical SWF.
        clip.attach(this.anim1Sym, "anim1", 1, ctx);
        clip.attach(this.sprite13Sym, "sprite13", 2, ctx);
        clip.attach(this.sprite7Sym, "sprite7", 3, ctx);
        clip.attach(this.sprite15Sym, "sprite15", 4, ctx);
      },
    };

    // ---- anim1 — 180-frame baked composite (main visual) --------
    // Listed in manifest animations[] only (not librarySymbols[]) so
    // textures are loaded with the bare name "anim1" (no lib_ prefix).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 180,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite16Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_13/frame_1/DoAction.as: SOMA.playSound("explosion")
    // The manifest also lists this sound at frame 0. Play it at spell start.
    callbacks.playSound("explosion");

    // Attach the outer wrapper (sprite_16) which in turn attaches all
    // child sprites (anim1, sprite_13, sprite_7, sprite_15) in its onLoad.
    this.root.attach(this.sprite16Sym, "sprite16", 1, context);
  }
}
