/**
 * Spell 2107 — Artillerie (Roublard artillery strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2107/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no "move" / "shoot" / "duplicate"
 * library symbols and no projectile-linear/ballistic/beam logic. The outer
 * SWF places sprite9 (the main animated composite) at the target cell. All
 * visual content is a single authored animation anchored at the target.
 *
 * Library symbols:
 *   - sprite7  (directlyDynamic: true, 118 frames) — the main visual timeline
 *               (smoke plume / explosion composite). Several frames spawn or
 *               mutate child sprites (sprite14/baton kind) through PlaceObject2.
 *               frame_35 → gotoAndPlay(random(5)+17); frame_117 → stop().
 *               ClipEvent-placed children at frames 75, 79, 85, 89, 93 each
 *               have onLoad (alpha init) and the frame_93 pair also has
 *               onEnterFrame (alpha decay + leftward drift).
 *   - sprite9  (directlyDynamic: false, 148 frames) — outer wrapper that
 *               contains sprite7. frame_147 → stop(). Not directly dynamic;
 *               wraps sprite7 via placements[].
 *   - sprite14 (directlyDynamic: true, 1 frame) — small baton/thorn particle.
 *               onEnterFrame: random alpha flicker.
 *   - sprite15 (directlyDynamic: true, 1 frame) — thorn wrapper. Placed by
 *               sprite16 (baton2 kind). onLoad: alpha init.
 *   - sprite16 (directlyDynamic: false, 1 frame) — baton2 wrapper containing
 *               sprite15 with oscillation. frameScripts[0] sets scale/scatter
 *               plus seeds oscillation vars; onEnterFrame oscillates rotation.
 *   - baton    (lib_baton, DefineSprite_18) — drift particle. frame_1 seeds
 *               vx/vy/t; onEnterFrame integrates with 0.95 friction.
 *   - baton2   (lib_baton2, DefineSprite_17) — burning thorn at target.
 *               frame_1 sets scale/scatter; inner sprite16/sprite15 combo
 *               provides oscillation.
 *   - tige     (lib_tige, DefineSprite_10) — oscillating stem particle.
 *               frame_1 uses _root.i for position/scale/alpha.
 *
 * Main timeline (frame_1): SOMA.playSound("arty_102").
 * Main timeline (frame_172): removeMovieClip → complete().
 *
 * The harness attaches sprite9 at the root (TargetCell anchor = target cell).
 * sprite9's frameScripts attach sprite7. sprite7's complex timeline and its
 * PlaceObject2 clip-event children are all ported below.
 *
 * signalHit: fired from sprite7's meaningful impact region. Given the
 * artillery pattern, we fire it at frame_35 of sprite7 (the canonical
 * loop-back / impact moment). Only once.
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

const SPRITE7_BOUNDS = {
  width: 16.55,
  height: 69.25,
  offsetX: -8.25,
  offsetY: -24.25,
};

const SPRITE9_BOUNDS = {
  width: 344.4,
  height: 224.85,
  offsetX: -144.4,
  offsetY: -175,
};

const SPRITE14_BOUNDS = {
  width: 49.1,
  height: 9.4,
  offsetX: -27,
  offsetY: -4.3,
};

const SPRITE15_BOUNDS = {
  width: 49.1,
  height: 9.4,
  offsetX: -26.95,
  offsetY: -4.2,
};

const SPRITE16_BOUNDS = {
  width: 6.7,
  height: 35.15,
  offsetX: -3.2,
  offsetY: -29.9,
};

// lib_baton (DefineSprite_18_baton) bounds — same as sprite14 (thorn shape)
const BATON_BOUNDS = {
  width: 49.1,
  height: 9.45,
  offsetX: -26.95,
  offsetY: -4.5,
};

// lib_baton2 (DefineSprite_17_baton2) bounds — same as sprite16 wrapper
const BATON2_BOUNDS = {
  width: 6.7,
  height: 35.15,
  offsetX: -3.2,
  offsetY: -29.9,
};

// lib_tige (DefineSprite_10_tige) — no direct manifest entry; reuse baton shape
const TIGE_BOUNDS = {
  width: 49.1,
  height: 9.45,
  offsetX: -26.95,
  offsetY: -4.5,
};

export class Spell2107 extends RuntimeSpell {
  readonly spellId = 2107;
  readonly displayType = SpellDisplayType.TargetCell;

  // Stored so onSpellStart can attach sprite9 and frameScripts can reference
  // the deeper symbols.
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite14Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite16Sym!: SymbolDefinition;
  private batonSym!: SymbolDefinition;
  private baton2Sym!: SymbolDefinition;
  private tigeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE14_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE15_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE16_BOUNDS);
    const batonAnchor = calculateAnchor(BATON_BOUNDS);
    const baton2Anchor = calculateAnchor(BATON2_BOUNDS);
    const tigeAnchor = calculateAnchor(TIGE_BOUNDS);

    // ----------------------------------------------------------------
    // sprite14 — directlyDynamic thorn particle (DefineSprite_14)
    // ----------------------------------------------------------------
    // AS DefineSprite_14/frame_1/PlaceObject2_13_2/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _alpha = random(100);
    this.sprite14Sym = {
      name: "sprite14",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      onEnterFrame: (clip) => {
        // AS: _alpha = random(100);
        clip.alpha = Math.floor(Math.random() * 100) / 100;
      },
    };

    // ----------------------------------------------------------------
    // sprite15 — directlyDynamic thorn wrapper (DefineSprite_15)
    // ----------------------------------------------------------------
    // AS DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load):
    //   _alpha = 100 - random(50);
    // sprite15 wraps sprite14 via placement (parentSpriteId=16 in manifest,
    // but also parentSpriteId=18 — placed inside baton2/sprite16 and inside
    // the baton symbol). We port the onLoad here; attach of sprite14 happens
    // in frameScripts[0].
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_15/frame_1/PlaceObject2_14_1/CLIPACTIONRECORD onClipEvent(load):
        //   _alpha = 100 - random(50);
        clip.alpha = (100 - Math.floor(Math.random() * 50)) / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite14 inside sprite15 at the canonical PlaceObject2
            // transform (parentSpriteId=15, frame=0, depth=1,
            // matrix: translateX=0.05, translateY=0.1).
            clip.attach(this.sprite14Sym, "sprite14_inner", 1, ctx, {
              x: 0.05,
              y: 0.1,
            });
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite16 — baton2 inner wrapper (DefineSprite_16), not directly dynamic
    // ----------------------------------------------------------------
    // Wraps sprite15 with oscillation clip-events ported from
    // DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/... (the parent baton2
    // symbol drives the oscillation on this sprite's placement).
    // sprite16 itself is not directly dynamic — it just contains sprite15.
    // The oscillation handlers live on baton2 (below) applied to sprite16.
    this.sprite16Sym = {
      name: "sprite16",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite15 inside sprite16 at canonical placement
            // (parentSpriteId=16, frame=0, depth=1,
            // matrix: translateX=0, translateY=0.8).
            clip.attach(this.sprite15Sym, "sprite15_inner", 1, ctx, {
              x: 0,
              y: 0.8,
            });
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // baton2 (DefineSprite_17_baton2) — oscillating burning thorn
    // ----------------------------------------------------------------
    // AS DefineSprite_17_baton2/frame_1/DoAction.as:
    //   t = 100 - random(50);
    //   _xscale = t;  _yscale = t;
    //   _X = 40 * (0.5 - Math.random());
    //   _Y = 20 * (0.5 - Math.random());
    //
    // AS DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load):
    //   a = 10 + random(20);
    //   i = 6 * Math.random();
    //   v2 = 1.05 + 0.5 * Math.random();
    //
    // AS DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _rotation = a * Math.sin(i++);
    //   a /= v2;
    //
    // The clip-event handlers in the canonical AS are attached to the
    // PlaceObject2 of sprite16 INSIDE baton2. We model this by storing the
    // oscillation state on baton2's clip.vars and driving it in baton2's
    // onEnterFrame (which mutates the inner sprite16 child's rotation).
    this.baton2Sym = {
      name: "baton2",
      totalFrames: 1,
      frames: textures.getFrames("lib_baton2"),
      anchorX: baton2Anchor.x,
      anchorY: baton2Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_17_baton2/frame_1/DoAction.as
            const t = 100 - Math.floor(Math.random() * 50);
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.x = 40 * (0.5 - Math.random());
            clip.y = 20 * (0.5 - Math.random());

            // Attach sprite16 (which wraps sprite15 → sprite14)
            // PlaceObject2_16_1: parentSpriteId=17, frame=0, depth=1
            // placement matrix: translateX=0, translateY=0.8 (applied by sprite16)
            // We attach at depth 1 with no extra transform (sprite16 manages internals)
            const inner = clip.attach(this.sprite16Sym, "sprite16_inner", 1, ctx);

            // AS DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(load):
            //   a = 10 + random(20);  i = 6 * Math.random();  v2 = 1.05 + 0.5 * Math.random();
            inner.vars.a = 10 + Math.floor(Math.random() * 20);
            inner.vars.i = 6 * Math.random();
            inner.vars.v2 = 1.05 + 0.5 * Math.random();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_17_baton2/frame_1/PlaceObject2_16_1/CLIPACTIONRECORD onClipEvent(enterFrame):
        //   _rotation = a * Math.sin(i++);
        //   a /= v2;
        // The rotation is applied to the inner sprite16 clip.
        const inner = clip.children.get("sprite16_inner");
        if (!inner) {
          return;
        }
        const a = inner.vars.a as number;
        const i = inner.vars.i as number;
        const v2 = inner.vars.v2 as number;
        inner.rotation = (a * Math.sin(i) * Math.PI) / 180;
        inner.vars.i = i + 1;
        inner.vars.a = a / v2;
      },
    };

    // ----------------------------------------------------------------
    // baton (DefineSprite_18_baton) — drift particle during explosion
    // ----------------------------------------------------------------
    // AS DefineSprite_18_baton/frame_1/DoAction.as:
    //   v = 5 * (-0.5 + Math.random());
    //   vy = 3 * (-0.5 + Math.random());
    //   f = _root._currentframe;    (runtime frame — we use 0 as neutral)
    //   t = 50 + 40 * (-0.5 + Math.random());
    //   _yscale = t + f * 5;
    //   _xscale = t + f * 5;
    //   this.onEnterFrame = function() { _X += v; _Y += vy; v *= 0.95; vy *= 0.95; };
    this.batonSym = {
      name: "baton",
      totalFrames: 1,
      frames: textures.getFrames("lib_baton"),
      anchorX: batonAnchor.x,
      anchorY: batonAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_18_baton/frame_1/DoAction.as
        clip.vars.v = 5 * (-0.5 + Math.random());
        clip.vars.vy = 3 * (-0.5 + Math.random());
        // f = _root._currentframe — we use 0 as a neutral stand-in since
        // _root frame state is not available in this context.
        const f = 0;
        const t = 50 + 40 * (-0.5 + Math.random());
        const scale = (t + f * 5) / 100;
        clip.scaleX = scale;
        clip.scaleY = scale;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_18_baton/frame_1/DoAction.as (inline onEnterFrame):
        //   _X = _X + v; _Y = _Y + vy; v *= 0.95; vy *= 0.95;
        const v = clip.vars.v as number;
        const vy = clip.vars.vy as number;
        clip.x += v;
        clip.y += vy;
        clip.vars.v = v * 0.95;
        clip.vars.vy = vy * 0.95;
      },
    };

    // ----------------------------------------------------------------
    // tige (DefineSprite_10_tige) — oscillating stem particle
    // ----------------------------------------------------------------
    // AS DefineSprite_10_tige/frame_1/DoAction.as:
    //   _X = 20 * Math.sin(_root.i);
    //   _Y = 7 * Math.cos(_root.i);
    //   _xscale = 50 * MAth.cos(_root.i);   (typo in AS: "MAth" == Math)
    //   if(_Y < 0) { _alpha = 70 * Math.cos(_root.i) + 100; }
    //
    // _root.i is the global animation counter. We model this as a
    // per-clip phase counter incremented each frame.
    this.tigeSym = {
      name: "tige",
      totalFrames: 1,
      frames: textures.getFrames("lib_tige"),
      anchorX: tigeAnchor.x,
      anchorY: tigeAnchor.y,
      onLoad: (clip) => {
        clip.vars.phase = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_tige/frame_1/DoAction.as
        const phase = clip.vars.phase as number;
        clip.x = 20 * Math.sin(phase);
        const yVal = 7 * Math.cos(phase);
        clip.y = yVal;
        clip.scaleX = (50 * Math.cos(phase)) / 100;
        if (yVal < 0) {
          clip.alpha = (70 * Math.cos(phase) + 100) / 100;
        }
        clip.vars.phase = phase + 0.1;
      },
    };

    // ----------------------------------------------------------------
    // sprite7 — main animated visual (DefineSprite_7, directlyDynamic)
    // ----------------------------------------------------------------
    // 118-frame authored timeline (smoke/explosion).
    //
    // Key frame scripts:
    //   frame_35 (index 34): gotoAndPlay(random(5)+17) — loop variation
    //   frame_117 (index 116): stop()
    //
    // PlaceObject2 clip-event children placed at various frames:
    //   frame_75  (index 74): PlaceObject2_4_1 → alpha-init child (onLoad: _alpha=random(80))
    //   frame_79  (index 78): PlaceObject2_6_1 → alpha-init child (onLoad: _alpha=random(80))
    //   frame_85  (index 84): PlaceObject2_4_1 → alpha-init child (onLoad: _alpha=random(80))
    //   frame_89  (index 88): PlaceObject2_6_1 → alpha-init child (onLoad: _alpha=random(80))
    //   frame_93  (index 92): PlaceObject2_6_1 → alpha-decay + left-drift child
    //     onLoad:  _alpha = random(120);
    //     onEnterFrame: _alpha -= 5; _X -= 2;
    //
    // We model each PlaceObject2 clip-event child as a lightweight
    // anonymous SymbolDefinition inline so they carry their own
    // onLoad/onEnterFrame behavior without polluting the registry.

    // Inline symbol: alpha-init-only child (frames 75, 79, 85, 89)
    // AS: onLoad { _alpha = random(80); }
    const alphaInitChild80: SymbolDefinition = {
      name: "__alpha80_child",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_75/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load)
        // AS DefineSprite_7/frame_79/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load)
        // AS DefineSprite_7/frame_85/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load)
        // AS DefineSprite_7/frame_89/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load)
        //   _alpha = random(80);
        clip.alpha = Math.floor(Math.random() * 80) / 100;
      },
    };

    // Inline symbol: alpha-decay + left-drift child (frame 93)
    // AS: onLoad { _alpha = random(120); }
    // AS: onEnterFrame { _alpha -= 5; _X -= 2; }
    const alphaDecayChild: SymbolDefinition = {
      name: "__alpha_decay_child",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_93/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load)
        //   _alpha = random(120);
        clip.alpha = Math.floor(Math.random() * 120) / 100;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/frame_93/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame)
        //   _alpha = _alpha - 5;
        //   _X = _X - 2;
        clip.alpha = Math.max(0, clip.alpha - 5 / 100);
        clip.x -= 2;
      },
    };

    let hitSignalled = false;

    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 118,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      frameScripts: new Map([
        [
          34,
          (clip, _ctx) => {
            // AS DefineSprite_7/frame_35/DoAction.as:
            //   gotoAndPlay(random(5) + 17);
            // Signal hit at this canonical impact/loop-back frame.
            if (!hitSignalled) {
              hitSignalled = true;
              this.runtime.signalHit();
            }
            clip.gotoAndPlay(Math.floor(Math.random() * 5) + 17 - 1);
          },
        ],
        [
          74,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_75/PlaceObject2_4_1 — place alpha-init child
            clip.attach(alphaInitChild80, "child_frame75_d4", 4, ctx);
          },
        ],
        [
          78,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_79/PlaceObject2_6_1 — place alpha-init child
            clip.attach(alphaInitChild80, "child_frame79_d6", 6, ctx);
          },
        ],
        [
          84,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_85/PlaceObject2_4_1 — place alpha-init child
            clip.attach(alphaInitChild80, "child_frame85_d4", 4, ctx);
          },
        ],
        [
          88,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_89/PlaceObject2_6_1 — place alpha-init child
            clip.attach(alphaInitChild80, "child_frame89_d6", 6, ctx);
          },
        ],
        [
          92,
          (clip, ctx) => {
            // AS DefineSprite_7/frame_93/PlaceObject2_6_1 — place alpha-decay+drift child
            clip.attach(alphaDecayChild, "child_frame93_d6", 6, ctx);
          },
        ],
        [
          116,
          (clip) => {
            // AS DefineSprite_7/frame_117/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite9 — outer wrapper (DefineSprite_9, not directly dynamic)
    // ----------------------------------------------------------------
    // 148-frame wrapper. frame_147 → stop().
    // Contains sprite7 via placement at frame_0, depth_2,
    // matrix: scaleX=1, scaleY=1, translateX=24.75, translateY=-10.15.
    // Also contains a secondary child at depth 4 (starting frame 4) with
    // translateX=7.95, translateY varying (the "move" tweens).
    // For simplicity we handle the primary sprite7 placement (depth 2)
    // and the secondary child (depth 4) as additional baton attachments
    // driven from the tween schedule embedded in the placements[] data.
    //
    // The placements[] for sprite9 show sprite7 placed at frame 0 depth 2
    // and then tweened (kind: "move") across ~40 frames. The per-frame
    // "move" updates shift translateY upward slightly each frame — this is
    // the authored rising-smoke tween. Rather than hard-coding 40 keyframes
    // we drive it via onEnterFrame using linear interpolation between the
    // first (translateY=-10.15) and last (translateY=4.85) values over
    // ~40 frames for the depth-2 child (sprite7 going from y=-10.15 to y=4.85).
    // The depth-4 child similarly runs from frame 4 (y=-25.65) to frame 38
    // (y=-13.55), and depth-6 from frame 8 (y=-41.45) to frame 38 (y=-31.9),
    // and depth-8 from frame 12 (y=-57.6) to frame 38 (y=-50.3).
    // All have constant x and scaleX/scaleY=1.
    //
    // We model sprite9's onEnterFrame to move the tweened children each frame.

    this.sprite9Sym = {
      name: "sprite9",
      totalFrames: 148,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onLoad: (clip) => {
        clip.vars.tickCount = 0;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place sprite7 at depth 2, canonical transform from placements[]:
            // parentSpriteId=9, frame=0, depth=2, translateX=24.75, translateY=-10.15
            clip.attach(this.sprite7Sym, "sprite7_d2", 2, ctx, {
              x: 24.75,
              y: -10.15,
            });
          },
        ],
        [
          4,
          (clip, ctx) => {
            // Place secondary baton at depth 4, frame 4
            // placements[]: parentSpriteId=9, frame=4, depth=4, translateX=7.95, translateY=-25.65
            clip.attach(this.batonSym, "baton_d4", 4, ctx, {
              x: 7.95,
              y: -25.65,
            });
          },
        ],
        [
          8,
          (clip, ctx) => {
            // Place third baton at depth 6, frame 8
            // placements[]: parentSpriteId=9, frame=8, depth=6, translateX=-8.85, translateY=-41.45
            clip.attach(this.batonSym, "baton_d6", 6, ctx, {
              x: -8.85,
              y: -41.45,
            });
          },
        ],
        [
          12,
          (clip, ctx) => {
            // Place fourth baton at depth 8, frame 12
            // placements[]: parentSpriteId=9, frame=12, depth=8, translateX=-25.65, translateY=-57.6
            clip.attach(this.batonSym, "baton_d8", 8, ctx, {
              x: -25.65,
              y: -57.6,
            });
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_9/frame_147/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // Drive the authored "move" tweens for sprite9's children.
        // These correspond to the per-frame PlaceObject2 "move" records
        // in sprite9's placements[] that shift children upward over time.
        // We use the clip's current frame to interpolate linearly between
        // the first and last keyframe positions from the placements[] data.
        const frame = clip.currentFrame;

        // sprite7 at depth 2: y goes from -10.15 (frame 0) to 4.85 (frame 40)
        // x stays at 24.75 throughout.
        const s7 = clip.children.get("sprite7_d2");
        if (s7) {
          if (frame <= 38) {
            const t2 = frame / 38;
            s7.y = -10.15 + (4.85 - -10.15) * t2;
          }
        }

        // baton at depth 4: y goes from -25.65 (frame 4) to -13.55 (frame 38)
        const b4 = clip.children.get("baton_d4");
        if (b4) {
          if (frame >= 4 && frame <= 38) {
            const t4 = (frame - 4) / (38 - 4);
            b4.y = -25.65 + (-13.55 - -25.65) * t4;
          }
        }

        // baton at depth 6: y goes from -41.45 (frame 8) to -31.9 (frame 38)
        const b6 = clip.children.get("baton_d6");
        if (b6) {
          if (frame >= 8 && frame <= 38) {
            const t6 = (frame - 8) / (38 - 8);
            b6.y = -41.45 + (-31.9 - -41.45) * t6;
          }
        }

        // baton at depth 8: y goes from -57.6 (frame 12) to -50.3 (frame 38)
        const b8 = clip.children.get("baton_d8");
        if (b8) {
          if (frame >= 12 && frame <= 38) {
            const t8 = (frame - 12) / (38 - 12);
            b8.y = -57.6 + (-50.3 - -57.6) * t8;
          }
        }
      },
    };

    // Register all symbols
    this.registry.register(this.sprite14Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite16Sym);
    this.registry.register(this.batonSym);
    this.registry.register(this.baton2Sym);
    this.registry.register(this.tigeSym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("arty_102");
    callbacks.playSound("arty_102");

    // The main timeline places sprite9 at the target (TargetCell anchor).
    // We attach it here so it starts ticking from the next runtime frame.
    // The outer SWF's frame_172 fires removeMovieClip → complete().
    // sprite9 is the outermost child; we drive complete() from a
    // synthetic frame script on the root triggered at frame 172.
    // Since the root itself has no authored frame scripts, we use a
    // root-level onEnterFrame guard to fire complete() once sprite9
    // has reached its terminal frame and the outer timeline would
    // have hit frame_172.
    this.root.attach(this.sprite9Sym, "sprite9", 1, context);

    // Drive the spell-level completion from the canonical frame_172 script.
    // We track elapsed frames on root and fire complete() after 172 ticks
    // (matching the AS: scripts/frame_172/DoAction.as → removeMovieClip).
    let completeFrameCount = 0;
    this.root.onEnterFrame = (_clip) => {
      completeFrameCount++;
      if (completeFrameCount >= 172) {
        this.root.onEnterFrame = null;
        this.runtime.complete();
      }
    };
  }
}
