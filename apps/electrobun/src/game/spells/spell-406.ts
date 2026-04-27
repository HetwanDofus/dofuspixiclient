/**
 * Spell 406 — Lakam (Sadida earth attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/406/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation in
 * `animations[]` (213 frames, no `move` symbol) and no caster-side logic in
 * the outer main-timeline scripts beyond `SOMA.playSound("lakam_405")`. The
 * whole effect lands at the target cell, making TargetCell correct.
 *
 * Library symbols:
 *   - `pierres` (DefineSprite_15_pierres) — single-frame stone particle.
 *     onLoad seeds position scatter, velocity vectors (with angle-based
 *     directional component), scale, and a random start frame via
 *     gotoAndPlay. onEnterFrame drives two-phase motion: initial float
 *     upward with lateral friction, then gravity-fall with alpha fade
 *     until alpha < 10 → removeMovieClip(_parent).
 *   - `goutte` (DefineSprite_1_goutte) — single-frame water droplet.
 *     frame_1 calls stop(). Purely visual; spawned by DefineSprite_21
 *     (the inner mist cloud) at the stone's current X during fade.
 *
 * The `shoot` animation (213 frames) is the main composite. It is in
 * `animations[]` only (not in `librarySymbols[]`), so the harness attaches
 * it via displayType=11 (TargetCell anchor). The shoot symbol carries
 * several authored child clips (DefineSprite_22 / DefineSprite_6 /
 * DefineSprite_21) driven by PlaceObject2 clip events and DoAction scripts.
 *
 * Key timings inside DefineSprite_22 (the outer rock-burst container):
 *   - frame_4:  `_rotation = _parent.angle` — orient to caster direction.
 *   - frame_49: `this.end()` → signalHit.
 *   - frame_142: `_parent.removeMovieClip(); stop()` → runtime.complete().
 *
 * DefineSprite_6 (stone spawner, depth 3 inside DefineSprite_22):
 *   onLoad: c = 0.
 *   onEnterFrame: while c < level*3, attach two `pierres` particles per
 *   iteration.
 *
 * DefineSprite_21 (mist/droplet cloud, placed at depths 6/11/16/26 inside
 * DefineSprite_22 at frames 1/7/31/37 with level-gated visibility):
 *   onLoad: seed v, va, t, r; set scale.
 *   onEnterFrame: drift X, fade alpha, spawn `goutte` droplets along path,
 *   decelerate. frame_22: stop().
 *
 * DefineSprite_3 (rotation randomiser, child of DefineSprite_6):
 *   frame_1: `_rotation = random(360)`.
 *
 * DefineSprite_9_shoot (inner spinning/fading overlay at depth 9 inside
 * DefineSprite_22's frame_1 child PlaceObject2_8_9):
 *   onEnterFrame: _rotation += 70 (degrees), _alpha -= 10.
 *
 * Main timeline: SOMA.playSound("lakam_405") only (frame_1/DoAction.as).
 * The `shoot` animation is the top-level animation entry — the harness
 * places it at the TargetCell anchor automatically. We register shoot as
 * a SymbolDefinition so its frame scripts and inner child clip-events are
 * wired up.
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

const PIERRES_BOUNDS = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

// goutte has 0x0 bounds in the manifest; use a neutral anchor.
const GOUTTE_BOUNDS = {
  width: 1,
  height: 1,
  offsetX: 0,
  offsetY: 0,
};

// ---- Bounds for the shoot animation (from animations[]) ----
const SHOOT_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

export class Spell406 extends RuntimeSpell {
  readonly spellId = 406;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep refs so onSpellStart can attach shoot.
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const goutteAnchor = calculateAnchor(GOUTTE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ----------------------------------------------------------------
    // goutte — DefineSprite_1_goutte
    // A simple water-droplet particle. frame_1/DoAction.as: stop().
    // Spawned by DefineSprite_21's onEnterFrame at varying X positions.
    // ----------------------------------------------------------------
    const goutteSym: SymbolDefinition = {
      name: "goutte",
      totalFrames: 1,
      frames: textures.getFrames("lib_goutte"),
      anchorX: goutteAnchor.x,
      anchorY: goutteAnchor.y,
      // AS: DefineSprite_1_goutte/frame_1/DoAction.as → stop()
      frameScripts: new Map([
        [
          0,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // pierres — DefineSprite_15_pierres
    // Single-frame stone particle. Carries a nested child (the visual
    // sprite itself at PlaceObject2_14_1) whose clip events drive the
    // physics. In the AS tree the clip events are on the INNER child
    // of the pierres sprite; we model them as onLoad/onEnterFrame on
    // the pierres symbol itself (the registry attaches at the same
    // depth so the effect is identical).
    // ----------------------------------------------------------------
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/
      //     CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.vd = 90 + Math.floor(Math.random() * 90);
        // gotoAndPlay(random(12) + 1) — 1-based AS → 0-based runtime
        clip.gotoAndPlay(Math.floor(Math.random() * 12));

        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // _parent._parent._parent._parent._parent.angle
        // pierres → pierres-parent (sprite_spawner/DefineSprite_6) →
        // DefineSprite_22 → shoot container → root
        // In our tree: clip.parent is the name-keyed child of the
        // spawner; the spawner (DefineSprite_6 equivalent) is inside
        // DefineSprite_22, which is inside shoot, which is inside root.
        // root.vars.angle is stored as DEGREES by configureHarness.
        const root = clip.parent?.parent?.parent?.parent ?? clip.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.an = an;
        clip.vars.v2x = Math.cos(an) * 5;
        clip.vars.v2y = Math.sin(an) * 5;

        // _parent._x / _parent._y scatter — position the parent
        // (the container holding this clip) within its own parent.
        const parent = clip.parent;
        if (parent) {
          parent.x = 20 * (Math.random() - 0.5);
          parent.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.vr = 30 * (-0.5 + Math.random());
        clip.vars.tps = 0;
      },

      // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        if (clip.alpha < 10 / 100) {
          // removeMovieClip(_parent)
          const parent = clip.parent;
          if (parent) {
            parent.remove();
          }
          return;
        }

        const parent = clip.parent;
        if (parent) {
          parent.x += clip.vars.vx as number;
          parent.y += clip.vars.vy as number;
        }

        const vr = clip.vars.vr as number;
        clip.rotation += (vr * Math.PI) / 180;

        let tps = clip.vars.tps as number;
        let v = clip.vars.v as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const vd = clip.vars.vd as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;

        if (tps < vd) {
          clip.y += v;
          vx /= 1.2;
          vy /= 1.2;
          v /= 1.2;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
          clip.vars.v = v;
        }

        tps++;
        clip.vars.tps = tps;

        if (tps > vd) {
          v2y *= 1.06;
          v2x *= 1.06;
          clip.y += v2y;
          clip.x += v2x;
          clip.vars.v2y = v2y;
          clip.vars.v2x = v2x;
          clip.alpha -= 1 / 100;
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_3 — rotation-randomiser child.
    // frame_1/DoAction.as: _rotation = random(360)
    // This child is placed inside the stone-spawner (DefineSprite_6)
    // by the authored timeline. We register it as a symbol so that
    // when the spawner attaches it, the frame_1 script fires.
    // ----------------------------------------------------------------
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS: DefineSprite_3/frame_1/DoAction.as
      frameScripts: new Map([
        [
          0,
          (clip) => {
            clip.rotation =
              (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_9_shoot — inner spinning/fading overlay.
    // Placed at depth 9 inside DefineSprite_22 frame_1.
    // AS: DefineSprite_9_shoot/frame_1/PlaceObject2_8_9/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation += 70;  _alpha -= 10;
    // AS: DefineSprite_9_shoot/frame_211/DoAction.as → stop()
    // ----------------------------------------------------------------
    const innerShootSym: SymbolDefinition = {
      name: "innerShoot",
      totalFrames: 211,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + 70 (degrees)
        clip.rotation += (70 * Math.PI) / 180;
        // AS: _alpha = _alpha - 10 (Flash 0-100 units)
        clip.alpha -= 10 / 100;
      },
      // AS: DefineSprite_9_shoot/frame_211/DoAction.as → stop()
      frameScripts: new Map([
        [
          210,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_21 — mist/droplet cloud particle.
    // Placed inside DefineSprite_22 at depths 6, 11, 16, 26
    // (frames 1, 7, 31, 37) with level-gated visibility.
    //
    // onLoad: seed v, va, t, r; apply scale.
    // onEnterFrame: drift X, fade alpha, spawn goutte droplets, decel.
    // frame_22/DoAction.as: stop().
    //
    // NOTE: Math.random(3) in AS2 ignores the argument — it's the same
    // as Math.random() (returns 0-1 float). We mirror that exactly.
    // ----------------------------------------------------------------
    const sprite21Sym: SymbolDefinition = {
      name: "sprite21",
      totalFrames: 22,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      // AS: DefineSprite_21/frame_1/PlaceObject2_19_1/
      //     CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = 5 + 18 * Math.random();
        // Math.random(3) in AS2 is identical to Math.random() — arg ignored
        clip.vars.va = 1 + Math.random();
        const t = 50 + 50 * Math.random();
        clip.vars.t = t;
        clip.vars.r = 0.1 + Math.random() * 0.8;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // c is a counter for goutte spawning; initialise here
        clip.vars.c = 0;
      },

      // AS: DefineSprite_21/frame_1/PlaceObject2_19_1/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip, ctx) => {
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        let c = clip.vars.c as number;

        clip.x += v;
        clip.alpha -= va / 100;

        // _parent is DefineSprite_22; _parent._parent is shoot;
        // _parent._parent._parent is root.
        const root = clip.parent?.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;

        if (c < 4 * level) {
          const parent = clip.parent;
          if (parent) {
            const goutteName = "goutte" + c;
            const attached = parent.attach(goutteSym, goutteName, c + 1, ctx);
            attached.x = clip.x;
          }
          c++;
          clip.vars.c = c;
        }

        v /= 1.2;
        clip.vars.v = v;
      },

      // AS: DefineSprite_21/frame_22/DoAction.as → stop()
      frameScripts: new Map([
        [
          21,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // DefineSprite_6 — stone-particle spawner.
    // Placed inside DefineSprite_22 at depth 3 (frame_1).
    // onLoad: c = 0.
    // onEnterFrame: while c < level*3, attach two pierres per pass.
    // ----------------------------------------------------------------
    const sprite6Sym: SymbolDefinition = {
      name: "sprite6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/
      //     CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.c = 0;
      },

      // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip, ctx) => {
        let c = clip.vars.c as number;
        // _parent._parent._parent.level:
        // sprite6 → DefineSprite_22 → shoot → root
        const root = clip.parent?.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;

        if (c < level * 3) {
          c += 1;
          clip.attach(pierresSym, "pierres" + c, c, ctx);
          c += 1;
          clip.attach(pierresSym, "pierres" + c, c, ctx);
          clip.vars.c = c;
        }
      },
    };

    // ----------------------------------------------------------------
    // DefineSprite_22 — main rock-burst container (top-level child of
    // the shoot animation root). This is the orchestrating clip.
    //
    // Authored child placements (PlaceObject2 in source):
    //   frame_1 depth 9  → innerShoot (spinning overlay)
    //   frame_1 depth 3  → sprite6 (stone spawner)
    //   frame_1 depth 6  → sprite21 instance (level≥2 visible)
    //   frame_7 depth 11 → sprite21 instance (level≥3 visible)
    //   frame_31 depth 16 → sprite21 instance (level≥2 visible)
    //   frame_37 depth 26 → sprite21 instance (level≥3 visible)
    //
    // Key frame scripts:
    //   frame_4  : _rotation = _parent.angle
    //   frame_49 : this.end() → signalHit
    //   frame_142: _parent.removeMovieClip(); stop() → complete
    // ----------------------------------------------------------------
    const sprite22Sym: SymbolDefinition = {
      name: "sprite22",
      totalFrames: 142,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          // frame_1 (index 0): place initial children
          0,
          (clip, ctx) => {
            // Attach innerShoot (depth 9) — spinning fading overlay
            clip.attach(innerShootSym, "innerShoot", 9, ctx);

            // Attach sprite6 stone spawner (depth 3)
            clip.attach(sprite6Sym, "sprite6", 3, ctx);

            // Attach sprite21 mist cloud at depth 6 (level-gated)
            // AS: DefineSprite_22/frame_1/PlaceObject2_21_6/onClipEvent(load)
            //   if (_parent._parent.level < 2) { _visible = false; }
            // _parent._parent from sprite21's perspective:
            //   sprite21 → sprite22 → shoot → root; level is on root.vars
            const root = clip.parent?.parent ?? clip.parent;
            const level = (root?.vars.level as number) ?? 1;

            const mist6 = clip.attach(sprite21Sym, "mist6", 6, ctx);
            if (level < 2) {
              mist6.visible = false;
            }
          },
        ],
        [
          // frame_4 (index 3): _rotation = _parent.angle
          // AS: DefineSprite_22/frame_4/DoAction.as
          3,
          (clip) => {
            const root = clip.parent?.parent ?? clip.parent;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          // frame_7 (index 6): place sprite21 at depth 11 (level≥3 only)
          // AS: DefineSprite_22/frame_7/PlaceObject2_21_11/onClipEvent(load)
          //   if (_parent._parent.level < 3) { _visible = false; }
          6,
          (clip, ctx) => {
            const root = clip.parent?.parent ?? clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const mist11 = clip.attach(sprite21Sym, "mist11", 11, ctx);
            if (level < 3) {
              mist11.visible = false;
            }
          },
        ],
        [
          // frame_31 (index 30): place sprite21 at depth 16 (level≥2)
          // AS: DefineSprite_22/frame_31/PlaceObject2_21_16/onClipEvent(load)
          //   if (_parent._parent.level < 2) { _visible = false; }
          30,
          (clip, ctx) => {
            const root = clip.parent?.parent ?? clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const mist16 = clip.attach(sprite21Sym, "mist16", 16, ctx);
            if (level < 2) {
              mist16.visible = false;
            }
          },
        ],
        [
          // frame_37 (index 36): place sprite21 at depth 26 (level≥3)
          // AS: DefineSprite_22/frame_37/PlaceObject2_21_26/onClipEvent(load)
          //   if (_parent._parent.level < 3) { _visible = false; }
          36,
          (clip, ctx) => {
            const root = clip.parent?.parent ?? clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const mist26 = clip.attach(sprite21Sym, "mist26", 26, ctx);
            if (level < 3) {
              mist26.visible = false;
            }
          },
        ],
        [
          // frame_49 (index 48): this.end() → signalHit
          // AS: DefineSprite_22/frame_49/DoAction.as
          48,
          () => {
            this.runtime.signalHit();
          },
        ],
        [
          // frame_142 (index 141): _parent.removeMovieClip(); stop()
          // AS: DefineSprite_22/frame_142/DoAction.as
          141,
          (clip) => {
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — top-level animation container (213 frames, from animations[]).
    // The harness places this at the TargetCell anchor (displayType=11).
    // It hosts sprite22 as its main child and drives the composite.
    // ----------------------------------------------------------------
    this.shootSym = {
      name: "shoot",
      totalFrames: 213,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      // AS: DefineSprite_9_shoot/frame_211/DoAction.as → stop()
      // (This is the outer shoot container; the 211-frame stop is also
      // honoured here as a safety net, though sprite22 completes at 142.)
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach the main rock-burst orchestrator as the first child
            clip.attach(sprite22Sym, "sprite22", 1, ctx);
          },
        ],
        [
          210,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(goutteSym);
    this.registry.register(pierresSym);
    this.registry.register(sprite3Sym);
    this.registry.register(innerShootSym);
    this.registry.register(sprite21Sym);
    this.registry.register(sprite6Sym);
    this.registry.register(sprite22Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("lakam_405")
    callbacks.playSound("lakam_405");

    // For displayType=11 (TargetCell) the harness does NOT auto-attach
    // any child — we attach the shoot container here so it starts
    // ticking from the next runtime frame.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
