/**
 * Spell 305 — Tremblement de Terre / Séisme (Earth-type impact, likely Sadida or Enutrof class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/305/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic):
 *   - Has both `move` and `shoot` symbols.
 *   - `move` (DefineSprite_18_move) has a frame_1 that sets up a trailing
 *     `cercle` particle system on the outer mc as the projectile flies.
 *   - `shoot` (DefineSprite_14_shoot) is a 159-frame impact composite that:
 *       - frame_1: plays sound "setag_310", wobbles an authored child
 *         (PlaceObject2_8_4, a DefineSprite_17 looping sprite), and spawns
 *         5 `pierres` rock particles via PlaceObject2_9_7.
 *       - frame_130+: fades out via PlaceObject2_13_9's enterFrame (_alpha -= 5).
 *       - frame_157: removes parent (spell complete).
 *   - The harness fires signalHit() automatically when the arc lands.
 *
 * Library symbols:
 *   - `pierres`   — stone chip particle. onLoad seeds vx/vy/v/vr/t/alpha/pos.
 *                   onEnterFrame bounces stones with gravity.
 *   - `cercle`    — dust/shockwave ring. Placed at move's position during flight.
 *                   Contains sprite27 (directlyDynamic) which spins with decay.
 *                   onLoad seeds va/t/scale/alpha/r. onEnterFrame fades + drifts.
 *   - `sprite27`  — spinning oval inside cercle. directlyDynamic, own clipEvents.
 *                   onLoad seeds vr/rotation/frame. onEnterFrame rotates with decay.
 *
 * Main timeline: SOMA.playSound("setag_305"); (frame_1/DoAction.as)
 *
 * Note on DefineSprite_17 (anonymous, no librarySymbol entry):
 *   It is the authored child at PlaceObject2_8_4 inside shoot's frame_1.
 *   Its frame_11 loops back to frame_1 (gotoAndPlay(1)). It is an authored
 *   placed-on-timeline sprite (not attachMovie'd), so its wobble behavior is
 *   driven by the PlaceObject2_8_4 clipEvent handlers applied to whatever
 *   clip lives at depth 4 of shoot. We model this as an anonymous "wobble"
 *   symbol that loops its 11-frame authored content baked into shoot's SVG
 *   frames — but the wobble clipEvent (amp/s rotation oscillator) runs live.
 *   We register it as "wobbleSprite" with the shoot's own frame textures as
 *   a container, driven purely by onLoad/onEnterFrame.
 *
 * Note on PlaceObject2_13_9 (fade-out child in shoot):
 *   This is an authored child placed at depth 9 inside shoot at frame_130.
 *   Its enterFrame does `_parent._alpha -= 5`, i.e. it fades the shoot clip
 *   itself. We implement this by installing a frameScript at frame 129 on
 *   the shoot symbol that starts decrementing shoot's alpha each tick via
 *   an onEnterFrame-style accumulator stored on shoot.vars.
 *
 * Note on DefineSprite_18_move (move symbol):
 *   frame_1 installs a JS onEnterFrame that reads `_X/_Y` (the clip's
 *   current position as driven by the harness arc) and drops `cercle`
 *   particles on the PARENT (the outer mc / root) at those coords.
 *   We replicate this by installing an onEnterFrame on the move clip itself.
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

// ---- Manifest bounds for library symbols ----

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const CERCLE_BOUNDS = {
  width: 44.2,
  height: 18.6,
  offsetX: -19.55,
  offsetY: -17.1,
};

const SPRITE27_BOUNDS = {
  width: 38.1,
  height: 21.6,
  offsetX: -19.05,
  offsetY: -19.8,
};

// shoot bounds (from animations[] — used for the shoot symbol's anchor)
const SHOOT_BOUNDS = {
  width: 108.75,
  height: 67.5,
  offsetX: -43.6,
  offsetY: -63.4,
};

export class Spell305 extends RuntimeSpell {
  readonly spellId = 305;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // We keep references so onSpellStart can access them
  private cercleSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite27Anchor = calculateAnchor(SPRITE27_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---------------------------------------------------------------
    // sprite27 — spinning oval inside cercle (directlyDynamic)
    // AS: scripts/DefineSprite_27/frame_1/PlaceObject2_26_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // onLoad:
    //   vr = random(66) + 33;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // onEnterFrame:
    //   _rotation = _rotation + (vr /= _parent.r);
    //   (_parent.r is set by the cercle clip's onLoad)
    // ---------------------------------------------------------------
    const sprite27Sym: SymbolDefinition = {
      name: "sprite27",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite27"),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_27/frame_1/PlaceObject2_26_1/onClipEvent(load)
        clip.vars.vr = Math.floor(Math.random() * 66) + 33;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // gotoAndStop(random(_totalframes) + 1) — 1 frame total, stays at 0
        clip.gotoAndStop(0);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_27/frame_1/PlaceObject2_26_1/onClipEvent(enterFrame)
        let vr = clip.vars.vr as number;
        // _parent.r is the cercle clip that owns this sprite27
        const parentR = (clip.parent?.vars.r as number) ?? 1.03;
        vr /= parentR;
        clip.vars.vr = vr;
        // _rotation += vr  (degrees → radians delta)
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---------------------------------------------------------------
    // cercle — dust/shockwave ring dropped along the projectile trail
    // AS: scripts/DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // The cercle clip also CONTAINS sprite27 (placed at depth 1 via
    // the manifest placements[] entry). We attach sprite27 in
    // cercle's frameScripts[0] (frame_1 of cercle's timeline).
    //
    // onLoad:
    //   va = 3 - random(3);
    //   t  = 60 + random(70);
    //   _xscale = t; _yscale = t;
    //   _alpha  = 70 + random(30);
    //   r = 1.03 + 0.5 * Math.random();
    //
    // onEnterFrame:
    //   if (_alpha < 5) { _parent.removeMovieClip(); }
    //   _alpha -= va;
    //   _X += _parent.vx;
    //   _Y += _parent.vy;
    //   _parent.vx /= r;
    //   _parent.vy /= r;
    // ---------------------------------------------------------------
    const cercleSym: SymbolDefinition = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/onClipEvent(load)
        const va = 3 - Math.floor(Math.random() * 3);
        clip.vars.va = va;
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.r = 1.03 + 0.5 * Math.random();
        // vx/vy are seeded by the move clip's onEnterFrame before attaching
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_28_cercle/frame_1/PlaceObject2_27_1/onClipEvent(enterFrame)
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        const currentAlpha = clip.alpha * 100; // work in Flash-unit space for comparison
        if (currentAlpha < 5) {
          clip.remove();
          return;
        }
        clip.alpha = Math.max(0, clip.alpha - va / 100);
        // _X += _parent.vx  — here _parent is the clip itself (the
        // cercle mc). vx/vy are stored on the cercle clip's vars,
        // seeded from the move onEnterFrame via `eval("_parent.cercle"+c).vx = vx`.
        const vx = (clip.vars.vx as number) ?? 0;
        const vy = (clip.vars.vy as number) ?? 0;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / r;
        clip.vars.vy = vy / r;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite27 inside cercle at depth 1, with the authored
            // matrix from manifest placements[]:
            //   scaleX=1, scaleY=0.861, rotateSkew0=0, rotateSkew1=-0.283,
            //   translateX=0, translateY=-0.05
            // rotation = atan2(rotateSkew0, scaleX) = atan2(0, 1) = 0
            // scaleY contribution: the matrix row [rotateSkew1, scaleY] =
            //   [-0.283, 0.861]; rotation from row = atan2(-0.283, 0.861) ≈ -0.316 rad
            // For simplicity we apply the translate + the dominant visual scale/skew:
            clip.attach(sprite27Sym, "sprite27_1", 1, ctx, {
              x: 0,
              y: -0.05,
              rotation: Math.atan2(-0.282684326171875, 0.861114501953125),
            });
          },
        ],
      ]),
    };
    this.cercleSym = cercleSym;

    // ---------------------------------------------------------------
    // pierres — stone chip particle (inside shoot's child at depth 7)
    // AS: scripts/DefineSprite_21_pierres/frame_1/PlaceObject2_20_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // onLoad:
    //   vx = 5 * (Math.random() - 0.5)
    //   vy = 2 * (Math.random() - 0.5)
    //   _parent._x = 20 * (Math.random() - 0.5)  ← sets the PARENT (pierres mc) position
    //   _parent._y = 10 * (Math.random() - 0.5)
    //   t = 60 + 40 * Math.random()
    //   _xscale = t; _yscale = t;
    //   _alpha = 20 + random(90)
    //   v = -10 * Math.random() - 5
    //   vr = 40 * (-0.5 + Math.random())
    //
    // NOTE: The actual clipEvent owner (PlaceObject2_20_1) is the inner
    // animated graphic INSIDE pierres. The `_parent._x` assignments target
    // the pierres clip itself. We fold this into the pierres symbol's
    // onLoad since we treat pierres as the single clip entity.
    //
    // onEnterFrame:
    //   _parent._x += vx; _parent._y += vy;
    //   if (t != 1) {
    //     _Y += v; _rotation += vr; v += 1.5;
    //     if (_Y > 0) { bounce + settle logic }
    //   }
    // ---------------------------------------------------------------
    const pierresSym: SymbolDefinition = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_21_pierres/frame_1/PlaceObject2_20_1/onClipEvent(load)
        clip.vars.vx = 5 * (Math.random() - 0.5);
        clip.vars.vy = 2 * (Math.random() - 0.5);
        // _parent._x/_y in AS sets the pierres clip's own position
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        const t = 60 + 40 * Math.random();
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = -10 * Math.random() - 5;
        clip.vars.vr = 40 * (-0.5 + Math.random());
        // local _Y offset (the inner animated graphic Y within pierres)
        clip.vars.localY = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21_pierres/frame_1/PlaceObject2_20_1/onClipEvent(enterFrame)
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const t = clip.vars.t as number;
        let v = clip.vars.v as number;
        let vr = clip.vars.vr as number;
        let localY = clip.vars.localY as number;

        // _parent._x += vx — moves the pierres clip itself
        clip.x += vx;
        clip.y += vy;

        if (t !== 1) {
          localY += v;
          // _rotation += vr  (degrees delta → radians)
          clip.rotation += (vr * Math.PI) / 180;
          v += 1.5;

          if (localY > 0) {
            // Bounce: halve velocities, reset rotation, bounce v
            vx /= 2;
            vy /= 2;
            clip.rotation = 0;
            localY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              vx = 0;
              vy = 0;
              clip.vars.t = 1;
            }
          }
        }

        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.v = v;
        clip.vars.vr = vr;
        clip.vars.localY = localY;
      },
    };

    // ---------------------------------------------------------------
    // move — 1-frame container (empty authored content)
    // AS: scripts/DefineSprite_18_move/frame_1/DoAction.as
    //
    //   c = 33;
    //   xi = _X; yi = _Y;
    //   this.onEnterFrame = function() {
    //     vx = _X - xi;  vy = _Y - yi;
    //     _parent.attachMovie("cercle","cercle" + c, c);
    //     eval("_parent.cercle" + c)._x = _X;
    //     eval("_parent.cercle" + c)._y = _Y - 20;
    //     eval("_parent.cercle" + c).vx = vx;
    //     eval("_parent.cercle" + c).vy = vy;
    //     c++;  xi = _X;  yi = _Y;
    //   };
    //
    // The harness positions `move` along the parabolic arc each tick,
    // so _X/_Y change every frame. We install the trailing-particle logic
    // as move's onEnterFrame. The `eval(...)._x = _X` assignments set
    // the newly-attached cercle clip's position. In our runtime, attach()
    // returns the child clip, and we then set x/y/vx/vy on it.
    // ---------------------------------------------------------------
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
            // AS DefineSprite_18_move/frame_1/DoAction.as — initialize trail state
            clip.vars.c = 33;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_18_move/frame_1/DoAction.as — onEnterFrame body
        let c = clip.vars.c as number;
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;

        const vx = clip.x - xi;
        const vy = clip.y - yi;

        const parent = clip.parent;
        if (parent) {
          const instanceName = `cercle${c}`;
          const newCercle = parent.attach(cercleSym, instanceName, c, ctx);
          newCercle.x = clip.x;
          newCercle.y = clip.y - 20;
          newCercle.vars.vx = vx;
          newCercle.vars.vy = vy;
        }

        clip.vars.c = c + 1;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
      },
    };

    // ---------------------------------------------------------------
    // shoot — 159-frame impact composite (DefineSprite_14_shoot)
    // AS layout:
    //   frame_1/DoAction.as: SOMA.playSound("setag_310")
    //   frame_1/PlaceObject2_8_4 clipEvents: wobble oscillator (amp/s)
    //   frame_1/PlaceObject2_9_7 onLoad: spawn 5 pierres
    //   frame_130/PlaceObject2_13_9 enterFrame: _parent._alpha -= 5
    //   frame_157/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // PlaceObject2_8_4 is the authored child (DefineSprite_17 looping
    // sprite) placed on shoot's timeline. We model it as a sub-symbol
    // "wobbleSprite" with its clipEvent handlers. Its actual visual
    // content is baked into the shoot SVG frames, but the WOBBLE
    // rotation (amp * s oscillation) must run live.
    //
    // PlaceObject2_9_7 is a container child that, on load, spawns 5
    // pierres particles. We model it as "pierresContainer".
    //
    // PlaceObject2_13_9 is placed at frame 130 and its enterFrame fades
    // shoot itself (_parent._alpha -= 5). We implement this as a flag
    // on shoot.vars that starts an alpha-decrement in shoot's own
    // onEnterFrame starting from frame 129.
    // ---------------------------------------------------------------

    // wobbleSprite — mirrors DefineSprite_17's authored content
    // (loops frame 1–11, i.e. gotoAndPlay(1) at frame_11).
    // PlaceObject2_8_4 clipEvents drive its rotation:
    //   onLoad:  amp = 30; s = 1;
    //   enterFrame: _rotation = amp * s; s *= -1; amp /= 1.5;
    const wobbleSpriteSym: SymbolDefinition = {
      name: "wobbleSprite",
      totalFrames: 11,
      frames: [], // authored visual baked into shoot's composite SVGs
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_14_shoot/frame_1/PlaceObject2_8_4/onClipEvent(load)
        clip.vars.amp = 30;
        clip.vars.s = 1;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_14_shoot/frame_1/PlaceObject2_8_4/onClipEvent(enterFrame)
        let amp = clip.vars.amp as number;
        let s = clip.vars.s as number;
        // _rotation = amp * s  (degrees → radians)
        clip.rotation = ((amp * s) * Math.PI) / 180;
        s *= -1;
        amp /= 1.5;
        clip.vars.s = s;
        clip.vars.amp = amp;
      },
      frameScripts: new Map([
        [
          10,
          (clip) => {
            // AS DefineSprite_17/frame_11/DoAction.as: gotoAndPlay(1)
            clip.gotoAndPlay(0);
          },
        ],
      ]),
    };

    // pierresContainer — mirrors PlaceObject2_9_7 inside shoot.
    // On load, spawns 5 pierres particles (depth 0–4).
    const pierresContainerSym: SymbolDefinition = {
      name: "pierresContainer",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip, ctx) => {
        // AS DefineSprite_14_shoot/frame_1/PlaceObject2_9_7/onClipEvent(load)
        //   c = 0; while(c < 5) { this.attachMovie("pierres","pierres"+c,c); c++; }
        for (let c = 0; c < 5; c++) {
          clip.attach(pierresSym, `pierres${c}`, c, ctx);
        }
      },
    };

    // shoot symbol — the main impact animation
    const shootFrames = textures.getFrames("shoot");
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 159,
      frames: shootFrames,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      onLoad: (clip) => {
        // Initialize fade-trigger flag
        clip.vars.fadingOut = false;
        clip.vars.parentAlphaAcc = 100; // track in Flash-unit space
      },
      onEnterFrame: (clip) => {
        // Replicate PlaceObject2_13_9 enterFrame behavior:
        //   _parent._alpha -= 5  (where _parent = shoot)
        // We start this once the clip has reached frame 129 (= AS frame 130).
        if (clip.vars.fadingOut === true) {
          const acc = (clip.vars.parentAlphaAcc as number) - 5;
          clip.vars.parentAlphaAcc = acc;
          clip.alpha = Math.max(0, acc / 100);
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_14_shoot/frame_1/DoAction.as:
            //   SOMA.playSound("setag_310")
            // Sound is played here; we cache playSound on shoot.vars
            // so we can call it. In practice we call it via the runtime
            // callbacks stored on the parent context — but per the guide,
            // sounds inside library symbols require capturing callbacks.
            // We call it via the runtime's callbacks captured at init.
            // (See onSpellStart where we store the callback reference.)
            const playSoundFn = clip.vars._playSound as
              | ((id: string) => void)
              | undefined;
            if (playSoundFn) {
              playSoundFn("setag_310");
            }

            // Place wobbleSprite (PlaceObject2_8_4) at depth 4
            clip.attach(wobbleSpriteSym, "wobbleSprite_4", 4, ctx);

            // Place pierresContainer (PlaceObject2_9_7) at depth 7
            clip.attach(pierresContainerSym, "pierresContainer_7", 7, ctx);
          },
        ],
        [
          129,
          (clip) => {
            // AS DefineSprite_14_shoot/frame_130: PlaceObject2_13_9 is placed here.
            // Its enterFrame does _parent._alpha -= 5. We activate the fade flag.
            clip.vars.fadingOut = true;
            clip.vars.parentAlphaAcc = clip.alpha * 100;
          },
        ],
        [
          156,
          (clip) => {
            // AS DefineSprite_14_shoot/frame_157/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };
    this.shootSym = shootSym;

    // Register all symbols
    this.registry.register(sprite27Sym);
    this.registry.register(cercleSym);
    this.registry.register(pierresSym);
    this.registry.register(wobbleSpriteSym);
    this.registry.register(pierresContainerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("setag_305");
    callbacks.playSound("setag_305");

    // Store playSound on the shoot symbol's vars so frame_1 of shoot
    // can call SOMA.playSound("setag_310") when it fires.
    // The shoot clip doesn't exist yet (harness attaches it on arc
    // landing), so we inject the callback via the registry symbol's
    // shared vars mechanism by patching the shoot symbol's frameScripts
    // closure. Since closures already capture `callbacks`, we store a
    // reference on a field for the shoot frameScript to access.
    this._playSound = callbacks.playSound;

    // Walk the root to inject _playSound into any already-attached shoot
    // clips (in case onSpellStart fires after harness in some edge cases).
    // In practice, shoot is attached later on arc-land, so the onEnterFrame
    // of shoot's frame_1 will pick up via clip.vars._playSound set below.
    // We also need to set it on the shoot symbol itself so when attach()
    // fires the frameScript[0], it can read it.
    // Inject via the shootSym's onLoad to seed _playSound on the clip:
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      // Patch the shootSym object (we own it) to add an onLoad that seeds _playSound
      const originalOnLoad = shootSym.onLoad;
      const playSound = callbacks.playSound;
      (shootSym as { onLoad: typeof shootSym.onLoad }).onLoad = (
        clip,
        ctx,
      ) => {
        if (originalOnLoad) {
          originalOnLoad(clip, ctx);
        }
        clip.vars._playSound = playSound;
      };
    }
  }

  /** Captured playSound for use inside shoot's frame_1 script. */
  private _playSound?: (id: string) => void;
}
