/**
 * Spell 601 — Dodge (Cra / generic dodge animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/601/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest has a `move` (2-frame) and
 * a `shoot` (144-frame) animation — the canonical ballistic pattern. The harness
 * drives `move` along a parabolic arc and attaches `shoot` at landing, then fires
 * signalHit automatically.
 *
 * Symbol layout:
 *
 *   - `sprite13`  (DefineSprite_13) — single-frame horizontal-drift leaf/spark.
 *                 frame_1/DoAction seeds `v` (leftward speed ±random). onEnterFrame
 *                 integrates X.  Placed by `move`'s frame_1 at 6 positions (depths
 *                 1,20,39,58,77,96) via PlaceObject2_13_* placements, each randomising
 *                 their start frame via `gotoAndStop(random(totalFrames)+1)` on load.
 *
 *   - `sprite9`   (DefineSprite_9) — purely decorative single-frame random-pose leaf.
 *                 frame_1/DoAction: `gotoAndStop(random(4)+1)`. Placed by
 *                 `sprite10`'s onLoad at its own depth. 4-frame sprite, random
 *                 initial frame. No per-frame physics.
 *
 *   - `sprite10`  (DefineSprite_10, directlyDynamic:true) — spark cluster. Each
 *                 instance placed by `shoot`'s frame_1 at depths 15,17,19,21,23,25
 *                 with fixed offsets from `librarySymbols[].placements[].matrix`.
 *                 frame_1/DoAction seeds per-particle vx/vy/p/cacc; also seeds the
 *                 inner sprite9 (`c`) rotation to `roti`. Its embedded child
 *                 (PlaceObject2_9_1) gets onLoad (seed vrot/vrot2/i) and
 *                 onEnterFrame (oscillate xscale + rotate) handled via a
 *                 nested SymbolDefinition for sprite9 that the sprite10 frame_1
 *                 script attaches.
 *                 The `sprite10` onEnterFrame (defined inline in DoAction as
 *                 `this.onEnterFrame`) moves _X/_Y with drag until c._y >= p.
 *
 *   - `move`      (DefineSprite_14_move) — 2-frame container. frame_1 has 6
 *                 sprite13 children placed at random start-frames. frame_2/DoAction:
 *                 `_parent.roti = _rotation; stop();` — captures the harness-applied
 *                 rotation angle onto root.vars.roti and stops.
 *
 *   - `shoot`     (DefineSprite_12_shoot) — 144-frame composite. frame_1/DoAction:
 *                 `_parent.move.removeMovieClip()` — removes the move clip.
 *                 frame_1 also has 6 sprite10 instances placed at fixed offsets
 *                 (PlaceObject2_10_15/17/19/21/23/25) and 1 sprite3 instance
 *                 (PlaceObject2_3_3) whose onLoad sets rotation to
 *                 `_parent._parent.roti`.
 *                 frame_109: a placed clip (PlaceObject2_11_1) fades out the
 *                 sprite at -3.33 alpha per frame.
 *                 frame_142/DoAction: stop().
 *
 *   - (DefineSprite_3 / DefineSprite_2) — visual sub-sprites baked into `shoot`'s
 *                 rendered SVG frames. DefineSprite_3/frame_16: stop().
 *                 DefineSprite_2/frame_46: stop(). These are container-only inner
 *                 symbols with no externally driven physics; their stop() scripts are
 *                 rendered into the composite SVG frames by the exporter.
 *
 * Main timeline frame_1/DoAction: `SOMA.playSound("dodge_601")`.
 *
 * The harness provides automatic signalHit on ballistic landing and attaches `move`
 * (frame_2 of which stores `roti`). Per-spell code must NOT call signalHit again.
 * Completion fires from `shoot` frame_142 (stop) — but the true removal signal is
 * the outer mc removal; we fire complete() from shoot's stop frame (143 → index 142).
 * Actually, the canonical shoot stops at frame_142 (AS 1-based) = index 141. We fire
 * complete() there.
 *
 * NOTE on `roti`: the `move` symbol's frame_2 stores `_parent._rotation` into
 * `_parent.roti`. The harness rotates root toward the target before the first tick,
 * and `move` inherits that rotation. When move's frame_2 fires it captures the
 * rotation angle (in degrees, stored on root.vars.roti) for subsequent use by
 * shoot's sprite10 sparks.
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

// ---------- bounds from manifest.librarySymbols[] ----------

const SPRITE10_BOUNDS = {
  width: 9.6,
  height: 6.25,
  offsetX: -4.9,
  offsetY: -3.35,
};

// sprite9 and sprite13 are not in manifest.librarySymbols (no `lib_` textures).
// They are container-only or fully-baked inner symbols. We give them reasonable
// anchor defaults (0.5) and empty frames[], with all behaviour driven by scripts.

export class Spell601 extends RuntimeSpell {
  readonly spellId = 601;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Stored so onSpellStart / frameScripts can reference them
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite13Sym!: SymbolDefinition;
  private moveSym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ----------------------------------------------------------------
    // sprite9 — DefineSprite_9
    // AS: DefineSprite_9/frame_1/DoAction.as
    //   gotoAndStop(random(4) + 1);
    // 4-frame random-pose decorative leaf. No per-frame physics.
    // Used as the inner child `c` attached by sprite10.
    // ----------------------------------------------------------------
    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 4,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // onLoad — mirrors PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        // AS: i = 0; vrot = -25 + 50 * Math.random(); vrot2 = -0.5 + 0.7 * Math.random();
        clip.vars.i = 0;
        clip.vars.vrot = -25 + 50 * Math.random();
        clip.vars.vrot2 = -0.5 + 0.7 * Math.random();
      },
      // onEnterFrame — mirrors PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        // AS: if (_Y < _parent.p) { vrot2 /= 1.04; _xscale = 50 * sin(i += vrot2); _rotation += vrot; }
        const parentP = (clip.parent?.vars.p as number) ?? 0;
        if (clip.y < parentP) {
          let vrot2 = clip.vars.vrot2 as number;
          const vrot = clip.vars.vrot as number;
          let i = clip.vars.i as number;
          vrot2 = vrot2 / 1.04;
          i = i + vrot2;
          clip.scaleX = (50 * Math.sin(i)) / 100;
          clip.rotation += (vrot * Math.PI) / 180;
          clip.vars.vrot2 = vrot2;
          clip.vars.i = i;
        }
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_9/frame_1/DoAction.as — gotoAndStop(random(4) + 1)
            const frame = Math.floor(Math.random() * 4);
            clip.gotoAndStop(frame);
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite13 — DefineSprite_13
    // AS: DefineSprite_13/frame_1/DoAction.as
    //   v = 2 * Math.random() - 3;
    //   this.onEnterFrame = function() { _X += v; };
    // Single-frame leftward-drifting spark/leaf in `move`.
    // The 6 PlaceObject2_13_* placements all set random start-frame
    // via onClipEvent(load): gotoAndStop(random(_totalframes)+1).
    // ----------------------------------------------------------------
    this.sprite13Sym = {
      name: "sprite13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // onLoad — mirrors all six PlaceObject2_13_*/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        // AS (all six instances identically):
        //   gotoAndStop(random(_totalframes) + 1)
        // totalFrames = 1, so this is always frame 1 → index 0.
        const frame = Math.floor(Math.random() * clip.totalFrames);
        clip.gotoAndStop(frame);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13/frame_1/DoAction.as
            //   v = 2 * Math.random() - 3;
            //   this.onEnterFrame = function() { _X += v; };
            clip.vars.v = 2 * Math.random() - 3;
            // Wire the per-frame physics via onEnterFrame on the clip itself.
            clip.onEnterFrame = (c) => {
              const v = c.vars.v as number;
              c.x += v;
            };
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite10 — DefineSprite_10 (directlyDynamic: true)
    // AS: DefineSprite_10/frame_1/DoAction.as
    //   roti = _parent._parent.roti - 30 + 60 * Math.random();
    //   c._rotation = roti;
    //   dv = 1.05 + 0.2 * Math.random();
    //   v = 3 + 10 * Math.random();
    //   vx = v * cos(roti * PI/180); vy = v * sin(roti * PI/180);
    //   p = 60 - random(30);
    //   cacc = 0.3 + 0.3 * Math.random();
    //   this.onEnterFrame = function() {
    //     if (c._y < p) { c._y += cacc; _X += vx; _Y += vy; vx /= dv; vy /= dv; }
    //   };
    // Also has inner child sprite9 at PlaceObject2_9_1 with load+enterFrame handlers.
    // ----------------------------------------------------------------
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    this.sprite10Sym = {
      name: "sprite10",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_10/frame_1/DoAction.as
            // Walk up: sprite10 → shoot → root (where roti lives)
            const shootClip = clip.parent;
            const rootClip = shootClip?.parent;
            const roti = (rootClip?.vars.roti as number) ?? 0;
            const localRoti = roti - 30 + 60 * Math.random();
            clip.vars.roti = localRoti;

            const dv = 1.05 + 0.2 * Math.random();
            const v = 3 + 10 * Math.random();
            const vx = v * Math.cos((localRoti * Math.PI) / 180);
            const vy = v * Math.sin((localRoti * Math.PI) / 180);
            const p = 60 - Math.floor(Math.random() * 30);
            const cacc = 0.3 + 0.3 * Math.random();

            clip.vars.dv = dv;
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            clip.vars.p = p;
            clip.vars.cacc = cacc;

            // Attach the inner sprite9 child `c`
            const cClip = clip.attach(this.sprite9Sym, "c", 1, ctx);
            // AS: c._rotation = roti  (degrees → radians)
            cClip.rotation = (localRoti * Math.PI) / 180;

            // Wire the per-frame physics as onEnterFrame
            clip.onEnterFrame = (self) => {
              const c = self.children.get("c");
              if (!c) {
                return;
              }
              const pVal = self.vars.p as number;
              if (c.y < pVal) {
                const cacc2 = self.vars.cacc as number;
                let vxCur = self.vars.vx as number;
                let vyCur = self.vars.vy as number;
                const dvCur = self.vars.dv as number;
                c.y += cacc2;
                self.x += vxCur;
                self.y += vyCur;
                vxCur = vxCur / dvCur;
                vyCur = vyCur / dvCur;
                self.vars.vx = vxCur;
                self.vars.vy = vyCur;
              }
            };
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // move — DefineSprite_14_move (2-frame container)
    // frame_1: 6 sprite13 children placed at depths 1,20,39,58,77,96.
    //          Each randomises its own start-frame on load.
    // frame_2/DoAction: _parent.roti = _rotation; stop();
    //   — captures the harness-applied rotation angle onto root.vars.roti
    //     so shoot's sprite10 sparks know which direction to spread.
    // ----------------------------------------------------------------
    this.moveSym = {
      name: "move",
      totalFrames: 2,
      frames: textures.getFrames("move"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14_move/frame_1 — 6 sprite13 placements
            // PlaceObject2_13_1, _20, _39, _58, _77, _96 (depths used as instance names)
            clip.attach(this.sprite13Sym, "sprite13_1", 1, ctx);
            clip.attach(this.sprite13Sym, "sprite13_20", 20, ctx);
            clip.attach(this.sprite13Sym, "sprite13_39", 39, ctx);
            clip.attach(this.sprite13Sym, "sprite13_58", 58, ctx);
            clip.attach(this.sprite13Sym, "sprite13_77", 77, ctx);
            clip.attach(this.sprite13Sym, "sprite13_96", 96, ctx);
          },
        ],
        [
          1,
          (clip) => {
            // AS: DefineSprite_14_move/frame_2/DoAction.as
            //   _parent.roti = _rotation;
            //   stop();
            // The harness has rotated `root` (our parent) to face the target.
            // We read root's rotation (radians) and convert to degrees for storage,
            // matching canonical AS which stored degrees in `roti`.
            const parent = clip.parent;
            if (parent) {
              const rotRadians = parent.rotation;
              parent.vars.roti = (rotRadians * 180) / Math.PI;
            }
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — DefineSprite_12_shoot (144-frame composite)
    //
    // frame_1/DoAction.as:
    //   _parent.move.removeMovieClip();
    // frame_1 also places 6 sprite10 instances (depths 15,17,19,21,23,25)
    //   at fixed offsets (from manifest placements[]) plus 1 sprite3 instance
    //   (PlaceObject2_3_3) whose onLoad sets rotation = _parent._parent.roti.
    // frame_109: PlaceObject2_11_1 onClipEvent(enterFrame): _parent._alpha -= 3.33
    //   (fades the shoot clip out from frame 109 onward).
    // frame_142/DoAction.as: stop();  (= index 141, 0-based)
    //
    // sprite3 (PlaceObject2_3_3) is a static visual already baked into the
    // composite SVG frames; its only dynamic behaviour is the onLoad rotation
    // assignment, which we replicate by rotating the shoot clip itself at
    // attach-time (via a dedicated child clip representing the rotation).
    // Actually, sprite3 is placed inside shoot, rotates to roti at load.
    // Since shoot is rendered as a composite, the sprite3 visual is baked in.
    // The onLoad rotation sets the authored static child's rotation — this is
    // purely visual and matched by shoot's overall SVG frames rotating with
    // the spell direction. We handle the fade (frame_109 enterFrame) via a
    // flag set in frame_109's frameScripts.
    // ----------------------------------------------------------------
    this.shootSym = {
      name: "shoot",
      totalFrames: 144,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 106.3,
        height: 43,
        offsetX: -66,
        offsetY: -27.25,
      }).x,
      anchorY: calculateAnchor({
        width: 106.3,
        height: 43,
        offsetX: -66,
        offsetY: -27.25,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_12_shoot/frame_1/DoAction.as
            //   _parent.move.removeMovieClip();
            const parent = clip.parent;
            if (parent) {
              const moveClip = parent.children.get("move");
              if (moveClip) {
                moveClip.remove();
              }
            }

            // AS: 6 sprite10 instances at fixed PlaceObject2_10_* positions.
            // Positions from manifest.librarySymbols[0].placements (parentSpriteId=12):
            //   depth 15: (17.4, 12.5)
            //   depth 17: (-10.1, -9.25)
            //   depth 19: (21.35, -18.1)
            //   depth 21: (0.1, -22.2)
            //   depth 23: (35.15, -4.8)
            //   depth 25: (5.2, 7.15)
            clip.attach(this.sprite10Sym, "sprite10_15", 15, ctx, {
              x: 17.4,
              y: 12.5,
            });
            clip.attach(this.sprite10Sym, "sprite10_17", 17, ctx, {
              x: -10.1,
              y: -9.25,
            });
            clip.attach(this.sprite10Sym, "sprite10_19", 19, ctx, {
              x: 21.35,
              y: -18.1,
            });
            clip.attach(this.sprite10Sym, "sprite10_21", 21, ctx, {
              x: 0.1,
              y: -22.2,
            });
            clip.attach(this.sprite10Sym, "sprite10_23", 23, ctx, {
              x: 35.15,
              y: -4.8,
            });
            clip.attach(this.sprite10Sym, "sprite10_25", 25, ctx, {
              x: 5.2,
              y: 7.15,
            });

            // AS: PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
            //   _rotation = _parent._parent.roti;
            // sprite3 is baked into shoot's composite SVG; its visual orientation
            // is handled by the shoot sprite's own rotation applied by the harness.
            // The runtime-equivalent: record roti on the shoot clip so sprite10
            // instances can read it (they walk up to root, where roti is stored
            // by move's frame_2 — see moveSym above).
          },
        ],
        [
          108,
          (clip) => {
            // AS: DefineSprite_12_shoot/frame_109/PlaceObject2_11_1/CLIPACTIONRECORD
            //     onClipEvent(enterFrame).as
            //   _parent._alpha -= 3.33
            // From frame 109 onward, fade the shoot clip by 3.33 alpha units per
            // frame (AS 0-100 scale → 3.33/100 per frame in TS 0-1 scale).
            // We install an onEnterFrame on the shoot clip here to drive the fade.
            clip.onEnterFrame = (self) => {
              self.alpha -= 3.33 / 100;
              if (self.alpha <= 0) {
                self.alpha = 0;
              }
            };
          },
        ],
        [
          141,
          (clip) => {
            // AS: DefineSprite_12_shoot/frame_142/DoAction.as — stop()
            // This is the final frame; the outer mc removal = spell complete.
            clip.stop();
            // Cancel the fade enterFrame to avoid dangling callbacks.
            clip.onEnterFrame = null;
            // Signal spell completion.
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.moveSym);
    this.registry.register(this.shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("dodge_601")
    callbacks.playSound("dodge_601");
  }
}
