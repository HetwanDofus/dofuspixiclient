/**
 * Spell 2023 — (Explosion / Death effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2023/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single "shoot" animation in
 * animations[] (no librarySymbols), no projectile motion, no caster reference —
 * it's a pure impact at the target cell. The harness places root at target.
 *
 * Library symbols (from AS structure analysis):
 *   - DefineSprite_21 — a wobble/spin child placed inside DefineSprite_24 instances.
 *     PlaceObject2_20_1 onLoad seeds alpha, scale, vr, _parent.vr, i.
 *     onEnterFrame drives xscale oscillation and parent rotation decay.
 *
 *   - DefineSprite_23 — a "shard" that flies outward. PlaceObject2_22_1 onLoad
 *     seeds velocity v. onEnterFrame moves _X by v with 0.8 friction.
 *
 *   - DefineSprite_24 — a composite "spark" made of 10 DefineSprite_23 shards
 *     placed at depths 1,3,5,7,9,11,13,15,17,19. Each shard's onLoad randomizes
 *     its rotation. Contains one DefineSprite_21 (wobbler) at depth 1.
 *
 *   - shoot (DefineSprite_18_shoot) — 114-frame (100-frame active) container.
 *     frame_1: _rotation = 0 (canonical override).
 *     frame_100: _parent.removeMovieClip() + stop() → spell complete.
 *     Also hosts the PlaceObject2_24_1 outer-mc clip event that fades alpha
 *     starting at t > 45.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("explo_death").
 *
 * The outer-mc clip events (frame_1/PlaceObject2_24_1) belong to the
 * shoot container itself (depth 1 on the outer mc), tracking `t` and
 * fading alpha after frame 45. These are modelled as shoot's onLoad/
 * onEnterFrame since the outer mc IS the shoot clip in our runtime.
 *
 * The harness fires runtime.signalHit() must be called manually for
 * displayType=11. We fire it at the canonical impact frame — frame_1
 * of shoot (immediate impact on landing).
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

// Bounds from animations[] entry for "shoot"
const SHOOT_BOUNDS = {
  width: 184.9,
  height: 110.4,
  offsetX: -92.4,
  offsetY: -54.85,
};

export class Spell2023 extends RuntimeSpell {
  readonly spellId = 2023;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols stored as fields so onSpellStart can reference them
  private wobbleSym!: SymbolDefinition;
  private shardSym!: SymbolDefinition;
  private sparkSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ---- DefineSprite_21 — wobble/spin child inside each spark ----
    // PlaceObject2_20_1 onClipEvent(load):
    //   _alpha = 50 + random(50);
    //   ta = 30 + random(70);
    //   _xscale = ta; _yscale = ta;
    //   vr = 3.36 * (-0.5 + Math.random());
    //   _parent.vr = 100 * (-0.5 + Math.random());
    //   i = 0;
    // PlaceObject2_20_1 onClipEvent(enterFrame):
    //   _xscale = 100 * Math.sin(i += vr *= 0.9);
    //   _parent._rotation += _parent.vr *= 0.9;
    this.wobbleSym = {
      name: "wobble",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
        const ta = 30 + Math.floor(Math.random() * 70);
        clip.scaleX = ta / 100;
        clip.scaleY = ta / 100;
        clip.vars.vr = 3.36 * (-0.5 + Math.random());
        // _parent.vr is stored on the spark (clip.parent) that contains this wobble
        if (clip.parent) {
          clip.parent.vars.vr = 100 * (-0.5 + Math.random());
        }
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_21/frame_1/PlaceObject2_20_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vr = clip.vars.vr as number;
        let i = clip.vars.i as number;
        vr *= 0.9;
        i += vr;
        clip.scaleX = (100 * Math.sin(i)) / 100;
        clip.vars.vr = vr;
        clip.vars.i = i;

        if (clip.parent) {
          let parentVr = clip.parent.vars.vr as number;
          parentVr *= 0.9;
          clip.parent.rotation += (parentVr * Math.PI) / 180;
          clip.parent.vars.vr = parentVr;
        }
      },
    };

    // ---- DefineSprite_23 — individual shard that flies outward ----
    // PlaceObject2_22_1 onClipEvent(load):
    //   v = 3.3 + random(40);
    // PlaceObject2_22_1 onClipEvent(enterFrame):
    //   _X = _X + (v *= 0.8);
    this.shardSym = {
      name: "shard",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_23/frame_1/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.v = 3.3 + Math.floor(Math.random() * 40);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_23/frame_1/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let v = clip.vars.v as number;
        v *= 0.8;
        clip.x += v;
        clip.vars.v = v;
      },
    };

    // ---- DefineSprite_24 — spark composite: 10 shards + 1 wobbler ----
    // PlaceObject2_23_{1,3,5,7,9,11,13,15,17,19} onClipEvent(load):
    //   _rotation = random(360);
    // Contains one DefineSprite_21 (wobbler) at depth 1 (PlaceObject2_20_1).
    // The wobbler's onEnterFrame also drives _parent._rotation and _parent.vr.
    // The shards are authored at odd depths 1–19 with random rotation each.
    this.sparkSym = {
      name: "spark",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_24/frame_1 — 10 shards at depths 1,3,5,7,9,11,13,15,17,19
            // Each PlaceObject2_23_N onClipEvent(load): _rotation = random(360);
            const shardDepths = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
            for (let di = 0; di < shardDepths.length; di++) {
              const depth = shardDepths[di];
              const child = clip.attach(
                this.shardSym,
                `shard${depth}`,
                depth,
                ctx
              );
              // onLoad for shards randomizes rotation (PlaceObject2_23_N onClipEvent(load))
              child.rotation =
                (Math.floor(Math.random() * 360) * Math.PI) / 180;
            }
            // Attach the wobbler at depth 20 (PlaceObject2_20_1 inside DefineSprite_21
            // is depth 1 of DefineSprite_21, but DefineSprite_21 itself is the child here)
            clip.attach(this.wobbleSym, "wobble1", 20, ctx);
          },
        ],
      ]),
    };

    // ---- shoot (DefineSprite_18_shoot) — 114-frame impact container ----
    // animations[] entry: shoot, 114 frames.
    // DefineSprite_18_shoot/frame_1/DoAction.as: _rotation = 0;
    // DefineSprite_18_shoot/frame_100/DoAction.as: _parent.removeMovieClip(); stop();
    //
    // The outer-mc clip events (frame_1/PlaceObject2_24_1) are for the shoot
    // clip placed at depth 1 on the outer mc. They track a timer t and fade
    // alpha after t > 45. We model these as shoot's onLoad/onEnterFrame since
    // in our runtime the shoot IS the content placed at the root.
    //
    // Additionally, shoot's frame_1 spawns multiple spark instances. The
    // canonical SWF places DefineSprite_24 instances on the shoot timeline
    // authored at frame_1 (as authoring-time placed children, not via
    // attachMovie). We replicate this by attaching sparks in the frame_0 script.
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    this.shootSym = {
      name: "shoot",
      totalFrames: 114,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip) => {
        // AS: frame_1/PlaceObject2_24_1/CLIPACTIONRECORD onClipEvent(load).as
        // t = 0;
        clip.vars.t = 0;
      },
      onEnterFrame: (clip) => {
        // AS: frame_1/PlaceObject2_24_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(t++ > 45) { _alpha = _alpha - 3.3; }
        let t = clip.vars.t as number;
        if (t > 45) {
          clip.alpha = Math.max(0, clip.alpha - 3.3 / 100);
        }
        clip.vars.t = t + 1;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_18_shoot/frame_1/DoAction.as
            // _rotation = 0;
            clip.rotation = 0;

            // Signal hit immediately on impact (displayType=11, no harness signalHit)
            this.runtime.signalHit();

            // Attach spark composites authored on the shoot timeline.
            // The canonical SWF places multiple DefineSprite_24 instances at
            // frame_1 of the shoot sprite as authored (not attachMovie).
            // We replicate this by attaching several spark instances here.
            for (let s = 0; s < 6; s++) {
              clip.attach(this.sparkSym, `spark${s}`, s + 1, ctx);
            }
          },
        ],
        [
          99,
          (clip) => {
            // AS: DefineSprite_18_shoot/frame_100/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.wobbleSym);
    this.registry.register(this.shardSym);
    this.registry.register(this.sparkSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_1/DoAction.as — SOMA.playSound("explo_death");
    callbacks.playSound("explo_death");

    // The shoot clip is the main authored content at depth 1 on the outer mc.
    // For displayType=11, root is at target cell; attach shoot at root.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
