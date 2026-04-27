/**
 * Spell 1206 — Panda spell (m_panda_spell_a).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1206/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest has `move` and `shoot`
 * animation entries. The harness drives `move` along a parabolic arc to the
 * target, then attaches `shoot` at impact and fires signalHit automatically.
 *
 * Symbols:
 *   - "sprite6" — streak/smoke particle spawned inside `move`. frame_1
 *     (DoAction) seeds angle (from _parent._parent.angle), v, va, t=100.
 *     onEnterFrame drifts with angular velocity, updates _xscale = v*10,
 *     t*=0.999, v*=0.95, _rotation = angle.
 *     AS: DefineSprite_6/frame_1/DoAction.as
 *
 *   - "sprite4" — puff particle spawned inside `shoot`. frame_1 seeds
 *     angle, v, va, t=70+random(30). onEnterFrame scales _xscale/_yscale=t,
 *     t*=0.975, v*=0.95, drifts by vx/vy.
 *     AS: DefineSprite_4/frame_1/DoAction.as
 *
 *   - "fade" — invisible child placed at shoot frame_39 whose onEnterFrame
 *     decrements _parent._alpha -= 3.34.
 *     AS: DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/onClipEvent(enterFrame).as
 *
 *   - "move" — 1-frame container. onEnterFrame flickers alpha (50+random(50)).
 *     frame_1 spawns sprite6 trail particles.
 *     AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/onClipEvent(enterFrame).as
 *
 *   - "shoot" — 74-frame composite from animations[]. frame_4 resets
 *     rotation=0. frame_39 attaches fade child. frame_72 stops +
 *     _parent.removeMovieClip → complete().
 *     AS: DefineSprite_8_shoot/frame_4/DoAction.as
 *         DefineSprite_8_shoot/frame_72/DoAction.as
 *
 * Main timeline: SOMA.playSound("m_panda_spell_a").
 * AS: frame_1/DoAction.as
 *
 * signalHit: fired automatically by the harness on ballistic landing
 * (displayType=30). NOT called from per-spell code.
 *
 * complete(): fired from shoot frameScripts[71] mirroring frame_72 DoAction.
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

const SHOOT_BOUNDS = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1206 extends RuntimeSpell {
  readonly spellId = 1206;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ----------------------------------------------------------------
    // "sprite6" — streak particle attached inside `move`.
    // AS: DefineSprite_6/frame_1/DoAction.as
    // frame_1 seeds state; onEnterFrame integrates physics each tick.
    // ----------------------------------------------------------------
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_6/frame_1/DoAction.as
        //   angle = _parent._parent.angle;
        //   v = 0.67 + random(5);
        //   va = 20 * (-0.5 + Math.random());
        //   t = 100;
        // _parent._parent is move's parent = root; angle is in degrees.
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/frame_1/DoAction.as — this.onEnterFrame
        //   if (random(5) == 0) { va = 20 * (-0.5 + Math.random()); }
        //   _xscale = v * 10;
        //   t *= 0.999;
        //   angle += va;
        //   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        //   vy = v * Math.sin(angle * 0.017453292519943295);
        //   _X += vx; _Y += vy;
        //   v *= 0.95;
        //   _rotation = angle;
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 5) === 0) {
          va = 20 * (-0.5 + Math.random());
        }
        // AS: _xscale = v * 10  (percent) → decimal
        clip.scaleX = (v * 10) / 100;
        t *= 0.999;
        angle += va;
        const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        const vy = v * Math.sin(angle * 0.017453292519943295);
        clip.x += vx;
        clip.y += vy;
        v *= 0.95;
        // AS: _rotation = angle (degrees) → radians
        clip.rotation = (angle * Math.PI) / 180;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ----------------------------------------------------------------
    // "sprite4" — puff particle attached inside `shoot`.
    // AS: DefineSprite_4/frame_1/DoAction.as
    // ----------------------------------------------------------------
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_4/frame_1/DoAction.as
        //   angle = _parent._parent.angle;
        //   v = 0.67 + random(5);
        //   va = 20 * (-0.5 + Math.random());
        //   t = 70 + random(30);
        // _parent._parent is shoot's parent = root.
        const root = clip.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 70 + Math.floor(Math.random() * 30);
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_4/frame_1/DoAction.as — this.onEnterFrame
        //   if (random(3) == 1) { va = 20 * (-0.5 + Math.random()); }
        //   _xscale = t; _yscale = t;
        //   t *= 0.975;
        //   angle += va;
        //   vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        //   vy = v * Math.sin(angle * 0.017453292519943295);
        //   _X += vx; _Y += vy;
        //   v *= 0.95;
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 3) === 1) {
          va = 20 * (-0.5 + Math.random());
        }
        // AS: _xscale = t; _yscale = t (percent) → decimal
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        t *= 0.975;
        angle += va;
        const vx = Math.abs(v * Math.cos(angle * 0.017453292519943295));
        const vy = v * Math.sin(angle * 0.017453292519943295);
        clip.x += vx;
        clip.y += vy;
        v *= 0.95;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ----------------------------------------------------------------
    // "fade" — invisible child placed inside shoot at frame_39.
    // onEnterFrame decrements the parent shoot clip's alpha by 3.34/frame.
    // AS: DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _parent._alpha -= 3.34
    // ----------------------------------------------------------------
    const fadeSym: SymbolDefinition = {
      name: "fade",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _parent._alpha -= 3.34  (alpha 0-100) → TS 0-1 delta
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3.34 / 100);
        }
      },
    };

    // ----------------------------------------------------------------
    // "move" — 1-frame container driven along the parabolic arc by the
    // harness. The canonical SWF placed a child (PlaceObject2_3_1)
    // whose onClipEvent(enterFrame) flickered alpha. We model that
    // flicker on the move clip itself (it's the only visual content)
    // and spawn sprite6 streak particles from frame_1.
    // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _alpha = 50 + random(50)
    // ----------------------------------------------------------------
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9_move/frame_1/PlaceObject2_3_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _alpha = 50 + random(50)  (0-100) → TS 0-1
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Spawn sprite6 streak particles so the projectile has a
            // visible trail. Particle count scales with spell level.
            const level = (clip.parent?.vars.level as number) ?? 1;
            const bound = 2 + level * level * 0.7;
            for (let c = 0; c < bound; c++) {
              clip.attach(sprite6Sym, `sprite6_${c}`, c + 1, ctx);
            }
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // "shoot" — 74-frame composite animation at the impact point.
    // Textures from animations[] entry "shoot" (no lib_ prefix).
    // Key frame scripts:
    //   frame_4  (index 3): _rotation = 0
    //   frame_39 (index 38): attach fade child
    //   frame_72 (index 71): stop(); _parent.removeMovieClip()
    // AS: DefineSprite_8_shoot/frame_4/DoAction.as
    //     DefineSprite_8_shoot/frame_72/DoAction.as
    // ----------------------------------------------------------------
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 74,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip, ctx) => {
        // Spawn sprite4 puff particles on first landing frame.
        const level = (clip.parent?.vars.level as number) ?? 1;
        const bound = 2 + level * level * 0.7;
        for (let c = 0; c < bound; c++) {
          clip.attach(sprite4Sym, `sprite4_${c}`, c + 10, ctx);
        }
      },
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_4/DoAction.as
            //   _rotation = 0
            // Cancels the velocity-angle rotation that the harness
            // applied when it attached shoot at landing.
            clip.rotation = 0;
          },
        ],
        [
          38,
          (clip, ctx) => {
            // AS: DefineSprite_8_shoot/frame_39 — place fade child
            // that will decay shoot's alpha from this point onward.
            if (!clip.children.has("fade")) {
              clip.attach(fadeSym, "fade", 7, ctx);
            }
          },
        ],
        [
          71,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_72/DoAction.as
            //   stop();
            //   _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(sprite4Sym);
    this.registry.register(fadeSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("m_panda_spell_a");
    callbacks.playSound("m_panda_spell_a");
  }
}
