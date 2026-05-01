/**
 * Spell 902 — Flèche Empoisonnée (Cra poison arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/902/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has `move` and `shoot`
 * library symbols, with `move`'s frame_1 spawning fumee smoke particles
 * along the flight path, and `shoot` being a 66-frame impact composite
 * (sprite6) that spawns more fumee on impact and removes itself at frame 64.
 *
 * Library symbols:
 *   - lib_fumee — 51-frame smoke puff particle. frame_1 seeds scale/rotation/vx/vy;
 *     onEnterFrame integrates position with rapid decay; frame_49 removes itself.
 *   - sprite6 (characterId=6) — 66-frame impact smoke burst, directlyDynamic=true.
 *     frame_1 spawns 7 fumee particles with random velocities; frame_64 calls
 *     _parent.removeMovieClip(). Has a PlaceObject2_4_2 child with onClipEvent(load)
 *     seeding `a=15` and onClipEvent(enterFrame) oscillating rotation.
 *     This is the `shoot` symbol placed inside DefineSprite_7_shoot.
 *   - shoot (DefineSprite_7_shoot) — wrapper: places sprite6 at depth 1 with
 *     a scale matrix. shoot's PlaceObject2_6_1 onClipEvent(load) scales it by
 *     `t = 50 + 20 * level`.
 *   - move (DefineSprite_8_move) — container: frame_1 sets up onEnterFrame that
 *     continuously attaches fumee smoke puffs at the projectile's current position.
 *     Has a PlaceObject2_4_1 child with onClipEvent(load/enterFrame) for wobble.
 *
 * Main timeline: SOMA.playSound("poison") + stop() (inferred from displayType=30
 * ballistic pattern; no explicit sound script in manifest but follows convention).
 *
 * Hit signal: fired automatically by the harness on landing (displayType=30).
 * Complete signal: fired from sprite6's frame_64 script (_parent.removeMovieClip).
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

const FUMEE_BOUNDS = {
  width: 28.7,
  height: 28.7,
  offsetX: -14.35,
  offsetY: -14.35,
};

const SPRITE6_BOUNDS = {
  width: 58.5,
  height: 61.45,
  offsetX: -48.9,
  offsetY: -44.8,
};

export class Spell902 extends RuntimeSpell {
  readonly spellId = 902;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private fumeeSym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);

    // ---- lib_fumee — smoke puff particle -------------------------
    // AS: DefineSprite_13_fumee/frame_1/DoAction.as
    //   t = 50 * Math.random() + 50
    //   _xscale = t; _yscale = t
    //   _rotation = random(360)
    //   vx /= 1 + 3 * Math.random()
    //   vy /= 3
    //   onEnterFrame: _X += vx; _Y += vy; vx /= 3; vy /= 3
    // AS: DefineSprite_13_fumee/frame_49/DoAction.as
    //   this.removeMovieClip()
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13_fumee/frame_1/DoAction.as
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            // vx and vy are seeded by the parent before attaching this clip.
            // Divide them per canonical frame_1.
            const vx = (clip.vars.vx as number) ?? 0;
            const vy = (clip.vars.vy as number) ?? 0;
            clip.vars.vx = vx / (1 + 3 * Math.random());
            clip.vars.vy = vy / 3;
          },
        ],
        [
          48,
          (clip) => {
            // AS: DefineSprite_13_fumee/frame_49/DoAction.as
            clip.remove();
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_13_fumee/frame_1/DoAction.as — onEnterFrame closure
        // _X = _X + vx; _Y = _Y + vy; vx /= 3; vy /= 3
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / 3;
        clip.vars.vy = vy / 3;
      },
    };

    // ---- sprite6 — impact smoke burst (directlyDynamic=true) -----
    // This is the sprite placed inside DefineSprite_7_shoot at depth 1.
    // AS: DefineSprite_6/frame_1/DoAction.as
    //   p = 0; while (p < 7) { attachMovie("fumee","fumee"+c,c); set vx/vy; c++; p++ }
    // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load):
    //   a = 15
    // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame):
    //   _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.1
    // AS: DefineSprite_6/frame_64/DoAction.as
    //   this._parent.removeMovieClip()
    //
    // The PlaceObject2_4_2 child is an authored placed clip inside sprite6's
    // timeline (an inner wobble spiral). We model it as a child attached
    // in sprite6's frame_1 with its own onLoad/onEnterFrame.
    // Since the inner child's identity is not a named library symbol but an
    // authored placed instance, we inline it as a sub-SymbolDefinition.
    const innerWobbleSym: SymbolDefinition = {
      name: "innerWobble6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 15;
        clip.vars.i = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.1
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 3.1415;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.1;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 66,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // p = 0; while(p < 7) { attachMovie("fumee","fumee"+c,c); set vx/vy; c++; p++ }
            // `c` is a clip-level counter; initialize on first frame if not set.
            if (clip.vars.c === undefined) {
              clip.vars.c = 0;
            }
            let c = clip.vars.c as number;
            for (let p = 0; p < 7; p++) {
              const child = clip.attach(this.fumeeSym, `fumee${c}`, c, ctx);
              child.vars.vx = 180 * (Math.random() - 0.5);
              child.vars.vy = 180 * (Math.random() - 0.5);
              c++;
            }
            clip.vars.c = c;

            // Also attach the inner wobble clip (PlaceObject2_4_2)
            clip.attach(innerWobbleSym, "innerWobble", 2, ctx);
          },
        ],
        [
          63,
          (clip) => {
            // AS: DefineSprite_6/frame_64/DoAction.as
            // this._parent.removeMovieClip()
            // sprite6's parent is `shoot`; shoot's parent is root.
            // _parent.removeMovieClip() kills shoot, completing the spell.
            const shootClip = clip.parent;
            if (shootClip) {
              shootClip.remove();
            }
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- shoot — wrapper container for sprite6 -------------------
    // AS: DefineSprite_7_shoot
    // Placement: sprite6 at depth 1, matrix {scaleX:0.9817, scaleY:0.9817,
    //   translateX:5.05, translateY:0.65} per manifest placements[].
    // AS: DefineSprite_7_shoot/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load):
    //   t = 50 + 20 * _parent._parent.level
    //   _xscale = t; _yscale = t
    // _parent._parent.level from shoot's child → shoot → root
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 66,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach sprite6 at depth 1 with the canonical placement matrix.
            // AS: DefineSprite_7_shoot/frame_1/PlaceObject2_6_1
            // matrix: scaleX=0.9817, scaleY=0.9817, translateX=5.05, translateY=0.65
            const child = clip.attach(this.sprite6Sym, "sprite6inst", 1, ctx, {
              x: 5.05,
              y: 0.65,
            });
            child.scaleX = 0.981719970703125;
            child.scaleY = 0.981719970703125;

            // AS: DefineSprite_7_shoot/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
            // t = 50 + 20 * _parent._parent.level
            // _xscale = t; _yscale = t
            // _parent._parent from sprite6inst → shoot → root
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const t = 50 + 20 * level;
            child.scaleX = (t / 100) * 0.981719970703125;
            child.scaleY = (t / 100) * 0.981719970703125;
          },
        ],
      ]),
    };

    // ---- move — ballistic projectile container -------------------
    // AS: DefineSprite_8_move
    // frame_1/DoAction.as: sets up an onEnterFrame that continuously
    // attaches fumee smoke at the projectile's current position.
    // frame_1/PlaceObject2_4_1 has a child clip with wobble handlers.
    const innerMoveSym: SymbolDefinition = {
      name: "innerMove8",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_8_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as
        // a = 20; t = 10 + 3 * _parent._parent.level; _xscale = t; _yscale = t
        // _parent._parent from innerMove → move → root
        const moveClip = clip.parent;
        const root = moveClip?.parent;
        const level = (root?.vars.level as number) ?? 1;
        clip.vars.a = 20;
        clip.vars.i = 0;
        const t = 10 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_8_move/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = 90 + a * MAth.cos(i += 1); a /= 1.3
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 1;
        clip.rotation = ((90 + a * Math.cos(i)) * Math.PI) / 180;
        a /= 1.3;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

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
            // AS: DefineSprite_8_move/frame_1/DoAction.as
            // xi = this._x; yi = this._y; nf = 1; c = 0;
            // this.onEnterFrame: attach fumee at current position each frame
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 1;
            clip.vars.c = 0;

            // Attach the inner wobble child (PlaceObject2_4_1)
            clip.attach(innerMoveSym, "innerMove", 1, ctx);
          },
        ],
      ]),
      onEnterFrame: (clip, ctx) => {
        // AS: DefineSprite_8_move/frame_1/DoAction.as — this.onEnterFrame closure
        // while(_loc2_ < nf) { attachMovie("fumee","fumee"+c, c+10); set pos; c++ }
        const nf = (clip.vars.nf as number) ?? 1;
        let c = (clip.vars.c as number) ?? 0;
        // Attach fumee on the parent (the outer mc / root), not on move itself.
        const parent = clip.parent;
        if (parent) {
          for (let loc2 = 0; loc2 < nf; loc2++) {
            const fumeeChild = parent.attach(
              this.fumeeSym,
              `fumee${c}`,
              c + 10,
              ctx
            );
            // Position at move's current location with small scatter.
            fumeeChild.x = clip.x + 15 * (Math.random() - 0.5);
            fumeeChild.y = clip.y + 15 * (Math.random() - 0.5);
            // fumee frame_1 expects vx/vy pre-seeded. For trail particles
            // seeded from move's position, canonical vx/vy = 0 (no velocity
            // set by the caller here — only position is set).
            fumeeChild.vars.vx = 0;
            fumeeChild.vars.vy = 0;
            c++;
          }
        }
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
        clip.vars.c = c;
      },
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(shootSym);
    this.registry.register(moveSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Main timeline: stop() — no explicit sound in manifest scripts.
    // displayType=30 harness attaches move automatically; shoot is
    // attached by the harness at landing.
  }
}
