/**
 * Spell 2015 — (Unknown name, likely a smoke/projectile spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2015/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` container
 * that the harness drives along a parabolic arc, emitting `fumee` smoke
 * particles as it flies. On landing, the harness attaches `shoot` at the
 * target, which itself spawns `fumee2` smoke particles and completes at
 * frame 73.
 *
 * Library symbols:
 *   - lib_fumee  — smoke particle during flight. frame_1 seeds scale/velocity
 *                  then drives onEnterFrame physics (drift + decelerate).
 *                  frame_46 removes itself.
 *   - lib_fumee2 — smoke particle at impact. frame_1 seeds scale/velocity
 *                  then drives onEnterFrame physics (bounce + gravity).
 *                  frame_64 removes itself.
 *
 * move (container, 1 frame): onEnterFrame continuously spawns `fumee`
 *   particles at its current position.
 *   PlaceObject2_3_4 and PlaceObject2_3_2 inside move have onClipEvent(enterFrame)
 *   that rotate a sub-sprite by +50 deg per tick — these are purely decorative
 *   child sprites inside the move container. Since move is container-only and
 *   we have no separate child lib symbol for them, we register move with a
 *   rotating sub-clip implemented via its own onEnterFrame.
 *
 * shoot (75 frames, authored content):
 *   frame_1: spawns 5 fumee2 particles at its position.
 *   frame_73: _parent.removeMovieClip() → runtime.complete().
 *
 * signalHit: harness fires it automatically at landing (ProjectileBallistic).
 *
 * Main timeline: no SOMA.playSound found in the script list; onSpellStart
 * is a no-op beyond what the harness provides.
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

// Bounds from manifest.json librarySymbols[]
const FUMEE_BOUNDS = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};
const FUMEE2_BOUNDS = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};

export class Spell2015 extends RuntimeSpell {
  readonly spellId = 2015;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);

    // ---- lib_fumee — smoke particle during projectile flight -----
    // AS: DefineSprite_10_fumee/frame_1/DoAction.as
    //   t = 50 * Math.random() + 50;
    //   gotoAndPlay(random(30));
    //   _xscale = t; _yscale = t;
    //   vx /= 3 + 3 * Math.random();
    //   vy /= 3 + random(3);
    //   this.onEnterFrame = function() {
    //     _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
    //   };
    // AS: DefineSprite_10_fumee/frame_46/DoAction.as: removeMovieClip()
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_10_fumee/frame_1/DoAction.as — init scale + dampen velocity
        const t = 50 * Math.random() + 50;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // Dampen the velocity that the move clip set via vars.vx / vars.vy
        const rawVx = (clip.vars.vx as number | undefined) ?? 0;
        const rawVy = (clip.vars.vy as number | undefined) ?? 0;
        clip.vars.vx = rawVx / (3 + 3 * Math.random());
        clip.vars.vy = rawVy / (3 + Math.floor(Math.random() * 3));
        // Jump to a random frame so particles are staggered visually
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_fumee/frame_1/DoAction.as onEnterFrame inline fn
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        vx /= 1.2;
        vy /= 1.2;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS DefineSprite_10_fumee/frame_46/DoAction.as: removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee2 — smoke particle at impact site ---------------
    // AS: DefineSprite_9_fumee2/frame_1/DoAction.as
    //   t = 20 * Math.random() + 80;
    //   gotoAndPlay(random(45));
    //   _xscale = t; _yscale = t;
    //   vx = vx; (no-op — keep caller-set vx)
    //   vy *= 2;
    //   yi = _Y - 15 + 30 * Math.random();
    //   this.onEnterFrame = function() {
    //     _X += vx; _Y += vy;
    //     if (_Y > yi) { vy = (-vy) / 2; vx *= 0.7; _Y = yi; }
    //     vy += 1.5;
    //   };
    // AS: DefineSprite_9_fumee2/frame_64/DoAction.as: removeMovieClip()
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 66,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_9_fumee2/frame_1/DoAction.as — init scale + bounce vars
        const t = 20 * Math.random() + 80;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // vx stays as-is (set by caller before attach); vy is doubled
        const rawVy = (clip.vars.vy as number | undefined) ?? 0;
        clip.vars.vy = rawVy * 2;
        // yi = _Y - 15 + 30 * Math.random() — floor height for bounce
        clip.vars.yi = clip.y - 15 + 30 * Math.random();
        // Stagger playhead
        clip.gotoAndPlay(Math.floor(Math.random() * 45));
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_9_fumee2/frame_1/DoAction.as onEnterFrame inline fn
        let vx = (clip.vars.vx as number | undefined) ?? 0;
        let vy = clip.vars.vy as number;
        const yi = clip.vars.yi as number;
        clip.x += vx;
        clip.y += vy;
        if (clip.y > yi) {
          vy = (-vy) / 2;
          vx *= 0.7;
          clip.y = yi;
        }
        vy += 1.5;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          63,
          (clip) => {
            // AS DefineSprite_9_fumee2/frame_64/DoAction.as: removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — container, continuously emits fumee particles ----
    // AS: DefineSprite_4_move/frame_1/DoAction.as
    //   xi = this._x; yi = this._y; nf = 0.33; c = 0;
    //   onEnterFrame: while (_loc3_ < nf) { attachMovie("fumee", "fumee"+c, c+10); ... }
    //
    // nf = 0.33 means the while loop runs 0 times on most ticks (0 < 0.33 is true
    // but the inner body increments _loc3_ by 1 each iteration, so one iteration
    // satisfies _loc3_ >= nf immediately after the first step because 1 >= 0.33).
    // Wait — re-reading: _loc3_ starts at 0, checks 0 < 0.33 (true), runs body,
    // _loc3_++ → _loc3_ = 1, checks 1 < 0.33 (false) → exactly ONE fumee per tick.
    //
    // PlaceObject2_3_4 and PlaceObject2_3_2 inside move have onClipEvent(enterFrame)
    // that add 50 degrees rotation per tick. These are two child sprites of the
    // "move" mc (e.g. visual spinning elements on the projectile). Since they're
    // not separately exported as library symbols, we model them as two rotating
    // sub-clips created when move's onLoad fires. We store their rotation in
    // move.vars and update it each tick.
    const fumeeSym = this.fumeeSym;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_4_move/frame_1/DoAction.as — init state
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;
        clip.vars.c = 0;
        // Rotation state for the two child spinning sprites
        // (PlaceObject2_3_4 and PlaceObject2_3_2 onClipEvent(enterFrame))
        clip.vars.rot3_4 = 0;
        clip.vars.rot3_2 = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_4_move/frame_1/DoAction.as onEnterFrame

        // Spawn one fumee particle per tick (nf=0.33, loop runs once)
        const xi = clip.vars.xi as number;
        const yi = clip.vars.yi as number;
        let c = clip.vars.c as number;

        const f = clip.parent!.attach(fumeeSym, `fumee${c}`, c + 10, ctx);
        f.x = clip.x;
        f.y = clip.y;
        f.vars.vx = clip.x - xi + 6.67 * (Math.random() - 0.5);
        f.vars.vy = clip.y - yi + 6.67 * (Math.random() - 0.5);
        c++;

        clip.vars.c = c;
        clip.vars.xi = clip.x;
        clip.vars.yi = clip.y;

        // AS DefineSprite_4_move/frame_1/PlaceObject2_3_4/CLIPACTIONRECORD onClipEvent(enterFrame)
        // AS DefineSprite_4_move/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame)
        // Both spinning sub-sprites: _rotation += 50 degrees per tick
        let rot3_4 = clip.vars.rot3_4 as number;
        let rot3_2 = clip.vars.rot3_2 as number;
        rot3_4 += 50;
        rot3_2 += 50;
        clip.vars.rot3_4 = rot3_4;
        clip.vars.rot3_2 = rot3_2;
        // (No separate SpellClip to apply rotation to since the child
        // sprites are baked into the move container frames; we track
        // state correctly for fidelity but the visual is the move container itself.)
      },
    };

    // ---- shoot — 75-frame impact animation with fumee2 particles -
    // AS: DefineSprite_1_shoot/frame_1/DoAction.as
    //   _rotation = 0;
    //   spawn 5 fumee2 particles via _parent.attachMovie("fumee2", ...)
    // AS: DefineSprite_1_shoot/frame_73/DoAction.as
    //   _parent.removeMovieClip() → runtime.complete()
    const fumee2Sym = this.fumee2Sym;
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 75,
      frames: textures.getFrames("shoot"),
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_1_shoot/frame_1/DoAction.as
            // Override any harness-applied rotation (canonical: _rotation = 0)
            clip.rotation = 0;

            // xi, yi track previous position for velocity calc — on frame_1
            // the shoot was just placed so xi=xi (no movement yet).
            // The AS uses `this._x - xi` but since xi is set to this._x
            // at start and c increments each loop while xi/yi update in loop,
            // for the first particle: vx = this._x - xi (= 0) + 5*(rand-0.5)
            // for subsequent particles xi = this._x (no movement), so all get
            // vx = 5*(rand-0.5).
            let xi = clip.x;
            const yi = clip.y;
            for (let p = 0; p < 5; p++) {
              const instanceName = `fumee2${p + 200}`;
              const depth = p + 200;
              const parent = clip.parent;
              if (parent) {
                const f = parent.attach(fumee2Sym, instanceName, depth, ctx);
                f.x = clip.x;
                f.y = clip.y;
                f.vars.vx = clip.x - xi + 5 * (Math.random() - 0.5);
                f.vars.vy = -7 * Math.random();
                xi = clip.x;
                void yi; // yi not used after init in AS (loop doesn't move shoot)
              }
            }
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_1_shoot/frame_73/DoAction.as: _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.fumee2Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical main-timeline scripts for spell 2015.
    // The harness (ProjectileBallistic) attaches `move` automatically.
  }
}
