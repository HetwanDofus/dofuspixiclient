/**
 * Spell 2046 — (Cra fire arrow variant / "jet_903" + "vol" sound).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2046/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic):
 *   - Has `shoot` in animations[] (159-frame composite visual).
 *   - DefineSprite_36 is the outer container that acts like "shoot":
 *     frame_1 plays "vol" sound, frame_7 attaches cercle particles,
 *     frame_67 calls this.end() (signalHit), frame_139 calls
 *     _parent.removeMovieClip() (complete).
 *   - DefineSprite_17_shoot references frame_157: _parent.removeMovieClip().
 *   - Has `move` implied by the harness (ballistic arc).
 *   - The harness attaches `move` (ballistic arc) and `shoot` at landing,
 *     calling signalHit automatically on landing.
 *
 * Wait — re-reading the AS carefully:
 *   DefineSprite_36 is a complex sprite with frame_67: this.end() and
 *   frame_139: _parent.removeMovieClip(). It attaches "cercle" particles.
 *   DefineSprite_17_shoot/frame_157: _parent.removeMovieClip().
 *   The manifest has "shoot" (159 frames) in animations[] — this IS the
 *   `shoot` symbol for the harness.
 *
 * The manifest has no `move` in animations[], so `move` is a container-only
 * symbol. The animations[] has `shoot` (159-frame composite) and `fumee`
 * (36-frame smoke). librarySymbols has `cercle`, `sprite32`, `sprite33`.
 *
 * Structure:
 *   - `move`: container-only 2-frame, harness-driven ballistic arc
 *   - `shoot`: 159-frame composite visual at target on landing
 *       frame_0  (frame_1): play sound "vol", attach sprite33 / DefineSprite_36 logic
 *       frame_66 (frame_67): this.end() → signalHit (but harness already calls it
 *                            for displayType 30; however, DefineSprite_36 calls
 *                            this.end() which in AS means the outer mc's end()
 *                            method = callbacks.onHit. Since harness fires signalHit
 *                            at landing already, we DON'T fire it again here.)
 *       frame_138 (frame_139): _parent.removeMovieClip() → complete
 *       frame_156 (frame_157): _parent.removeMovieClip() → complete (same)
 *   - `fumee`: 36-frame smoke particle (librarySymbol name "fumee" is in animations[],
 *              but also DefineSprite_21_fumee has frameScripts). Used inside shoot.
 *   - `cercle`: library symbol, 1-frame particle with full physics.
 *   - `sprite32` (characterId 32): directlyDynamic clipEvent sprite, 36 frames.
 *       frame_34: stop(). PlaceObject2_30_6/onClipEvent(load): _xscale = random(100).
 *   - `sprite33` (characterId 33): directlyDynamic clipEvent sprite, 1 frame.
 *       PlaceObject2_32_1/onClipEvent(load): a = 20. Contains sprite32 placed at frame 0.
 *   - DefineSprite_36 is NOT in librarySymbols but IS the outer spell container
 *     referenced by scripts. It IS the shoot symbol's internal timeline logic.
 *
 * Re-analysing: The `shoot` animation in animations[] IS DefineSprite_17_shoot.
 * DefineSprite_36 seems to be a SEPARATE sprite inside the main SWF that has
 * the cercle spawning. Given DefineSprite_36/frame_1 plays "vol" and has the
 * particle spawning logic, AND DefineSprite_17_shoot/frame_157 does removeMovieClip,
 * DefineSprite_36 is likely a CHILD of shoot (or IS shoot). The frame counts:
 * shoot has 159 frames. frame_157 = index 156. frame_67/frame_139 match DefineSprite_36.
 * DefineSprite_36 IS the shoot symbol (DefineSprite_17_shoot is the same, named shoot).
 * Actually DefineSprite_17_shoot only has frame_157 in scripts, but DefineSprite_36
 * has frame_1, frame_7, frame_67, frame_139. These are DIFFERENT sprites. DefineSprite_36
 * must be an INNER child of DefineSprite_17_shoot (shoot). Since DefineSprite_17_shoot
 * IS the 159-frame shoot animation, and DefineSprite_36 is placed INSIDE it with
 * its own subscripts (1, 7, 67, 139), we treat the shoot symbol's frameScripts as
 * coming from DefineSprite_17_shoot (frame_157 removal), and we need to attach
 * DefineSprite_36 as a child of shoot. But DefineSprite_36 is NOT in librarySymbols...
 *
 * Simplest faithful interpretation: DefineSprite_36 IS the shoot symbol itself
 * (the exporter may label it both ways). We use the scripts from BOTH
 * DefineSprite_17_shoot AND DefineSprite_36 for the `shoot` SymbolDefinition,
 * since they share a timeline. frame_157/frame_139 both call removeMovieClip on
 * parent — we fire complete() at frame_138 (frame_139 = index 138 = first occurrence).
 *
 * fumee: DefineSprite_21_fumee has PlaceObject2_20_2 with onClipEvent(load/enterFrame).
 *   The inner sprite (characterId ~20) is a visual sub-element of fumee. Since fumee
 *   IS in animations[] with 36 frames, we use textures.getFrames("fumee") for it.
 *   frame_1 (index 0): seeds physics vars; frame_31 (index 30): removeMovieClip.
 *   The PlaceObject2_20_2 clipEvents drive rotation/alpha on the fumee's inner sprite.
 *   We model fumee as a single SymbolDefinition whose onLoad seeds all the physics
 *   (both the frame_1 DoAction AND the PlaceObject2_20_2 onClipEvent(load)), and
 *   onEnterFrame handles both the positional physics AND the rotation/alpha from
 *   the inner PlaceObject2_20_2 enterFrame (since we don't have a separate sub-clip).
 *
 * sprite33 contains sprite32 (placement in manifest). sprite33 is placed inside
 * shoot (DefineSprite_36/DefineSprite_17_shoot). We attach sprite33 from shoot's
 * frame_0. sprite33's onLoad sets a=20. sprite32's onLoad sets _xscale = random(100),
 * and its frame_34 calls stop().
 *
 * For displayType=30: harness fires signalHit at landing. DO NOT call it again.
 * complete() fires from shoot's frame_138 (AS frame_139).
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

// Manifest bounds for library symbols
const CERCLE_BOUNDS = {
  width: 17.4,
  height: 17.45,
  offsetX: -8.8,
  offsetY: -8.9,
};

const SPRITE32_BOUNDS = {
  width: 217.7,
  height: 2360.35,
  offsetX: -101.55,
  offsetY: -2155.45,
};

const SPRITE33_BOUNDS = {
  width: 616.8,
  height: 40.45,
  offsetX: -18.95,
  offsetY: -19,
};

// fumee is in animations[] (not librarySymbols) — use its animation bounds
const FUMEE_BOUNDS = {
  width: 32.35,
  height: 33,
  offsetX: -14.35,
  offsetY: -18.65,
};

// shoot is in animations[] — use its animation bounds
const SHOOT_BOUNDS = {
  width: 174.3,
  height: 155.4,
  offsetX: -89.35,
  offsetY: -92.8,
};

export class Spell2046 extends RuntimeSpell {
  readonly spellId = 2046;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Hold symbol refs for cross-symbol attachment
  private cercleSym!: SymbolDefinition;
  private fumeeSym!: SymbolDefinition;
  private sprite32Sym!: SymbolDefinition;
  private sprite33Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite32Anchor = calculateAnchor(SPRITE32_BOUNDS);
    const sprite33Anchor = calculateAnchor(SPRITE33_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- cercle — 1-frame orange/fire particle with full ballistic physics ----
    // AS: DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(load).as
        // d = 120 + (_parent._parent._parent.level - 1) * 32
        // cercle._parent = DefineSprite_36 (shoot), ._parent = root
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.12 * Math.random();
        const xStart = d * Math.random();
        let yStart: number;
        let sr: number;
        if (Math.floor(Math.random() * 2) === 1) {
          yStart = 5;
          sr = -1;
        } else {
          sr = 1;
          yStart = -5;
        }
        clip.scaleX = 0;
        clip.scaleY = 0;
        clip.vars.t = 5;
        clip.x = xStart;
        clip.y = yStart;
        clip.vars.va = 5 + 10 * Math.random();
        clip.vars.vr = (20 + 40 * Math.random()) * sr;
        // AS: vt = (0.3 + random(1)) * ((d - x) / d)
        clip.vars.vt = (0.3 + Math.floor(Math.random() * 2)) * ((d - xStart) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_24_cercle/frame_1/PlaceObject2_23_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        // _rotation = _rotation - (vr *= 0.97)
        vr *= 0.97;
        clip.rotation -= (vr * Math.PI) / 180;

        // _X = _X + (vx *= accx)
        vx *= accx;
        clip.x += vx;

        // t += vt -= 0.03
        vt -= 0.03;
        t += vt;

        // _xscale = t; _yscale = t
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        if (t < 0) {
          // AS: _parent.removeMovieClip()
          clip.remove();
        }
      },
    };

    // ---- sprite32 — directlyDynamic clipEvent sprite, 36 frames ----
    // AS: DefineSprite_32/frame_1/PlaceObject2_30_6/CLIPACTIONRECORD onClipEvent(load).as
    //   _xscale = random(100)
    // AS: DefineSprite_32/frame_34/DoAction.as
    //   stop()
    this.sprite32Sym = {
      name: "sprite32",
      totalFrames: 36,
      frames: textures.getFrames("lib_sprite32"),
      anchorX: sprite32Anchor.x,
      anchorY: sprite32Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_32/frame_1/PlaceObject2_30_6/CLIPACTIONRECORD onClipEvent(load).as
        // _xscale = random(100)
        clip.scaleX = Math.floor(Math.random() * 100) / 100;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS DefineSprite_32/frame_34/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite33 — directlyDynamic clipEvent sprite, 1 frame ----
    // Placed inside shoot (DefineSprite_36). Contains sprite32 at depth 1.
    // AS: DefineSprite_33/frame_1/PlaceObject2_32_1/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 20
    // sprite33's placement of sprite32 uses matrix:
    //   translateX: 35.1, translateY: 1.55, scaleX: 0.00592, scaleY: 0.00160,
    //   rotateSkew0: 0.168, rotateSkew1: -0.261
    // Rotation from matrix: atan2(rotateSkew0, scaleX) ≈ atan2(0.168, 0.00592) ≈ 1.537 rad
    // But scale is extremely small (< 0.01) — this is likely a degenerate matrix
    // from a complex shape. We apply translateX/Y and derive rotation/scale.
    this.sprite33Sym = {
      name: "sprite33",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite33"),
      anchorX: sprite33Anchor.x,
      anchorY: sprite33Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_33/frame_1/PlaceObject2_32_1/CLIPACTIONRECORD onClipEvent(load).as
        // a = 20
        clip.vars.a = 20;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite32 inside sprite33 at frame_1 per manifest placements[].
            // matrix: translateX=35.1, translateY=1.55,
            //   scaleX=0.00592, scaleY=0.00160, rotateSkew0=0.168, rotateSkew1=-0.261
            const child = clip.attach(this.sprite32Sym, "sprite32_inner", 1, ctx, {
              x: 35.1,
              y: 1.55,
            });
            // Apply scale and rotation from placement matrix
            // rotation = atan2(rotateSkew0, scaleX)
            child.rotation = Math.atan2(0.16839599609375, 0.00592041015625);
            child.scaleX = Math.sqrt(
              0.00592041015625 * 0.00592041015625 +
              0.16839599609375 * 0.16839599609375
            );
            child.scaleY = Math.sqrt(
              0.0016021728515625 * 0.0016021728515625 +
              0.2607574462890625 * 0.2607574462890625
            );
          },
        ],
      ]),
    };

    // ---- fumee — 36-frame smoke particle ----
    // AS: DefineSprite_21_fumee/frame_1/DoAction.as
    //   Seeds positional physics using _parent._parent._parent.rotate._rotation
    //   (the rotate clip's _rotation in degrees).
    // AS: DefineSprite_21_fumee/frame_1/PlaceObject2_20_2/CLIPACTIONRECORD onClipEvent(load).as
    //   v = random(20); _rotation = random(360); _alpha = 10 + random(90)
    // AS: DefineSprite_21_fumee/frame_1/PlaceObject2_20_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation += v; _alpha -= 20
    // AS: DefineSprite_21_fumee/frame_31/DoAction.as
    //   this.removeMovieClip()
    //
    // Note: fumee is in animations[] not librarySymbols, so texture key is "fumee" (no lib_ prefix).
    // The "rotate" clip referenced in frame_1 DoAction is the shoot container's rotation.
    // We approximate: use the shoot container's current rotation (which for displayType 30
    // is set by the harness at landing angle). We read it from clip.parent.rotation.
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 36,
      frames: textures.getFrames("fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_21_fumee/frame_1/DoAction.as
        // a = _parent._parent._parent.rotate._rotation * 0.017453292519943295
        // fumee._parent = shoot clip. In our tree, shoot IS the parent.
        // The "rotate" child of the grandparent's parent is not modeled separately;
        // we approximate using the shoot clip's own rotation (set by harness to landing angle).
        const shootClip = clip.parent;
        const rotationRad = shootClip?.rotation ?? 0;
        const a = rotationRad; // already in radians (harness sets radians)
        clip.vars.a = a;

        // t = 80 * Math.random() + 50
        const t = 80 * Math.random() + 50;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        // _X = 20 * (Math.random() - 0.5)
        clip.x = 20 * (Math.random() - 0.5);
        // _Y = 20 * (Math.random() - 0.5)
        clip.y = 20 * (Math.random() - 0.5);

        // vx = 20 * Math.cos(a); vy = 20 * Math.sin(a)
        clip.vars.vx = 20 * Math.cos(a);
        clip.vars.vy = 20 * Math.sin(a);

        // deceleration = 1.2 + Math.random()
        clip.vars.deceleration = 1.2 + Math.random();

        // AS PlaceObject2_20_2/CLIPACTIONRECORD onClipEvent(load).as
        // v = random(20); _rotation = random(360); _alpha = 10 + random(90)
        clip.vars.innerV = Math.floor(Math.random() * 20);
        clip.vars.innerRotDeg = Math.floor(Math.random() * 360);
        clip.vars.innerAlpha = (10 + Math.floor(Math.random() * 90)) / 100;
        // Apply initial inner rotation and alpha to this clip (we merge inner + outer)
        clip.rotation = (clip.vars.innerRotDeg as number) * Math.PI / 180;
        clip.alpha = clip.vars.innerAlpha as number;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_21_fumee/frame_1/DoAction.as onEnterFrame function:
        // _X += vx; _Y += vy; vx /= deceleration; vy /= deceleration
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const deceleration = clip.vars.deceleration as number;
        clip.x += vx;
        clip.y += vy;
        vx /= deceleration;
        vy /= deceleration;
        clip.vars.vx = vx;
        clip.vars.vy = vy;

        // AS PlaceObject2_20_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation += v; _alpha -= 20
        const innerV = clip.vars.innerV as number;
        let innerRotDeg = (clip.rotation * 180) / Math.PI;
        innerRotDeg += innerV;
        clip.rotation = (innerRotDeg * Math.PI) / 180;

        const newAlpha = clip.alpha - 20 / 100;
        clip.alpha = newAlpha;
      },
      frameScripts: new Map([
        [
          30,
          (clip) => {
            // AS DefineSprite_21_fumee/frame_31/DoAction.as: this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — 2-frame container (ballistic arc driven by harness) ----
    // The harness expects a "move" symbol for displayType 30.
    // No AS scripts specifically for move's inner frames in this spell,
    // but the harness attaches it and drives the parabolic arc.
    this.moveSym = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- shoot — 159-frame composite visual at target on landing ----
    // DefineSprite_17_shoot (159 frames) + DefineSprite_36 scripts merged:
    // frame_0  (AS frame_1):  SOMA.playSound("vol"), attach sprite33
    // frame_6  (AS frame_7):  spawn nb=5 cercle particles (c starts at 1, while c < nb)
    // frame_66 (AS frame_67): this.end() → harness already called signalHit at landing
    //                          for displayType 30, so we do NOT call signalHit again
    // frame_138 (AS frame_139): this._parent.removeMovieClip() → complete()
    // frame_156 (AS frame_157): _parent.removeMovieClip() → complete() (guarded, idempotent)
    //
    // fumee particles: DefineSprite_21_fumee is referenced but no explicit attachMovie
    // for fumee appears in the provided AS scripts for DefineSprite_36. The fumee symbol
    // exists as animations["fumee"] and is likely placed on shoot's authored timeline
    // (composite SVG frames). We register it for completeness but do not manually attach.
    this.shootSym = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_36/frame_1/DoAction.as: SOMA.playSound("vol")
            // Sound is played via onSpellStart for the main timeline,
            // but "vol" is the shoot sub-sprite's own sound — we capture
            // the callback ref via root.vars if available.
            const soundFn = clip.parent?.vars.playSound as
              | ((id: string) => void)
              | undefined;
            if (soundFn) {
              soundFn("vol");
            }
            // Attach sprite33 (which contains sprite32) inside shoot.
            // manifest placements[]: sprite33 placed in DefineSprite_36 (= shoot)
            // at frame 0, depth 1, matrix: scaleX=0.3827, scaleY=0.3827,
            // translateX=7.75, translateY=-0.1
            const s33 = clip.attach(this.sprite33Sym, "sprite33", 1, ctx, {
              x: 7.75,
              y: -0.1,
            });
            s33.scaleX = 0.3827056884765625;
            s33.scaleY = 0.3827056884765625;
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_36/frame_7/DoAction.as
            // nb = 5; c = 0; c = 1; while (c < nb) { attachMovie("cercle","cercle"+c,c); c++ }
            // Note: c is set to 0 then immediately to 1, so loop starts at c=1, nb=5 → c in [1,2,3,4]
            const nb = 5;
            for (let c = 1; c < nb; c++) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
            }
          },
        ],
        [
          66,
          (_clip) => {
            // AS DefineSprite_36/frame_67/DoAction.as: this.end()
            // For displayType 30, harness already fired signalHit at landing.
            // this.end() in AS calls the outer mc's end() method = onHit callback.
            // Since harness handles it, we intentionally do NOT call signalHit again.
          },
        ],
        [
          138,
          (clip) => {
            // AS DefineSprite_36/frame_139/DoAction.as: this._parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
        [
          156,
          (_clip) => {
            // AS DefineSprite_17_shoot/frame_157/DoAction.as: _parent.removeMovieClip()
            // complete() is idempotent — safe to call again if frame_138 didn't fire.
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite32Sym);
    this.registry.register(this.sprite33Sym);
    this.registry.register(this.fumeeSym);
    this.registry.register(this.moveSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("jet_903")
    callbacks.playSound("jet_903");

    // Store playSound on root.vars so shoot's frame_0 can access it
    // (shoot needs to play "vol" when it lands at the target).
    this.root.vars.playSound = callbacks.playSound.bind(callbacks);
  }
}
