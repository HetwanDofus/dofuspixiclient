/**
 * Spell 2012 — (Iop/generic ballistic projectile with smoke trails).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2012/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic):
 *   - Has `move` + `shoot` symbols. `move` drives smoke-trail particles
 *     (fumee) along the parabolic arc. `shoot` spawns fumee2 particles
 *     at the target on impact and runs for 73 frames before calling
 *     _parent.removeMovieClip().
 *   - The harness fires signalHit() automatically on landing.
 *
 * Library symbols:
 *   - lib_fumee2 — 51-frame smoke puff particle spawned by shoot/frame_1
 *     at the impact site. onLoad randomises scale, jumps to random frame,
 *     and applies vy gravity. onEnterFrame drifts position with friction
 *     + gravity. Removes at frame_49. At frame 3 (0-based) places sprite8
 *     (wrapper) which in turn places sprite7 (spinning spark).
 *   - lib_fumee  — 48-frame thin smoke trail particle spawned by move's
 *     onEnterFrame during the projectile flight. onLoad randomises scale,
 *     jumps to random frame, divides vx/vy. onEnterFrame drifts with
 *     friction. Removes at frame_46.
 *   - sprite7    — directlyDynamic clipEvent sprite (a spinning spark).
 *     onLoad seeds rotation increment i ∈ [-200, 200). onEnterFrame
 *     increments rotation by i each tick.
 *   - sprite8    — wrapper sprite (directlyDynamic: false). Placed inside
 *     fumee2 at frame 3, depth 1. Its frameScripts[0] attaches sprite7
 *     at depth 1 with the placement matrix from manifest placements[].
 *
 * move symbol (DefineSprite_6_move):
 *   - frame_1 onEnterFrame spawns `nf=5` fumee particles per tick
 *     tracking the projectile position, with velocity inherited from
 *     the move clip's motion delta (xi/yi).
 *   - PlaceObject2_5_2 onClipEvent(enterFrame): an inner sprite inside
 *     move rotates by 75 degrees/tick. Registered as sprite10.
 *
 * shoot symbol (DefineSprite_3_shoot):
 *   - frame_1: resets rotation to 0, then spawns 7 fumee2 particles at
 *     _parent with staggered vx/vy.
 *   - frame_73: _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: no SOMA.playSound found; harness attaches `move` automatically.
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

// ---- Bounds from manifest.librarySymbols[] ----

const FUMEE2_BOUNDS = {
  width: 13.25,
  height: 8.25,
  offsetX: -8.45,
  offsetY: -7.3,
};

const FUMEE_BOUNDS = {
  width: 2,
  height: 2.05,
  offsetX: -0.3,
  offsetY: -0.55,
};

const SPRITE7_BOUNDS = {
  width: 5.4,
  height: 5.6,
  offsetX: -2.55,
  offsetY: -3.1,
};

const SPRITE8_BOUNDS = {
  width: 1.9,
  height: 1.9,
  offsetX: -0.85,
  offsetY: -0.9,
};

export class Spell2012 extends RuntimeSpell {
  readonly spellId = 2012;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Symbols that need cross-reference (shoot spawns fumee2 on parent;
  // fumee2 spawns sprite8; sprite8 spawns sprite7)
  private fumee2Sym!: SymbolDefinition;
  private fumeeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);

    // ----------------------------------------------------------------
    // sprite7 — directlyDynamic spinning spark
    // AS: DefineSprite_7/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_7/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    const sprite7Sym: SymbolDefinition = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): i = -200 + random(400)
        clip.vars.i = -200 + Math.floor(Math.random() * 400);
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _rotation = _rotation + i
        const i = clip.vars.i as number;
        clip.rotation += (i * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // sprite8 — wrapper (directlyDynamic: false), placed inside fumee2
    // at frame 3 (0-based), depth 1.
    // placements[]: parentSpriteId=8 → sprite7 placed at frame 0, depth 1
    // with matrix { scaleX:0.345, scaleY:0.345, translateX:0.05, translateY:0.15 }
    // ----------------------------------------------------------------
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite7 at depth 1 with the canonical placement matrix:
            // manifest librarySymbols sprite7 placements[0]:
            //   parentSpriteId=8, frame=0, depth=1
            //   matrix: scaleX=0.345123, scaleY=0.345123,
            //            translateX=0.05, translateY=0.15
            const child = clip.attach(sprite7Sym, "sprite7", 1, ctx, {
              x: 0.05,
              y: 0.15,
            });
            child.scaleX = 0.345123291015625;
            child.scaleY = 0.345123291015625;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_fumee2 — impact smoke puff (51 frames)
    // AS: DefineSprite_11_fumee2/frame_1/DoAction.as
    //     DefineSprite_11_fumee2/frame_49/DoAction.as
    // sprite8 is placed at frame 3 (0-based), depth 1 inside fumee2
    // per manifest librarySymbols sprite8 placements[0]:
    //   parentSpriteId=11, frame=3, depth=1,
    //   matrix: scaleX=1.2182, translateX=0.05, translateY=-0.25
    // ----------------------------------------------------------------
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_11_fumee2/frame_1/DoAction.as
            const t = 20 * Math.random() + 80;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // gotoAndPlay(random(45)) → 0-based
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
            // Attenuate inherited vx/vy
            const vx = (clip.vars.vx as number) ?? 0;
            const vy = (clip.vars.vy as number) ?? 0;
            clip.vars.vx = vx * 0.67;
            clip.vars.vy = vy * 0.67;
            // Register per-frame motion with gravity
            clip.onEnterFrame = (c) => {
              // AS: _X = _X + vx; _Y = _Y + vy; vy += 0.5
              const cvx = c.vars.vx as number;
              const cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              c.vars.vy = cvy + 0.5;
            };
          },
        ],
        [
          3,
          (clip, ctx) => {
            // manifest sprite8 placements[0]: parentSpriteId=11, frame=3 (0-based), depth=1
            // kind="place" → attach sprite8 here with its placement matrix
            // matrix: scaleX=1.2181854248046875, translateX=0.05, translateY=-0.25
            const child = clip.attach(sprite8Sym, "sprite8", 1, ctx, {
              x: 0.05,
              y: -0.25,
            });
            child.scaleX = 1.2181854248046875;
            child.scaleY = 1.2181854248046875;
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_11_fumee2/frame_49/DoAction.as
            // this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_fumee — trail smoke (48 frames)
    // AS: DefineSprite_13_fumee/frame_1/DoAction.as
    //     DefineSprite_13_fumee/frame_46/DoAction.as
    // ----------------------------------------------------------------
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13_fumee/frame_1/DoAction.as
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // gotoAndPlay(random(30)) → 0-based
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            // Divide inherited vx/vy
            const rawVx = (clip.vars.vx as number) ?? 0;
            const rawVy = (clip.vars.vy as number) ?? 0;
            clip.vars.vx = rawVx / (3 + 3 * Math.random());
            clip.vars.vy = rawVy / (3 + Math.floor(Math.random() * 3));
            // Per-frame drift with friction
            clip.onEnterFrame = (c) => {
              // AS: _X = _X + vx; _Y = _Y + vy; vx /= 1.2; vy /= 1.2
              const cvx = c.vars.vx as number;
              const cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              c.vars.vx = cvx / 1.2;
              c.vars.vy = cvy / 1.2;
            };
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_13_fumee/frame_46/DoAction.as
            // this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite10 (DefineSprite_10) — inner spinning child of move
    // AS: DefineSprite_10/frame_1/DoAction.as → _rotation = random(360)
    // AS: DefineSprite_6_move/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD
    //     onClipEvent(enterFrame) → _rotation = _rotation + 75
    // ----------------------------------------------------------------
    const sprite10Sym: SymbolDefinition = {
      name: "sprite10",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_10/frame_1/DoAction.as: _rotation = random(360)
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      },
      onEnterFrame: (clip) => {
        // AS PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame):
        // _rotation = _rotation + 75
        clip.rotation += (75 * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // move — projectile container (DefineSprite_6_move)
    // Harness attaches this at the caster; its onEnterFrame spawns
    // fumee trail particles each tick tracking position delta.
    // AS: DefineSprite_6_move/frame_1/DoAction.as
    // ----------------------------------------------------------------
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6_move/frame_1/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 5;
            clip.vars.c = 0;

            // Attach the inner spinning sprite10 (PlaceObject2_5_2)
            clip.attach(sprite10Sym, "sprite10", 5, ctx);

            // Register per-tick fumee spawning
            clip.onEnterFrame = (c, ectx) => {
              // AS DefineSprite_6_move/frame_1/DoAction.as (this.onEnterFrame)
              const nf = c.vars.nf as number;
              let counter = c.vars.c as number;
              const xi = c.vars.xi as number;
              const yi = c.vars.yi as number;

              const parent = c.parent;
              if (parent) {
                for (let loc3 = 0; loc3 < nf; loc3++) {
                  const instanceName = `fumee${counter}`;
                  const depth = counter + 5;
                  const child = parent.attach(this.fumeeSym, instanceName, depth, ectx);
                  child.x = c.x;
                  child.y = c.y;
                  child.vars.vx = c.x - xi + 6.67 * (Math.random() - 0.5);
                  child.vars.vy = c.y - yi + 6.67 * (Math.random() - 0.5);
                  counter++;
                }
              }
              c.vars.c = counter;
              c.vars.xi = c.x;
              c.vars.yi = c.y;
            };
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // shoot — impact container (DefineSprite_3_shoot)
    // Harness attaches at landing; frame_1 resets rotation and spawns
    // 7 fumee2 particles on _parent. frame_73 → spell complete.
    // AS: DefineSprite_3_shoot/frame_1/DoAction.as
    //     DefineSprite_3_shoot/frame_73/DoAction.as
    // ----------------------------------------------------------------
    const shootBoundsAnchor = calculateAnchor({
      width: 132.8,
      height: 88.75,
      offsetX: -77.4,
      offsetY: -75.2,
    });

    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 75,
      frames: textures.getFrames("shoot"),
      anchorX: shootBoundsAnchor.x,
      anchorY: shootBoundsAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = 0 — override any harness-applied velocity angle
            clip.rotation = 0;

            // Spawn 7 fumee2 particles on _parent at impact position
            const parent = clip.parent;
            if (parent) {
              let localXi = clip.x;
              let c = 0;
              // AS: while (p < 7) { _parent.attachMovie("fumee2", "fumee2"+c+200, c+200); ... }
              for (let p = 0; p < 7; p++) {
                const instanceName = `fumee2${c}${200}`;
                const depth = c + 200;
                const child = parent.attach(this.fumee2Sym, instanceName, depth, ctx);
                child.x = clip.x;
                child.y = clip.y - 30;
                child.vars.vx = clip.x - localXi + 5 * (Math.random() - 0.5);
                child.vars.vy = -7 * Math.random();
                localXi = clip.x;
                c++;
              }
            }
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_73/DoAction.as
            // _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // Register all symbols
    this.registry.register(sprite7Sym);
    this.registry.register(sprite8Sym);
    this.registry.register(this.fumee2Sym);
    this.registry.register(this.fumeeSym);
    this.registry.register(sprite10Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No SOMA.playSound found in the canonical AS scripts for spell 2012.
    // The harness already attaches "move" for displayType 30.
  }
}
