/**
 * Spell 2016 — Setag (Osamodas summon-trail effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2016/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `move` symbol
 * (DefineSprite_11_move) that tracks its own position each frame and
 * spawns `cercle` trail particles behind it as it travels, and a `shoot`
 * symbol (DefineSprite_6_shoot) that is the 159-frame impact animation.
 * The harness rotates the root container to face the target, places
 * `shoot` at the target-relative offset. The `move` symbol is attached
 * by DefineSprite_11_move/frame_1 logic driven via the harness.
 *
 * Actually, re-reading the AS more carefully:
 *   - `DefineSprite_11_move` spawns cercle particles each frame as
 *     the harness moves the `move` clip along the line to target.
 *   - `DefineSprite_6_shoot` is the 159-frame burn at the target;
 *     frame_157 calls `_parent.removeMovieClip()` + stop().
 *   - `DefineSprite_17` (unnamed particle inside shoot, at depth 3,
 *     frame_130) fades out via alpha -= 10 in its enterFrame.
 *   - `DefineSprite_18_cercle` is the trail particle: onLoad seeds
 *     physics (va, t, r); onEnterFrame fades and drifts using vx/vy
 *     stored on the cercle clip's parent (the `_parent` in AS = the
 *     cercle clip itself since attachMovie puts properties on it).
 *   - `DefineSprite_10` is a sub-clip inside shoot; frame_10 loops
 *     back to frame_1.
 *
 * displayType=20 (ProjectileLinear): root at caster, rotated to face
 * target, `shoot` attached at target-relative offset inside the
 * rotated container. `move` is also registered for the trail particle
 * spawning logic.
 *
 * Library symbols:
 *   - cercle — trail particle. onLoad seeds va, t, _xscale/_yscale,
 *     _alpha, r. onEnterFrame fades by va, drifts by vx/vy stored on
 *     the cercle clip itself (set by move's frame_1 logic), decays
 *     vx/vy by r; removes when alpha < 10.
 *
 * Unnamed inner particles (DefineSprite_17) inside shoot at depth 3:
 *   onLoad: seeds vr = random(33)+17, sets random rotation + frame.
 *   onEnterFrame: _rotation += vr /= _parent.r  (r from shoot's vars).
 *
 * Main timeline: SOMA.playSound("setag_305").
 *
 * signalHit: fired at shoot's impact — approximately frame 1 of shoot
 * (first frame after landing). For displayType 20 the harness does NOT
 * auto-signal hit, so we fire it in shoot's frame_0 script.
 *
 * complete(): fired from shoot's frame_156 script (AS frame_157:
 * `_parent.removeMovieClip(); stop();`).
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

const CERCLE_BOUNDS = {
  width: 24.75,
  height: 10.45,
  offsetX: -11.15,
  offsetY: -9.5,
};

const SHOOT_BOUNDS = {
  width: 90.15,
  height: 62.85,
  offsetX: -25,
  offsetY: -60.75,
};

export class Spell2016 extends RuntimeSpell {
  readonly spellId = 2016;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- lib_cercle — trail particle spawned by move each frame ----
    // AS: DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Note: In the AS, `_parent.vx` / `_parent.vy` refer to the cercle
    // clip's own properties set by move's frame_1 script:
    //   eval("_parent.cercle" + c).vx = vx;
    //   eval("_parent.cercle" + c).vy = vy;
    // So vx/vy are on the cercle clip itself (clip.vars.vx/vy),
    // and the sub-sprite (PlaceObject2_17_1) reads `_parent.vx` where
    // _parent is the cercle clip. We fold both levels into one: the
    // cercle SymbolDefinition's onLoad/onEnterFrame are the inner
    // sprite's clip events, but they operate on `clip` which IS the
    // cercle clip (since PlaceObject2_17_1 is just the visual child,
    // not a separately tracked SpellClip node at this level).
    const cercleSym: SymbolDefinition = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/
        //     CLIPACTIONRECORD onClipEvent(load).as
        //   va = 2 - random(1.5);  → random(1.5) in AS = floor(rand*1.5) ∈ {0,1}
        //   t = 60 + random(70);
        //   _xscale = t; _yscale = t;
        //   _alpha = 70 + random(30);
        //   r = 1.05 + 0.5 * Math.random();
        const va = 2 - Math.floor(Math.random() * 1.5);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.va = va;
        clip.vars.r = 1.05 + 0.5 * Math.random();
        // vx/vy are set externally by move's frame_1 script after attach
        // Default to 0 in case they aren't set yet.
        if (clip.vars.vx === undefined) {
          clip.vars.vx = 0;
        }
        if (clip.vars.vy === undefined) {
          clip.vars.vy = 0;
        }
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   if(_alpha < 10) { _parent.removeMovieClip(); }
        //   _alpha = _alpha - va;
        //   _X = _X + _parent.vx;
        //   _Y = _Y + _parent.vy;
        //   _parent.vx /= r;
        //   _parent.vy /= r;
        const alphaPct = clip.alpha * 100;
        if (alphaPct < 10) {
          clip.remove();
          return;
        }
        const va = clip.vars.va as number;
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const r = clip.vars.r as number;
        clip.alpha = (alphaPct - va) / 100;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / r;
        clip.vars.vy = vy / r;
      },
    };

    // ---- move — container that spawns trail particles while in flight ----
    // AS: DefineSprite_11_move/frame_1/DoAction.as
    //   c = 33;
    //   xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi; vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle"+c, c);
    //     eval("_parent.cercle"+c)._x = _X;
    //     eval("_parent.cercle"+c)._y = _Y - 20;
    //     eval("_parent.cercle"+c).vx = vx;
    //     eval("_parent.cercle"+c).vy = vy;
    //     c++; xi = _X; yi = _Y;
    //   };
    //
    // The harness drives the move clip's x/y along the projectile line
    // each tick. The onEnterFrame here records the delta each frame and
    // spawns a cercle particle on the parent (root) at the current pos.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_11_move/frame_1/DoAction.as
            // Initialize the trail particle counter and position tracking.
            clip.vars.c = 33;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS: DefineSprite_11_move/frame_1/DoAction.as — the onEnterFrame
        // closure set up in frame_1.
        const c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        const vx = clip.x - xi;
        const vy = clip.y - yi;
        const parent = clip.parent;
        if (parent) {
          const cercleInst = parent.attach(cercleSym, `cercle${c}`, c, ctx);
          cercleInst.x = clip.x;
          cercleInst.y = clip.y - 20;
          cercleInst.vars.vx = vx;
          cercleInst.vars.vy = vy;
        }
        clip.vars.c = c + 1;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---- shoot — 159-frame impact animation at target ---------------
    // AS: DefineSprite_6_shoot/frame_157/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    //
    // The shoot animation has a sub-clip at depth 3 (PlaceObject2_5_3)
    // whose enterFrame fades it: _parent._alpha -= 10 (frame_130 onward).
    // That sub-clip corresponds to an authored sprite inside shoot's
    // visual timeline — since the shoot frames are rendered as composite
    // SVG frames, the alpha fade is baked into the authored frames.
    // We handle the fade by attaching a sub-clip definition that applies
    // the alpha decrement to shoot itself starting at frame 130.
    //
    // Actually DefineSprite_6_shoot's PlaceObject2_5_3 is a child of
    // shoot, and its enterFrame does `_parent._alpha -= 10` meaning
    // shoot's alpha decrements. We model this by adding an onEnterFrame
    // to the shootSym itself that starts decrementing at frame 130.
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (_clip) => {
        // No canonical onLoad for shoot itself.
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6_shoot/frame_130/PlaceObject2_5_3/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        //   _parent._alpha -= 10;
        // This fires from frame 130 onwards (0-based: frame index >= 129).
        if (clip.currentFrame >= 129) {
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
      },
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: shoot frame_1 — signal hit when the impact begins.
            // displayType=20 (ProjectileLinear): harness does NOT auto-signal hit.
            this.runtime.signalHit();
          },
        ],
        [
          156,
          (clip) => {
            // AS: DefineSprite_6_shoot/frame_157/DoAction.as
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(cercleSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("setag_305");
    callbacks.playSound("setag_305");
  }
}
