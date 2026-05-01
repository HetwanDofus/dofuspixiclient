/**
 * Spell 2016 — Setag (unknown class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2016/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `shoot` animation
 * in `animations[]` (not `librarySymbols[]`), no `move` symbol, and the
 * harness for ProjectileLinear attaches "shoot" at the target-relative
 * offset inside a container rotated to face the target — matching the
 * canonical pattern for a linear arrow/bolt.
 *
 * Library symbols:
 *   - sprite17 (characterId=17, directlyDynamic=true) — a rotating sparkle
 *     particle placed inside `cercle` at depth 1. onLoad seeds vr (rotation
 *     speed) + initial random rotation + random frame. onEnterFrame spins via
 *     `_rotation += vr /= _parent.r` (r comes from the cercle parent).
 *   - cercle (characterId=18) — a glowing orb trail particle. Contains
 *     sprite17 as a child. onLoad (on sprite17 placement) seeds va, t
 *     (scale/alpha), r (decay). onEnterFrame fades + drifts using vx/vy
 *     inherited from parent's vars (set by move's onEnterFrame when it
 *     attaches cercles), removes when alpha < 10.
 *
 * The `shoot` symbol (159 frames) is in `animations[]` so it is NOT a
 * library symbol — the harness attaches it by name. It contains:
 *   - DefineSprite_11_move (frame_1): seeds c=33, xi/yi, then an onEnterFrame
 *     that attaches `cercle` particles at the move clip's current position
 *     each tick to create a trail. DefineSprite_10 (10 frames, loops) is an
 *     internal helper — frame_10 calls gotoAndPlay(1).
 *   - frame_130: PlaceObject2_5_3 has an onClipEvent(enterFrame) that fades
 *     the shoot container alpha by 10 per tick.
 *   - frame_157: `_parent.removeMovieClip(); stop();` — signals completion.
 *
 * Main timeline: SOMA.playSound("setag_305");
 *
 * NOTE: The `move` symbol here is DefineSprite_11_move which lives INSIDE
 * the shoot timeline (it is the projectile bolt graphic child), NOT a
 * top-level harness move symbol. For ProjectileLinear the harness only
 * uses "shoot". We register `move` as a library symbol so the shoot
 * timeline's frame_1 can attach it by name.
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

const SPRITE17_BOUNDS = {
  width: 21.3,
  height: 12.1,
  offsetX: -10.8,
  offsetY: -10.95,
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

  private sprite17Sym!: SymbolDefinition;
  private cercleSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE17_BOUNDS);
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- sprite17 — rotating sparkle particle inside cercle -----
    // directlyDynamic: true — has its own CLIPACTIONRECORD handlers.
    //
    // AS DefineSprite_17/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   vr = random(33) + 17;
    //   _rotation = random(360);
    //   gotoAndStop(random(_totalframes) + 1);
    //
    // AS DefineSprite_17/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + (vr /= _parent.r);
    //   (_parent is the cercle clip — r is seeded there)
    this.sprite17Sym = {
      name: "sprite17",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      onLoad: (clip) => {
        // AS: vr = random(33) + 17;  _rotation = random(360);
        //     gotoAndStop(random(_totalframes) + 1);
        clip.vars.vr = Math.floor(Math.random() * 33) + 17;
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // totalFrames = 1, so random(_totalframes) = random(1) = 0, gotoAndStop(1) → frame 0
        clip.gotoAndStop(Math.floor(Math.random() * clip.totalFrames));
      },
      onEnterFrame: (clip) => {
        // AS: _rotation = _rotation + (vr /= _parent.r);
        // _parent is the cercle clip; r is stored on cercle's vars.
        let vr = clip.vars.vr as number;
        const parentR = (clip.parent?.vars.r as number) ?? 1.05;
        vr = vr / parentR;
        clip.vars.vr = vr;
        clip.rotation += (vr * Math.PI) / 180;
      },
    };

    // ---- cercle — glowing orb trail particle --------------------
    // cercle contains sprite17 as a child (placed at frame_1 / depth 1
    // per placements[] in manifest). The onLoad/onEnterFrame are on
    // sprite17's placement inside cercle.
    //
    // AS DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   va = 2 - random(1.5);   → random(1.5) = Math.floor(rand*1.5) ∈ {0,1} → va ∈ {1,2}
    //   t = 60 + random(70);
    //   _xscale = t;  _yscale = t;
    //   _alpha = 70 + random(30);
    //   r = 1.05 + 0.5 * Math.random();
    //
    // AS DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if(_alpha < 10) { _parent.removeMovieClip(); }
    //   _alpha = _alpha - va;
    //   _X = _X + _parent.vx;
    //   _Y = _Y + _parent.vy;
    //   _parent.vx /= r;
    //   _parent.vy /= r;
    //
    // NOTE: These handlers live on the sprite17 child WITHIN cercle.
    // The _parent references inside those handlers refer to `cercle`.
    // We implement them as part of cercle's own lifecycle since in the
    // runtime, the PlaceObject2 placement of sprite17 drives cercle's
    // fade/drift behavior. We attach sprite17 inside cercle's frame_1
    // and implement the fade/drift in cercle's own onEnterFrame (which
    // is what the canonical CLIPACTIONRECORD on the sprite17 child does).
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_18_cercle/frame_1 — place sprite17 at depth 1
            // with canonical matrix from placements[]:
            //   scaleX=1, scaleY=0.861, rotateSkew1=-0.2827, translateX=0, translateY=-0.05
            // Apply the matrix: rotation ≈ atan2(-rotateSkew1, scaleX) since skew1 is non-zero.
            // atan2(0.2827, 1) ≈ 0.2764 rad
            const child = clip.attach(this.sprite17Sym, "sprite17inst", 1, ctx, {
              x: 0,
              y: -0.05,
              rotation: Math.atan2(-(-0.282684326171875), 1), // atan2(rotateSkew1, scaleX) gives tilt
            });
            // Apply scaleY from placement matrix
            child.scaleY = 0.861114501953125;
          },
        ],
      ]),
      onLoad: (clip) => {
        // AS DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(load).as
        // (These run as the cercle clip initializes, seeding its vars for the
        //  enterFrame handler below.)
        const va = 2 - Math.floor(Math.random() * 1.5);
        const t = 60 + Math.floor(Math.random() * 70);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (70 + Math.floor(Math.random() * 30)) / 100;
        clip.vars.va = va;
        clip.vars.r = 1.05 + 0.5 * Math.random();
        // vx/vy are set externally by the move clip when attaching cercles;
        // initialise to 0 as a fallback.
        if (clip.vars.vx === undefined) {
          clip.vars.vx = 0;
        }
        if (clip.vars.vy === undefined) {
          clip.vars.vy = 0;
        }
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_18_cercle/frame_1/PlaceObject2_17_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const alphaCurrent = clip.alpha * 100; // convert back to 0-100 for threshold check
        if (alphaCurrent < 10) {
          clip.remove();
          return;
        }
        const va = clip.vars.va as number;
        const r = clip.vars.r as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;

        clip.alpha = (alphaCurrent - va) / 100;
        clip.x += vx;
        clip.y += vy;
        vx /= r;
        vy /= r;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
    };

    // ---- shoot — 159-frame projectile container -----------------
    // shoot is in animations[] (not librarySymbols[]), so frames come
    // from textures.getFrames("shoot") WITHOUT the lib_ prefix.
    //
    // Internal structure (from AS scripts):
    //   - DefineSprite_11_move at frame_1: seeds c=33, xi/yi, mounts an
    //     onEnterFrame that attaches cercle particles each tick.
    //   - DefineSprite_10 (looping, 10-frame internal): an internal looping
    //     clip used as the visible bolt graphic. Its frame_10 does
    //     gotoAndPlay(1) — handled in a sub-symbol below.
    //   - frame_130: a child clip fades the shoot container's alpha by 10/tick.
    //   - frame_157: _parent.removeMovieClip(); stop(); → spell complete.
    //
    // The harness attaches shoot at the target offset. We define it here.
    //
    // The frame_130 PlaceObject2_5_3 onClipEvent(enterFrame) fades _parent._alpha.
    // In canonical AS _parent of that sub-clip is the shoot container, so
    // each tick shoot.alpha decreases by 10/100 = 0.1. We implement this
    // via a frameScripts entry at frame 129 that installs an onEnterFrame
    // on shoot itself (matching the canonical "a child placed at frame 130
    // whose enterFrame ticks shoot._alpha down").

    // DefineSprite_10 — 10-frame looping bolt graphic (internal to shoot's
    // authored timeline; the pre-rendered shoot SVGs already incorporate
    // this motion so we don't need a separate SymbolDefinition for it —
    // the shoot composite frames capture it). However, the move clip
    // references _X/_Y of the harness-driven "move" child, which in
    // this spell is NOT the projectile itself but rather the parent
    // container's onEnterFrame motion set by configureHarness.
    //
    // For ProjectileLinear the harness DOES NOT attach "move" — it
    // attaches "shoot" at the target-local offset and rotates root.
    // The DefineSprite_11_move frame_1 script is authored INSIDE shoot's
    // timeline. To reproduce the cercle trail, we use shoot's own
    // onEnterFrame (installed at frame_1) tracking its own position.

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_11_move/frame_1/DoAction.as
            // c = 33; xi = _X; yi = _Y;
            // Seed the trail state on the shoot clip itself.
            clip.vars.c = 33;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            // The onEnterFrame that attaches cercle particles is mounted
            // on shoot (mirroring the canonical move sub-clip behavior).
            // We install it here; it will be overridden at frame 129 to
            // also fade alpha.
            clip.onEnterFrame = (self, ctx) => {
              const c = self.vars.c as number;
              const xi = self.vars.xi as number;
              const yi = self.vars.yi as number;
              const vx = self.x - xi;
              const vy = self.y - yi;

              // AS: _parent.attachMovie("cercle","cercle" + c, c)
              // _parent of move is shoot's parent (the root / harness container).
              const parent = self.parent;
              if (parent) {
                const cercleInst = parent.attach(
                  this.cercleSym,
                  `cercle${c}`,
                  c,
                  ctx
                );
                // AS: eval("_parent.cercle" + c)._x = _X;
                //     eval("_parent.cercle" + c)._y = _Y - 20;
                //     eval("_parent.cercle" + c).vx = vx;
                //     eval("_parent.cercle" + c).vy = vy;
                cercleInst.x = self.x;
                cercleInst.y = self.y - 20;
                cercleInst.vars.vx = vx;
                cercleInst.vars.vy = vy;
              }

              self.vars.c = c + 1;
              self.vars.xi = self.x;
              self.vars.yi = self.y;
            };
          },
        ],
        [
          129,
          (clip) => {
            // AS DefineSprite_6_shoot/frame_130/PlaceObject2_5_3/
            //    CLIPACTIONRECORD onClipEvent(enterFrame).as:
            //   _parent._alpha -= 10;
            // A sub-clip placed at frame 130 whose enterFrame fades
            // the shoot container. We append alpha-fade to shoot's own
            // onEnterFrame from this frame onward.
            const existingEF = clip.onEnterFrame;
            clip.onEnterFrame = (self, ctx) => {
              if (existingEF) {
                existingEF(self, ctx);
              }
              // AS: _parent._alpha -= 10;  (shoot is _parent of the sub-clip)
              self.alpha = Math.max(0, self.alpha - 10 / 100);
            };
          },
        ],
        [
          156,
          (clip) => {
            // AS DefineSprite_6_shoot/frame_157/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite17Sym);
    this.registry.register(this.cercleSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("setag_305");
    callbacks.playSound("setag_305");
  }
}
