/**
 * Spell 2059 — (Smoke-arrow projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2059/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Rationale:
 *   - Has both `move` and `shoot` symbols.
 *   - `move` (DefineSprite_6_move) has an onEnterFrame that deposits `fumee`
 *     smoke wisps along the flight path as the harness drives it parabolically.
 *   - `shoot` (DefineSprite_3_shoot) frame_1 spawns 7 `fumee2` smoke plumes at
 *     impact; frame_73 removes the parent mc → spell complete.
 *   - Canonical ballistic pattern matches displayType 30 exactly.
 *
 * Library symbols:
 *   - lib_fumee  — 48-frame smoke wisp (flight trail). frame_1 seeds scale,
 *     random phase via gotoAndPlay, damps vx/vy by a random factor, registers
 *     onEnterFrame for decelerated drift. frame_46 removes self.
 *   - lib_fumee2 — 51-frame smoke puff (impact side). frame_1 seeds scale,
 *     random phase via gotoAndPlay, doubles vx/vy, registers onEnterFrame for
 *     gravity-driven drift (vy += 0.5). frame_49 removes self. Also places
 *     sprite8 at its timeline frame 3 (0-based).
 *   - sprite7    — directlyDynamic clip-event particle (spinning shard).
 *     onLoad seeds random rotation increment `i` ∈ [-66, 66].
 *     onEnterFrame increments rotation by `i` each tick.
 *   - sprite8    — wrapper (not directlyDynamic). Attaches sprite7 at its
 *     frame_1 (index 0). Is itself placed inside fumee2 at frame index 3.
 *   - moveSpinner — inner spinner child of `move` (DefineSprite_10).
 *     frame_1: _rotation = random(360). onEnterFrame: _rotation += 150/tick
 *     (from DefineSprite_6_move/PlaceObject2_5_1 CLIPACTIONRECORD).
 *   - move       — container-only. frame_1 seeds xi/yi/nf/c, attaches the
 *     inner spinner, and registers an onEnterFrame that emits 2 `fumee` wisps
 *     per tick on the parent, tracking previous position for velocity.
 *   - shoot      — container-only. frame_1 resets rotation to 0, spawns 7
 *     fumee2 plumes on the parent. frame_73 removes outer mc → complete.
 *     (signalHit is fired automatically by the harness on landing for
 *     displayType 30 — do NOT call it again here.)
 *
 * Main timeline: no SOMA.playSound present in the canonical AS scripts.
 * onSpellStart is a no-op; the harness attaches `move` automatically.
 *
 * CLIPACTIONRECORD sources ported:
 *   - DefineSprite_7/onClipEvent(load)        → sprite7Sym.onLoad
 *   - DefineSprite_7/onClipEvent(enterFrame)  → sprite7Sym.onEnterFrame
 *   - DefineSprite_6_move/PlaceObject2_5_1/onClipEvent(enterFrame) → moveSpinnerSym.onEnterFrame
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

const FUMEE_BOUNDS = {
  width: 2,
  height: 2.05,
  offsetX: -0.3,
  offsetY: -0.55,
};

const FUMEE2_BOUNDS = {
  width: 13.25,
  height: 8.25,
  offsetX: -8.45,
  offsetY: -7.3,
};

const SPRITE7_BOUNDS = {
  width: 6.05,
  height: 5.5,
  offsetX: -3.3,
  offsetY: -3.1,
};

const SPRITE8_BOUNDS = {
  width: 2.1,
  height: 1.9,
  offsetX: -1.1,
  offsetY: -0.9,
};

export class Spell2059 extends RuntimeSpell {
  readonly spellId = 2059;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Hold refs so cross-referencing symbol definitions works cleanly.
  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private moveSpinnerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite8Anchor = calculateAnchor(SPRITE8_BOUNDS);

    // ----------------------------------------------------------------
    // lib_fumee — 48-frame smoke wisp (flight trail particle)
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
            // t = 50 * Math.random() + 50;
            // gotoAndPlay(random(30));
            // _xscale = t; _yscale = t;
            // vx /= 3 + 3 * Math.random();
            // vy /= 3 + random(3);
            // this.onEnterFrame = function() { _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2; };
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const phase = Math.floor(Math.random() * 30);
            clip.gotoAndPlay(phase);
            const vx = (clip.vars.vx as number | undefined) ?? 0;
            const vy = (clip.vars.vy as number | undefined) ?? 0;
            clip.vars.vx = vx / (3 + 3 * Math.random());
            clip.vars.vy = vy / (3 + Math.floor(Math.random() * 3));
            clip.onEnterFrame = (c) => {
              // AS: _X = _X + vx; _Y = _Y + vy; vx /= 1.2; vy /= 1.2;
              let cvx = c.vars.vx as number;
              let cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              cvx /= 1.2;
              cvy /= 1.2;
              c.vars.vx = cvx;
              c.vars.vy = cvy;
            };
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_13_fumee/frame_46/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // sprite7 — directlyDynamic spinning particle (inner child of sprite8)
    // AS: DefineSprite_7/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    //     DefineSprite_7/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    this.sprite7Sym = {
      name: "sprite7",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
        // i = -66 + random(133);
        clip.vars.i = -66 + Math.floor(Math.random() * 133);
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + i;
        const i = clip.vars.i as number;
        clip.rotation += (i * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // sprite8 — wrapper (not directlyDynamic), carries sprite7 as child.
    // Placed inside fumee2 (characterId=11) at frame index 3.
    // manifest: parentSpriteId=11, frame=3, kind:"place", depth=1,
    //   matrix: scaleX=1.218, translateX=0.05, translateY=-0.25
    // sprite8 itself places sprite7 at its own frame_1 (index 0):
    //   matrix: scaleX=0.345, translateX=0.05, translateY=0.15
    // ----------------------------------------------------------------
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite8"),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Placement of sprite7 inside sprite8 at frame_1 (0-based index 0).
            // manifest librarySymbols sprite7: parentSpriteId=8, frame=0, depth=1,
            // matrix: scaleX=0.345123291015625, translateX=0.05, translateY=0.15
            const s7 = clip.attach(this.sprite7Sym, "sprite7_inner", 1, ctx, {
              x: 0.05,
              y: 0.15,
            });
            s7.scaleX = 0.345123291015625;
            s7.scaleY = 0.345123291015625;
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // lib_fumee2 — 51-frame smoke puff (impact particle)
    // AS: DefineSprite_11_fumee2/frame_1/DoAction.as
    //     DefineSprite_11_fumee2/frame_49/DoAction.as
    // Also places sprite8 at its own frame index 3 (manifest kind:"place",
    // parentSpriteId=11, frame=3, depth=1).
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
            // t = 20 * Math.random() + 80;
            // gotoAndPlay(random(45));
            // _xscale = t; _yscale = t;
            // vx *= 2; vy *= 2;
            // this.onEnterFrame = function() { _X += vx; _Y += vy; vy += 0.5; };
            const t = 20 * Math.random() + 80;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const phase = Math.floor(Math.random() * 45);
            clip.gotoAndPlay(phase);
            const vx = (clip.vars.vx as number | undefined) ?? 0;
            const vy = (clip.vars.vy as number | undefined) ?? 0;
            clip.vars.vx = vx * 2;
            clip.vars.vy = vy * 2;
            clip.onEnterFrame = (c) => {
              // AS: _X += vx; _Y += vy; vy += 0.5;
              const cvx = c.vars.vx as number;
              let cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              cvy += 0.5;
              c.vars.vy = cvy;
            };
          },
        ],
        [
          3,
          (clip, ctx) => {
            // manifest librarySymbols sprite8: kind:"place", parentSpriteId=11,
            // frame=3 (0-based), depth=1,
            // matrix: scaleX=1.2181854248046875, translateX=0.05, translateY=-0.25
            if (!clip.children.has("sprite8_inner")) {
              const s8 = clip.attach(this.sprite8Sym, "sprite8_inner", 1, ctx, {
                x: 0.05,
                y: -0.25,
              });
              s8.scaleX = 1.2181854248046875;
              s8.scaleY = 1.2181854248046875;
            }
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_11_fumee2/frame_49/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ----------------------------------------------------------------
    // moveSpinner — inner spinning child placed inside `move` via
    // PlaceObject2_5_1. Corresponds to DefineSprite_10 (random initial
    // rotation) with the CLIPACTIONRECORD that spins +150 deg/tick.
    // AS: DefineSprite_10/frame_1/DoAction.as
    //     DefineSprite_6_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // ----------------------------------------------------------------
    this.moveSpinnerSym = {
      name: "moveSpinner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10/frame_1/DoAction.as
            // _rotation = random(360);
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS DefineSprite_6_move/frame_1/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 150;
        clip.rotation += (150 * Math.PI) / 180;
      },
    };

    // ----------------------------------------------------------------
    // move — container-only (ballistic projectile carrier)
    // AS: DefineSprite_6_move/frame_1/DoAction.as
    // The harness attaches this at the caster and drives it along the
    // parabolic arc. frame_1 seeds state and registers a per-tick
    // onEnterFrame that emits fumee wisps on the parent mc.
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
            // xi = this._x; yi = this._y; nf = 2; c = 0;
            // this.onEnterFrame = function() { emit nf fumee per tick on _parent };
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 2;
            clip.vars.c = 0;

            // Attach the inner spinning child (PlaceObject2_5_1 inside DefineSprite_6_move)
            clip.attach(this.moveSpinnerSym, "spinner", 1, ctx);

            clip.onEnterFrame = (c) => {
              // AS DefineSprite_6_move/frame_1/DoAction.as — onEnterFrame closure
              // while(_loc3_ < nf) { attachMovie("fumee","fumee"+c, c+5); set x/y/vx/vy; c++; }
              // xi = this._x; yi = this._y;
              const nf = c.vars.nf as number;
              let counter = c.vars.c as number;
              const xi = c.vars.xi as number;
              const yi = c.vars.yi as number;

              for (let loc3 = 0; loc3 < nf; loc3++) {
                const instanceName = `fumee${counter}`;
                const parentClip = c.parent;
                if (parentClip) {
                  const f = parentClip.attach(
                    this.fumeeSym,
                    instanceName,
                    counter + 5,
                    ctx
                  );
                  f.x = c.x;
                  f.y = c.y;
                  f.vars.vx = c.x - xi + 10 * (Math.random() - 0.5);
                  f.vars.vy = c.y - yi + 10 * (Math.random() - 0.5);
                }
                counter++;
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
    // shoot — container-only (impact carrier)
    // AS: DefineSprite_3_shoot/frame_1/DoAction.as
    //     DefineSprite_3_shoot/frame_73/DoAction.as
    // The harness attaches this at the landing position when `move` arrives.
    // frame_1 resets rotation to 0, spawns 7 fumee2 plumes on the parent.
    // frame_73 (0-based: 72) calls _parent.removeMovieClip() → complete().
    // signalHit is fired automatically by the harness (displayType 30) on
    // landing — do NOT call it here.
    // ----------------------------------------------------------------
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 75,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_3_shoot/frame_1/DoAction.as
            // _rotation = 0;
            // xi = this._x; yi = this._y; c = 0;
            // while(p < 7) { attachMovie("fumee2","fumee2"+c+200, c+200); set pos/vel; c++; xi=_x; yi=_y; p++ }
            clip.rotation = 0;
            let xi = clip.x;
            // yi is tracked but unused after assignment in the loop (AS quirk — keep for fidelity)
            let yi = clip.y; // eslint-disable-line @typescript-eslint/no-unused-vars
            let c = 0;
            const parent = clip.parent;
            for (let p = 0; p < 7; p++) {
              const instanceName = `fumee2${c}200`;
              const depth = c + 200;
              if (parent) {
                const f = parent.attach(
                  this.fumee2Sym,
                  instanceName,
                  depth,
                  ctx
                );
                f.x = clip.x;
                f.y = clip.y - 30;
                // AS: f.vx = this._x - xi + 5 * (Math.random() - 0.5)
                // AS: f.vy = -7 * Math.random()
                f.vars.vx = clip.x - xi + 5 * (Math.random() - 0.5);
                f.vars.vy = -7 * Math.random();
              }
              c++;
              xi = clip.x;
              yi = clip.y;
            }
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_73/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- Register all symbols ----
    this.registry.register(this.fumeeSym);
    this.registry.register(this.fumee2Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.moveSpinnerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical AS scripts for spell 2059.
    // The harness (displayType=30 ProjectileBallistic) attaches `move`
    // automatically; no additional main-timeline children to attach here.
  }
}
