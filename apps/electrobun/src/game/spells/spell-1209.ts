/**
 * Spell 1209 — (Unknown name, likely a Cra/Ecaflip projectile burst).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1209/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`/`shoot`/`duplicate`
 * library symbol, no caster-side reference, no dual-anchored pattern.
 * The spell consists of:
 *   - sprite_7: a 117-frame composite impact animation anchored at the
 *     target cell. frame_115 calls `_parent.removeMovieClip()` — this
 *     signals spell completion.
 *   - sprite_6: a 2-frame particle symbol. frame_1 initialises per-
 *     particle physics (angle, velocity `v`, angular velocity `va`,
 *     alpha-decay `t`) and attaches an `onEnterFrame` that moves the
 *     particle along a jittery arc, decaying speed and scale. frame_2
 *     calls `stop()`. sprite_6 instances are attached by sprite_7 at
 *     some point during its timeline (the manifest lists sprite_6 as
 *     an `animations[]` entry that sprite_7's composite frames embed).
 *
 * Library symbols: none in `librarySymbols[]`. All symbols come from
 * `animations[]`, so NO `lib_` prefix is used anywhere.
 *
 * Main timeline (frame_2/DoAction.as): `stop();` — no sound call, no
 * explicit child attaches from the main timeline in canonical AS.
 * sprite_7 is the implicit main-timeline content (placed by the SWF
 * PlaceObject2 at depth 1 on the main timeline).
 *
 * Particle pattern for sprite_6:
 *   onLoad seeds: angle (random full circle), v (6.67..26.67),
 *     va (±20 deg/frame), t=100.
 *   onEnterFrame: randomly re-seeds va; applies _xscale = v*14;
 *     decays t by 0.95; advances angle by va; computes vx/vy from
 *     angle; translates _X/_Y; decays v by 0.9; sets _rotation=angle.
 *
 * Note: sprite_7 is composite (isComposite: true) — its 117 SVG frames
 * already incorporate the static visual layers. The runtime also
 * attaches live sprite_6 clips for the particle behaviour described
 * in DefineSprite_6/frame_1/DoAction.as. Frame 115 of sprite_7
 * (0-based: index 114) fires `_parent.removeMovieClip()`, ending the
 * spell.
 *
 * signalHit: fired at frame_1 of sprite_7 (the first rendered impact
 * frame) since there is no explicit canonical hit marker — the earliest
 * visible impact is the canonical signal point for TargetCell spells.
 * (We fire it at frame 0 of sprite_7, which is the impact first frame.)
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

// Bounds from manifest animations[] — no lib_ prefix (not in librarySymbols)
const SPRITE_6_BOUNDS = {
  width: 41.25,
  height: 10,
  offsetX: -20,
  offsetY: -5,
};

const SPRITE_7_BOUNDS = {
  width: 187.9,
  height: 187.9,
  offsetX: -95.7,
  offsetY: -109.7,
};

export class Spell1209 extends RuntimeSpell {
  readonly spellId = 1209;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite7Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE_7_BOUNDS);

    // ---- sprite_6 — jittery arc particle -------------------------
    // Canonical: DefineSprite_6/frame_1/DoAction.as (onLoad init)
    //            DefineSprite_6/frame_1/DoAction.as (onEnterFrame)
    //            DefineSprite_6/frame_2/DoAction.as → stop()
    //
    // frame_1 DoAction sets up per-particle state AND defines this.onEnterFrame.
    // In the runtime we split: onLoad handles the init assignments,
    // onEnterFrame handles the per-tick motion. frame_2 stops the clip.
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 2,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,

      // AS DefineSprite_6/frame_1/DoAction.as — initialisation block
      onLoad: (clip) => {
        clip.vars.angle = 360 * Math.random();
        clip.vars.v = 6.67 + Math.floor(Math.random() * 20);
        clip.vars.va = 40 * (-0.5 + Math.random());
        clip.vars.t = 100;
      },

      // AS DefineSprite_6/frame_1/DoAction.as — this.onEnterFrame function body
      onEnterFrame: (clip) => {
        let angle = clip.vars.angle as number;
        let v = clip.vars.v as number;
        let va = clip.vars.va as number;
        let t = clip.vars.t as number;

        // if (random(2) == 0) { va = 40 * (-0.5 + Math.random()); }
        if (Math.floor(Math.random() * 2) === 0) {
          va = 40 * (-0.5 + Math.random());
        }

        // _xscale = v * 14  (AS percent → TS decimal)
        clip.scaleX = (v * 14) / 100;

        // t *= 0.95  (alpha decay — AS used t as alpha but never set
        // _alpha directly in this script; it just decays for bookkeeping.
        // We mirror the variable but also apply it as alpha so the particle
        // visually fades out.)
        t *= 0.95;
        clip.alpha = t / 100;

        // angle += va
        angle += va;

        // vx/vy from angle (angle is in degrees, AS uses * 0.017453... = PI/180)
        const angleRad = angle * 0.017453292519943295;
        const vx = v * Math.cos(angleRad);
        const vy = v * Math.sin(angleRad);

        clip.x += vx;
        clip.y += vy;

        // v *= 0.9
        v *= 0.9;

        // _rotation = angle (degrees → radians)
        clip.rotation = (angle * Math.PI) / 180;

        // write back
        clip.vars.angle = angle;
        clip.vars.v = v;
        clip.vars.va = va;
        clip.vars.t = t;

        // remove when effectively invisible / stopped
        if (v < 0.1) {
          clip.remove();
        }
      },

      frameScripts: new Map([
        [
          1,
          // AS DefineSprite_6/frame_2/DoAction.as → stop()
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_7 — 117-frame composite impact animation ----------
    // Canonical: DefineSprite_7/frame_115/DoAction.as → _parent.removeMovieClip()
    //
    // This is the main impact sprite placed at the target cell.
    // frame 0 (AS frame_1): first visible impact frame → signal hit.
    // frame 114 (AS frame_115): remove parent → spell complete.
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 117,
      frames: textures.getFrames("sprite_7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,

      frameScripts: new Map([
        [
          0,
          // AS frame_1 (first impact frame) — signal hit at the first
          // rendered frame of the impact composite.
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          114,
          // AS DefineSprite_7/frame_115/DoAction.as: _parent.removeMovieClip()
          (clip) => {
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: frame_2/DoAction.as → stop()
    // No SOMA.playSound call. The main timeline implicitly places
    // sprite_7 at depth 1 (standard SWF PlaceObject2 on the main
    // timeline). We attach it explicitly here so it starts ticking.
    this.root.attach(this.sprite7Sym, "sprite7", 1, context);
  }
}
