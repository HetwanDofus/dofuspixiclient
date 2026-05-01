/**
 * Spell 408 — Lakam (Sacrieur earth/rock attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/408/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation
 * anchored at the target cell — no projectile motion, no caster reference,
 * no `move` symbol. The harness places the container at the target cell and
 * the `shoot` symbol plays out its 83-frame timeline there.
 *
 * The spell also has a `sprite11` library symbol (directlyDynamic: true,
 * characterId 11) which is an internal sub-sprite placed inside the `shoot`
 * composite. It carries an onClipEvent(enterFrame) that periodically spawns
 * `pierres` particles. The `pierres` symbol (characterId 6) has both
 * onClipEvent(load) and onClipEvent(enterFrame) driving full ballistic
 * physics for each stone fragment.
 *
 * Library symbols:
 *   - "pierres" (lib_pierres) — single-frame stone particle.
 *       onLoad: seeds vd, vx, vy, angle-based v2x/v2y, scale t, v, vr, tps.
 *       onEnterFrame: ballistic drift in two phases (rise then fall+fade);
 *                     removes parent wrapper clip when _alpha < 10.
 *   - "sprite11" (lib_sprite11) — 95-frame sub-animation placed inside shoot
 *       at depth 1 (frame 0 of shoot). Its clip carries an onEnterFrame
 *       (from PlaceObject2_9_3) that progressively spawns pierres pairs up
 *       to level*3. frame 6 stops the timeline.
 *   - "shoot" — 83-frame composite. Placed by the harness (TargetCell).
 *       frame 82: _parent.removeMovieClip() → complete().
 *
 * The shoot composite also contains sprite11 (a placed sub-sprite at
 * depth 1, frame 0). We attach sprite11 inside shoot's frame_1 script.
 *
 * Main timeline: SOMA.playSound("lakam_405").
 *
 * signalHit: fired at shoot frame 0 (first frame of impact at target) since
 * this is displayType=11 (not ballistic, harness does NOT auto-fire it).
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

// Bounds from manifest.json librarySymbols[]
const PIERRES_BOUNDS = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

const SPRITE11_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -62.05,
  offsetY: -98,
};

// Bounds for the shoot animation (from animations[])
const SHOOT_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

export class Spell408 extends RuntimeSpell {
  readonly spellId = 408;
  readonly displayType = SpellDisplayType.TargetCell;

  // Store symbol refs so inner symbols can reference each other.
  private pierresSym!: SymbolDefinition;
  private sprite11Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const sprite11Anchor = calculateAnchor(SPRITE11_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ----------------------------------------------------------------
    // "pierres" — stone fragment particle
    //
    // Each instance is attached INSIDE a wrapper clip spawned by
    // sprite11's onEnterFrame. The AS attaches "pierres" at depth c
    // inside `this` (which is the PlaceObject2_9_3 clip, a child of
    // sprite11). The wrapper clip's _x/_y are set by onLoad on the
    // pierres clip itself (_parent._x / _parent._y = the wrapper).
    //
    // AS path: DefineSprite_6_pierres/frame_1/DoAction.as → stop()
    //          PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //          PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // NOTE: The "pierres" symbol's PlaceObject2_5_1 is a nested clip
    // placed inside the pierres sprite at frame 1. In the runtime we
    // collapse this one level: the pierres SymbolDefinition itself
    // carries the onLoad/onEnterFrame that the canonical AS put on the
    // inner PlaceObject2_5_1 object. This matches the observable
    // runtime behaviour (the inner clip is non-visual; all physics are
    // on the inner clip but they mutate _parent = the pierres sprite).
    // ----------------------------------------------------------------
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      // AS: DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/
      //     CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.tps = 0;

        const vd = 30 + Math.floor(Math.random() * 30);
        clip.vars.vd = vd;

        // gotoAndPlay(random(4) + 1) — pierres has 1 frame so this is
        // effectively a no-op visually, but we honour the canonical call.
        clip.gotoAndPlay(Math.floor(Math.random() * 4));

        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // AS: an = _parent._parent._parent._parent._parent.angle + PI
        // Traversal from the pierres clip:
        //   clip (pierres) → wrapper → sprite11 clip → shoot → root
        // root.vars.angle is in DEGREES (canonical AS convention).
        // Convert to radians for the trig, then add PI.
        const root =
          clip.parent?.parent?.parent?.parent ??
          clip.parent?.parent?.parent ??
          clip.parent?.parent ??
          clip.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.an = an;
        clip.vars.v2x = Math.cos(an) * 5;
        clip.vars.v2y = Math.sin(an) * 5;

        // _parent._x and _parent._y set the wrapper clip's position.
        // In our runtime the pierres clip IS the wrapper (collapsed),
        // so we set clip.x / clip.y directly.
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = 60 * (-0.5 + Math.random());
      },

      // AS: DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        // if (_alpha < 10) removeMovieClip(_parent)
        if (clip.alpha < 0.1) {
          // _parent.removeMovieClip() — remove the pierres clip itself
          // (already collapsed, so clip.remove() is correct).
          clip.remove();
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const vr = clip.vars.vr as number;
        let tps = clip.vars.tps as number;
        const vd = clip.vars.vd as number;
        let v = clip.vars.v as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;

        // _parent._x += vx; _parent._y += vy;
        clip.x += vx;
        clip.y += vy;

        // _rotation = _rotation + vr  (degrees → radians)
        clip.rotation += (vr * Math.PI) / 180;

        // Phase 1: rise (tps < vd)
        // NOTE: AS uses tps++ (post-increment) twice in the same
        // expression block, so the first check uses tps and increments
        // it; the second check uses tps+1. We replicate the double-
        // increment faithfully.
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

        // Phase 2: fall + fade (tps > vd, after first increment)
        if (tps > vd) {
          v2y *= 1.2;
          v2x *= 1.2;
          clip.y += v2y;
          clip.x += v2x;
          clip.vars.v2y = v2y;
          clip.vars.v2x = v2x;
          // _alpha -= 10  (0-100 scale → 0-1: subtract 10/100)
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
        tps++;

        clip.vars.tps = tps;
      },

      // AS: DefineSprite_6_pierres/frame_1/DoAction.as → stop()
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
    // "sprite11" — the animated sub-composite placed inside shoot.
    //
    // directlyDynamic: true. Has 95 authored frames + an onEnterFrame
    // on PlaceObject2_9_3 (depth 3, placed at frame 0 of sprite 11's
    // own timeline) that periodically spawns pairs of pierres particles.
    // frame 6: stop().
    //
    // AS path: DefineSprite_11/frame_7/DoAction.as → stop()
    //          DefineSprite_11/frame_1/PlaceObject2_9_3/
    //              CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    this.sprite11Sym = {
      name: "sprite11",
      totalFrames: 95,
      frames: textures.getFrames("lib_sprite11"),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,

      // AS: DefineSprite_11/frame_1/PlaceObject2_9_3/
      //     CLIPACTIONRECORD onClipEvent(enterFrame).as
      //
      // The PlaceObject2_9_3 clip is a non-visual container placed at
      // depth 3 within sprite11. Its onEnterFrame spawns pierres pairs
      // into itself. We collapse it: the onEnterFrame is implemented
      // directly on sprite11 and pierres are attached as children of
      // sprite11.
      onLoad: (clip) => {
        // Seed the counter used by onEnterFrame.
        clip.vars.c = 0;
      },

      onEnterFrame: (clip, ctx) => {
        // AS: if (c < _parent._parent._parent.level * 3)
        // _parent._parent._parent from PlaceObject2_9_3 inside sprite11:
        //   PlaceObject2_9_3 → sprite11 → shoot → root
        // In our collapsed model: sprite11 clip's parent = shoot clip,
        // shoot clip's parent = root.
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        let c = clip.vars.c as number;
        if (c < level * 3) {
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          clip.vars.c = c;
        }
      },

      // AS: DefineSprite_11/frame_7/DoAction.as → stop()
      frameScripts: new Map([
        [
          6,
          (clip) => {
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // "shoot" — 83-frame main impact animation at target cell.
    //
    // The harness (TargetCell) does NOT automatically attach shoot;
    // for displayType=11 the harness leaves the root empty and the
    // per-spell module attaches its content. We attach shoot from
    // onSpellStart so it starts playing immediately.
    //
    // frame 0: signalHit + attach sprite11 at depth 1.
    // frame 82: _parent.removeMovieClip() → complete().
    //
    // The manifest shows sprite11 placed at frame 0 of shoot (the
    // `placements[]` entry with `kind: "place"`, `frame: 0`, `depth: 1`,
    // `translateX: 0.45`, `translateY: -5.15`).
    // ----------------------------------------------------------------
    this.shootSym = {
      name: "shoot",
      totalFrames: 83,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Signal hit at first impact frame (displayType 11 — harness
            // does NOT auto-fire signalHit).
            this.runtime.signalHit();

            // AS: sprite11 placed at frame 0 of shoot (PlaceObject2 depth 1)
            // with matrix translateX=0.45, translateY=-5.15.
            clip.attach(this.sprite11Sym, "sprite11", 1, ctx, {
              x: 0.45,
              y: -5.15,
            });
          },
        ],
        [
          82,
          (clip) => {
            // AS: DefineSprite_12_shoot/frame_83/DoAction.as
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.sprite11Sym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("lakam_405")
    callbacks.playSound("lakam_405");

    // Attach the shoot animation at the root. For displayType=11 the
    // root container is already positioned at the target cell by the
    // spell-view; shoot at (0,0) within root lands at target cell.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
