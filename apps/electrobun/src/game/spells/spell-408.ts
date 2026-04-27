/**
 * Spell 408 — Lakam (Earth/Stone impact, likely Sacrier or Feca class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/408/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` animation anchored
 * at the target cell, with no `move` symbol, no caster-relative logic, and no
 * `_parent.cellFrom` / `_parent.cellTo` world-absolute positioning. It is a
 * pure target-cell impact spell.
 *
 * AS layout:
 *   - main timeline frame_1: SOMA.playSound("lakam_405")
 *   - DefineSprite_12_shoot (83 frames): the top-level shoot composite.
 *       frame_83: _parent.removeMovieClip(); stop() → spell complete.
 *       Internally contains DefineSprite_11 and DefineSprite_14 composites.
 *   - DefineSprite_14 (at least 2 frames): inner composite.
 *       frame_2: stop(); this.end() → signalHit (damage popup).
 *   - DefineSprite_11 (7 frames): inner particle emitter container.
 *       frame_1: has a PlaceObject2_9_3 clip with onClipEvent(enterFrame) that
 *                spawns `pierres` particles in pairs up to level*3 total.
 *       frame_7: stop().
 *   - DefineSprite_8 (container): random rotation on load.
 *       frame_1: _rotation = random(360)
 *   - DefineSprite_13_goutte: single-frame drip clip.
 *       frame_1: stop()
 *   - lib_pierres (1 frame): stone particle with full physics.
 *       onLoad: seeds vd, vx, vy, an, v2x, v2y, t, v, vr; positions _parent.
 *       onEnterFrame: integrates motion, fades, removes when _alpha < 10.
 *
 * The `shoot` symbol is authored in the manifest animations[] (83 frames,
 * fully composite). DefineSprite_11, DefineSprite_14, DefineSprite_8, and
 * DefineSprite_13_goutte are sub-composites embedded within shoot — the
 * extractor bakes them into the shoot frames. We model them as container-only
 * SymbolDefinitions to carry their frame scripts.
 *
 * Library symbols:
 *   - lib_pierres — stone particle. onLoad seeds physics. onEnterFrame
 *     integrates, fades, removes when alpha < 10.
 *
 * The harness attaches `shoot` at root for displayType=11. We register `shoot`
 * with its 83 frames and final-frame completion script.
 *
 * signalHit is fired from DefineSprite_14's frame_2 script (this.end() in
 * canonical AS). complete() is fired from shoot's frame_83.
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

export class Spell408 extends RuntimeSpell {
  readonly spellId = 408;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);

    // ---- lib_pierres — stone particle with full physics ----------
    // AS DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/onClipEvent(load)
    // and onClipEvent(enterFrame).
    // Note: The pierres clip itself is a single-frame sprite. Its _parent
    // is DefineSprite_8 (the random-rotation wrapper), whose _parent is
    // the particle list clip (DefineSprite_11's PlaceObject2_9_3 child),
    // whose _parent._parent._parent._parent is the outer mc (root).
    // The angle traversal in AS: _parent._parent._parent._parent._parent.angle
    // = root.vars.angle (5 levels up from the pierres clip in the authored SWF).
    // In our flat runtime model the pierres clip's parent chain is:
    //   pierres → (attached inside sprite_8_instance → sprite_11_emitter → shoot → root)
    // We walk up to root to read angle.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/onClipEvent(load)
        // vd = 30 + random(30)
        // gotoAndPlay(random(4) + 1)
        // vx = 15 * (Math.random() - 0.5)
        // vy = 15 * (Math.random() - 0.5)
        // an = _parent._parent._parent._parent._parent.angle + PI
        // v2x = cos(an) * 5
        // v2y = sin(an) * 5
        // _parent._x = 20 * (Math.random() - 0.5)
        // _parent._y = 10 * (Math.random() - 0.5)
        // t = 60 + 40 * Math.random()
        // v = -10
        // _xscale = t; _yscale = t
        // vr = 60 * (-0.5 + Math.random())
        const vd = 30 + Math.floor(Math.random() * 30);
        clip.vars.vd = vd;

        // gotoAndPlay(random(4) + 1) → random(4) ∈ [0,3] → frames [1,4] (1-based)
        // → gotoAndPlay(0..3) in 0-based. Since totalFrames=1, this is a no-op for
        // our single-frame asset, but we mirror it faithfully.
        clip.gotoAndPlay(Math.floor(Math.random() * 4));

        clip.vars.vx = 15 * (Math.random() - 0.5);
        clip.vars.vy = 15 * (Math.random() - 0.5);

        // Walk up to root to read angle (stored in degrees on root.vars.angle
        // by configureHarness). Add PI (radians) for the opposite-direction burst.
        let root = clip.parent;
        while (root && root.parent !== null) {
          root = root.parent;
        }
        const angleDeg = (root?.vars.angle as number) ?? 0;
        const an = (angleDeg * Math.PI) / 180 + Math.PI;
        clip.vars.v2x = Math.cos(an) * 5;
        clip.vars.v2y = Math.sin(an) * 5;

        // _parent._x / _parent._y — scatter the wrapper clip.
        const parentClip = clip.parent;
        if (parentClip) {
          parentClip.x = 20 * (Math.random() - 0.5);
          parentClip.y = 10 * (Math.random() - 0.5);
        }

        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.vars.v = -10;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.vr = 60 * (-0.5 + Math.random());
        clip.vars.tps = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_pierres/frame_1/PlaceObject2_5_1/onClipEvent(enterFrame)
        // if(_alpha < 10) { removeMovieClip(_parent) }
        // _parent._x += vx; _parent._y += vy
        // _rotation = _rotation + vr
        // if(tps++ < vd) { _Y += v; vx /= 1.2; vy /= 1.2; v /= 1.2 }
        // if(tps++ > vd) { _Y += (v2y *= 1.2); _X += (v2x *= 1.2); _alpha -= 10 }
        const alpha = clip.alpha;
        if (alpha < 0.1) {
          clip.parent?.remove();
          return;
        }

        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const vr = clip.vars.vr as number;
        let v = clip.vars.v as number;
        let v2x = clip.vars.v2x as number;
        let v2y = clip.vars.v2y as number;
        let tps = clip.vars.tps as number;
        const vd = clip.vars.vd as number;

        // Move wrapper clip
        const parentClip = clip.parent;
        if (parentClip) {
          parentClip.x += vx;
          parentClip.y += vy;
        }

        // Rotate self
        clip.rotation += (vr * Math.PI) / 180;

        // First tps++ check (post-increment: uses tps THEN increments)
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

        // Second tps++ check
        if (tps > vd) {
          v2y *= 1.2;
          v2x *= 1.2;
          clip.y += v2y;
          clip.x += v2x;
          clip.alpha = Math.max(0, clip.alpha - 0.1);
          clip.vars.v2y = v2y;
          clip.vars.v2x = v2x;
        }
        tps++;

        clip.vars.tps = tps;
      },
    };

    // ---- DefineSprite_8 — random-rotation wrapper for each pierre ----------
    // AS DefineSprite_8/frame_1/DoAction.as: _rotation = random(360)
    // This is a container-only clip that wraps each pierres instance and
    // applies a random rotation to it.
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            // _rotation = random(360)
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- DefineSprite_13_goutte — drip/drop clip --------------------
    // AS DefineSprite_13_goutte/frame_1/DoAction.as: stop()
    // Single-frame clip that just stops. Rendered as part of the shoot composite.
    const goutteSym: SymbolDefinition = {
      name: "goutte",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13_goutte/frame_1/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_11 — particle emitter (7 frames) -----------
    // AS DefineSprite_11/frame_1 has a PlaceObject2_9_3 child with an
    // onClipEvent(enterFrame) that spawns pierres pairs up to level*3 total.
    // AS DefineSprite_11/frame_7/DoAction.as: stop()
    //
    // The emitter clip is placed inside shoot, and its inner clip (PlaceObject2_9_3)
    // drives the particle spawning. We model the emitter as a container-only
    // SymbolDefinition. The spawning logic that was on PlaceObject2_9_3's
    // onEnterFrame is lifted into the emitter's own onEnterFrame since we don't
    // model inner placed objects separately — the emitter IS the spawner.
    const sprite11Sym: SymbolDefinition = {
      name: "sprite11",
      totalFrames: 7,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // Initialize the counter used by the enterFrame spawner.
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_11/frame_1/PlaceObject2_9_3/onClipEvent(enterFrame):
        // if(c < _parent._parent._parent.level * 3) {
        //   c += 1; this.attachMovie("pierres","pierres" + c, c);
        //   c += 1; this.attachMovie("pierres","pierres" + c, c);
        // }
        //
        // _parent._parent._parent from the placed clip is: PlaceObject's parent
        // (sprite11) → shoot → root. So level = root.vars.level.
        // We walk up: clip (sprite11) → shoot → root.
        const shootClip = clip.parent;
        const rootClip = shootClip?.parent;
        const level = (rootClip?.vars.level as number) ?? 1;
        let c = clip.vars.c as number;
        if (c < level * 3) {
          c += 1;
          // Wrap each pierres in a sprite8 (random-rotation wrapper) so
          // the canonical _parent._x / _parent._y setters in pierres' onLoad
          // operate on the wrapper. We attach sprite8 then attach pierres inside it.
          const wrapperName = `wrapper${c}`;
          const wrapper = clip.attach(sprite8Sym, wrapperName, c, ctx);
          wrapper.attach(this.pierresSym, `pierres${c}`, 1, ctx);
          c += 1;
          const wrapperName2 = `wrapper${c}`;
          const wrapper2 = clip.attach(sprite8Sym, wrapperName2, c, ctx);
          wrapper2.attach(this.pierresSym, `pierres${c}`, 1, ctx);
          clip.vars.c = c;
        }
      },
      frameScripts: new Map([
        [
          6,
          (clip) => {
            // AS DefineSprite_11/frame_7/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_14 — inner composite with signalHit -------
    // AS DefineSprite_14/frame_2/DoAction.as: stop(); this.end() → signalHit.
    const sprite14Sym: SymbolDefinition = {
      name: "sprite14",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          1,
          (_clip) => {
            // AS DefineSprite_14/frame_2/DoAction.as: stop(); this.end()
            // this.end() is the canonical hit signal.
            _clip.stop();
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    // ---- shoot — 83-frame top-level impact composite -------------
    // The shoot animation is authored with full composite frames (the SVG
    // extractor baked all child visuals into the shoot frames). We provide
    // its frame textures from animations[] (no lib_ prefix — shoot is in
    // animations[], not librarySymbols[]).
    // frame_83: _parent.removeMovieClip(); stop() → complete.
    //
    // We also attach sprite11 (particle emitter) and sprite14 (hit signal)
    // as logical children so their frame scripts fire during the shoot lifetime.
    // In the canonical SWF these are PlaceObject2'd onto shoot's timeline;
    // we mirror that by attaching them from shoot's frame_1 script.
    const shootBounds = {
      width: 126.25,
      height: 122.8,
      offsetX: -61.6,
      offsetY: -103.15,
    };
    const shootAnchor = calculateAnchor(shootBounds);
    const shootFrames = textures.getFrames("shoot");

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 83,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach logical sub-composites that drive particle spawning
            // and hit signalling. These mirror the PlaceObject2 children
            // on shoot's authored timeline.
            clip.attach(sprite11Sym, "sprite11", 1, ctx);
            clip.attach(sprite14Sym, "sprite14", 2, ctx);
            clip.attach(goutteSym, "goutte", 3, ctx);
          },
        ],
        [
          82,
          (clip) => {
            // AS DefineSprite_12_shoot/frame_83/DoAction.as:
            // _parent.removeMovieClip(); stop()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(sprite8Sym);
    this.registry.register(goutteSym);
    this.registry.register(sprite11Sym);
    this.registry.register(sprite14Sym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("lakam_405")
    callbacks.playSound("lakam_405");

    // The harness (TargetCell / displayType=11) does not auto-attach `shoot`.
    // For TargetCell spells the per-spell module must attach shoot explicitly
    // from onSpellStart (the harness only sets root.vars, it does not spawn children
    // for displayType 10/11/12).
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
