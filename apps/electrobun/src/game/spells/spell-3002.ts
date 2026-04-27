/**
 * Spell 3002 — Élément Polyvalent (multi-element arrow spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/3002/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * symbols consumed by the ballistic harness: `move` trails elemental
 * particles along the arc, `shoot` spawns an impact burst at the target.
 * The harness fires signalHit automatically on landing.
 *
 * Library symbols (all four are optional depending on params):
 *   - lib_part_f — fire particle (1 frame). frame_1 seeds random rotation,
 *                  scale, position, random start frame + spinning vr decay.
 *                  Stops at frame 19 (DefineSprite_29).
 *   - lib_part_w — water particle (1 frame). frame_1 seeds random rotation,
 *                  scale, position, random start frame.
 *                  Stops at frame 11 (DefineSprite_13).
 *   - lib_part_e — earth particle (1 frame). frame_1 seeds random rotation,
 *                  scale, position, random start frame.
 *                  Stops at frame 14 (DefineSprite_24).
 *   - lib_part_a — air particle (1 frame). frame_1 seeds random rotation,
 *                  scale, position, random start frame.
 *                  Stops at frame 9 (DefineSprite_36).
 *
 * Composite symbols:
 *   - move  — 1-frame container. Carries two placed objects:
 *               PlaceObject2_1_1: c2 counter; each enterFrame spawns
 *                 n elemental part_* particles on the root at move's position.
 *               PlaceObject2_5_3: wobble oscillator (a/i). enterFrame sets
 *                 rotation = 90 + a*cos(i += 0.6), a /= 1.1.
 *   - shoot — 20-frame container. PlaceObject2_1_1 onLoad spawns a burst
 *               of part_* particles (14 - 3*active_elements each element).
 *               PlaceObject2_5_2 oscillates rotation like move but with
 *               faster phase step (3.1415) and sharper decay (1.3).
 *               frame_22 (capped to frame_20): removeMovieClip + complete.
 *
 * Main timeline frame_1/DoAction.as is empty — no sound, no child attaches.
 *
 * Note on DefineSprite numbering:
 *   DefineSprite_29 = part_f (fire, 19 frames authored → stop at frame 19)
 *   DefineSprite_13 = part_w (water, 11 frames authored → stop at frame 11)
 *   DefineSprite_24 = part_e (earth, 14 frames authored → stop at frame 14)
 *   DefineSprite_36 = part_a (air, 9 frames authored → stop at frame 9)
 *   DefineSprite_11_move = move
 *   DefineSprite_10_shoot = shoot (20 frames)
 *   DefineSprite_9 = inner wobble sprite inside shoot (22 frames → stop at 22)
 *
 * The shoot symbol's canonical removal is frame_20/DoAction.as →
 * `_parent.removeMovieClip(); stop();` — this triggers runtime.complete().
 * Since displayType=30, runtime.signalHit() is fired by the harness at
 * landing — we must NOT call it again.
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

const PART_F_BOUNDS = {
  width: 35.05,
  height: 32.2,
  offsetX: -4.5,
  offsetY: -22.6,
};
const PART_W_BOUNDS = {
  width: 25.5,
  height: 24.8,
  offsetX: -8.1,
  offsetY: -17.75,
};
const PART_E_BOUNDS = {
  width: 61.65,
  height: 60.5,
  offsetX: -16.2,
  offsetY: -25.85,
};
const PART_A_BOUNDS = {
  width: 32.2,
  height: 37.45,
  offsetX: -29,
  offsetY: -37.45,
};

export class Spell3002 extends RuntimeSpell {
  readonly spellId = 3002;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Kept as fields so move's onEnterFrame can reference them to attach
  // particles on the root at the projectile's current position.
  private partFSym!: SymbolDefinition;
  private partWSym!: SymbolDefinition;
  private partESym!: SymbolDefinition;
  private partASym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    context: SpellContext,
  ): void {
    const partFAnchor = calculateAnchor(PART_F_BOUNDS);
    const partWAnchor = calculateAnchor(PART_W_BOUNDS);
    const partEAnchor = calculateAnchor(PART_E_BOUNDS);
    const partAAnchor = calculateAnchor(PART_A_BOUNDS);

    // ---- lib_part_f — fire particle (DefineSprite_29) ---------------
    // frame_1: AS DefineSprite_29/frame_1/DoAction.as
    //   seeds rotation, scale, position, gotoAndPlay(random(3)+1), vr
    //   onEnterFrame: _rotation += (vr *= 0.9)
    // frame_19: AS DefineSprite_29/frame_19/DoAction.as → stop()
    this.partFSym = {
      name: "part_f",
      totalFrames: 19,
      frames: textures.getFrames("lib_part_f"),
      anchorX: partFAnchor.x,
      anchorY: partFAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_29/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = 20 + 30 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            const startFrame = Math.floor(Math.random() * 3) + 1;
            clip.gotoAndPlay(startFrame - 1);
            clip.vars.vr = Math.floor(Math.random() * 10);
            clip.onEnterFrame = (c) => {
              // onEnterFrame from DoAction (inline function): _rotation += (vr *= 0.9)
              let vr = c.vars.vr as number;
              vr *= 0.9;
              c.vars.vr = vr;
              c.rotation += (vr * Math.PI) / 180;
            };
          },
        ],
        [
          18,
          (clip) => {
            // AS DefineSprite_29/frame_19/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_part_w — water particle (DefineSprite_13) --------------
    // frame_1: AS DefineSprite_13/frame_1/DoAction.as
    //   seeds rotation, position, scale, gotoAndPlay(random(5)+1)
    // frame_11: AS DefineSprite_13/frame_11/DoAction.as → stop()
    this.partWSym = {
      name: "part_w",
      totalFrames: 11,
      frames: textures.getFrames("lib_part_w"),
      anchorX: partWAnchor.x,
      anchorY: partWAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_13/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            const t = 20 + 30 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const startFrame = Math.floor(Math.random() * 5) + 1;
            clip.gotoAndPlay(startFrame - 1);
          },
        ],
        [
          10,
          (clip) => {
            // AS DefineSprite_13/frame_11/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_part_e — earth particle (DefineSprite_24) --------------
    // frame_1: AS DefineSprite_24/frame_1/DoAction.as
    //   seeds rotation, position, scale, gotoAndPlay(random(5)+1)
    // frame_14: AS DefineSprite_24/frame_14/DoAction.as → stop()
    this.partESym = {
      name: "part_e",
      totalFrames: 14,
      frames: textures.getFrames("lib_part_e"),
      anchorX: partEAnchor.x,
      anchorY: partEAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_24/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            const t = 10 + 40 * Math.random();
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const startFrame = Math.floor(Math.random() * 5) + 1;
            clip.gotoAndPlay(startFrame - 1);
          },
        ],
        [
          13,
          (clip) => {
            // AS DefineSprite_24/frame_14/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- lib_part_a — air particle (DefineSprite_36) ----------------
    // frame_1: AS DefineSprite_36/frame_1/DoAction.as
    //   seeds rotation, position, gotoAndPlay(random(3)+1)
    // frame_9: AS DefineSprite_36/frame_9/DoAction.as → stop()
    this.partASym = {
      name: "part_a",
      totalFrames: 9,
      frames: textures.getFrames("lib_part_a"),
      anchorX: partAAnchor.x,
      anchorY: partAAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_36/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            clip.x = 20 * (Math.random() - 0.5);
            clip.y = 20 * (Math.random() - 0.5);
            const startFrame = Math.floor(Math.random() * 3) + 1;
            clip.gotoAndPlay(startFrame - 1);
          },
        ],
        [
          8,
          (clip) => {
            // AS DefineSprite_36/frame_9/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.partFSym);
    this.registry.register(this.partWSym);
    this.registry.register(this.partESym);
    this.registry.register(this.partASym);

    // ---- move — 1-frame container (DefineSprite_11_move) ------------
    // Two placed objects on frame_1:
    //   PlaceObject2_1_1: counter child that each enterFrame spawns
    //     n elemental particles on the root (outer mc) at move's position.
    //   PlaceObject2_5_3: wobble oscillator child.
    // We model both as a single onLoad (seeds both sets of vars on the
    // move clip itself) + onEnterFrame (runs both behaviours).
    const partFSym = this.partFSym;
    const partWSym = this.partWSym;
    const partESym = this.partESym;
    const partASym = this.partASym;

    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_11_move/frame_1/PlaceObject2_1_1/onClipEvent(load)
        clip.vars.c2 = 100;
        // AS DefineSprite_11_move/frame_1/PlaceObject2_5_3/onClipEvent(load)
        clip.vars.a_wobble = 30;
        clip.vars.i_wobble = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_11_move/frame_1/PlaceObject2_1_1/onClipEvent(enterFrame)
        // Spawn n particles of each active element on the root (outer mc)
        // at move's current position.
        const params = ctx.params ?? {
          fire: false,
          water: false,
          earth: false,
          air: false,
        };
        const nbre =
          (params.fire ? 1 : 0) +
          (params.water ? 1 : 0) +
          (params.earth ? 1 : 0) +
          (params.air ? 1 : 0);

        let n = 1;
        if (nbre === 1) {
          n = 3;
        } else if (nbre === 2) {
          n = 2;
        } else if (nbre === 3) {
          n = 1;
        } else if (nbre === 4) {
          n = 1;
        }

        // The root for particle placement is clip.parent (== the runtime root)
        // because in canonical AS: _parent._parent.attachMovie(...)
        // move is a child of root, so clip.parent = root.
        const root = clip.parent;
        let c2 = clip.vars.c2 as number;

        if (params.fire) {
          for (let c = c2; c < c2 + n; c++) {
            if (root) {
              const p = root.attach(partFSym, `part_f${c}`, c, ctx);
              p.x = clip.x;
              p.y = clip.y;
            }
          }
          c2++;
        }
        if (params.water) {
          for (let c = c2; c < c2 + n; c++) {
            if (root) {
              const p = root.attach(partWSym, `part_w${c}`, c, ctx);
              p.x = clip.x;
              p.y = clip.y;
            }
          }
          c2++;
        }
        if (params.earth) {
          for (let c = c2; c < c2 + n; c++) {
            if (root) {
              const p = root.attach(partESym, `part_e${c}`, c, ctx);
              p.x = clip.x;
              p.y = clip.y;
            }
          }
          c2++;
        }
        if (params.air) {
          for (let c = c2; c < c2 + n; c++) {
            if (root) {
              const p = root.attach(partASym, `part_a${c}`, c, ctx);
              p.x = clip.x;
              p.y = clip.y;
            }
          }
          c2++;
        }
        clip.vars.c2 = c2;

        // AS DefineSprite_11_move/frame_1/PlaceObject2_5_3/onClipEvent(enterFrame)
        // _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1
        let a = clip.vars.a_wobble as number;
        let i = clip.vars.i_wobble as number;
        i += 0.6;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a_wobble = a;
        clip.vars.i_wobble = i;
      },
    };

    // ---- shoot — 20-frame container (DefineSprite_10_shoot) ---------
    // PlaceObject2_1_1 onLoad: spawns burst of part_* on self.
    //   n = 14 - 3*fire - 3*water - 3*earth - 3*air
    //   Each active element spawns n particles starting from c2.
    // PlaceObject2_5_2 onLoad: seeds a=10, i=0.
    // PlaceObject2_5_2 onEnterFrame: _rotation = 90 + a*cos(i += PI); a /= 1.3
    // frame_20: _parent.removeMovieClip(); stop() → complete().
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 20,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 29.75,
        height: 31.6,
        offsetX: -23.25,
        offsetY: -17.6,
      }).x,
      anchorY: calculateAnchor({
        width: 29.75,
        height: 31.6,
        offsetX: -23.25,
        offsetY: -17.6,
      }).y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_10_shoot/frame_1/PlaceObject2_1_1/onClipEvent(load)
        // Spawn burst of elemental particles on self at impact.
        const params = ctx.params ?? {
          fire: false,
          water: false,
          earth: false,
          air: false,
        };
        const activeCount =
          (params.fire ? 1 : 0) +
          (params.water ? 1 : 0) +
          (params.earth ? 1 : 0) +
          (params.air ? 1 : 0);
        const n = 14 - 3 * activeCount;

        let c2 = 200;

        if (params.fire) {
          for (let c = c2; c < c2 + n; c++) {
            clip.attach(partFSym, `part_f${c}`, c, ctx);
          }
          c2++;
        }
        if (params.water) {
          for (let c = c2; c < c2 + n; c++) {
            clip.attach(partWSym, `part_w${c}`, c, ctx);
          }
          c2++;
        }
        if (params.earth) {
          for (let c = c2; c < c2 + n; c++) {
            clip.attach(partESym, `part_e${c}`, c, ctx);
          }
          c2++;
        }
        if (params.air) {
          for (let c = c2; c < c2 + n; c++) {
            clip.attach(partASym, `part_a${c}`, c, ctx);
          }
          c2++;
        }

        // AS DefineSprite_10_shoot/frame_1/PlaceObject2_5_2/onClipEvent(load)
        clip.vars.a_wobble = 10;
        clip.vars.i_wobble = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_shoot/frame_1/PlaceObject2_5_2/onClipEvent(enterFrame)
        // _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.3
        let a = clip.vars.a_wobble as number;
        let i = clip.vars.i_wobble as number;
        i += 3.1415;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.3;
        clip.vars.a_wobble = a;
        clip.vars.i_wobble = i;
      },
      frameScripts: new Map([
        [
          19,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_20/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as is empty — no sound, no child attaches.
    // The harness (displayType=30, ProjectileBallistic) automatically attaches
    // "move" and drives the arc, then attaches "shoot" at landing.
  }
}
