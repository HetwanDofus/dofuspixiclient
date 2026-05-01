/**
 * Spell 1203 — Panda (m_panda_spell_a).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1203/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The manifest has only a `shoot` animation
 * and no `move` symbol, which matches the linear projectile pattern: root is
 * rotated to face the target, and the harness attaches `shoot` at the target
 * offset inside the rotated container.
 *
 * Library symbols (all defined inline in the AS, no `librarySymbols[]` in manifest):
 *
 *   - `shoot` (DefineSprite_8_shoot, 74 frames) — the main projectile/impact
 *     animation. It is also the symbol the harness attaches at the target offset.
 *     frame_4:  `_rotation = 0;`  (resets harness-applied rotation so the
 *               impact visual stands upright).
 *     frame_39: A child clip (DefineSprite_4 via PlaceObject2_7_1) has an
 *               `onClipEvent(enterFrame)` that decrements `_parent._alpha` by
 *               3.34 per tick — i.e. the shoot clip itself fades out at -3.34/
 *               tick starting from frame 39. We model this as a SymbolDefinition
 *               `fadeParticle` attached at frame_39 whose onEnterFrame mutates
 *               its parent's alpha.
 *     frame_72: `stop(); _parent.removeMovieClip();` → `this.runtime.complete()`.
 *
 *   - `move` (DefineSprite_9_move) — the in-flight projectile container. Its
 *     lone placed child (PlaceObject2_3_1, DefineSprite_6 / DefineSprite_4) has
 *     an `onClipEvent(enterFrame)` that pulses `_alpha = 50 + random(50)` each
 *     tick. We model this as a `moveParticle` symbol attached in move's frame_1.
 *
 *   - Two particle "smoke puff" sprites referenced by the AS scripts:
 *       DefineSprite_6 — drift particle seeded from `_parent._parent.angle`.
 *                        Uses `_xscale = v*10` (single-axis scale). `t` starts
 *                        at 100 and decays by *0.999 (cosmetic, unused for
 *                        removal). Removed implicitly when v reaches ~0.
 *       DefineSprite_4 — drift particle, same physics but both axes scaled by t,
 *                        t starts at 70-100 and decays by *0.975. `va` changes
 *                        on `random(3)==1` (more frequent jitter).
 *
 * Main timeline: `SOMA.playSound("m_panda_spell_a");` (no stop, single frame).
 *
 * NOTE: The manifest `animations[]` only lists `shoot` (74 frames). `move` is
 * not a separate animation in this manifest — the harness for ProjectileLinear
 * only attaches `shoot` (not `move`), so we model `move` as a container-only
 * symbol for completeness, but the harness will only use `shoot`.
 *
 * Since ProjectileLinear harness does NOT call signalHit automatically, we call
 * `this.runtime.signalHit()` at the frame where the projectile visually impacts
 * the target. Given the animation, frame_4 (where `_rotation = 0` fires) is the
 * canonical "hit registered" moment (the first non-travel frame of the impact
 * burst).
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

// Shoot bounds from manifest animations[0]
const SHOOT_BOUNDS = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1203 extends RuntimeSpell {
  readonly spellId = 1203;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ---- DefineSprite_6 — alpha-pulsing move particle (in-flight) -----------
    // AS: scripts/DefineSprite_9_move/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    // This is the child placed inside the `move` container. Each tick its
    // alpha is randomised to 50-100%.
    const moveParticleSym: SymbolDefinition = {
      name: "moveParticle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _alpha = 50 + random(50);
        clip.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
      },
    };

    // ---- move — 1-frame container (the in-flight projectile) ----------------
    // AS: DefineSprite_9_move/frame_1 places a child (PlaceObject2_3_1)
    // whose enterFrame pulses alpha. We attach that child in frame_1.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach the alpha-pulsing child placed by PlaceObject2_3_1
            clip.attach(moveParticleSym, "moveParticle1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_6 drift particle — used inside shoot ------------------
    // AS: scripts/DefineSprite_6/frame_1/DoAction.as
    // Seeded with angle from _parent._parent.angle, v, va, t.
    // onEnterFrame: oscillate angle, drift with abs(vx), decay v.
    const driftParticle6Sym: SymbolDefinition = {
      name: "driftParticle6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction.as — init block
        // angle is read from _parent._parent.angle (shoot → root) at onLoad time
        const shootClip = clip.parent;
        const rootClip = shootClip?.parent;
        const angleDeg = (rootClip?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6/frame_1/DoAction.as — onEnterFrame
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        let t = clip.vars.t as number;

        let newVa = va;
        if (Math.floor(Math.random() * 5) === 0) {
          newVa = 20 * (-0.5 + Math.random());
        }

        // _xscale = v * 10  (single-axis scale, percent → decimal)
        clip.scaleX = (v * 10) / 100;

        t *= 0.999;

        angle += newVa;

        const rad = angle * 0.017453292519943295;
        const vx = Math.abs(v * Math.cos(rad));
        const vy = v * Math.sin(rad);

        clip.x += vx;
        clip.y += vy;

        v *= 0.95;

        // _rotation = angle (degrees → radians)
        clip.rotation = (angle * Math.PI) / 180;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = newVa;
        clip.vars.t = t;
      },
    };

    // ---- DefineSprite_4 drift particle — fade-out child in shoot frame_39 ---
    // Two roles:
    //   1. As a shoot sub-particle spawned at impact (same physics as DefineSprite_4).
    //   2. As the fade-driver: from frame_39 onward, each tick the shoot clip's
    //      alpha is decremented by 3.34.
    //
    // The canonical script path is:
    //   scripts/DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
    //   CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   → `_parent._alpha -= 3.34;`
    //
    // This places a child inside shoot at frame_39 whose enterFrame mutates
    // shoot's (_parent's) alpha. We model this as a dedicated `fadeDriver`
    // symbol whose onEnterFrame decrements clip.parent.alpha.

    const fadeDriverSym: SymbolDefinition = {
      name: "fadeDriver",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: scripts/DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3.34;
        const parent = clip.parent;
        if (parent) {
          const currentAlpha = parent.alpha;
          parent.alpha = Math.max(0, currentAlpha - 3.34 / 100);
        }
      },
    };

    // ---- DefineSprite_4 drift particle — impact scatter particle ------------
    // AS: scripts/DefineSprite_4/frame_1/DoAction.as
    // Similar to DefineSprite_6 but: both axes scaled by t; t starts at 70-100
    // and decays *0.975; va changes on random(3)==1.
    const driftParticle4Sym: SymbolDefinition = {
      name: "driftParticle4",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_4/frame_1/DoAction.as — init block
        const shootClip = clip.parent;
        const rootClip = shootClip?.parent;
        const angleDeg = (rootClip?.vars.angle as number) ?? 0;
        clip.vars.angle = angleDeg;
        clip.vars.v = 0.67 + Math.floor(Math.random() * 5);
        clip.vars.va = 20 * (-0.5 + Math.random());
        clip.vars.t = 70 + Math.floor(Math.random() * 30);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_4/frame_1/DoAction.as — onEnterFrame
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        if (Math.floor(Math.random() * 3) === 1) {
          va = 20 * (-0.5 + Math.random());
        }

        // _xscale = _yscale = t (percent → decimal)
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        t *= 0.975;

        angle += va;

        const rad = angle * 0.017453292519943295;
        const vx = Math.abs(v * Math.cos(rad));
        const vy = v * Math.sin(rad);

        clip.x += vx;
        clip.y += vy;

        v *= 0.95;

        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;
      },
    };

    // ---- shoot — 74-frame main impact animation --------------------------
    // AS: DefineSprite_8_shoot
    //   frame_4:  `_rotation = 0;`  — override harness rotation, stand upright.
    //   frame_39: PlaceObject2_7_1 attaches a child (fadeDriver) whose
    //             onEnterFrame decrements shoot's alpha by 3.34/tick.
    //   frame_72: `stop(); _parent.removeMovieClip();`
    //
    // Also spawns drift particles at frame_1 (impact scatter).
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 74,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // frame_1 of shoot: spawn scatter particles using DefineSprite_4
            // and DefineSprite_6 physics. These are implied by the shoot
            // symbol's authored content (impact burst scatters).
            // Spawn a small set of each particle type for the impact.
            const level = (clip.parent?.vars.level as number) ?? 1;
            const particleCount = 3 + level;
            for (let c = 0; c < particleCount; c++) {
              clip.attach(driftParticle4Sym, `dp4_${c}`, 10 + c, ctx);
            }
            for (let c = 0; c < particleCount; c++) {
              clip.attach(driftParticle6Sym, `dp6_${c}`, 20 + c, ctx);
            }
          },
        ],
        [
          3,
          (clip) => {
            // AS: scripts/DefineSprite_8_shoot/frame_4/DoAction.as
            // `_rotation = 0;`
            // Resets the velocity-angle rotation the harness applied when
            // attaching shoot, so the impact visual stands upright.
            clip.rotation = 0;
            // Signal hit at this frame — the impact is now visually confirmed.
            this.runtime.signalHit();
          },
        ],
        [
          38,
          (clip, ctx) => {
            // AS: scripts/DefineSprite_8_shoot/frame_39/PlaceObject2_7_1/
            //     CLIPACTIONRECORD onClipEvent(enterFrame).as
            // Place the fade-driver child at frame_39. Its onEnterFrame will
            // decrement _parent._alpha (i.e. shoot's alpha) by 3.34 each tick.
            clip.attach(fadeDriverSym, "fadeDriver1", 7, ctx);
          },
        ],
        [
          71,
          (clip) => {
            // AS: scripts/DefineSprite_8_shoot/frame_72/DoAction.as
            // `stop(); _parent.removeMovieClip();`
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveParticleSym);
    this.registry.register(moveSym);
    this.registry.register(driftParticle6Sym);
    this.registry.register(driftParticle4Sym);
    this.registry.register(fadeDriverSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // `SOMA.playSound("m_panda_spell_a");`
    callbacks.playSound("m_panda_spell_a");
  }
}
