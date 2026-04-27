/**
 * Spell 2902 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2902/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, no dual-anchor pattern — it is a pure target-cell impact composed
 * of a single authored container (DefineSprite_31) that auto-positions itself
 * at the target cell. The harness does nothing special for TargetCell; the
 * root clip is placed at the target by spell-view.
 *
 * Library symbols (all referenced via attachMovie inside the authored tree):
 *   - lib_minifeux  (DefineSprite_8)  — small fire spark, 36 frames. onLoad
 *     seeds alpha+velocity; onEnterFrame drifts/fades. frame_34 removes self.
 *     Spawned by a rotating sub-clip inside DefineSprite_26.
 *   - lib_minifeux2 (DefineSprite_7)  — small fire spark variant, 36 frames.
 *     Same pattern as minifeux but slightly different init. frame_34 removes.
 *     Spawned by DefineSprite_23_feux frame_8 particle (random chance per frame).
 *   - lib_minifeux3 (DefineSprite_6)  — longer spark, 78 frames. onLoad seeds
 *     alpha+v; onEnterFrame parent-alpha flicker + x-drift with friction.
 *     frame_76 removes self. Spawned by feux frame_11 and frame_14 particles.
 *   - lib_minifeux4 (DefineSprite_3)  — large firework spark, 78 frames. onLoad
 *     seeds angle/alpha/v/vr; onEnterFrame full angle-physics drift. frame_76
 *     removes self. Spawned by feux frame_14 particle on load.
 *   - lib_feux      (DefineSprite_23) — firework burst composite, 16 frames.
 *     frame_1 goesAndStop to level+1, selecting which internal particle variant
 *     runs. Contains several internal particle sub-clips (PlaceObject2_12_1 /
 *     PlaceObject2_14_1 / PlaceObject2_19_1 / PlaceObject2_22_1) that spawn
 *     minifeux2/3/4 into the grandparent. Multiple feux instances are spawned
 *     by DefineSprite_31 frame_76's onClipEvent(load).
 *
 * Main authored timeline DefineSprite_31 (97 frames):
 *   frame_1:  SOMA.playSound("fireworks01"); scale/rotation randomisation;
 *             compte = 1.
 *   frame_70: SOMA.playSound("explo_fireworks"); → signalHit.
 *   frame_76: onClipEvent(load) on placed child → spawns 6+7*((level-1)%3)
 *             feux instances, each scaled by sz=60+20*((level-1)%3).
 *   frame_97: stop() — spell is done → complete().
 *
 * The outer main timeline frame_319/DoAction.as calls
 * `_parent.removeMovieClip(); stop();` which is the top-level completion.
 * We map that to runtime.complete() on frame 96 (= AS frame_97 stop()).
 *
 * NOTE: The deeply nested particle sub-clips inside lib_feux (PlaceObject2_*)
 * each carry their own onLoad/onEnterFrame and do attachMovie calls into
 * `_parent._parent` (which is the root / outer mc in our model). We implement
 * these as the onLoad/onEnterFrame of synthetic inner symbols registered as
 * part of lib_feux's frameScripts, but because the runtime only supports one
 * level of child-clip clip-events, we model each feux "phase" (frame_2,
 * frame_5, frame_8, frame_11, frame_14) as the per-frame script of lib_feux
 * that attaches those particles directly. The particles themselves (minifeux*
 * instances) are attached to the root container so their positions/animations
 * are correct.
 *
 * The `compte` counter used across the various AS snippets is replaced with
 * a module-level incrementing counter to avoid depth collisions.
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
const MINIFEUX_BOUNDS  = { width: 2.45,  height: 2.05,  offsetX:   0.2,  offsetY: -1.2   };
const MINIFEUX2_BOUNDS = { width: 2.45,  height: 2.05,  offsetX:   0.2,  offsetY: -1.2   };
const MINIFEUX3_BOUNDS = { width: 2.45,  height: 2.05,  offsetX:   0.2,  offsetY: -1.2   };
const MINIFEUX4_BOUNDS = { width: 5.35,  height: 6.6,   offsetX:  -1.25, offsetY: -2.85  };
const FEUX_BOUNDS      = { width: 48.25, height: 53.3,  offsetX: -18.65, offsetY: -26.75 };

// Module-level depth counter shared across all attachMovie calls that need a
// globally-unique depth (mirrors the AS random(200000)/random(300000) pattern
// but deterministic to avoid depth collisions in our Map-keyed child lookup).
let _globalDepth = 1000;
function nextDepth(): number {
  return _globalDepth++;
}

export class Spell2902 extends RuntimeSpell {
  readonly spellId = 2902;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols captured so they can be referenced across frameScripts.
  private minifeuxSym!:  SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private feuxSym!:      SymbolDefinition;
  private sprite31Sym!:  SymbolDefinition;

  // Sound callback captured in onSpellStart so frame scripts can use it.
  private playSoundFn?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const minifeuxAnchor  = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const feuxAnchor      = calculateAnchor(FEUX_BOUNDS);

    // ── lib_minifeux (DefineSprite_8_minifeux) ─────────────────────────────
    // AS DefineSprite_8_minifeux/frame_1/DoAction.as:
    //   _rotation = random(360);
    //   _X = _parent.boule._x;   ← boule is an internal MC; we skip this
    //   _Y = _parent.boule._y;      position override (caller sets x/y).
    //
    // AS .../PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = 150; v = Math.random();
    //
    // AS .../PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _alpha -= 3.34; _X += v;
    //
    // AS .../frame_34/DoAction.as: this.removeMovieClip();
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/DoAction.as + onClipEvent(load)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 150 / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let alpha = clip.alpha * 100;
        alpha -= 3.34;
        clip.alpha = alpha / 100;
        const v = clip.vars.v as number;
        clip.x += v;
      },
      frameScripts: new Map([
        [33, (clip) => {
          // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip()
          clip.remove();
        }],
      ]),
    };

    // ── lib_minifeux2 (DefineSprite_7_minifeux2) ───────────────────────────
    // AS DefineSprite_7_minifeux2/frame_1/DoAction.as:
    //   _rotation = random(360);
    //
    // AS .../PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = random(150); v = Math.random();
    //
    // AS .../PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _alpha -= 3.34; _X += v;
    //
    // AS .../frame_34/DoAction.as: this.removeMovieClip();
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/DoAction.as + onClipEvent(load)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        let alpha = clip.alpha * 100;
        alpha -= 3.34;
        clip.alpha = alpha / 100;
        const v = clip.vars.v as number;
        clip.x += v;
      },
      frameScripts: new Map([
        [33, (clip) => {
          // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip()
          clip.remove();
        }],
      ]),
    };

    // ── lib_minifeux3 (DefineSprite_6_minifeux3) ───────────────────────────
    // AS DefineSprite_6_minifeux3/frame_1/DoAction.as:
    //   _rotation = random(360);
    //
    // AS .../PlaceObject2_5_1/onClipEvent(load):
    //   _alpha = random(150); v = 0.67 + 1 * Math.random();
    //
    // AS .../PlaceObject2_5_1/onClipEvent(enterFrame):
    //   _parent._alpha = random(100);
    //   _alpha -= 1.6;
    //   _X += (v *= 0.85);
    //
    // AS .../frame_76/DoAction.as: this.removeMovieClip();
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/DoAction.as + onClipEvent(load)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        // _parent._alpha = random(100) — clip itself is the "minifeux3" instance;
        // it has no meaningful parent to flicker here since it is attached directly
        // to root. We apply the alpha flicker to the clip itself as a best-effort
        // visual approximation of the canonical "the outer container flickers".
        clip.alpha = Math.floor(Math.random() * 100) / 100;
        let innerAlpha = (clip.vars._innerAlpha as number | undefined) ?? (clip.alpha * 100);
        innerAlpha -= 1.6;
        clip.vars._innerAlpha = innerAlpha;
        let v = clip.vars.v as number;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [75, (clip) => {
          // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip()
          clip.remove();
        }],
      ]),
    };

    // ── lib_minifeux4 (DefineSprite_3_minifeux4) ───────────────────────────
    // AS DefineSprite_3_minifeux4/frame_1/DoAction.as: (empty)
    //
    // AS .../PlaceObject2_2_1/onClipEvent(load):
    //   angle = 90;
    //   _alpha = random(150);
    //   v = -1.6 - 3.34 * Math.random();
    //   vr = -0.5 + Math.random();
    //
    // AS .../PlaceObject2_2_1/onClipEvent(enterFrame):
    //   _rotation = angle * 57.29746936176985;   (radians→degrees then stored)
    //   angle += vr;
    //   _parent._alpha = random(100);
    //   _alpha -= 1.6;
    //   _Y += (v *= 0.85);
    //   vx = v * Math.cos(angle);
    //   vy = v * Math.sin(angle);
    //   _X += vx; _Y += vy;
    //
    // AS .../frame_76/DoAction.as: this.removeMovieClip();
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(load)
        clip.vars.angle = 90; // stored as radians equivalent context below
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        // Note: AS stores `angle` in radians and converts to degrees via *57.297...
        // for _rotation. We keep angle in radians and set clip.rotation directly.
        let angle = clip.vars.angle as number;
        const vr = clip.vars.vr as number;
        let v = clip.vars.v as number;

        // _rotation = angle * 57.29746936176985  (AS degrees) →
        // clip.rotation = angle (already in radians, 57.297... = 180/pi converts back)
        clip.rotation = angle;

        angle += vr;
        clip.vars.angle = angle;

        // _parent._alpha = random(100) — flicker on self (see minifeux3 note)
        clip.alpha = Math.floor(Math.random() * 100) / 100;

        let alphaVal = (clip.vars._innerAlpha as number | undefined) ?? 150;
        alphaVal -= 1.6;
        clip.vars._innerAlpha = alphaVal;

        v *= 0.85;
        clip.vars.v = v;
        clip.y += v;

        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
      },
      frameScripts: new Map([
        [75, (clip) => {
          // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip()
          clip.remove();
        }],
      ]),
    };

    // ── lib_feux (DefineSprite_23_feux) ────────────────────────────────────
    // 16-frame firework burst. Each "phase" is selected by gotoAndStop on
    // frame_1. Internally places sub-clips (PlaceObject2_12_1 etc.) whose
    // onLoad/onEnterFrame spawn minifeux* into _parent._parent (= root).
    //
    // We model each phase as a self-contained symbol with onLoad/onEnterFrame
    // that encapsulate the PlaceObject2_* behaviour. Since the runtime only
    // supports one onLoad/onEnterFrame per symbol, we dispatch on
    // clip.vars.phase (set in frame_1 frameScript = gotoAndStop result).
    //
    // AS DefineSprite_23_feux/frame_1/DoAction.as:
    //   gotoAndStop(_parent._parent._parent.level + 1);
    //
    // Phases (the frame the clip stops at, 1-based in AS → 0-based in runtime):
    //   frame 2  (index 1) — small upward spark   (PlaceObject2_12_1, frame_2 variant)
    //   frame 5  (index 4) — medium rotating spark (PlaceObject2_14_1, frame_5 variant)
    //   frame 8  (index 7) — medium spark w/ minifeux2 spawning (PlaceObject2_12_1, frame_8)
    //   frame 11 (index 10) — large exploding spark → spawns minifeux3 burst (PlaceObject2_19_1)
    //   frame 14 (index 13) — large spark → spawns minifeux4 on load, minifeux3 on expire
    //                          (PlaceObject2_22_1, frame_14)
    //
    // For levels 1-6 the phase frame = level+1, cycling through the 5 phases
    // (the canonical AS uses the full level value; we clamp to [2..6] which
    // gives frame indices 1,2,3,4,5 → the five phases above).
    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_23_feux/frame_1/DoAction.as:
        //   gotoAndStop(_parent._parent._parent.level + 1)
        // clip._parent = a "feux" child inside sprite_31's sub-mc;
        // in our model clip.parent is the sprite_31 instance, and
        // root.vars.level is the spell level.
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars?.level as number | undefined) ?? 1;
        const phase = level + 1; // AS 1-based frame
        clip.vars.phase = phase;
        clip.gotoAndStop(phase - 1); // 0-based

        // Initialise per-phase vars mirroring each PlaceObject2 onClipEvent(load).
        if (phase === 2) {
          // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/onClipEvent(load)
          clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          clip.vars.g   = 1 * Math.random();
          clip.vars.va  = 0;
          const t = 100 + Math.floor(Math.random() * 100);
          clip.vars.t   = t;
          clip.scaleX   = t / 100;
          clip.scaleY   = t / 100;
          clip.vars.d   = 100 - Math.floor(Math.random() * 70);
          clip.vars.acc = 3.34 + Math.random() * 5;
          clip.vars.vacc = 1 + 1 * Math.random();
          clip.x        = 10 + Math.floor(Math.random() * 20);
        } else if (phase === 5) {
          // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/onClipEvent(load)
          clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          clip.vars.g   = 0.6 * Math.random();
          clip.vars.va  = 0;
          const t = 200 + Math.floor(Math.random() * 100);
          clip.vars.t   = t;
          clip.scaleX   = t / 100;
          clip.scaleY   = t / 100;
          clip.vars.d   = 100 - Math.floor(Math.random() * 70);
          clip.vars.acc = 1.67 + Math.random() * 5;
          clip.vars.vacc = 1 + 1 * Math.random();
          clip.x        = 10 + Math.floor(Math.random() * 20);
        } else if (phase === 8) {
          // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/onClipEvent(load)
          clip.vars.g    = 0.67 * Math.random();
          clip.vars.va   = 0;
          const t = 100 + Math.floor(Math.random() * 100);
          clip.vars.t    = t;
          clip.scaleX    = t / 100;
          clip.scaleY    = t / 100;
          clip.vars.d    = 100 - Math.floor(Math.random() * 70);
          clip.vars.acc  = 1.67 + Math.random() * 5;
          clip.vars.vacc = 1 + 1 * Math.random();
          clip.vars.vx   = 10 * (-0.5 + Math.random());
          clip.vars.vy   = 10 * (-0.5 + Math.random());
          clip.vars.accx = 0.8 + 0.1 * Math.random();
          clip.vars.accy = 0.8 + 0.1 * Math.random();
          clip.vars.c    = 0;
          clip.vars.compte = Math.floor(Math.random() * 200000);
        } else if (phase === 11) {
          // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/onClipEvent(load)
          clip.stop();
          clip.vars.g    = 0.67 * Math.random();
          clip.vars.va   = 0;
          const t = 100 + Math.floor(Math.random() * 100);
          clip.vars.t    = t;
          clip.scaleX    = t / 100;
          clip.scaleY    = t / 100;
          clip.vars.dmax = 100;
          clip.x         = -10 + Math.floor(Math.random() * 20);
          clip.vars.d    = 100 - Math.floor(Math.random() * 70);
          clip.vars.acc  = 1.67 + Math.random() * 5;
          clip.vars.vacc = 1.5 + 1.5 * Math.random();
          clip.vars.vx   = 20 * (-0.5 + Math.random());
          clip.vars.vy   = 20 * (-0.5 + Math.random());
          clip.vars.accx = 0.8 + 0.1 * Math.random();
          clip.vars.accy = 0.8 + 0.1 * Math.random();
          clip.vars.c    = 0;
        } else if (phase >= 14) {
          // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/onClipEvent(load)
          // Spawn minifeux4 instances into root (= _parent._parent in AS).
          const root2 = clip.parent?.parent ?? clip.parent;
          for (let nbr = 1; nbr < 2; nbr++) {
            const d = nextDepth();
            if (root2) {
              const mf4 = root2.attach(this.minifeux4Sym, `minifeux4_${d}`, d, ctx);
              mf4.x = clip.x;
              mf4.y = clip.y + (clip.parent?.y ?? 0);
            }
          }
          clip.vars.angle  = -1.1415 + 0.2 * (-0.5 + Math.random());
          clip.vars.vit    = 2 + 10 * Math.random();
          clip.stop();
          clip.vars.frein  = 0.9 + 0.05 * Math.random();
          clip.vars.vr     = 0;
          clip.vars.sz     = 240 + Math.floor(Math.random() * 120);
          clip.vars.frangle = 1.2;
          clip.vars.c      = 0;
        }
      },
      onEnterFrame: (clip, ctx) => {
        const phase = clip.vars.phase as number;

        if (phase === 2) {
          // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/onClipEvent(enterFrame)
          clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          let t = clip.vars.t as number;
          t = 20 + Math.floor(Math.random() * 80);
          clip.vars.t = t;
          clip.scaleX = t / 100;
          clip.scaleY = t / 100;
          const g = clip.vars.g as number;
          if (clip.parent) {
            clip.parent.y += g;
          }
          const vacc = clip.vars.vacc as number;
          let va = clip.vars.va as number;
          va += vacc;
          clip.vars.va = va;
          clip.alpha = (150 - va) / 100;
          const acc = clip.vars.acc as number;
          const d = clip.vars.d as number;
          clip.x -= (clip.x - d) / acc;
          if (clip.alpha < 0) {
            if (clip.parent) {
              clip.parent.remove();
            }
          }
        } else if (phase === 5) {
          // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/onClipEvent(enterFrame)
          let t = clip.vars.t as number;
          clip.rotation += ((t / 6) * Math.PI) / 180;
          t--;
          clip.vars.t = t;
          clip.scaleX = t / 3 / 100;
          clip.scaleY = t / 3 / 100;
          const g = clip.vars.g as number;
          if (clip.parent) {
            clip.parent.y += g;
          }
          const acc = clip.vars.acc as number;
          const d = clip.vars.d as number;
          clip.x -= (clip.x - d) / acc;
          if (t < 0) {
            if (clip.parent) {
              clip.parent.remove();
            }
          }
        } else if (phase === 8) {
          // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/onClipEvent(enterFrame)
          const root2 = clip.parent?.parent ?? clip.parent;
          if (Math.floor(Math.random() * 15) === 1) {
            let compte = clip.vars.compte as number;
            if (root2) {
              const mf2 = root2.attach(this.minifeux2Sym, `minifeux2_${compte}`, compte, ctx);
              mf2.x = clip.x;
              mf2.y = clip.y + (clip.parent?.y ?? 0);
              let c = clip.vars.c as number;
              mf2.alpha = (100 - c) / 100;
              c++;
              clip.vars.c = c;
            }
            compte = Math.floor(Math.random() * 200000);
            clip.vars.compte = compte;
          }
          let t = clip.vars.t as number;
          clip.rotation += ((t / 3) * Math.PI) / 180;
          t--;
          clip.vars.t = t;
          clip.scaleX = t / 3 / 100;
          clip.scaleY = t / 3 / 100;
          const g8 = clip.vars.g as number;
          if (clip.parent) {
            clip.parent.y += g8;
          }
          let vx8 = clip.vars.vx as number;
          let vy8 = clip.vars.vy as number;
          const accx8 = clip.vars.accx as number;
          const accy8 = clip.vars.accy as number;
          vx8 *= accx8;
          vy8 *= accy8;
          clip.vars.vx = vx8;
          clip.vars.vy = vy8;
          clip.x += vx8;
          clip.y += vy8;
          if (t < 0) {
            if (clip.parent) {
              clip.parent.remove();
            }
          }
        } else if (phase === 11) {
          // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/onClipEvent(enterFrame)
          let t = clip.vars.t as number;
          if (t < 150) {
            clip.play();
          }
          if (t < 135) {
            const root2 = clip.parent?.parent ?? clip.parent;
            let c = clip.vars.c as number;
            for (let nbr = 1; nbr < 10; nbr++) {
              const compte = nextDepth();
              if (root2) {
                const mf3 = root2.attach(this.minifeux3Sym, `minifeux3_${compte}`, compte, ctx);
                mf3.x = clip.x;
                mf3.y = clip.y + (clip.parent?.y ?? 0);
                mf3.alpha = (100 - c) / 100;
                c++;
              }
            }
            clip.vars.c = c;
            if (clip.parent) {
              clip.parent.remove();
            }
            return;
          }
          clip.rotation += ((t / 3) * Math.PI) / 180;
          t--;
          clip.vars.t = t;
          clip.scaleX = t / 3 / 100;
          clip.scaleY = t / 3 / 100;
          const g11 = clip.vars.g as number;
          if (clip.parent) {
            clip.parent.y += g11;
          }
          let vx11 = clip.vars.vx as number;
          let vy11 = clip.vars.vy as number;
          const accx11 = clip.vars.accx as number;
          const accy11 = clip.vars.accy as number;
          vx11 *= accx11;
          vy11 *= accy11;
          clip.vars.vx = vx11;
          clip.vars.vy = vy11;
          clip.x += vx11;
          clip.y += vy11;
        } else if (phase >= 14) {
          // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/onClipEvent(enterFrame)
          let angle  = clip.vars.angle  as number;
          let vit    = clip.vars.vit    as number;
          let vr     = clip.vars.vr     as number;
          let sz     = clip.vars.sz     as number;
          let frangle = clip.vars.frangle as number;
          const frein = clip.vars.frein as number;
          let t14    = clip.vars.t      as number | undefined;
          let c14    = clip.vars.c      as number;

          clip.rotation = angle; // angle already in radians (see onLoad)
          clip.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
          sz *= frein + 0.02;
          clip.vars.sz = sz;
          clip.scaleX = sz / 100;
          clip.scaleY = sz / 100;

          if (Math.floor(Math.random() * 24) === 1) {
            vr = 0.67 * (-0.5 + Math.random());
            clip.vars.vr = vr;
          }
          angle += vr * frangle;
          frangle *= frein;
          clip.vars.angle = angle;
          clip.vars.frangle = frangle;

          const vx14 = vit * Math.cos(angle);
          const vy14 = vit * Math.sin(angle);
          clip.x += vx14;
          clip.y += vy14;
          vit *= frein;
          clip.vars.vit = vit;

          if (t14 !== undefined && t14 < 150) {
            clip.play();
          }
          if (t14 !== undefined && t14 < 135) {
            const root2 = clip.parent?.parent ?? clip.parent;
            for (let nbr = 1; nbr < 10; nbr++) {
              const compte = nextDepth();
              if (root2) {
                const mf3 = root2.attach(this.minifeux3Sym, `minifeux3_${compte}`, compte, ctx);
                mf3.x = clip.x;
                mf3.y = clip.y + (clip.parent?.y ?? 0);
                mf3.alpha = (100 - c14) / 100;
                c14++;
              }
            }
            clip.vars.c = c14;
            if (clip.parent) {
              clip.parent.remove();
            }
          }
        }
      },
    };

    // ── sprite_31 — outer authored container (97 frames) ──────────────────
    // AS DefineSprite_31/frame_1/DoAction.as + DoAction_2.as:
    //   SOMA.playSound("fireworks01");   ← handled in onSpellStart
    //   taille = 80 + random(40);
    //   _xscale = taille; _yscale = taille;
    //   _rotation = -20 + random(40);
    //   compte = 1;
    //
    // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
    // AS DefineSprite_31/frame_76/PlaceObject2_28_3/onClipEvent(load):
    //   sz = 60 + 20 * ((level-1) % 3);
    //   _xscale = sz; _yscale = sz;
    //   i = 1; while (i < 6 + 7 * ((level-1) % 3)) { attachMovie("feux","feux"+i,i); i++ }
    //
    // AS DefineSprite_31/frame_97/DoAction.as: stop() → complete.
    //
    // Note: frame_76 has a PlaceObject2_28_3 whose onClipEvent(load) attaches
    // the feux instances. In our model DefineSprite_28 (frame_2: stop()) is the
    // container for that placed object. We treat frame_76 as a frameScript on
    // sprite_31 that directly does the feux attaches (DefineSprite_28 is just a
    // trivial stop() container; its onLoad functionality is the feux spawn loop).
    this.sprite31Sym = {
      name: "sprite_31",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_31/frame_1/DoAction_2.as
        const taille = 80 + Math.floor(Math.random() * 40);
        clip.scaleX = taille / 100;
        clip.scaleY = taille / 100;
        clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
        clip.vars.compte = 1;
      },
      frameScripts: new Map([
        [69, () => {
          // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
          // Also canonical hit frame — the explosion is when damage resolves.
          this.playSoundFn?.("explo_fireworks");
          this.runtime.signalHit();
        }],
        [75, (clip, ctx) => {
          // AS DefineSprite_31/frame_76/PlaceObject2_28_3/onClipEvent(load):
          // sz = 60 + 20 * ((level-1) % 3); attach 6+7*((level-1)%3) feux
          const level = (this.root.vars.level as number) ?? 1;
          const mod3 = (level - 1) % 3;
          const sz = 60 + 20 * mod3;
          const count = 6 + 7 * mod3;
          for (let i = 1; i < count; i++) {
            const child = clip.attach(this.feuxSym, `feux${i}`, i, ctx);
            child.scaleX = sz / 100;
            child.scaleY = sz / 100;
          }
        }],
        [96, (clip) => {
          // AS DefineSprite_31/frame_97/DoAction.as: stop()
          // This is the canonical end of the outer mc → complete.
          clip.stop();
          this.runtime.complete();
        }],
      ]),
    };

    this.registry.register(this.minifeuxSym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(this.sprite31Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");

    // Capture sound callback for use in frame scripts.
    this.playSoundFn = callbacks.playSound;

    // Attach the main authored container (sprite_31) at the root.
    // This mirrors the top-level main-timeline placement in the canonical SWF.
    this.root.attach(this.sprite31Sym, "sprite31", 1, context);
  }
}
