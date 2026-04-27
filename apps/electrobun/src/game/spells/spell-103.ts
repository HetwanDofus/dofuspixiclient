/**
 * Spell 103 — Attaque Naturelle (Feca).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer
 * (M4 validation slice — proves the runtime supports the runtime-
 * spawned-particle pattern that the previous "stack FrameAnimatedSprite
 * at target" approach couldn't handle).
 *
 * Canonical AS scripts under `tools/combat-exporter/output/spell-anims/
 * 103/scripts/scripts/` define five symbols:
 *
 *   - `lib_baton`   — orange thorn drift particle. onLoad seeds vx/vy
 *                     in [-0.8, 0.8] / [-1.5, 1.5], scales 35-95%.
 *                     onEnterFrame integrates pos with 0.95 friction.
 *   - `lib_baton2`  — orange thorn impact particle at target. onLoad
 *                     seeds amplitude `a` ∈ [10,30] deg, phase `i`,
 *                     decay `v2` ∈ [1.05,1.55]. onEnterFrame oscillates
 *                     rotation as `_rotation = a*sin(i++)`, decays
 *                     amplitude.
 *   - `lib_effet`   — 16-frame fire-burst impact composite, removes
 *                     itself at frame 16 (`DefineSprite_14_effet/
 *                     frame_16`).
 *   - `move`        — empty 2-frame container. frame 0 spawns `2 +
 *                     level²·0.7` baton thorns; frame 1 attaches
 *                     `effet` to its parent (the outer mc, anchored
 *                     at caster) and stops. The harness drives `move`
 *                     along a parabolic arc to the target.
 *   - `shoot`       — empty 106-frame container. frame 0 spawns the
 *                     same baton2 count; frame 105 removes the parent
 *                     and signals spell completion (~3.5 s burn).
 *
 * The harness configures displayType=30 (ProjectileBallistic), which
 * automatically attaches `move` at root, animates it along the arc,
 * and attaches `shoot` at the target on landing. We just register the
 * symbol semantics here.
 */

