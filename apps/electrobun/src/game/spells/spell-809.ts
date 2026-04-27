/**
 * Spell 809 — Lakam (Earth/Rock impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/809/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored `shoot`
 * animation anchored at the target cell with no projectile or caster-
 * relative motion. DefineSprite_39 is the outer container (166 frames):
 *   - frame_58:  this.end() → signalHit (damage popup)
 *   - frame_208: _parent.removeMovieClip() + stop() → spell complete
 *     (NOTE: frame_208 > 166 frames of the shoot animation — the
 *     DefineSprite_39 is the top-level container whose frame count
 *     extends beyond the shoot sub-sprite; we drive completion from
 *     frame_165 of DefineSprite_9_shoot which fires _parent.removeMovieClip())
 *
 * Library symbols:
 *   - lib_pierres — single-frame rock fragment particle. onLoad seeds
 *     vd (lifetime), vx/vy (spread), an (angle+π), v2x/v2y (gravity
 *     direction), t (scale), v (initial upward velocity), vr (rotation
 *     speed). onEnterFrame integrates position and rotates; fades
 *     after vd ticks, then accelerates in launch-angle direction.
 *
 * Structure analysis:
 *   - DefineSprite_9_shoot (the `shoot` symbol, 166 frames total):
 *       - frame_1: PlaceObject2_8_5 has onClipEvent(enterFrame) that
 *         spins and fades a child sprite (DefineSprite_6 / DefineSprite_3
 *         sub-children). This is an authored sub-composite, not a
 *         script-driven attach — the visual is in the precomposed
 *         shoot frames themselves.
 *       - frame_165: _parent.removeMovieClip(); stop() → complete.
 *   - DefineSprite_6 contains the `pierres` particle spawner:
 *       onClipEvent(enterFrame): spawns up to level*3 pairs of
 *       `pierres` particles each frame until count reached.
 *   - DefineSprite_39 wraps the outer main-timeline content.
 *       frame_58: this.end() → signalHit
 *       frame_208: _parent.removeMovieClip() → complete
 *     However, DefineSprite_9_shoot/frame_165 also removes parent —
 *     we use that as the canonical completion signal since shoot is
 *     the outermost registered symbol.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("lakam_405")
 *
 * The harness attaches `shoot` at the target cell for displayType=11.
 * We register `shoot` as the main animated symbol with its frame
 * scripts. The `pierres` library symbol is registered for particle
 * spawning triggered inside the shoot timeline.
 *
 * NOTE on DefineSprite_6 / DefineSprite_39 sub-sprites: these are
 * authored composite children baked into the shoot frames (visible in
 * the SVG frame sequence). The pierres-spawner (DefineSprite_6) is a
 * child placed inside shoot. We model it as part of the shoot frame_1
 * script — the onEnterFrame on PlaceObject2_4_3 (depth 3 in
 * DefineSprite_6) spawns pierres pairs. Since DefineSprite_6 is a
 * container-only clip placed at depth inside shoot, we register it as
 * a sub-symbol and attach it from shoot's frame_1 script.
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

const PIERRES_BOUNDS = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

const SHOOT_BOUNDS = {
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

export class Spell809 extends RuntimeSpell {
  readonly spellId = 809;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private spawnerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_pierres — rock fragment particle --------------------
    // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The pierres symbol has a child (PlaceObject2_14_1) placed at depth 1
    // with both load and enterFrame clip events. The _parent references
    // in those scripts refer to the pierres clip itself (the direct
    // parent of the placed child). We model the onLoad/onEnterFrame as
    // belonging to the pierres symbol directly — the child visual is
    // the lib_pierres sprite frame.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //
        // vd = 30 + random(30)
        // gotoAndPlay(random(4) + 1)  — random starting frame
        // vx = 15 * (Math.random() - 0.5)
        // vy = 15 * (Math.random() - 0.5)
        // an = _parent._parent._parent._parent._parent.angle + 3.1415
        //   hierarchy: inner-child → pierres → spawner-container →
        //              shoot → root  (root.vars.angle in degrees, AS stores degrees)
        // v2x = Math.cos(an) * 2
        // v2y = Math.sin(an) * 5
        // _parent._x = 20 * (Math.random() - 0.5)   → clip.x (the pierres clip)
        // _parent._y = 10 * (Math.random() - 0.5)   → clip.y
        // t = 60 + 40 * Math.random()
        // v = -10
        // _xscale = t; _yscale = t
        // vr = 60 * (-0.5 + Math.random())

        clip.vars.vd = 30 + Math.floor(Math.random() * 30);
        clip.vars.tps = 0;
        clip.gotoAndPlay(Math.floor(Math.random() * 4));

        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // Walk up: pierres.parent = spawner, spawner.parent = shoot, shoot.parent = root
        const root = clip.parent?.parent?.parent;
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.v2x = Math.cos(an) * 2;
        clip.vars.v2y = Math.sin(an) * 5;

        // Position scatter (applied to the pierres clip itself)
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = 60 * (-0.5 + Math.random());
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_15_pierres/frame_1/PlaceObject2_14_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //
        // if(_alpha < 10) { removeMovieClip(_parent) }
        // _parent._x += vx
        // _parent._y += vy
        // _rotation = _rotation + vr
        // if(tps++ < vd) { _Y += v; vx /= 1.2; vy /= 1.2; v /= 1.2 }
        // if(tps++ > vd) { _Y += (v2y *= 1.2); _parent._y += 10;
        //                  _X += (v2x *= 1.2); _alpha -= 10 }
        //
        // Note: the AS uses two tps++ in one frame, so tps increments
        // twice per frame. The first check is tps (before first inc),
        // the second check is tps+1 (after first inc). We replicate
        // the double-increment exactly.

        if (clip.alpha < 0.1) {
          clip.remove();
          return;
        }

        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const vr = clip.vars.vr as number;
        let tps = (clip.vars.tps as number) ?? 0;
        const vd = clip.vars.vd as number;
        let v = clip.vars.v as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;

        // _parent._x += vx  (_parent of the inner child = the pierres clip)
        clip.x += vx;
        clip.y += vy;

        // _rotation += vr (this is on the inner placed child — we apply
        // it to the pierres clip since we merged the hierarchy)
        clip.rotation += (vr * Math.PI) / 180;

        // First tps++ check: tps < vd → upward rise phase
        if (tps < vd) {
          clip.y += v;
          clip.vars.vx = vx / 1.2;
          clip.vars.vy = vy / 1.2;
          v = v / 1.2;
          clip.vars.v = v;
        }
        tps = tps + 1;

        // Second tps++ check: (tps) > vd → gravity/fade phase
        if (tps > vd) {
          v2y = v2y * 1.2;
          clip.y += v2y;
          clip.y += 10;
          v2x = v2x * 1.2;
          clip.x += v2x;
          clip.alpha = clip.alpha - 10 / 100;
          clip.vars.v2x = v2x;
          clip.vars.v2y = v2y;
        }
        tps = tps + 1;
        clip.vars.tps = tps;
      },
    };

    // ---- spawner — DefineSprite_6 container that spawns pierres --
    // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // This is a container-only clip placed inside the shoot composite.
    // Its child at PlaceObject2_4_3 (the spawning child) has an
    // enterFrame that spawns pairs of pierres until count reaches
    // level * 3. We model the enterFrame on the spawner clip itself.
    this.spawnerSym = {
      name: "spawner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // Initialize the counter
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //
        // if(c < _parent._parent._parent.level * 3) {
        //   c += 1; attachMovie("pierres", "pierres" + c, c);
        //   c += 1; attachMovie("pierres", "pierres" + c, c);
        // }
        //
        // _parent._parent._parent of the placed child (depth 3 in
        // DefineSprite_6) = DefineSprite_6's parent chain:
        //   spawning-child → spawner → shoot → root
        // root.vars.level is the spell level.

        let c = (clip.vars.c as number) ?? 0;
        const root = clip.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        const limit = level * 3;

        if (c < limit) {
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          c += 1;
          clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
          clip.vars.c = c;
        }
      },
    };

    // ---- shoot — 166-frame animated impact composite -------------
    // AS: DefineSprite_9_shoot/frame_165/DoAction.as:
    //   _parent.removeMovieClip(); stop()
    //
    // The shoot symbol contains the precomposed visual (166 SVG frames)
    // plus the spawner child attached at frame_1. A child at depth 5
    // (PlaceObject2_8_5) has an onClipEvent(enterFrame) that rotates
    // +35°/frame and fades -5 alpha — this is baked into the authored
    // composite frames so we don't need to model it separately.
    //
    // frame_58 inside DefineSprite_39 (the outer container wrapping
    // shoot) calls this.end() → signalHit. Since DefineSprite_39 is
    // the outer authored timeline and shoot (DefineSprite_9) is its
    // child, we treat frame_57 of shoot as the canonical hit frame
    // (frame_58 in 1-based AS = index 57 in 0-based runtime) since
    // the DefineSprite_39 frame_58 corresponds to approximately the
    // same moment in the shoot child timeline. We fire signalHit at
    // frame 57 (AS frame_58) of the shoot timeline.
    const shootAnchorCalc = calculateAnchor(SHOOT_BOUNDS);
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 166,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchorCalc.x,
      anchorY: shootAnchorCalc.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_9_shoot/frame_1 — attach the spawner
            // container (models DefineSprite_6 with its pierres spawner)
            clip.attach(this.spawnerSym, "spawner", 6, ctx);
          },
        ],
        [
          57,
          () => {
            // AS: DefineSprite_39/frame_58/DoAction.as → this.end()
            // Signals hit (damage popup) at the impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          165,
          (clip) => {
            // AS: DefineSprite_9_shoot/frame_165/DoAction.as
            // _parent.removeMovieClip(); stop()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.spawnerSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("lakam_405")
    callbacks.playSound("lakam_405");

    // For displayType=11 (TargetCell) the harness does NOT auto-attach
    // `shoot` — we must attach it ourselves from onSpellStart. The
    // shoot clip is placed at the root (container origin = target cell).
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
