/**
 * Spell 2901 — Fireworks (feux d'artifice).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2901/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a self-contained fireworks burst
 * at the target cell. There is no projectile, no caster-side anchor, no
 * dual-timeline pattern. The outer container (DefineSprite_31) lands at the
 * target, plays 97 frames, and signals completion on frame_97 stop(). The
 * harness handles no ballistic/beam logic, so signalHit must be fired
 * manually from the canonical hit frame (frame_70, the explosion sound frame).
 *
 * Library symbols:
 *   - lib_minifeux4  — 78-frame spark particle. onLoad seeds angle, alpha,
 *                      velocity v and angular velocity vr. onEnterFrame
 *                      rotates, drifts, fades; removes at frame_76.
 *   - lib_minifeux3  — 78-frame ember streak. onLoad seeds alpha, v.
 *                      onEnterFrame fades parent alpha, fades self, drifts X;
 *                      removes at frame_76.
 *   - lib_minifeux2  — 36-frame ember streak. onLoad seeds alpha, v.
 *                      onEnterFrame fades self, drifts X; removes at frame_34.
 *   - lib_minifeux   — 36-frame ember streak (same behaviour as minifeux2 but
 *                      initial alpha fixed at 150, position seeded from
 *                      parent's "boule" child position). Removes at frame_34.
 *   - lib_feux       — 16-frame composite firework burst. frame_1 jumps to
 *                      level+1 (level-dependent sub-variant). Multiple
 *                      per-particle clip events drive drift, rotation, scale,
 *                      and secondary particle spawning. Instantiated by
 *                      DefineSprite_31's frame_76 onLoad in a count loop.
 *
 * DefineSprite_31 (outer container, TargetCell anchor):
 *   frame_1:  playSound("fireworks01"); set taille scale/rotation; compte=1.
 *   frame_70: playSound("explo_fireworks") → signalHit.
 *   frame_76: onLoad spawns (6 + 7*((level-1)%3)) "feux" instances with
 *             size sz = 60 + 20*((level-1)%3).
 *   frame_97: stop() → complete().
 *
 * Main timeline frame_319: _parent.removeMovieClip(); stop() — this is the
 * outer destruction; we map it to this.runtime.complete() from the outer
 * container's frame_97 stop (the DefineSprite_31 timeline owns the spell
 * lifetime, and frame_97 is the canonical endpoint matching frame_319 of the
 * outer main timeline).
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

// ---- Bounds from librarySymbols[] entries ----

const MINIFEUX4_BOUNDS = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const MINIFEUX3_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX2_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const FEUX_BOUNDS = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

export class Spell2901 extends RuntimeSpell {
  readonly spellId = 2901;
  readonly displayType = SpellDisplayType.TargetCell;

  // Symbols that are cross-referenced between handlers (feux spawns minifeux3,
  // minifeux2, minifeux4 into its grandparent; outer container spawns feux).
  private minifeux4Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux2Sym!: SymbolDefinition;
  private minifeuxSym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;

  // Sound callback captured in onSpellStart for use from frame scripts.
  private soundCb?: (id: string) => void;

  // Per-instance depth counter for dynamically attached minifeux* inside
  // the feux particle handlers. We use a large base to avoid collision with
  // the authored depth 1-N of the feux children.
  private dynDepth = 100000;

  private nextDepth(): number {
    return this.dynDepth++;
  }

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const mf4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const mf3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const mf2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const mfAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);

    // ----------------------------------------------------------------
    // lib_minifeux4 — 78-frame spark / comet particle
    // AS: DefineSprite_3_minifeux4
    // ----------------------------------------------------------------
    // onClipEvent(load): AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // onClipEvent(enterFrame): AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // frame_76: AS DefineSprite_3_minifeux4/frame_76/DoAction.as → this.removeMovieClip()
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: mf4Anchor.x,
      anchorY: mf4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.angle = 90;
        clip.vars._alpha_val = Math.floor(Math.random() * 150);
        clip.alpha = (clip.vars._alpha_val as number) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;

        // _rotation = angle * 57.29746936176985  (radians→degrees factor inverted)
        // angle is already in radians here; multiply by 57.29... gives degrees,
        // but we need radians for Pixi. So: clip.rotation = angle (already radians).
        clip.rotation = angle;
        angle += vr;
        clip.vars.angle = angle;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }

        // _alpha = _alpha - 1.6
        let alphaVal = clip.vars._alpha_val as number;
        alphaVal -= 1.6;
        clip.vars._alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal / 100);

        // _Y = _Y + (v *= 0.85)
        v *= 0.85;
        clip.vars.v = v;
        clip.y += v;

        // vx = v * cos(angle); vy = v * sin(angle)
        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;
      },
      frameScripts: new Map([
        [
          75,
          (clip) => {
            // AS DefineSprite_3_minifeux4/frame_76/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux3 — 78-frame ember streak (longer-lived)
    // AS: DefineSprite_6_minifeux3
    // ----------------------------------------------------------------
    // onClipEvent(load): AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // onClipEvent(enterFrame): AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // frame_76: AS DefineSprite_6_minifeux3/frame_76/DoAction.as → this.removeMovieClip()
    // frame_1 DoAction: AS DefineSprite_6_minifeux3/frame_1/DoAction.as → _rotation = random(360)
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: mf3Anchor.x,
      anchorY: mf3Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        const alphaVal = Math.floor(Math.random() * 150);
        clip.vars._alpha_val = alphaVal;
        clip.alpha = alphaVal / 100;
        clip.vars.v = 0.67 + 1 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        let alphaVal = clip.vars._alpha_val as number;
        alphaVal -= 1.6;
        clip.vars._alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal / 100);

        let v = clip.vars.v as number;
        v *= 0.85;
        clip.vars.v = v;
        clip.x += v;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_1/DoAction.as: _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          75,
          (clip) => {
            // AS DefineSprite_6_minifeux3/frame_76/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux2 — 36-frame ember streak
    // AS: DefineSprite_7_minifeux2
    // ----------------------------------------------------------------
    // onClipEvent(load): AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // onClipEvent(enterFrame): AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // frame_34: AS DefineSprite_7_minifeux2/frame_34/DoAction.as → this.removeMovieClip()
    // frame_1 DoAction: AS DefineSprite_7_minifeux2/frame_1/DoAction.as → _rotation = random(360)
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: mf2Anchor.x,
      anchorY: mf2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        const alphaVal = Math.floor(Math.random() * 150);
        clip.vars._alpha_val = alphaVal;
        clip.alpha = alphaVal / 100;
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let alphaVal = clip.vars._alpha_val as number;
        alphaVal -= 3.34;
        clip.vars._alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal / 100);
        clip.x += clip.vars.v as number;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_1/DoAction.as: _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_7_minifeux2/frame_34/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux — 36-frame ember streak (position from boule child)
    // AS: DefineSprite_8_minifeux
    // ----------------------------------------------------------------
    // onClipEvent(load): AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    // onClipEvent(enterFrame): AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // frame_34: AS DefineSprite_8_minifeux/frame_34/DoAction.as → this.removeMovieClip()
    // frame_1 DoAction: AS DefineSprite_8_minifeux/frame_1/DoAction.as
    //   _rotation = random(360); _X = _parent.boule._x; _Y = _parent.boule._y
    this.minifeuxSym = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: mfAnchor.x,
      anchorY: mfAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        // _alpha = 150 (fixed, not random)
        clip.vars._alpha_val = 150;
        clip.alpha = 150 / 100; // clamped to 1 by Pixi — fine, starts opaque
        clip.vars.v = Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let alphaVal = clip.vars._alpha_val as number;
        alphaVal -= 3.34;
        clip.vars._alpha_val = alphaVal;
        clip.alpha = Math.max(0, alphaVal / 100);
        clip.x += clip.vars.v as number;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_1/DoAction.as
            // _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // _X = _parent.boule._x; _Y = _parent.boule._y
            // "boule" is a child of the parent feux clip; look it up.
            const boule = clip.parent?.find("boule");
            if (boule) {
              clip.x = boule.x;
              clip.y = boule.y;
            }
          },
        ],
        [
          33,
          (clip) => {
            // AS DefineSprite_8_minifeux/frame_34/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_feux — 16-frame composite firework burst
    // AS: DefineSprite_23_feux
    //
    // This is a complex multi-variant symbol. Its frame_1 DoAction does:
    //   gotoAndStop(_parent._parent._parent.level + 1)
    // which routes to one of several authored sub-frames, each carrying
    // a different PlaceObject2 clip with its own load/enterFrame events.
    //
    // The sub-frame variants referenced in the AS:
    //   frame 2  (level=1): PlaceObject2_12_1 — slow spinning sparkle, drifts to d
    //   frame 5  (level=4): PlaceObject2_14_1 — rotating fan, drifts to d
    //   frame 8  (level=7): PlaceObject2_12_1 — faster sparkle variant, spawns minifeux2
    //   frame 11 (level=10): PlaceObject2_19_1 — exploding star, spawns minifeux3
    //   frame 14 (level=13): PlaceObject2_22_1 — comet, spawns minifeux4 on load + minifeux3 on burst
    //
    // Since attachMovie("feux",...) is done with a loop count based on
    // (level-1)%3, and the feux frame_1 script routes by level, we need
    // to correctly use _parent._parent._parent.level. Inside the feux
    // symbol, _parent is the outer container (DefineSprite_31), and
    // _parent._parent is the root. We map: clip → outerContainer → root.
    //
    // All spawned minifeux*/minifeux3/minifeux2/minifeux4 are attached to
    // _parent._parent (= root) because they need to be peers of the feux
    // cluster, not children of it.
    // ----------------------------------------------------------------
    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_23_feux/frame_1/DoAction.as:
            //   gotoAndStop(_parent._parent._parent.level + 1)
            // clip.parent = outerContainer (DefineSprite_31)
            // clip.parent.parent = root
            const root = clip.parent?.parent;
            const level = (root?.vars.level as number) ?? 1;
            const targetFrame = level + 1; // AS 1-based
            clip.gotoAndStop(targetFrame - 1); // 0-based

            // Now we need to install the per-variant clip event handlers.
            // In canonical Flash, each gotoAndStop target frame has a
            // PlaceObject2 that carries its own onClipEvent(load) +
            // onClipEvent(enterFrame). We simulate this by running the
            // load handler now and installing onEnterFrame.

            // Determine which variant by the stopped frame (0-based):
            const f = clip.currentFrame; // 0-based after gotoAndStop

            if (f === 1) {
              // frame_2: PlaceObject2_12_1 — slow spinner
              // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.parent!.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
              clip.vars.vg = -6 * Math.random();
              clip.vars.g = 1 * Math.random();
              clip.vars.va = 0;
              const t2 = 100 + Math.floor(Math.random() * 100);
              clip.vars.t = t2;
              clip.scaleX = t2 / 100;
              clip.scaleY = t2 / 100;
              clip.vars.dmax = 100;
              clip.x = 10 + Math.floor(Math.random() * 20);
              clip.vars.d = 100 - Math.floor(Math.random() * 70);
              clip.vars.acc = 3.34 + Math.random() * 5;
              clip.vars.vacc = 1 + 1 * Math.random();
              clip.onEnterFrame = (c) => {
                // AS DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                c.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
                const tNew = 20 + Math.floor(Math.random() * 80);
                c.scaleX = tNew / 100;
                c.scaleY = tNew / 100;
                const g = c.vars.g as number;
                if (c.parent) {
                  c.parent.y += g;
                }
                let va = c.vars.va as number;
                const vacc = c.vars.vacc as number;
                va += vacc;
                c.vars.va = va;
                c.alpha = Math.max(0, (150 - va) / 100);
                const acc = c.vars.acc as number;
                const d = c.vars.d as number;
                c.x -= (c.x - d) / acc;
                if (c.alpha <= 0) {
                  c.parent?.remove();
                }
              };
            } else if (f === 4) {
              // frame_5: PlaceObject2_14_1 — rotating fan
              // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.parent!.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
              clip.vars.vg = -9 * Math.random();
              clip.vars.g = 0.6 * Math.random();
              clip.vars.va = 0;
              const t5 = 200 + Math.floor(Math.random() * 100);
              clip.vars.t = t5;
              clip.scaleX = t5 / 100;
              clip.scaleY = t5 / 100;
              clip.vars.dmax = 100;
              clip.x = 10 + Math.floor(Math.random() * 20);
              clip.vars.d = 100 - Math.floor(Math.random() * 70);
              clip.vars.acc = 1.67 + Math.random() * 5;
              clip.vars.vacc = 1 + 1 * Math.random();
              clip.onEnterFrame = (c) => {
                // AS DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let t = c.vars.t as number;
                // _rotation = _rotation + t / 6  (degrees)
                c.rotation += (t / 6 * Math.PI) / 180;
                t--;
                c.vars.t = t;
                c.scaleX = t / 100 / 3;
                c.scaleY = t / 100 / 3;
                const g = c.vars.g as number;
                if (c.parent) {
                  c.parent.y += g;
                }
                const acc = c.vars.acc as number;
                const d = c.vars.d as number;
                c.x -= (c.x - d) / acc;
                if (t < 0) {
                  c.parent?.remove();
                }
              };
            } else if (f === 7) {
              // frame_8: PlaceObject2_12_1 — faster sparkle, spawns minifeux2
              // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.vars.vg = -9 * Math.random();
              clip.vars.g = 0.67 * Math.random();
              clip.vars.va = 0;
              const t8 = 100 + Math.floor(Math.random() * 100);
              clip.vars.t = t8;
              clip.scaleX = t8 / 100;
              clip.scaleY = t8 / 100;
              clip.vars.dmax = 100;
              clip.vars.d = 100 - Math.floor(Math.random() * 70);
              clip.vars.acc = 1.67 + Math.random() * 5;
              clip.vars.vacc = 1 + 1 * Math.random();
              clip.vars.vx = 10 * (-0.5 + Math.random());
              clip.vars.vy = 10 * (-0.5 + Math.random());
              clip.vars.accx = 0.8 + 0.1 * Math.random();
              clip.vars.accy = 0.8 + 0.1 * Math.random();
              clip.vars.c_count = 0;
              clip.vars.compte = Math.floor(Math.random() * 200000);
              clip.onEnterFrame = (c, ectx) => {
                // AS DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                if (Math.floor(Math.random() * 15) === 1) {
                  // attachMovie("minifeux2","minifeux2"+compte,compte) on _parent._parent
                  const grandparent = c.parent?.parent;
                  if (grandparent) {
                    const compte = c.vars.compte as number;
                    const depth = this.nextDepth();
                    const mf2 = grandparent.attach(this.minifeux2Sym, `minifeux2_${compte}`, depth, ectx);
                    mf2.x = c.x;
                    mf2.y = c.y + (c.parent?.y ?? 0);
                    let cc = c.vars.c_count as number;
                    mf2.alpha = Math.max(0, (100 - cc) / 100);
                    cc++;
                    c.vars.c_count = cc;
                    c.vars.compte = Math.floor(Math.random() * 200000);
                  }
                }
                let t = c.vars.t as number;
                // _rotation = _rotation + t/3 (degrees)
                c.rotation += (t / 3 * Math.PI) / 180;
                t--;
                c.vars.t = t;
                c.scaleX = t / 100 / 3;
                c.scaleY = t / 100 / 3;
                const g = c.vars.g as number;
                if (c.parent) {
                  c.parent.y += g;
                }
                let vx = c.vars.vx as number;
                let vy = c.vars.vy as number;
                const accx = c.vars.accx as number;
                const accy = c.vars.accy as number;
                vx *= accx;
                vy *= accy;
                c.vars.vx = vx;
                c.vars.vy = vy;
                c.x += vx;
                c.y += vy;
                if (t < 0) {
                  c.parent?.remove();
                }
              };
            } else if (f === 10) {
              // frame_11: PlaceObject2_19_1 — exploding star, spawns minifeux3
              // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.stop();
              clip.vars.vg = -9 * Math.random();
              clip.vars.g = 0.67 * Math.random();
              clip.vars.va = 0;
              const t11 = 100 + Math.floor(Math.random() * 100);
              clip.vars.t = t11;
              clip.scaleX = t11 / 100;
              clip.scaleY = t11 / 100;
              clip.vars.dmax = 100;
              clip.x = -10 + Math.floor(Math.random() * 20);
              clip.vars.d = 100 - Math.floor(Math.random() * 70);
              clip.vars.acc = 1.67 + Math.random() * 5;
              clip.vars.vacc = 1.5 + 1.5 * Math.random();
              clip.vars.vx = 20 * (-0.5 + Math.random());
              clip.vars.vy = 20 * (-0.5 + Math.random());
              clip.vars.accx = 0.8 + 0.1 * Math.random();
              clip.vars.accy = 0.8 + 0.1 * Math.random();
              clip.vars.c_count = 0;
              clip.onEnterFrame = (c, ectx) => {
                // AS DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let t = c.vars.t as number;
                if (t < 150) {
                  c.play();
                }
                if (t < 135) {
                  // Spawn 9 minifeux3 particles into grandparent, then remove parent
                  const grandparent = c.parent?.parent;
                  if (grandparent) {
                    let nbr = 1;
                    while (nbr < 10) {
                      const compte = Math.floor(Math.random() * 200000);
                      const depth = this.nextDepth();
                      const mf3 = grandparent.attach(this.minifeux3Sym, `minifeux3_${compte}`, depth, ectx);
                      mf3.x = c.x;
                      mf3.y = c.y + (c.parent?.y ?? 0);
                      let cc = c.vars.c_count as number;
                      mf3.alpha = Math.max(0, (100 - cc) / 100);
                      cc++;
                      c.vars.c_count = cc;
                      nbr++;
                    }
                  }
                  c.parent?.remove();
                  return;
                }
                // _rotation = _rotation + t/3 (degrees)
                c.rotation += (t / 3 * Math.PI) / 180;
                t--;
                c.vars.t = t;
                c.scaleX = t / 100 / 3;
                c.scaleY = t / 100 / 3;
                const g = c.vars.g as number;
                if (c.parent) {
                  c.parent.y += g;
                }
                let vx = c.vars.vx as number;
                let vy = c.vars.vy as number;
                const accx = c.vars.accx as number;
                const accy = c.vars.accy as number;
                vx *= accx;
                vy *= accy;
                c.vars.vx = vx;
                c.vars.vy = vy;
                c.x += vx;
                c.y += vy;
              };
            } else if (f === 13) {
              // frame_14: PlaceObject2_22_1 — comet
              // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
              //   nbr=1; while(nbr<2) { attachMovie("minifeux4",...) on _parent._parent; nbr++ }
              const grandparent = clip.parent?.parent;
              if (grandparent) {
                const compte14 = Math.floor(Math.random() * 300000);
                const depth14 = this.nextDepth();
                const mf4inst = grandparent.attach(this.minifeux4Sym, `minifeux4_${compte14}`, depth14, ctx);
                mf4inst.x = clip.x;
                mf4inst.y = clip.y + (clip.parent?.y ?? 0);
              }
              clip.vars.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
              clip.vars.vit = 2 + 10 * Math.random();
              clip.stop();
              clip.vars.frein = 0.9 + 0.05 * Math.random();
              clip.vars.vr = 0;
              clip.vars.sz = 240 + Math.floor(Math.random() * 120);
              clip.vars.frangle = 1.2;
              clip.vars.c_count = 0;
              clip.onEnterFrame = (c, ectx) => {
                // AS DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let angle14 = c.vars.angle as number;
                let vit = c.vars.vit as number;
                let sz14 = c.vars.sz as number;
                let vr14 = c.vars.vr as number;
                let frangle = c.vars.frangle as number;
                const frein = c.vars.frein as number;
                let t14 = (c.vars.t as number) ?? 200;

                // _rotation = angle * 57.29... (angle in radians → degrees factor)
                // For Pixi we just use the angle in radians directly.
                c.rotation = angle14;
                c.alpha = Math.min(1, (50 + Math.floor(Math.random() * 60)) / 100);
                sz14 *= frein + 0.02;
                c.vars.sz = sz14;
                c.scaleX = sz14 / 100;
                c.scaleY = sz14 / 100;

                if (Math.floor(Math.random() * 24) === 1) {
                  vr14 = 0.67 * (-0.5 + Math.random());
                  c.vars.vr = vr14;
                }
                angle14 += vr14 * frangle;
                frangle *= frein;
                c.vars.angle = angle14;
                c.vars.frangle = frangle;

                const vx14 = vit * Math.cos(angle14);
                const vy14 = vit * Math.sin(angle14);
                c.x += vx14;
                c.y += vy14;
                vit *= frein;
                c.vars.vit = vit;

                // t is not explicitly set in load for frame_14 variant;
                // treat as countdown from initial value (use sz as proxy
                // from original context — but AS uses `t` which is
                // undefined in load for this variant, so starts as
                // undefined → effectively NaN → comparisons always false).
                // The canonical AS has `if(t<150) play(); if(t<135) burst`
                // but t is never initialized for this variant, so these
                // never fire. We preserve that by keeping t at its default.
                if (t14 < 150) {
                  c.play();
                }
                if (t14 < 135) {
                  const gp14 = c.parent?.parent;
                  if (gp14) {
                    let nbr14 = 1;
                    while (nbr14 < 10) {
                      const compte14b = Math.floor(Math.random() * 300000);
                      const depth14b = this.nextDepth();
                      const mf3b = gp14.attach(this.minifeux3Sym, `minifeux3_${compte14b}`, depth14b, ectx);
                      mf3b.x = c.x;
                      mf3b.y = c.y + (c.parent?.y ?? 0);
                      let cc14 = c.vars.c_count as number;
                      mf3b.alpha = Math.max(0, (100 - cc14) / 100);
                      cc14++;
                      c.vars.c_count = cc14;
                      nbr14++;
                    }
                  }
                  c.parent?.remove();
                }
              };
            }
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_31 — outer container (the top-level spell clip)
    // Registered as "sprite_31" so onSpellStart can attach it.
    //
    // This is a 97-frame container that orchestrates everything.
    // frame_1 DoAction (DoAction_2):
    //   taille = 80 + random(40); _xscale = _yscale = taille; _rotation = -20+random(40); compte=1
    // frame_70: SOMA.playSound("explo_fireworks") → signalHit
    // frame_76 onLoad: size/count loop attaching "feux"
    // frame_97: stop() → complete()
    // ----------------------------------------------------------------
    const outerContainerSym: SymbolDefinition = {
      name: "sprite_31",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_31/frame_1/DoAction_2.as
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_31/frame_70/DoAction.as: SOMA.playSound("explo_fireworks")
            this.soundCb?.("explo_fireworks");
            // frame_70 is the canonical explosion — signal hit here
            this.runtime.signalHit();
          },
        ],
        [
          75,
          (clip, ctx) => {
            // AS DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
            // sz = 60 + 20*((level-1)%3)
            // i=1; while(i < 6 + 7*((level-1)%3)) { attachMovie("feux","feux"+i,i); i++ }
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const sz = 60 + 20 * ((level - 1) % 3);
            clip.scaleX = sz / 100;
            clip.scaleY = sz / 100;
            const feuxCount = 6 + 7 * ((level - 1) % 3);
            for (let i = 1; i < feuxCount; i++) {
              clip.attach(this.feuxSym, `feux${i}`, i, ctx);
            }
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_31/frame_97/DoAction.as: stop()
            clip.stop();
            // AS frame_319/DoAction.as: _parent.removeMovieClip(); stop()
            // This is the outer mc — signal spell completion.
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeuxSym);
    this.registry.register(this.feuxSym);
    this.registry.register(outerContainerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS DefineSprite_31/frame_1/DoAction.as: SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");
    this.soundCb = callbacks.playSound;

    // Attach the outer container (DefineSprite_31) as the single child of root.
    const outerSym = this.registry.resolve("sprite_31");
    if (outerSym) {
      this.root.attach(outerSym, "sprite_31", 1, context);
    }
  }
}