import type {
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const BATON_BOUNDS = {
  width: 49.1,
  height: 9.45,
  offsetX: -26.95,
  offsetY: -4.5,
};
const BATON2_BOUNDS = {
  width: 6.75,
  height: 35.15,
  offsetX: -3.2,
  offsetY: -19.1,
};
const EFFET_BOUNDS = {
  width: 100.8,
  height: 100.85,
  offsetX: -49.35,
  offsetY: -50.45,
};

export class Spell103 extends RuntimeSpell {
  readonly spellId = 103;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const batonAnchor = calculateAnchor(BATON_BOUNDS);
    const baton2Anchor = calculateAnchor(BATON2_BOUNDS);
    const effetAnchor = calculateAnchor(EFFET_BOUNDS);

    // ---- lib_baton — drift thorn during projectile flight --------
    // AS: DefineSprite_8_baton/frame_1/DoAction.as
    //   v = 1.6 * (-0.5 + Math.random())
    //   vy = 3 * (-0.5 + Math.random())
    //   t = 50 + 40 * (-0.5 + Math.random())
    //   _xscale = _yscale = t + 5
    //   onEnterFrame: _X += v; _Y += vy; v *= 0.95; vy *= 0.95
    const batonSym: SymbolDefinition = {
      name: "baton",
      totalFrames: 1,
      frames: textures.getFrames("lib_baton"),
      anchorX: batonAnchor.x,
      anchorY: batonAnchor.y,
      onLoad: (clip) => {
        clip.vars.v = 1.6 * (-0.5 + Math.random());
        clip.vars.vy = 3 * (-0.5 + Math.random());
        const t = 50 + 40 * (-0.5 + Math.random());
        clip.scaleX = (t + 5) / 100;
        clip.scaleY = (t + 5) / 100;
      },
      onEnterFrame: (clip) => {
        const v = clip.vars.v as number;
        const vy = clip.vars.vy as number;
        clip.x += v;
        clip.y += vy;
        clip.vars.v = v * 0.95;
        clip.vars.vy = vy * 0.95;
      },
    };

    // ---- lib_baton2 — burning thorn at target -------------------
    // AS DefineSprite_7_baton2/frame_1/DoAction.as:
    //   t = 100 - random(50)  → scale [50, 100]%
    //   _X = 40 * (0.5 - random)  → scatter X ±20
    //   _Y = 20 * (0.5 - random)  → scatter Y ±10
    // AS PlaceObject2_6_1/onClipEvent(load):
    //   a = 10 + random(20)   → amplitude in [10,30] deg
    //   i = 6 * Math.random()  → initial phase
    //   v2 = 1.05 + 0.5*Math.random() → decay
    // AS PlaceObject2_6_1/onClipEvent(enterFrame):
    //   _rotation = a * sin(i++);  a /= v2
    const baton2Sym: SymbolDefinition = {
      name: "baton2",
      totalFrames: 1,
      frames: textures.getFrames("lib_baton2"),
      anchorX: baton2Anchor.x,
      anchorY: baton2Anchor.y,
      onLoad: (clip) => {
        const tScale = 100 - Math.floor(Math.random() * 50);
        clip.scaleX = tScale / 100;
        clip.scaleY = tScale / 100;
        clip.x = 40 * (0.5 - Math.random());
        clip.y = 20 * (0.5 - Math.random());
        clip.vars.a = 10 + Math.floor(Math.random() * 20);
        clip.vars.i = 6 * Math.random();
        clip.vars.v2 = 1.05 + 0.5 * Math.random();
      },
      onEnterFrame: (clip) => {
        const a = clip.vars.a as number;
        const i = clip.vars.i as number;
        const v2 = clip.vars.v2 as number;
        // AS rotation is degrees → convert to radians for Pixi.
        clip.rotation = ((a * Math.sin(i)) * Math.PI) / 180;
        clip.vars.i = i + 1;
        clip.vars.a = a / v2;
      },
    };

    // ---- lib_effet — 16-frame impact composite --------------------
    // AS DefineSprite_14_effet/frame_16/DoAction.as: removeMovieClip(this).
    // The dofasset may carry 14-18 frames (the extractor pads with
    // duplicate trailers); use what's actually present and clamp the
    // removal frame to length-1 if the asset is shorter than 16.
    const effetFrames = textures.getFrames("lib_effet");
    const effetTotal = Math.min(16, effetFrames.length);
    const effetRemovalFrame = Math.max(0, effetTotal - 1);
    const effetSym: SymbolDefinition = {
      name: "effet",
      totalFrames: Math.max(1, effetTotal),
      frames: effetFrames.slice(0, effetTotal),
      anchorX: effetAnchor.x,
      anchorY: effetAnchor.y,
      frameScripts: new Map([
        [
          effetRemovalFrame,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — 2-frame container (empty content) ----------------
    // AS DefineSprite_10_move/frame_1/DoAction.as:
    //   nb = 2 + _parent.level² * 0.7; spawn baton particles
    // AS frame_2/DoAction.as:
    //   _parent.attachMovie("effet","effet",100); stop()
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: while (c < 2 + f*f*0.7). Strict-less against a FLOAT
            // means the loop runs ceil(2.7) = 3 times at level 1, not
            // floor (2). Use the un-floored bound directly.
            const level = (clip.parent?.vars.level as number) ?? 1;
            const bound = 2 + level * level * 0.7;
            for (let c = 0; c < bound; c++) {
              clip.attach(batonSym, `baton${c}`, c, ctx);
            }
          },
        ],
        [
          1,
          (clip, ctx) => {
            // Canonical AS DefineSprite_10_move/frame_2/DoAction.as:
            //   _parent.attachMovie("effet","effet",100);
            //   stop();
            // attachMovie with no initObject → child placed at parent
            // local (0,0). For displayType 30, parent (the outer mc)
            // is at world (caster.x, caster.y - 10) per
            // VisualEffectHandler.as:114, so effet's center renders
            // there. Strict 1:1 — no extra offset.
            const parent = clip.parent;
            if (parent && !parent.children.has("effet")) {
              parent.attach(effetSym, "effet", 100, ctx);
            }
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 106-frame burn at target ------------------------
    // AS DefineSprite_9_shoot/frame_1/DoAction.as:
    //   f = _parent.level;
    //   _rotation = 0;            ← KEY: cancels the velocity-angle
    //                                rotation that VisualEffectHandler
    //                                applied when attaching shoot, so
    //                                the burning thorns stand UPRIGHT
    //                                regardless of how steep the
    //                                projectile arc was. Without this
    //                                line the thorns look "crooked"
    //                                at close range where the landing
    //                                velocity has a large vyi component.
    //   nb = 2 + level² * 0.7; spawn baton2 particles
    // AS frame_106/DoAction.as:
    //   _parent.removeMovieClip()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 106,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Override the harness-applied projectile-velocity rotation
            // — canonical AS does `_rotation = 0` here.
            clip.rotation = 0;
            // Same `c < 2 + f*f*0.7` strict-less-than-float bound as
            // baton: loop runs ceil(value) times, not floor. Level 1 =
            // 3 baton2 thorns, level 6 = 28.
            const level = (clip.parent?.vars.level as number) ?? 1;
            const bound = 2 + level * level * 0.7;
            for (let c = 0; c < bound; c++) {
              clip.attach(baton2Sym, `baton2_${c}`, c, ctx);
            }
          },
        ],
        [
          105,
          (clip) => {
            // _parent.removeMovieClip — kill the whole spell tree;
            // the runtime treats clip.remove() on the root via
            // complete().
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(batonSym);
    this.registry.register(baton2Sym);
    this.registry.register(effetSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(callbacks: {
    playSound: (id: string) => void;
  }): void {
    // Top-level main timeline: SOMA.playSound("ronce"); stop();
    callbacks.playSound("ronce");
  }
}
