/**
 * Spell 310 — Séisme (Feca earth spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/310/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * symbols, with `move` carrying a wobbling boulder projectile along a
 * parabolic arc to the target, then `shoot` playing a 130-frame rock-
 * scatter impact. This matches the ballistic pattern exactly.
 *
 * Library symbols (all registered below):
 *   - DefineSprite_18 (inner wobble sprite inside `move`):
 *       Unnamed inner clip. onLoad seeds vr ∈ [100,299], random rotation,
 *       random gotoAndStop frame. onEnterFrame: _rotation += (vr /= _parent.r).
 *       _parent.r is set by cercle's onLoad.
 *
 *   - lib_cercle (DefineSprite_19_cercle, wraps DefineSprite_18):
 *       onLoad: va ∈ [1..4], t ∈ [60,129] (scale+alpha seed),
 *       r ∈ [1.1, 1.6]. onEnterFrame: fade by va, drift by _parent.vx/vy
 *       (which are on the cercle clip itself, set by move's onLoad via the
 *       inner clip hierarchy), remove when alpha < 10.
 *
 *   - lib_pierres (DefineSprite_12_pierres, impact rock particle):
 *       onLoad: seeds vx/vy/t/alpha/v/vr for ballistic bounce.
 *       onEnterFrame: bouncing gravity simulation; settles when |v| < 1.
 *
 *   - move (DefineSprite_9_move, 1-frame wobbling boulder container):
 *       PlaceObject2_4_1 onClipEvent(load): vr ∈ [-10,10], vx ∈ [0,0.3],
 *       i = 1.5. onEnterFrame: _rotation += vr; _yscale = 100*sin(i+=vx).
 *       frame_1/DoAction.as is empty — no frameScripts needed.
 *
 *   - shoot (DefineSprite_8_shoot, 130-frame impact):
 *       PlaceObject2_4_2 onClipEvent(load): seeds rb, apr, vr, g, vx, vy,
 *       fin=0. onEnterFrame: boulder bounce physics until fin=1.
 *       PlaceObject2_7_4 onClipEvent(enterFrame) at frame_103: fades
 *       _parent._alpha by 3 each frame.
 *       frame_1/DoAction.as: _rotation=0; SOMA.playSound("setag_310").
 *       frame_130/DoAction.as: _parent.removeMovieClip(); stop().
 *
 * Main timeline frame_1: SOMA.playSound("setag_305").
 *
 * The harness (displayType=30) automatically attaches `move`, drives it
 * along the parabolic arc, then attaches `shoot` at the target on landing
 * and calls runtime.signalHit(). We must NOT call signalHit ourselves.
 * complete() is fired from shoot's frame_130 script.
 *
 * NOTE on inner-clip hierarchy for `move`:
 *   The canonical SWF's `move` symbol has a placed child (PlaceObject2_4_1)
 *   that IS the wobbling boulder sprite. We model this as `move`'s onLoad
 *   attaching a `cercle` child (the boulder sprite), matching the AS
 *   PlaceObject2 instantiation order. The inner DefineSprite_18 is nested
 *   inside cercle.
 *
 * NOTE on `shoot`'s inner placed child (PlaceObject2_4_2):
 *   The canonical `shoot` symbol has a placed child whose clip events drive
 *   the bounce physics. We model this by having `shoot`'s onLoad attach a
 *   `pierres` child, and shoot's frame_103 script fades shoot's alpha.
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

// Bounds from manifest animations[] for shoot (the composite animation)
// and from what the AS hierarchy tells us about the library symbols.
// Since librarySymbols[] is empty in the manifest, we use the animations[]
// entry for `shoot` and treat inner symbols as container-only with frames:[].

const SHOOT_BOUNDS = {
  width: 106.85,
  height: 77.85,
  offsetX: -41.7,
  offsetY: -74.2,
};

export class Spell310 extends RuntimeSpell {
  readonly spellId = 310;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Cached symbol refs needed across methods
  private pierresSym!: SymbolDefinition;
  private cercleSym!: SymbolDefinition;
  private innerWobbleSym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- DefineSprite_18 — inner wobble sprite inside cercle/move ----
    // This is the unnamed inner placed child of DefineSprite_19_cercle.
    // AS: DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // No texture data available (not a named library symbol in manifest),
    // treat as container-only. The `shoot` animation frames are the visual.
    this.innerWobbleSym = {
      name: "innerWobble",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vr = Math.floor(Math.random() * 200) + 100;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(_totalframes) + 1) — totalFrames = 1, so frame 0
        clip.gotoAndStop(Math.floor(Math.random() * 1));
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_18/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + (vr /= _parent.r)
        // _parent is the cercle clip which has vars.r
        const parentR = (clip.parent?.vars.r as number) ?? 1.1;
        let vr = clip.vars.vr as number;
        vr = vr / parentR;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- lib_cercle (DefineSprite_19_cercle) — boulder wobble wrapper ----
    // AS: DefineSprite_19_cercle/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_19_cercle/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // The cercle clip wraps the inner wobble sprite and carries vx/vy for
    // position drift (read by the inner wobble's enterFrame for _parent.r,
    // and used in enterFrame to move itself).
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_19_cercle/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(load).as
        const va = 4 - Math.floor(Math.random() * 3);
        clip.vars.va = va;
        const t = 60 + Math.floor(Math.random() * 70);
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.1 + 0.5 * Math.random();
        // Place the inner wobble child (PlaceObject2_18_1 = the innerWobble)
        clip.attach(this.innerWobbleSym, "innerWobble", 1, ctx);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_19_cercle/frame_1/PlaceObject2_18_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const currentAlpha = clip.alpha * 100;
        if (currentAlpha < 10) {
          clip.parent?.remove();
          return;
        }
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        clip.alpha = (currentAlpha - va) / 100;
        // _X and _Y are on the cercle clip itself; vx/vy are on _parent
        // (the move clip that placed this cercle)
        const parent = clip.parent;
        if (parent) {
          let vx = parent.vars.vx as number;
          let vy = parent.vars.vy as number;
          clip.x += vx;
          clip.y += vy;
          parent.vars.vx = vx / r;
          parent.vars.vy = vy / r;
        }
      },
    };

    // ---- lib_pierres (DefineSprite_12_pierres) — impact rock particle ----
    // AS: DefineSprite_12_pierres/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_12_pierres/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Note: onLoad sets _parent._x and _parent._y — the "parent" of pierres
    // is the container clip that shoot attaches, so we set that container's
    // position. In our model, pierres is attached inside shoot, so _parent
    // refers to the shoot clip. We set clip.parent.x/y in onLoad.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_12_pierres/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y — position the shoot container
        const parent = clip.parent;
        if (parent) {
          parent.x = 20 * (Math.random() - 0.5);
          parent.y = 10 * (Math.random() - 0.5);
        }
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -10 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_12_pierres/frame_1/PlaceObject2_11_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        const t = clip.vars.t as number;

        const parent = clip.parent;
        if (parent) {
          parent.x += vx;
          parent.y += vy;
        }

        if (t !== 1) {
          clip.y += v;
          clip.rotation += (vr * Math.PI) / 180;
          v += 1;

          if (clip.y > 0) {
            // AS: SOMA.playSound("setag_310") is not here in pierres;
            // it's in shoot's frame_1 and shoot's inner clip enterFrame.
            vx *= 0.5;
            vy *= 0.5;
            clip.rotation = 0;
            clip.y = 0;
            v = -v / 4;
            vr = 40 * (-0.5 + Math.random()); // bounce dampens vr too

            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              clip.vars.t = 1;
            }
          }

          clip.vars.v = v;
          clip.vars.vr = vr;
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- move (DefineSprite_9_move) — 1-frame wobbling boulder ----
    // AS: DefineSprite_9_move/frame_1/PlaceObject2_4_1/onClipEvent(load).as
    //     DefineSprite_9_move/frame_1/PlaceObject2_4_1/onClipEvent(enterFrame).as
    //     DefineSprite_9_move/frame_1/DoAction.as (empty)
    // The harness attaches `move` and drives it along the arc. The placed
    // child (PlaceObject2_4_1) is the actual boulder wobble — we model it
    // by attaching a cercle child in move's onLoad.
    this.moveSym = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_9_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.vr = 20 * (-0.5 + Math.random());
        clip.vars.vx = 0.3 * Math.random();
        clip.vars.i = 1.5;
        // Attach the cercle child (the visual boulder) as PlaceObject2_4_1
        clip.attach(this.cercleSym, "cercle1", 1, ctx);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + vr
        // _yscale = 100 * Math.sin(i += vx)
        const vr = clip.vars.vr as number;
        let i = clip.vars.i as number;
        const vx = clip.vars.vx as number;
        clip.rotation += (vr * Math.PI) / 180;
        i += vx;
        clip.scaleY = (100 * Math.sin(i)) / 100;
        clip.vars.i = i;
      },
    };

    // ---- shoot (DefineSprite_8_shoot) — 130-frame impact ----
    // AS: DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_8_shoot/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_8_shoot/frame_1/DoAction.as: _rotation=0; SOMA.playSound("setag_310")
    //     DefineSprite_8_shoot/frame_103/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_8_shoot/frame_130/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // The shoot symbol has:
    //   - A placed child at frame_1 (PlaceObject2_4_2) — the bouncing rock.
    //     We attach a `pierres` instance in shoot's onLoad.
    //   - A placed child at frame_103 (PlaceObject2_7_4) — just fades
    //     _parent._alpha by 3 each frame. We model this as a frameScripts
    //     entry at frame 102 that installs an onEnterFrame on the shoot clip
    //     itself to fade its alpha.
    //
    // The `shoot` composite animation frames are used for the visual.
    const shootFrames = textures.getFrames("shoot");

    this.shootSym = {
      name: "shoot",
      totalFrames: 130,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_8_shoot/frame_1/DoAction.as
        // _rotation = 0 (override harness-applied velocity angle)
        clip.rotation = 0;
        // The sound is played in onSpellStart for frame_1 of shoot;
        // canonical AS fires it in frame_1/DoAction.as of shoot itself.
        // We capture callbacks via the runtime.
        // Note: playSound from within a symbol requires the callbacks ref.
        // We store it and call here via the runtime's callbacks.
        this.runtime.callbacks.playSound("setag_310");

        // Attach the bouncing rock child (PlaceObject2_4_2)
        clip.attach(this.pierresSym, "pierres1", 1, ctx);
      },
      frameScripts: new Map([
        [
          102,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_103/PlaceObject2_7_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
            // A placed child at frame_103 whose enterFrame fades _parent._alpha by 3.
            // We install a per-tick fade directly on the shoot clip from this frame onward.
            clip.onEnterFrame = (c) => {
              c.alpha = Math.max(0, c.alpha - 3 / 100);
            };
          },
        ],
        [
          129,
          (clip) => {
            // AS DefineSprite_8_shoot/frame_130/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.innerWobbleSym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.pierresSym);
    this.registry.register(this.moveSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("setag_305");
    callbacks.playSound("setag_305");
  }
}
