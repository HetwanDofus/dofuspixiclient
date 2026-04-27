/**
 * Spell 2900 — Feux d'Artifice (Fireworks).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2900/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, no "move"/"shoot" pattern — it is a pure impact animation at the
 * target cell. The outer mc (DefineSprite_31) plays 97 frames at the target, then
 * stops; frame_319/DoAction.as calls `_parent.removeMovieClip()` which is the
 * top-level completion signal.
 *
 * Structure:
 *   DefineSprite_31 — outer container (97 frames + "boule" placeholder):
 *     frame_1:  SOMA.playSound("fireworks01"); set taille scale + rotation; compte=1.
 *     frame_70: SOMA.playSound("explo_fireworks").
 *     frame_76: spawns a "boule" child (DefineSprite_28) whose onLoad (PlaceObject2_28_3)
 *               attaches 6..26 "feux" children based on level.
 *     frame_97: stop().
 *
 *   lib_feux (DefineSprite_23) — firework burst, 16 frames.
 *     frame_1/DoAction: gotoAndStop(level+1) → jump to one of several sub-modes.
 *     frame_2  child (PlaceObject2_12): single-spark "bounce" that attaches minifeux2.
 *     frame_5  child (PlaceObject2_14): drift spark that removes parent.
 *     frame_8  child (PlaceObject2_12): star spark, attaches minifeux2.
 *     frame_11 child (PlaceObject2_19): star spark, attaches minifeux3 burst.
 *     frame_14 child (PlaceObject2_22): "rocket" spark, attaches minifeux4 on load,
 *               attaches minifeux3 then removes when t<90.
 *
 *   lib_minifeux  (DefineSprite_8) — small fire particle, 36 frames.
 *     frame_1/DoAction: random rotation; _X/_Y from _parent.boule._x/_y.
 *     frame_1 onLoad:  seed alpha=150, v=random.
 *     frame_1 onEnterFrame: alpha -=3.34; X+=v.
 *     frame_34: removeMovieClip.
 *
 *   lib_minifeux2 (DefineSprite_7) — small fire particle variant, 36 frames.
 *     frame_1/DoAction: random rotation.
 *     frame_1 onLoad:  seed alpha=random(150), v=random.
 *     frame_1 onEnterFrame: alpha -=3.34; X+=v.
 *     frame_34: removeMovieClip.
 *
 *   lib_minifeux3 (DefineSprite_6) — glitter trail particle, 78 frames.
 *     frame_1/DoAction: random rotation.
 *     frame_1 onLoad:  alpha=random(150), v=2+3*random.
 *     frame_1 onEnterFrame: parent._alpha=random(100); alpha-=1.6; X+=v*0.85.
 *     frame_76: removeMovieClip.
 *
 *   lib_minifeux4 (DefineSprite_3) — large spark, 78 frames.
 *     frame_1/DoAction: (empty — no action).
 *     frame_1 onLoad:  angle=90, alpha=random(150), v=-1.6-3.34*random, vr=-0.5+random.
 *     frame_1 onEnterFrame: rotate by angle*57.29; angle+=vr; parent._alpha=random(100);
 *                            alpha-=1.6; Y+=v*0.85; X+=v*cos(angle); Y+=v*sin(angle).
 *     frame_76: removeMovieClip.
 *
 * NOTE: The "boule" placement (PlaceObject2_28_3 onClipEvent load) lives inside
 * DefineSprite_31/frame_76.  In the SWF this is a placed instance of DefineSprite_28
 * that auto-runs an onLoad clip-event which attaches all the "feux" children.  We
 * model this as a "boule" SymbolDefinition (container, 2 frames — DefineSprite_28 has
 * frame_2 with stop()) whose onLoad runs the feux attachment loop, matching canonical
 * execution order exactly.
 *
 * The outer DefineSprite_31 has 97 frames; frame_97 → stop(). The main-timeline
 * frame_319/DoAction.as calls `_parent.removeMovieClip(); stop();` — we call
 * `this.runtime.complete()` from there.
 *
 * signalHit: fired from feux frame_14 child when t<90 (the particle burst that marks
 * the visual explosion peak), matching the "explo_fireworks" sound at frame_70 of the
 * outer container.  We use feux's onLoad for the minifeux4 spawn, and the runtime
 * signalHit once per spell from the first feux particle that reaches that threshold.
 * In practice all feux run similar logic — we guard it with a single flag on root.vars.
 *
 * Sounds:
 *   frame_1  of DefineSprite_31: "fireworks01" → played in onSpellStart.
 *   frame_70 of DefineSprite_31: "explo_fireworks" → played from frameScripts[69].
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

// ---- Bounds from manifest.json librarySymbols[] ----

const MINIFEUX_BOUNDS = {
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

const MINIFEUX3_BOUNDS = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX4_BOUNDS = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const FEUX_BOUNDS = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

export class Spell2900 extends RuntimeSpell {
  readonly spellId = 2900;
  readonly displayType = SpellDisplayType.TargetCell;

  // Stored so we can reference them from within other symbols' scripts.
  private minifeux2Sym!: SymbolDefinition;
  private minifeux3Sym!: SymbolDefinition;
  private minifeux4Sym!: SymbolDefinition;
  private feuxSym!: SymbolDefinition;

  // Guard so signalHit fires only once.
  private hitFired = false;

  // Captured sound callback for use from frameScripts.
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const minifeuxAnchor = calculateAnchor(MINIFEUX_BOUNDS);
    const minifeux2Anchor = calculateAnchor(MINIFEUX2_BOUNDS);
    const minifeux3Anchor = calculateAnchor(MINIFEUX3_BOUNDS);
    const minifeux4Anchor = calculateAnchor(MINIFEUX4_BOUNDS);
    const feuxAnchor = calculateAnchor(FEUX_BOUNDS);

    // ----------------------------------------------------------------
    // lib_minifeux — DefineSprite_8_minifeux, 36 frames
    // Small fire particle attached by the "boule" clip event onto the
    // outer container.  Its frame_1/DoAction positions it at boule's
    // world coords; we approximate boule at (0,0) of the outer mc
    // since the outer mc IS at the target cell.
    // ----------------------------------------------------------------
    const minifeuxSym: SymbolDefinition = {
      name: "minifeux",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux"),
      anchorX: minifeuxAnchor.x,
      anchorY: minifeuxAnchor.y,

      // AS: DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = Math.random();
        clip.alpha = 150 / 100;
      },

      // AS: DefineSprite_8_minifeux/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        const v = clip.vars.v as number;
        clip.alpha = clip.alpha - 3.34 / 100;
        clip.x += v;
        clip.vars.v = v;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_8_minifeux/frame_1/DoAction.as
          // _rotation = random(360);
          // _X = _parent.boule._x;  (boule is at 0,0 of parent — outer mc at target)
          // _Y = _parent.boule._y;
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // boule sits at the outer mc origin (0,0) — already the default.
            clip.x = 0;
            clip.y = 0;
          },
        ],
        [
          // AS: DefineSprite_8_minifeux/frame_34/DoAction.as — this.removeMovieClip()
          33,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux2 — DefineSprite_7_minifeux2, 36 frames
    // Spawned by feux (frame_8 child onEnterFrame) onto the outer mc.
    // ----------------------------------------------------------------
    this.minifeux2Sym = {
      name: "minifeux2",
      totalFrames: 36,
      frames: textures.getFrames("lib_minifeux2"),
      anchorX: minifeux2Anchor.x,
      anchorY: minifeux2Anchor.y,

      // AS: DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = Math.random();
        clip.alpha = Math.floor(Math.random() * 150) / 100;
      },

      // AS: DefineSprite_7_minifeux2/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        const v = clip.vars.v as number;
        clip.alpha = clip.alpha - 3.34 / 100;
        clip.x += v;
        clip.vars.v = v;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_7_minifeux2/frame_1/DoAction.as — _rotation = random(360)
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          // AS: DefineSprite_7_minifeux2/frame_34/DoAction.as — this.removeMovieClip()
          33,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux3 — DefineSprite_6_minifeux3, 78 frames
    // Glitter trail particle, spawned by feux frame_11 and frame_14
    // children when they reach their burst threshold.
    // ----------------------------------------------------------------
    this.minifeux3Sym = {
      name: "minifeux3",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux3"),
      anchorX: minifeux3Anchor.x,
      anchorY: minifeux3Anchor.y,

      // AS: DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = 2 + 3 * Math.random();
        clip.alpha = Math.floor(Math.random() * 150) / 100;
      },

      // AS: DefineSprite_6_minifeux3/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let v = clip.vars.v as number;
        // _parent._alpha = random(100) — clip's parent alpha is random each frame.
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        clip.alpha = clip.alpha - 1.6 / 100;
        v *= 0.85;
        clip.x += v;
        clip.vars.v = v;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_6_minifeux3/frame_1/DoAction.as — _rotation = random(360)
          0,
          (clip) => {
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
        [
          // AS: DefineSprite_6_minifeux3/frame_76/DoAction.as — this.removeMovieClip()
          75,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_minifeux4 — DefineSprite_3_minifeux4, 78 frames
    // Large spark; spawned by feux frame_14 child's onLoad.
    // ----------------------------------------------------------------
    this.minifeux4Sym = {
      name: "minifeux4",
      totalFrames: 78,
      frames: textures.getFrames("lib_minifeux4"),
      anchorX: minifeux4Anchor.x,
      anchorY: minifeux4Anchor.y,

      // AS: DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.angle = 90;
        clip.alpha = Math.floor(Math.random() * 150) / 100;
        clip.vars.v = -1.6 - 3.34 * Math.random();
        clip.vars.vr = -0.5 + Math.random();
      },

      // AS: DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        const vr = clip.vars.vr as number;

        // _rotation = angle * 57.29746936176985  (angle in radians → degrees, then display)
        // SpellClip uses radians; angle here IS in radians (starts at 90 radians in AS,
        // multiplied by 57.29... = degrees). We store angle in radians and set rotation directly.
        clip.rotation = angle * 57.29746936176985 * (Math.PI / 180);
        angle += vr;

        // _parent._alpha = random(100)
        if (clip.parent) {
          clip.parent.alpha = Math.floor(Math.random() * 100) / 100;
        }
        // _alpha -= 1.6
        clip.alpha = clip.alpha - 1.6 / 100;

        // _Y += v * 0.85
        v *= 0.85;
        clip.y += v;

        // vx = v*cos(angle); vy = v*sin(angle)
        const vx = v * Math.cos(angle);
        const vy = v * Math.sin(angle);
        clip.x += vx;
        clip.y += vy;

        clip.vars.angle = angle;
        clip.vars.v = v;
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_3_minifeux4/frame_1/DoAction.as — (empty)
          0,
          (_clip) => {
            // no-op: canonical DoAction is empty
          },
        ],
        [
          // AS: DefineSprite_3_minifeux4/frame_76/DoAction.as — this.removeMovieClip()
          75,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_feux — DefineSprite_23_feux, 16 frames
    //
    // This is the main firework burst symbol.  Its frame_1 jumps to
    // level+1 so each feux instance behaves differently based on spell
    // level (frames 2, 3, 4, 5, or 6 = levels 1-5; frame_2 at
    // level=1, etc.).  At each frame a different inner clip (child
    // placed via PlaceObject2) runs its own onLoad + onEnterFrame.
    //
    // We model the canonical inner clips as per-frame onLoad/onEnterFrame
    // stored on clip.vars keyed per frame, selected once we know which
    // sub-frame was chosen.  Because SpellClip does not support
    // per-frame clip placements, we use frameScripts to install the
    // appropriate onEnterFrame handler when the feux clip lands on its
    // chosen frame (via gotoAndStop in frame_1).
    //
    // We also handle the signalHit here (frame_14 child's explosion
    // threshold, which is the biggest visual event).
    // ----------------------------------------------------------------
    const self = this;

    this.feuxSym = {
      name: "feux",
      totalFrames: 16,
      frames: textures.getFrames("lib_feux"),
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_23_feux/frame_1/DoAction.as
          // gotoAndStop(_parent._parent._parent.level + 1)
          // feux is attached inside the boule clip, which is inside DefineSprite_31,
          // which is attached to the root.  So _parent._parent._parent = root.
          // We walk: clip (feux) → boule → outer_mc (DefineSprite_31) → root
          0,
          (clip) => {
            const root = clip.parent?.parent?.parent ?? clip.parent?.parent;
            const level = (root?.vars.level as number) ?? 1;
            // AS: gotoAndStop(level + 1) — 1-based, so frame index = level
            clip.gotoAndStop(level);

            // Install the appropriate inner-clip behaviour based on the
            // chosen frame.  In canonical AS each frame places a different
            // PlaceObject2 child; we replicate by setting up onLoad vars
            // and swapping the onEnterFrame handler on the clip itself.
            // We call the _init_ side immediately (mirrors onClipEvent(load))
            // and set an onEnterFrame for the per-frame particle logic.
            const chosenFrame = clip.currentFrame; // 0-based = level

            if (chosenFrame === 1) {
              // frame_2: PlaceObject2_12 child — bounce spark, attaches minifeux2
              // AS: DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.vars.ef2_parentRotation = Math.floor(Math.random() * 360);
              if (clip.parent) {
                clip.parent.rotation = (clip.vars.ef2_parentRotation as number * Math.PI) / 180;
              }
              clip.vars.ef2_g = 1 * Math.random();
              clip.vars.ef2_va = 0;
              clip.vars.ef2_t = 100 + Math.floor(Math.random() * 100);
              const t2 = clip.vars.ef2_t as number;
              clip.scaleX = t2 / 100;
              clip.scaleY = t2 / 100;
              clip.vars.ef2_X = 10 + Math.floor(Math.random() * 20);
              clip.x = clip.vars.ef2_X as number;
              clip.vars.ef2_d = 100 - Math.floor(Math.random() * 70);
              clip.vars.ef2_acc = 3.34 + Math.random() * 5;
              clip.vars.ef2_vacc = 1 + 1 * Math.random();

              clip.onEnterFrame = (c) => {
                // AS: DefineSprite_23_feux/frame_2/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                const g = c.vars.ef2_g as number;
                let va = c.vars.ef2_va as number;
                const vacc = c.vars.ef2_vacc as number;
                const acc = c.vars.ef2_acc as number;
                const d = c.vars.ef2_d as number;

                c.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
                const newT = 20 + Math.floor(Math.random() * 80);
                c.scaleX = newT / 100;
                c.scaleY = newT / 100;
                // _parent._y += g
                if (c.parent) {
                  c.parent.y += g;
                }
                va += vacc;
                c.alpha = (150 - va) / 100;
                // _X -= (_X - d) / acc
                const curX = c.x;
                c.x = curX - (curX - d) / acc;
                c.vars.ef2_va = va;
                if (c.alpha < 0) {
                  if (c.parent) {
                    c.parent.remove();
                  }
                }
              };
            } else if (chosenFrame === 4) {
              // frame_5: PlaceObject2_14 child — drift spark, removes parent when t<0
              // AS: DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load).as
              if (clip.parent) {
                clip.parent.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
              }
              clip.vars.ef5_g = 0.6 * Math.random();
              clip.vars.ef5_t = 200 + Math.floor(Math.random() * 100);
              const t5 = clip.vars.ef5_t as number;
              clip.scaleX = t5 / 100;
              clip.scaleY = t5 / 100;
              clip.vars.ef5_X = 10 + Math.floor(Math.random() * 20);
              clip.x = clip.vars.ef5_X as number;
              clip.vars.ef5_d = 100 - Math.floor(Math.random() * 70);
              clip.vars.ef5_acc = 1.67 + Math.random() * 5;

              clip.onEnterFrame = (c) => {
                // AS: DefineSprite_23_feux/frame_5/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let t = c.vars.ef5_t as number;
                const g = c.vars.ef5_g as number;
                const acc = c.vars.ef5_acc as number;
                const d = c.vars.ef5_d as number;

                // _rotation += t/6
                c.rotation += ((t / 6) * Math.PI) / 180;
                t--;
                c.scaleX = t / 3 / 100;
                c.scaleY = t / 3 / 100;
                if (c.parent) {
                  c.parent.y += g;
                }
                const curX = c.x;
                c.x = curX - (curX - d) / acc;
                c.vars.ef5_t = t;
                if (t < 0) {
                  if (c.parent) {
                    c.parent.remove();
                  }
                }
              };
            } else if (chosenFrame === 7) {
              // frame_8: PlaceObject2_12 child — star spark, attaches minifeux2
              // AS: DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.vars.ef8_g = 0.67 * Math.random();
              clip.vars.ef8_t = 100 + Math.floor(Math.random() * 100);
              const t8 = clip.vars.ef8_t as number;
              clip.scaleX = t8 / 100;
              clip.scaleY = t8 / 100;
              clip.vars.ef8_vx = 10 * (-0.5 + Math.random());
              clip.vars.ef8_vy = 10 * (-0.5 + Math.random());
              clip.vars.ef8_accx = 0.8 + 0.1 * Math.random();
              clip.vars.ef8_accy = 0.8 + 0.1 * Math.random();
              clip.vars.ef8_c = 0;
              clip.vars.ef8_compte = Math.floor(Math.random() * 200000);

              clip.onEnterFrame = (c, ctx) => {
                // AS: DefineSprite_23_feux/frame_8/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let t = c.vars.ef8_t as number;
                const g = c.vars.ef8_g as number;
                let vx = c.vars.ef8_vx as number;
                let vy = c.vars.ef8_vy as number;
                const accx = c.vars.ef8_accx as number;
                const accy = c.vars.ef8_accy as number;
                let cc = c.vars.ef8_c as number;
                let compte = c.vars.ef8_compte as number;

                if (Math.floor(Math.random() * 15) === 1) {
                  // _parent._parent.attachMovie("minifeux2","minifeux2"+compte,compte)
                  // _parent is feux clip, _parent._parent is boule, _parent._parent._parent is outer mc
                  const outerMc = c.parent?.parent?.parent;
                  if (outerMc) {
                    const m2 = outerMc.attach(
                      self.minifeux2Sym,
                      `minifeux2_${compte}`,
                      compte,
                      ctx,
                    );
                    m2.x = c.x;
                    m2.y = c.y + (c.parent ? c.parent.y : 0);
                    m2.alpha = Math.max(0, (100 - cc) / 100);
                    cc++;
                  }
                  compte = Math.floor(Math.random() * 200000);
                }

                // _rotation += t/3
                c.rotation += ((t / 3) * Math.PI) / 180;
                t--;
                c.scaleX = t / 3 / 100;
                c.scaleY = t / 3 / 100;
                if (c.parent) {
                  c.parent.y += g;
                }
                vx *= accx;
                vy *= accy;
                c.x += vx;
                c.y += vy;

                c.vars.ef8_t = t;
                c.vars.ef8_vx = vx;
                c.vars.ef8_vy = vy;
                c.vars.ef8_c = cc;
                c.vars.ef8_compte = compte;

                if (t < 0) {
                  if (c.parent) {
                    c.parent.remove();
                  }
                }
              };
            } else if (chosenFrame === 10) {
              // frame_11: PlaceObject2_19 child — star spark, attaches minifeux3 burst
              // AS: DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(load).as
              clip.stop();
              clip.vars.ef11_g = 0.67 * Math.random();
              clip.vars.ef11_t = 100 + Math.floor(Math.random() * 100);
              const t11 = clip.vars.ef11_t as number;
              clip.scaleX = t11 / 100;
              clip.scaleY = t11 / 100;
              clip.vars.ef11_X = -10 + Math.floor(Math.random() * 20);
              clip.x = clip.vars.ef11_X as number;
              clip.vars.ef11_vx = 20 * (-0.5 + Math.random());
              clip.vars.ef11_vy = 20 * (-0.5 + Math.random());
              clip.vars.ef11_accx = 0.8 + 0.1 * Math.random();
              clip.vars.ef11_accy = 0.8 + 0.1 * Math.random();
              clip.vars.ef11_c = 0;

              clip.onEnterFrame = (c, ctx) => {
                // AS: DefineSprite_23_feux/frame_11/PlaceObject2_19_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let t = c.vars.ef11_t as number;
                const g = c.vars.ef11_g as number;
                let vx = c.vars.ef11_vx as number;
                let vy = c.vars.ef11_vy as number;
                const accx = c.vars.ef11_accx as number;
                const accy = c.vars.ef11_accy as number;
                let cc = c.vars.ef11_c as number;

                if (t < 150) {
                  c.play();
                }
                if (t < 135) {
                  // spawn minifeux3 burst (nbr 1..9) onto outer mc
                  const outerMc = c.parent?.parent?.parent;
                  if (outerMc) {
                    for (let nbr = 1; nbr < 10; nbr++) {
                      const compte = Math.floor(Math.random() * 200000);
                      const m3 = outerMc.attach(
                        self.minifeux3Sym,
                        `minifeux3_${compte}`,
                        compte,
                        ctx,
                      );
                      m3.x = c.x;
                      m3.y = c.y + (c.parent ? c.parent.y : 0);
                      m3.alpha = Math.max(0, (100 - cc) / 100);
                      cc++;
                    }
                  }
                  if (c.parent) {
                    c.parent.remove();
                  }
                  // Signal hit once on first big burst
                  if (!self.hitFired) {
                    self.hitFired = true;
                    self.runtime.signalHit();
                  }
                  return;
                }

                // _rotation += t/3
                c.rotation += ((t / 3) * Math.PI) / 180;
                t--;
                c.scaleX = t / 3 / 100;
                c.scaleY = t / 3 / 100;
                if (c.parent) {
                  c.parent.y += g;
                }
                vx *= accx;
                vy *= accy;
                c.x += vx;
                c.y += vy;

                c.vars.ef11_t = t;
                c.vars.ef11_vx = vx;
                c.vars.ef11_vy = vy;
                c.vars.ef11_c = cc;
              };
            } else if (chosenFrame === 13) {
              // frame_14: PlaceObject2_22 child — rocket spark
              // AS: DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(load).as
              // First: spawn 1 minifeux4 at current position onto outer mc
              // (nbr loop runs while nbr < 2, so exactly once)
              const outerMc = clip.parent?.parent?.parent;
              if (outerMc) {
                const compte = Math.floor(Math.random() * 200000);
                const m4 = outerMc.attach(
                  self.minifeux4Sym,
                  `minifeux4_${compte}`,
                  compte,
                  _context,
                );
                m4.x = clip.x;
                m4.y = clip.y + (clip.parent ? clip.parent.y : 0);
              }

              clip.vars.ef14_angle = -1.1415 + 0.2 * (-0.5 + Math.random());
              clip.vars.ef14_vit = 6 + 10 * Math.random();
              clip.stop();
              clip.vars.ef14_frein = 0.9 + 0.05 * Math.random();
              clip.vars.ef14_vr = 0;
              clip.vars.ef14_sz = 240 + Math.floor(Math.random() * 120);
              clip.vars.ef14_frangle = 1.2;
              clip.vars.ef14_c = 0;

              clip.onEnterFrame = (c, ctx) => {
                // AS: DefineSprite_23_feux/frame_14/PlaceObject2_22_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
                let angle = c.vars.ef14_angle as number;
                let vit = c.vars.ef14_vit as number;
                const frein = c.vars.ef14_frein as number;
                let vr = c.vars.ef14_vr as number;
                let sz = c.vars.ef14_sz as number;
                let frangle = c.vars.ef14_frangle as number;
                let cc = c.vars.ef14_c as number;

                c.rotation = angle * 57.29746936176985 * (Math.PI / 180);
                c.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
                sz *= frein + 0.02;
                c.scaleX = sz / 100;
                c.scaleY = sz / 100;

                if (Math.floor(Math.random() * 16) === 1) {
                  vr = 1 * (-0.5 + Math.random());
                }
                frangle *= frein;
                angle += vr * frangle;

                const vx = vit * Math.cos(angle);
                const vy = vit * Math.sin(angle);
                c.x += vx;
                c.y += vy;
                vit *= frein;

                c.vars.ef14_angle = angle;
                c.vars.ef14_vit = vit;
                c.vars.ef14_vr = vr;
                c.vars.ef14_sz = sz;
                c.vars.ef14_frangle = frangle;
                c.vars.ef14_c = cc;

                // NOTE: in canonical AS, `t` here refers to some outer variable
                // (likely the feux parent's t counter).  We skip the play/removal
                // check since there is no `t` seeded on this variant's load;
                // the canonical t in frame_14 context appears to come from a
                // different scope.  We instead use sz decay as the natural end:
                if (sz < 5) {
                  // spawn minifeux3 burst
                  const outerMc2 = c.parent?.parent?.parent;
                  if (outerMc2) {
                    for (let nbr = 1; nbr < 10; nbr++) {
                      const compte = Math.floor(Math.random() * 200000);
                      const m3 = outerMc2.attach(
                        self.minifeux3Sym,
                        `minifeux3_${compte}`,
                        compte,
                        ctx,
                      );
                      m3.x = c.x;
                      m3.y = c.y + (c.parent ? c.parent.y : 0);
                      m3.alpha = Math.max(0, (100 - cc) / 100);
                      cc++;
                      c.vars.ef14_c = cc;
                    }
                  }
                  if (c.parent) {
                    c.parent.remove();
                  }
                  if (!self.hitFired) {
                    self.hitFired = true;
                    self.runtime.signalHit();
                  }
                }
              };
            } else {
              // frame_3 / frame_4 / frame_6 etc. — use frame_5 variant as fallback
              // (canonical AS only defines handlers for frames 2,5,8,11,14 —
              // other frames are empty timeline content)
              // No onEnterFrame — just let the clip play its authored frames.
            }
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // "boule" — models DefineSprite_28 (frame_2 has stop()).
    // In canonical SWF, this is placed on DefineSprite_31's timeline at
    // frame_76 via PlaceObject2_28_3, whose onClipEvent(load) attaches
    // 6..26 feux children based on level.  We capture that logic in
    // the onLoad here.
    // ----------------------------------------------------------------
    const bouleSym: SymbolDefinition = {
      name: "boule",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      // AS: DefineSprite_31/frame_76/PlaceObject2_28_3/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip, ctx) => {
        // sz = 60 + 20 * ((level-1) % 3)
        const outerMc = clip.parent;
        const level = (outerMc?.vars.level as number) ?? 1;
        const sz = 60 + 20 * ((level - 1) % 3);
        clip.scaleX = sz / 100;
        clip.scaleY = sz / 100;

        // i = 1; while (i < 6 + 7 * ((level-1) % 3)) { attachMovie("feux","feux"+i,i); i++ }
        const feuxCount = 6 + 7 * ((level - 1) % 3);
        for (let i = 1; i < feuxCount; i++) {
          clip.attach(self.feuxSym, `feux${i}`, i, ctx);
        }
      },

      frameScripts: new Map([
        [
          // AS: DefineSprite_28/frame_2/DoAction.as — stop()
          1,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // outer_mc — models DefineSprite_31 (97 frames).
    // This is the top-level animated container for the whole firework.
    // It is attached to root in onSpellStart.
    // frame_1  DoAction: SOMA.playSound("fireworks01") — handled in onSpellStart.
    //          DoAction_2: taille scale/rotation/compte init.
    // frame_70 DoAction: SOMA.playSound("explo_fireworks").
    // frame_76 PlaceObject2_28_3: places "boule" with onLoad (modelled above).
    // frame_97 DoAction: stop().
    // ----------------------------------------------------------------
    const outerMcSym: SymbolDefinition = {
      name: "outer_mc",
      totalFrames: 97,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          // AS: DefineSprite_31/frame_1/DoAction_2.as
          // taille = 80 + random(40); scale + rotate; compte = 1
          0,
          (clip) => {
            const taille = 80 + Math.floor(Math.random() * 40);
            clip.scaleX = taille / 100;
            clip.scaleY = taille / 100;
            clip.rotation = ((-20 + Math.floor(Math.random() * 40)) * Math.PI) / 180;
            clip.vars.compte = 1;
          },
        ],
        [
          // AS: DefineSprite_31/frame_70/DoAction.as — SOMA.playSound("explo_fireworks")
          69,
          (_clip) => {
            self._playSound?.("explo_fireworks");
          },
        ],
        [
          // AS: DefineSprite_31/frame_76 — place "boule" (PlaceObject2_28_3 onLoad fires feux spawns)
          75,
          (clip, ctx) => {
            clip.attach(bouleSym, "boule", 3, ctx);
          },
        ],
        [
          // AS: DefineSprite_31/frame_97/DoAction.as — stop()
          96,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // Main-timeline frame_319/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    // The main timeline has 319 frames; at frame_319 the outer mc is
    // removed.  We model this on the root's onEnterFrame: when root
    // has been running for 318 frames (0-based), we call complete().
    // Actually: root is a plain container; the canonical main timeline
    // IS the outer mc (DefineSprite_31 lives within it).  The main
    // timeline frame_319 script kills the outer mc.  We place this
    // logic in a frameScript on the outer mc but at a safe frame
    // past the stop() at frame 97 — canonical says stop() freezes the
    // outer mc at 97; then the main timeline at frame_319 kills it.
    // We approximate this by: after outer_mc.stop() fires at frame 96,
    // we set up a root-level onEnterFrame countdown from there.
    // For simplicity and 1:1 fidelity we'll use a dedicated "mainTimeline"
    // wrapper symbol on root that runs 319 frames total and calls
    // complete at frame_319.
    // ----------------------------------------------------------------
    // NOTE: The cleanest approach is to attach outer_mc to root from
    // onSpellStart and register a root onEnterFrame that counts to
    // frame 318 (0-based 319) then calls complete().
    // We implement this as a thin "main" symbol with 319 frames.
    const mainSym: SymbolDefinition = {
      name: "main",
      totalFrames: 319,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          // AS: frame_319/DoAction.as — _parent.removeMovieClip(); stop();
          318,
          (clip) => {
            clip.remove();
            self.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(minifeuxSym);
    this.registry.register(this.minifeux2Sym);
    this.registry.register(this.minifeux3Sym);
    this.registry.register(this.minifeux4Sym);
    this.registry.register(this.feuxSym);
    this.registry.register(bouleSym);
    this.registry.register(outerMcSym);
    this.registry.register(mainSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for later use from frameScripts (frame_70).
    this._playSound = callbacks.playSound;

    // AS: DefineSprite_31/frame_1/DoAction.as — SOMA.playSound("fireworks01")
    callbacks.playSound("fireworks01");

    // Attach the main timeline wrapper (319 frames) onto root.
    // This in turn, at frame_76 of outer_mc, places "boule" which attaches "feux".
    const mainSym = this.registry.resolve("main");
    const outerMcSym = this.registry.resolve("outer_mc");
    if (mainSym) {
      this.root.attach(mainSym, "main", 1, context);
    }
    if (outerMcSym) {
      this.root.attach(outerMcSym, "outer_mc", 2, context);
    }
  }
}
