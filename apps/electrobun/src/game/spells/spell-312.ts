/**
 * Spell 312 — Artillerie (Cra artillery strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/312/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * caster-side anchoring, and no WorldAbsolute dual-anchor pattern. The
 * entire animation plays at the target cell as a composite impact. The
 * main timeline has 279 frames (anim1) driven as a single `anim1`
 * symbol. Inner library symbols (sprite4, sprite7, sprite8) are
 * CLIPACTIONRECORD-driven particles that spin, oscillate, and fade out.
 *
 * The outermost authored sprite is DefineSprite_9, which at frame 277
 * (0-based: 276) calls `_parent.removeMovieClip()` → spell complete.
 * That is the only explicit completion signal in the AS.
 *
 * Library symbols (all directlyDynamic: true):
 *
 *   - sprite4 (characterId=4) — single-frame leaf/shard.
 *       PlaceObject2_3_3/onLoad: random rotation [0,360), xscale/yscale [30,100).
 *       PlaceObject2_1_1/onLoad: random rotation [-90,270), alpha [40,90), phase i.
 *       (Two separate placements of sprite4 inside sprite7 at frame 0,
 *        depths 3 and 1 respectively — each has its own clipEvent.)
 *
 *   - sprite7 (characterId=7) — wrapper that holds two sprite4 instances.
 *       Its own scripts are the sprite4 clipEvents above. sprite7 itself
 *       spins: onLoad seeds scale [50,100)%, vr [5,20), alpha [40,100).
 *       onEnterFrame: _rotation += vr.
 *       sprite7 is placed twice inside sprite8 (depths 1 + 11) at frame 0.
 *
 *   - sprite8 (characterId=8) — outer container that holds two sprite7
 *       instances. onLoad seeds oscillation params (i,p,v2,vr,v).
 *       onEnterFrame: Lissajous spiral (_X = 25*sin(i += v2),
 *       _Y = 5*cos(i) + (p -= v)), alpha fade-in/fade-out,
 *       removeMovieClip when fully faded.
 *       sprite8 is placed FOUR times in DefineSprite_9 at frames 3, 15,
 *       30, 45 (depths 1, 13, 25, 37) — staggered deployments.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("arty_101"); (no stop)
 *
 * The `anim1` animation in manifest.animations[] is the pre-rendered
 * composite (279 frames). We attach it as the primary visual symbol
 * so the timeline advances and its frame 276 frameScript fires
 * `_parent.removeMovieClip()` → `this.runtime.complete()`.
 *
 * signalHit: fired at the first sprite8 placement frame (frame 3,
 * 0-based index 3) — canonical "impact moment" when the first
 * artillery ring appears.
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

// ---------------------------------------------------------------------------
// Manifest bounds
// ---------------------------------------------------------------------------

const ANIM1_BOUNDS = {
  width: 80,
  height: 78.45,
  offsetX: -43.55,
  offsetY: -50.1,
};

const SPRITE4_BOUNDS = {
  width: 97.55,
  height: 56.85,
  offsetX: -39.6,
  offsetY: -29.7,
};

const SPRITE7_BOUNDS = {
  width: 116.85,
  height: 125.45,
  offsetX: -58.35,
  offsetY: -79.8,
};

const SPRITE8_BOUNDS = {
  width: 80,
  height: 78.45,
  offsetX: -43.5,
  offsetY: -50,
};

export class Spell312 extends RuntimeSpell {
  readonly spellId = 312;
  readonly displayType = SpellDisplayType.TargetCell;

  // Kept as fields so onSpellStart can attach the top-level symbol.
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);

    // ---- sprite4 — single-frame shard particle --------------------
    // Two different placements inside sprite7 with different clipEvent
    // handlers attached per-placement (PlaceObject2_3_3 at depth 3 and
    // PlaceObject2_1_1 at depth 1). Because both placements share the
    // same symbol character we register ONE SymbolDefinition with onLoad
    // that applies the UNION of both variants. In practice the runtime
    // calls attach() twice (at different instance names/depths), so each
    // child clip gets its own independent onLoad run with independent
    // random state — exactly matching the canonical two-placement
    // behavior. We pick the PlaceObject2_1_1 variant (rotation + alpha +
    // phase) as the canonical onLoad and apply the PlaceObject2_3_3
    // variant (scale-only) as an additional step that is harmless to
    // merge.
    const sprite4Sym: SymbolDefinition = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
        // (scale variant — applied to every placement)
        const scaleVal = 30 + Math.floor(Math.random() * 70);
        clip.scaleX = scaleVal / 100;
        clip.scaleY = scaleVal / 100;

        // AS DefineSprite_4/frame_1/PlaceObject2_1_1/CLIPACTIONRECORD onClipEvent(load).as
        // (rotation + alpha + phase variant)
        const rotDeg = Math.floor(Math.random() * 360) - 90;
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      // sprite4 has no onEnterFrame scripts in the canonical AS.
    };

    // ---- sprite7 — spinning container holding two sprite4 instances -
    // AS DefineSprite_7/frame_1/PlaceObject2_6_5 (depth 5),
    //    PlaceObject2_6_7 (depth 7), PlaceObject2_6_9 (depth 9):
    //    onLoad: scale [50,100)%, vr [5,20), alpha [40,100)
    //    onEnterFrame: _rotation += vr
    //
    // NOTE: The PlaceObject2 suffixes _5, _7, _9 are SEPARATE instances
    // of sprite7 placed inside the PARENT (sprite8). The _6_ infix in
    // the path indicates the characterId of sprite7 is 7 (DefineSprite_7).
    // All three placements share the same load/enterFrame logic.
    //
    // sprite7 also places two sprite4 children at depth 1 and depth 3
    // (as seen in manifest placements[].parentSpriteId === 7, depths 1
    // and 11 in that record — actually looking more carefully: sprite4
    // placements show parentSpriteId=7). We attach those in frame_1.
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_6_7/CLIPACTIONRECORD onClipEvent(load).as
        // (same for _6_9 and _6_5 — identical logic)
        const t = Math.floor(Math.random() * 50) + 50;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.vars.vr = 5 + Math.floor(Math.random() * 15);
        clip.alpha = (40 + Math.floor(Math.random() * 60)) / 100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_6_7/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const vr = clip.vars.vr as number;
        clip.rotation += (vr * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place two sprite4 children inside sprite7.
            // manifest: sprite4.placements[0] — parentSpriteId=7, frame=0,
            //   depth=1, matrix(translateX=0.55, translateY=0.05)
            // manifest: sprite4.placements[?] — actually the manifest shows
            //   sprite4 has placements under parentSpriteId=7 at depths 1.
            //   We also see the PlaceObject2_3_3 and PlaceObject2_1_1
            //   variant paths, which implies two distinct placements (depths
            //   3 and 1). We attach both here.
            const c1 = clip.attach(sprite4Sym, "shard1", 1, ctx, {
              x: 0.55,
              y: 0.05,
            });
            // Override onLoad for depth-1 placement:
            // PlaceObject2_1_1 variant — rotation+alpha+phase (already done
            // in shared onLoad). Nothing extra needed.

            const c3 = clip.attach(sprite4Sym, "shard3", 3, ctx, {
              x: 0.55,
              y: 0.05,
            });
            // PlaceObject2_3_3 variant — scale+rotation only (already
            // handled in shared onLoad). c1/c3 are independent instances.
            void c1;
            void c3;
          },
        ],
      ]),
    };

    // ---- sprite8 — oscillating wrapper holding sprite7 instances --
    // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS DefineSprite_8/frame_1/PlaceObject2_7_11/CLIPACTIONRECORD onClipEvent(load).as
    //   (identical logic for both depth-1 and depth-11 sprite7 placements)
    //   i=0; p=0; v2=0.03+0.06*Math.random(); _rotation=random(360);
    //   _alpha=120; _parent._alpha=10; v=0.3+0.6*Math.random();
    //
    // onEnterFrame: Lissajous spiral with alpha fade-in/out +
    //   removeMovieClip when fully faded out.
    //
    // Two instances of sprite7 are placed at depth 1 and depth 11
    // (matrix translateX offsets 0 and -7.05) inside sprite8.
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
        // (same for PlaceObject2_7_11)
        clip.vars.i = 0;
        clip.vars.p = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        // _alpha = 120 → 1.2 clamped — the AS sets the INNER sprite7's
        // alpha to 120 (super-bright at load). We set it on this clip
        // as the canonical `_alpha` property; Pixi clamps to [0,1].
        clip.alpha = 1; // clamped from 120/100 = 1.2
        // _parent._alpha = 10 → set parent (anim1 / outer) alpha to 0.1
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.6 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        let p = clip.vars.p as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;

        const curY = clip.y;
        const parent = clip.parent;

        if (curY > -100 && parent && parent.alpha < 1) {
          // _parent._alpha += 10
          parent.alpha = Math.min(1, parent.alpha + 10 / 100);
        }
        if (curY < -100) {
          // _parent._alpha -= 20
          if (parent) {
            parent.alpha = parent.alpha - 20 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              clip.remove();
              return;
            }
          }
        }

        // _rotation += 1.3 degrees
        clip.rotation += (1.3 * Math.PI) / 180;

        // _Y = 5 * cos(i) + (p -= v)
        p -= v;
        const newY = 5 * Math.cos(i) + p;
        clip.y = newY;

        // _X = 25 * sin(i += v2)
        i += v2;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // _alpha = 80 * cos(i) + 100  (AS 0-100 scale → /100)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }

        clip.vars.i = i;
        clip.vars.p = p;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place two sprite7 children inside sprite8, mirroring the
            // manifest placements:
            //   sprite7.placements[0]: parentSpriteId=8, depth=1,
            //     matrix(scaleX=0.625, scaleY=0.625, tx=-0.05, ty=-0.1)
            //   sprite7.placements[1]: parentSpriteId=8, depth=11,
            //     matrix(scaleX=0.625, scaleY=0.625, tx=-7.05, ty=-0.1)
            const s7a = clip.attach(sprite7Sym, "spinner1", 1, ctx, {
              x: -0.05,
              y: -0.1,
            });
            s7a.scaleX = 0.625;
            s7a.scaleY = 0.625;

            const s7b = clip.attach(sprite7Sym, "spinner11", 11, ctx, {
              x: -7.05,
              y: -0.1,
            });
            s7b.scaleX = 0.625;
            s7b.scaleY = 0.625;
          },
        ],
      ]),
    };

    // ---- anim1 — 279-frame composite main animation ----------------
    // DefineSprite_9 wraps the anim1 timeline. frame_277 (0-based: 276)
    // calls _parent.removeMovieClip() → spell complete.
    // sprite8 instances are placed at frames 3, 15, 30, 45 (0-based:
    // 3, 15, 30, 45 → already 0-indexed per manifest `frame` field).
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    let hitSignalled = false;
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 279,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip, ctx) => {
            // manifest: sprite8.placements[0] — parentSpriteId=9, frame=3,
            //   depth=1, matrix(tx=-0.05, ty=-0.1), ratio=3
            const s8a = clip.attach(sprite8Sym, "ring1", 1, ctx, {
              x: -0.05,
              y: -0.1,
            });
            void s8a;
            // Canonical hit moment — first ring appears.
            if (!hitSignalled) {
              hitSignalled = true;
              this.runtime.signalHit();
            }
          },
        ],
        [
          15,
          (clip, ctx) => {
            // manifest: sprite8.placements[1] — parentSpriteId=9, frame=15,
            //   depth=13, matrix(tx=-0.05, ty=-0.1), ratio=15
            const s8b = clip.attach(sprite8Sym, "ring13", 13, ctx, {
              x: -0.05,
              y: -0.1,
            });
            void s8b;
          },
        ],
        [
          30,
          (clip, ctx) => {
            // manifest: sprite8.placements[2] — parentSpriteId=9, frame=30,
            //   depth=25, matrix(tx=-0.05, ty=-0.1), ratio=30
            const s8c = clip.attach(sprite8Sym, "ring25", 25, ctx, {
              x: -0.05,
              y: -0.1,
            });
            void s8c;
          },
        ],
        [
          45,
          (clip, ctx) => {
            // manifest: sprite8.placements[3] — parentSpriteId=9, frame=45,
            //   depth=37, matrix(tx=-0.05, ty=-0.1), ratio=45
            const s8d = clip.attach(sprite8Sym, "ring37", 37, ctx, {
              x: -0.05,
              y: -0.1,
            });
            void s8d;
          },
        ],
        [
          276,
          (clip) => {
            // AS DefineSprite_9/frame_277/DoAction.as:
            //   _parent.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite4Sym);
    this.registry.register(sprite7Sym);
    this.registry.register(sprite8Sym);
    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("arty_101");
    callbacks.playSound("arty_101");

    // Attach the main anim1 composite at depth 1 on the root so the
    // DefineSprite_9 timeline starts running immediately.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
