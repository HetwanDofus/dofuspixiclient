/**
 * Spell 913 — Flèche de Recul (Cra wind arrow / pushback arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/913/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` symbol
 * (DefineSprite_11_move) and a `shoot` symbol (DefineSprite_9_shoot),
 * which is the canonical marker for a ballistic projectile. The harness
 * drives `move` along a parabolic arc to the target, then attaches
 * `shoot` at impact and calls runtime.signalHit() automatically.
 *
 * Library symbols:
 *   - DefineSprite_3 — wind-streak particle, 35 frames. frame_1 sets
 *     _rotation = _parent._parent.angle and scatters position ±25/±12.5.
 *     frame_35 stops. No library symbol entry — attached inline by move's
 *     frame_1 at each of 7 depths (PlaceObject2_10_1, _3, _5, _7, _9,
 *     _11, _13). Each placement has identical onLoad / onEnterFrame
 *     semantics (amplitude oscillation decay).
 *   - DefineSprite_7 — sub-composite inside shoot; 27 frames, frame_27
 *     stops. No clip events. Also attached inside shoot (DefineSprite_8
 *     plays the sound).
 *   - move  (DefineSprite_11_move) — projectile container. frame_1 holds
 *     7 authored child placements (PlaceObject2_10_1 through _13), each
 *     an instance of the wind-streak sprite (DefineSprite_3) with identical
 *     onLoad / onEnterFrame clip events. The harness attaches move at
 *     caster and drives the arc.
 *   - shoot (DefineSprite_9_shoot) — 66-frame impact. frame_7: this.end()
 *     (signalHit — but harness already does it for displayType 30, so we
 *     skip). frame_65: _parent.removeMovieClip() → complete().
 *
 * Main timeline: DefineSprite_8/frame_1 plays sound "jet_903"; no explicit
 * attachMovie on the main timeline beyond move/shoot (handled by harness).
 *
 * Note on DefineSprite_3 particle placement: the 7 PlaceObject2 entries in
 * DefineSprite_11_move/frame_1 all have the same onLoad/onEnterFrame logic.
 * Each instance is independently tracked via clip.vars for `a` (amplitude)
 * and `i` (phase), so we register one shared symbol definition and attach
 * 7 instances with separate names. The onLoad for each seeds `a=45`,
 * `i=0` (implicit in AS — `i` starts undefined → 0 on first increment),
 * and sets scale from `50 + 3 * _parent._parent.level`. The onEnterFrame
 * oscillates rotation: `_rotation = 90 + a * cos(i += 0.5)`, decaying
 * amplitude by dividing by 1.1 each tick. `_parent._parent` in move's
 * children is move's parent (root), which holds `level` in root.vars.
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

// DefineSprite_3 (wind-streak particle) bounds.
// Not in librarySymbols[] — no explicit manifest entry. The particle
// is an authored composite rendered into the shoot/move atlases; we
// treat it as a container-only symbol (no frame textures) since its
// visual content is driven by the authored 35-frame timeline baked
// into the shoot composite frames. Runtime instances only need the
// clip-event physics.
const STREAK_BOUNDS = {
  width: 101.1,
  height: 63.25,
  offsetX: -62.05,
  offsetY: -28.4,
};

// shoot bounds from manifest animations[0]
const SHOOT_BOUNDS = {
  width: 101.1,
  height: 63.25,
  offsetX: -62.05,
  offsetY: -28.4,
};

export class Spell913 extends RuntimeSpell {
  readonly spellId = 913;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Keep refs so onSpellStart can reference them.
  private streakSym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const streakAnchor = calculateAnchor(STREAK_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_3 — wind-streak particle (7 instances in move) ----
    // Placed by DefineSprite_11_move/frame_1 via 7 PlaceObject2 entries.
    // All 7 share identical onLoad / onEnterFrame behaviour.
    //
    // AS DefineSprite_3/frame_1/DoAction.as:
    //   _rotation = _parent._parent.angle;
    //   _X = 50 * (Math.random() - 0.5);
    //   _Y = 25 * (Math.random() - 0.5);
    //
    // AS DefineSprite_3/frame_35/DoAction.as:
    //   stop();
    //
    // AS PlaceObject2_10_*/CLIPACTIONRECORD onClipEvent(load).as:
    //   a = 45;
    //   t = 50 + 3 * _parent._parent.level;
    //   _xscale = t;
    //   _yscale = t;
    //
    // AS PlaceObject2_10_*/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = 90 + a * Math.cos(i += 0.5);
    //   a /= 1.1;
    //
    // Note: `i` is never initialised in onLoad — AS treats undefined as 0
    // on first use in arithmetic, so `i += 0.5` on the first tick gives 0.5.
    // We initialise clip.vars.i = 0 here to reproduce that.
    this.streakSym = {
      name: "streak",
      totalFrames: 35,
      frames: [],
      anchorX: streakAnchor.x,
      anchorY: streakAnchor.y,

      // AS DefineSprite_11_move/frame_1/PlaceObject2_10_*/onClipEvent(load)
      onLoad: (clip) => {
        // Seed amplitude and scale from parent level.
        // _parent._parent in the AS is: streak → move → root.
        const root = clip.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        clip.vars.a = 45;
        clip.vars.i = 0;
        const t = 50 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },

      // AS DefineSprite_11_move/frame_1/PlaceObject2_10_*/onClipEvent(enterFrame)
      onEnterFrame: (clip) => {
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 0.5;
        // AS: _rotation = 90 + a * Math.cos(i) — degrees → radians
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_3/frame_1/DoAction.as:
            //   _rotation = _parent._parent.angle;
            //   _X = 50 * (Math.random() - 0.5);
            //   _Y = 25 * (Math.random() - 0.5);
            // _parent._parent for a streak is: streak → move → root.
            const root = clip.parent?.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
            clip.x = 50 * (Math.random() - 0.5);
            clip.y = 25 * (Math.random() - 0.5);
          },
        ],
        [
          34,
          (clip) => {
            // AS DefineSprite_3/frame_35/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- move — projectile container (DefineSprite_11_move) -------------
    // Harness attaches `move` at caster origin and drives it along the arc.
    // frame_1 of move spawns the 7 streak particles.
    //
    // The 7 PlaceObject2 entries in frame_1 of DefineSprite_11_move are:
    //   PlaceObject2_10_1, _3, _5, _7, _9, _11, _13
    // (depths 1, 3, 5, 7, 9, 11, 13 — the numbers in the path names are
    // the characterId_depth pattern).
    // All 7 use the same streak symbol definition; each gets independent
    // clip.vars state because they are separate SpellClip instances.
    this.moveSym = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_11_move/frame_1 implicitly places 7 instances
            // of DefineSprite_3 at depths 1, 3, 5, 7, 9, 11, 13.
            // Each fires its own onLoad + frame_1 script on attach.
            clip.attach(this.streakSym, "streak1", 1, ctx);
            clip.attach(this.streakSym, "streak3", 3, ctx);
            clip.attach(this.streakSym, "streak5", 5, ctx);
            clip.attach(this.streakSym, "streak7", 7, ctx);
            clip.attach(this.streakSym, "streak9", 9, ctx);
            clip.attach(this.streakSym, "streak11", 11, ctx);
            clip.attach(this.streakSym, "streak13", 13, ctx);
          },
        ],
      ]),
    };

    // ---- shoot — 66-frame impact (DefineSprite_9_shoot) -----------------
    // Harness attaches `shoot` at target on landing.
    //
    // AS DefineSprite_9_shoot/frame_7/DoAction.as:
    //   this.end();
    // → canonical signalHit. For displayType 30, harness already signals
    //   hit on landing, so we do NOT call signalHit again here.
    //
    // AS DefineSprite_9_shoot/frame_65/DoAction.as:
    //   this._parent.removeMovieClip();
    // → complete the spell.
    //
    // The shoot animation has authored frame textures (shoot_0..shoot_65).
    const shootFrames = textures.getFrames("shoot");
    this.shootSym = {
      name: "shoot",
      totalFrames: 66,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          65,
          (clip) => {
            // AS DefineSprite_9_shoot/frame_65/DoAction.as:
            //   this._parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.streakSym);
    this.registry.register(this.moveSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("jet_903");
    callbacks.playSound("jet_903");
  }
}
