/**
 * Spell 601 — Esquive (Dodge/Ecaflip dodge spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/601/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell uses the canonical `move` + `shoot`
 * pattern: `move` (2 frames) contains authored spark particles (DefineSprite_13, each
 * with a horizontal drift onEnterFrame), and on frame_2 records its rotation into
 * `_parent.roti` then stops. `shoot` (144 frames) is attached at landing by the harness;
 * its frame_1 removes the `move` clip and contains authored sub-sprites:
 *   - PlaceObject2_3_3 (DefineSprite_2 — 46-frame impact, stops at frame 46):
 *       onClipEvent(load): _rotation = _parent._parent.roti
 *   - Six PlaceObject2_10_* instances (DefineSprite_10 — spark emitter particles):
 *       frame_1/DoAction.as: seeds roti, dv, v, vx, vy, p, cacc with random values,
 *         installs an onEnterFrame to drift the child `c` (a DefineSprite_9 spark).
 *       PlaceObject2_9_1/onClipEvent(load): seeds i, vrot, vrot2.
 *       PlaceObject2_9_1/onClipEvent(enterFrame): oscillates xscale + rotation until
 *         _Y >= p.
 *   - PlaceObject2_11_1 (appears at frame_109, DefineSprite_3 — sub-glow, stops at
 *       frame 16): onClipEvent(enterFrame): _parent._alpha -= 3.33 (fade out shoot).
 *   - frame_142/DoAction.as: stop() — timeline halts but spell is considered complete
 *     at this point.
 *
 * The harness fires runtime.signalHit() automatically at projectile landing (displayType=30),
 * so we must NOT call it from per-spell code.
 *
 * Library symbols (from manifest animations[] — no librarySymbols[] entries):
 *   - "move"  — 2-frame composite container. frame_2 stores _rotation into roti.
 *   - "shoot" — 144-frame composite container. frame_1 removes move; frame_142 stops.
 *
 * Main timeline: SOMA.playSound("dodge_601"); (frame_1/DoAction.as)
 *
 * NOTE: The sub-sprites within shoot (DefineSprite_2, DefineSprite_3, DefineSprite_9,
 * DefineSprite_10) are authored into the composite shoot frames as visual content —
 * they are not separately attachMovie'd library symbols. Their frame scripts / clip events
 * are baked into the shoot composite animation. We model the ones we can observe via
 * the script files:
 *   - The spark emitter logic (DefineSprite_10 + its child DefineSprite_9) is registered
 *     as a symbol "spark_emitter" that shoot's frame_1 attaches at the six authored depths.
 *   - The inner spark (DefineSprite_9) is registered as "spark_inner".
 *   - The fade-out glow (PlaceObject2_11_1) is modelled as an onEnterFrame installed on
 *     shoot at frame 108 (= AS frame_109), applying the alpha decay.
 *   - The impact base (DefineSprite_2, 46-frame) is registered as "impact_base"; its
 *     onLoad sets rotation from roti.
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

// Bounds from manifest animations[] entries (no librarySymbols[]).
const SHOOT_BOUNDS = {
  width: 106.3,
  height: 43,
  offsetX: -66,
  offsetY: -27.25,
};
const MOVE_BOUNDS = {
  width: 68.35,
  height: 40.3,
  offsetX: -31.35,
  offsetY: -18.8,
};

export class Spell601 extends RuntimeSpell {
  readonly spellId = 601;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- spark_inner — DefineSprite_9 ----------------------------
    // AS: DefineSprite_9/frame_1/DoAction.as
    //   gotoAndStop(random(4) + 1);
    // This symbol has 4 authored frames; on load it jumps to a random one.
    // No explicit frameCount in librarySymbols — treat as 4 frames.
    const sparkInnerSym: SymbolDefinition = {
      name: "spark_inner",
      totalFrames: 4,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_9/frame_1/DoAction.as
            clip.gotoAndStop(Math.floor(Math.random() * 4));
          },
        ],
      ]),
    };

    // ---- spark_emitter — DefineSprite_10 -------------------------
    // AS: DefineSprite_10/frame_1/DoAction.as
    //   roti = _parent._parent.roti - 30 + 60 * Math.random();
    //   c._rotation = roti;
    //   dv = 1.05 + 0.2 * Math.random();
    //   v = 3 + 10 * Math.random();
    //   vx = v * Math.cos(roti * PI / 180);
    //   vy = v * Math.sin(roti * PI / 180);
    //   p = 60 - random(30);
    //   cacc = 0.3 + 0.3 * Math.random();
    //   onEnterFrame: if (c._y < p) { c._y += cacc; _X += vx; _Y += vy; vx/=dv; vy/=dv; }
    //
    // Child "c" (a spark_inner / DefineSprite_9) is placed at depth 1 inside each emitter.
    // Its clip events:
    //   onClipEvent(load): i=0; vrot=-25+50*Math.random(); vrot2=-0.5+0.7*Math.random();
    //   onClipEvent(enterFrame): if (_Y < _parent.p) {
    //       vrot2 /= 1.04; _xscale = 50*sin(i+=vrot2); _rotation += vrot; }
    const sparkEmitterSym: SymbolDefinition = {
      name: "spark_emitter",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            // _parent._parent.roti — emitter's parent is shoot, shoot's parent is root.
            const shoot = clip.parent;
            const root = shoot?.parent;
            const rotiBase = (root?.vars.roti as number) ?? 0;
            const roti = rotiBase - 30 + 60 * Math.random();
            clip.vars.roti = roti;
            clip.vars.dv = 1.05 + 0.2 * Math.random();
            const v = 3 + 10 * Math.random();
            clip.vars.vx = v * Math.cos((roti * Math.PI) / 180);
            clip.vars.vy = v * Math.sin((roti * Math.PI) / 180);
            clip.vars.p = 60 - Math.floor(Math.random() * 30);
            clip.vars.cacc = 0.3 + 0.3 * Math.random();

            // Attach inner spark "c" and apply its initial rotation.
            // The sparkInnerSym onLoad (via frame_1 script) randomises its frame.
            const innerSymRef = this.registry.resolve("spark_inner");
            if (innerSymRef) {
              const c = clip.attach(innerSymRef, "c", 1, ctx);
              c.rotation = (roti * Math.PI) / 180;
              // Seed spark_inner clip-event vars.
              // AS: PlaceObject2_9_1/onClipEvent(load)
              c.vars.i = 0;
              c.vars.vrot = -25 + 50 * Math.random();
              c.vars.vrot2 = -0.5 + 0.7 * Math.random();
              // AS: PlaceObject2_9_1/onClipEvent(enterFrame)
              c.onEnterFrame = (cClip) => {
                const parentP = cClip.parent?.vars.p as number | undefined;
                if (parentP !== undefined && cClip.y < parentP) {
                  let vrot2 = cClip.vars.vrot2 as number;
                  let i = cClip.vars.i as number;
                  const vrot = cClip.vars.vrot as number;
                  vrot2 /= 1.04;
                  i += vrot2;
                  cClip.scaleX = (50 * Math.sin(i)) / 100;
                  cClip.rotation += (vrot * Math.PI) / 180;
                  cClip.vars.vrot2 = vrot2;
                  cClip.vars.i = i;
                }
              };
            }

            // Install per-emitter onEnterFrame (the inline `this.onEnterFrame = function()` in AS).
            clip.onEnterFrame = (self) => {
              // AS: DefineSprite_10/frame_1/DoAction.as onEnterFrame
              const c = self.children.get("c");
              const p = self.vars.p as number;
              if (c && c.y < p) {
                let vx = self.vars.vx as number;
                let vy = self.vars.vy as number;
                const dv = self.vars.dv as number;
                const cacc = self.vars.cacc as number;
                c.y += cacc;
                self.x += vx;
                self.y += vy;
                vx /= dv;
                vy /= dv;
                self.vars.vx = vx;
                self.vars.vy = vy;
              }
            };
          },
        ],
      ]),
    };

    // ---- impact_base — DefineSprite_2 (46 frames) ---------------
    // Placed at depth 3 inside shoot at frame_1, as PlaceObject2_3_3.
    // onClipEvent(load): _rotation = _parent._parent.roti
    // frame_46/DoAction.as: stop()
    const impactBaseSym: SymbolDefinition = {
      name: "impact_base",
      totalFrames: 46,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_12_shoot/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
        // _parent._parent.roti — impact_base's parent is shoot, shoot's parent is root.
        const shoot = clip.parent;
        const root = shoot?.parent;
        const roti = (root?.vars.roti as number) ?? 0;
        clip.rotation = (roti * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS: DefineSprite_2/frame_46/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- glow_sub — DefineSprite_3 (16 frames) ------------------
    // Placed as PlaceObject2_11_1 (depth 1 of some inner container) which
    // appears on the shoot timeline at frame_109. Its clip event fades the
    // shoot clip's alpha. We model this as a child attached to shoot at
    // frame 108 (0-based), whose onEnterFrame reduces shoot's alpha.
    // AS: DefineSprite_3/frame_16/DoAction.as: stop()
    const glowSubSym: SymbolDefinition = {
      name: "glow_sub",
      totalFrames: 16,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS: DefineSprite_3/frame_16/DoAction.as
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_12_shoot/frame_109/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3.33  — "parent" here is the shoot clip.
        const shoot = clip.parent;
        if (shoot) {
          shoot.alpha = Math.max(0, shoot.alpha - 3.33 / 100);
        }
      },
    };

    // ---- move_spark — DefineSprite_13 ---------------------------
    // Placed inside DefineSprite_14_move at multiple depths (1,20,39,58,77,96).
    // frame_1/DoAction.as: v = 2*Math.random() - 3; onEnterFrame: _X += v;
    // These are authored particles embedded in the move composite frames.
    // The PlaceObject2_13_*/onClipEvent(load) entries each do:
    //   gotoAndStop(random(_totalframes) + 1)
    // We model this as a single symbol with onLoad randomising frame.
    const moveSparkSym: SymbolDefinition = {
      name: "move_spark",
      totalFrames: 4,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13/frame_1/DoAction.as
            const v = 2 * Math.random() - 3;
            clip.vars.v = v;
            clip.onEnterFrame = (self) => {
              const vel = self.vars.v as number;
              self.x += vel;
            };
          },
        ],
      ]),
      onLoad: (clip) => {
        // AS: DefineSprite_14_move/frame_1/PlaceObject2_13_*/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndStop(random(_totalframes) + 1)
        clip.gotoAndStop(Math.floor(Math.random() * 4));
      },
    };

    // ---- move — 2-frame container --------------------------------
    // AS: DefineSprite_14_move
    //   frame_2/DoAction.as: _parent.roti = _rotation; stop();
    // The harness attaches move at (0,0) and drives parabolic motion.
    // Multiple authored spark_emitter children are placed at frame_1 as
    // PlaceObject2_13_* objects (gotoAndStop to random frame on load).
    // On frame_2, the rotation angle (set by harness during arc) is stored
    // into root.vars.roti, then the clip stops.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14_move/frame_1 — spark particles placed at
            // depths 1, 20, 39, 58, 77, 96 (each with onClipEvent(load) that
            // does gotoAndStop(random(_totalframes)+1))
            const depths = [1, 20, 39, 58, 77, 96];
            for (let idx = 0; idx < depths.length; idx++) {
              clip.attach(
                moveSparkSym,
                `move_spark_${depths[idx]}`,
                depths[idx],
                ctx
              );
            }
          },
        ],
        [
          1,
          (clip) => {
            // AS: DefineSprite_14_move/frame_2/DoAction.as
            // _parent.roti = _rotation; stop();
            const parent = clip.parent;
            if (parent) {
              // Store current rotation (in degrees, as AS would) on parent.
              // The sub-sprites read roti as degrees, so convert back.
              parent.vars.roti = (clip.rotation * 180) / Math.PI;
            }
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 144-frame container ----------------------------
    // AS: DefineSprite_12_shoot
    //   frame_1/DoAction.as: _parent.move.removeMovieClip();
    //   frame_1: places PlaceObject2_3_3 (impact_base at depth 3),
    //            places PlaceObject2_10_15/17/19/21/23/25 (spark_emitter at those depths)
    //   frame_109: PlaceObject2_11_1 (glow_sub) appears with enterFrame fade.
    //   frame_142/DoAction.as: stop();
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 144,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_12_shoot/frame_1/DoAction.as
            // _parent.move.removeMovieClip();
            const root = clip.parent;
            if (root) {
              const moveClip = root.children.get("move");
              if (moveClip) {
                moveClip.remove();
              }
            }

            // PlaceObject2_3_3 — impact_base at depth 3, with onLoad that sets rotation.
            clip.attach(impactBaseSym, "impact_base", 3, ctx);

            // PlaceObject2_10_15/17/19/21/23/25 — spark emitters at six depths.
            // Each has onClipEvent(load): gotoAndStop(random(_totalframes) + 1)
            // which is handled internally in sparkEmitterSym's frame_1 script.
            const emitterDepths = [15, 17, 19, 21, 23, 25];
            for (let idx = 0; idx < emitterDepths.length; idx++) {
              const depth = emitterDepths[idx];
              clip.attach(sparkEmitterSym, `emitter_${depth}`, depth, ctx);
            }
          },
        ],
        [
          108,
          (clip, ctx) => {
            // AS: DefineSprite_12_shoot/frame_109 — PlaceObject2_11_1 (glow_sub) appears.
            // Its onClipEvent(enterFrame) fades shoot's alpha.
            clip.attach(glowSubSym, "glow_sub", 1, ctx);
          },
        ],
        [
          141,
          (clip) => {
            // AS: DefineSprite_12_shoot/frame_142/DoAction.as
            // stop();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sparkInnerSym);
    this.registry.register(sparkEmitterSym);
    this.registry.register(impactBaseSym);
    this.registry.register(glowSubSym);
    this.registry.register(moveSparkSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("dodge_601");
    callbacks.playSound("dodge_601");
  }
}
