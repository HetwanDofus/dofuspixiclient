/**
 * Spell 2018 — (Projectile Ballistic spell with smoke particles).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2018/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Has both `move` (6-frame animated
 * projectile) and `shoot` (108-frame container) symbols. The harness drives
 * `move` along a parabolic arc to the target, then attaches `shoot` at impact
 * and fires signalHit automatically.
 *
 * Library symbols:
 *   - lib_fumee2 — 57-frame smoke puff particle. frame_1 seeds t (scale),
 *     vx, vy, vr, yi (ground level), fin=0, a=0; installs onEnterFrame for
 *     physics (drift, gravity, settle on ground, fade out). frame_55 removes
 *     itself.
 *
 * Harness symbols (container-only):
 *   - move  — 6-frame animated projectile (actual frames from animations[]).
 *             No frameScripts needed; harness drives its arc motion.
 *   - shoot — 108-frame container. frame_1 spawns 7 fumee2 smoke puffs on
 *             _parent (the outer mc / root). frame_106 calls
 *             _parent.removeMovieClip() → runtime.complete().
 *
 * Main timeline: no sound in the canonical scripts (no SOMA.playSound call
 * found in the provided AS). Harness attaches move; on landing attaches shoot.
 *
 * NOTE on shoot frame_1 AS logic:
 *   The loop runs `while (p < 7)` attaching fumee2 to `_parent` (the outer
 *   mc, i.e. root in our runtime). Each fumee2 is placed at shoot's current
 *   _x/_y. `f.vx = this._x - xi + 5*(Math.random()-0.5)` where xi starts
 *   as this._x and is then updated to this._x each iteration, so xi == this._x
 *   every iteration meaning `this._x - xi` is always 0. Thus vx reduces to
 *   `5*(Math.random()-0.5)` for all 7 particles. vy is seeded as
 *   `-5*Math.random()` (upward). The fumee2 frame_1 script then re-reads
 *   these from the instance vars (set by the attaching code as f.vx / f.vy)
 *   and doubles vy: `vy *= 2`.
 *
 * NOTE on fumee2 onEnterFrame (defined inline in frame_1):
 *   Uses Flash-style inline `this.onEnterFrame = function(){}` — ported as
 *   the symbol's `onEnterFrame` handler. The `pain.pain.vr` reference in the
 *   original AS is a sub-clip of fumee2 that doesn't exist in our asset (no
 *   `pain` child registered), so we silently skip it.
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

const FUMEE2_BOUNDS = {
  width: 3.6,
  height: 3.6,
  offsetX: -1.6,
  offsetY: -2.05,
};

const MOVE_BOUNDS = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

export class Spell2018 extends RuntimeSpell {
  readonly spellId = 2018;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- lib_fumee2 — smoke puff particle ----------------------------------------
    // Canonical: DefineSprite_7_fumee2/frame_1/DoAction.as (onLoad init)
    //            DefineSprite_7_fumee2/frame_1/DoAction.as (inline onEnterFrame)
    //            DefineSprite_7_fumee2/frame_55/DoAction.as (remove self)
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 57,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_fumee2/frame_1/DoAction.as
        // t = 50 * Math.random() + 50;
        // stop();
        // _xscale = t; _yscale = t;
        // vx = vx;  (vx was set by the spawner before onLoad runs — keep it)
        // vt = 2;
        // vy *= 2;  (vy was set by the spawner)
        // yi = _Y - 5 + 10 * Math.random();
        // vr = 30 * Math.random() - 0.5;
        // fin = 0;
        // a = 0;
        const t = 50 * Math.random() + 50;
        clip.vars.t = t;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.stop();
        // vx is already set on clip.vars by the spawner (f.vx = ...)
        const vx = (clip.vars.vx as number | undefined) ?? 0;
        clip.vars.vx = vx;
        clip.vars.vt = 2;
        // vy was set by spawner as -5*Math.random(), frame_1 doubles it
        const vy = (clip.vars.vy as number | undefined) ?? 0;
        clip.vars.vy = vy * 2;
        clip.vars.yi = clip.y - 5 + 10 * Math.random();
        clip.vars.vr = 30 * Math.random() - 0.5;
        clip.vars.fin = 0;
        clip.vars.a = 0;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_fumee2/frame_1/DoAction.as — inline onEnterFrame
        // if (fin == 1) {
        //   _alpha = 150 - (a += 3.3);
        //   _xscale = t * vt * 2;
        //   _yscale = t * vt;
        //   vt -= (vt - 3) / 1.5;
        // }
        // _X += vx; _Y += vy; _rotation += vr;
        // if (_Y > yi) { settle + play + fin=1 }
        // vy += 0.5;
        let fin = clip.vars.fin as number;
        let a = clip.vars.a as number;
        let vt = clip.vars.vt as number;
        const t = clip.vars.t as number;
        const vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        let vr = clip.vars.vr as number;
        const yi = clip.vars.yi as number;

        if (fin === 1) {
          a += 3.3;
          // AS: _alpha = 150 - a  (Flash 0-100 scale, but 150 base means it
          // starts fully opaque and fades. We clamp to [0,1] for Pixi.)
          clip.alpha = Math.max(0, Math.min(1, (150 - a) / 100));
          clip.scaleX = (t * vt * 2) / 100;
          clip.scaleY = (t * vt) / 100;
          vt -= (vt - 3) / 1.5;
          clip.vars.vt = vt;
          clip.vars.a = a;
        }

        clip.x += vx;
        clip.y += vy;
        // AS _rotation in degrees → radians delta
        clip.rotation += (vr * Math.PI) / 180;

        if (clip.y > yi) {
          vy = 0;
          clip.y = yi;
          clip.rotation = 0;
          vr = 0;
          // AS: pain.pain.vr = 0; pain.pain.i = 0.8; — skip (sub-clip not present)
          clip.vars.vx = 0;
          clip.play();
          fin = 1;
          clip.vars.fin = fin;
          clip.vars.vr = vr;
        }

        vy += 0.5;
        clip.vars.vy = vy;
        clip.vars.vr = vr;
      },
      frameScripts: new Map([
        [
          54,
          (clip) => {
            // AS DefineSprite_7_fumee2/frame_55/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — 6-frame animated projectile --------------------------------------
    // `move` lives in animations[] (not librarySymbols[]), uses real frame textures.
    // The harness attaches it and drives arc motion. No additional frame scripts.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 6,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
    };

    // ---- shoot — 108-frame container ---------------------------------------------
    // animations[] entry (width=0, height=0 → container-only, frames: []).
    // frame_1 (index 0): spawn 7 fumee2 particles on _parent (root).
    // frame_106 (index 105): _parent.removeMovieClip() → runtime.complete().
    // signalHit is fired automatically by the harness at landing (displayType 30).
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 108,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_1_shoot/frame_1/DoAction.as
            // _rotation = 0;
            // xi = this._x; yi = this._y; c = 0;
            // while (p < 7) { attach fumee2 to _parent at shoot's position }
            clip.rotation = 0;
            const xi = clip.x;
            const yi = clip.y;
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            let c = 0;
            for (let p = 0; p < 7; p++) {
              const instanceName = `fumee2${c}200`;
              const f = parent.attach(this.fumee2Sym, instanceName, c + 200, ctx);
              // AS: f._x = this._x; f._y = this._y;
              f.x = clip.x;
              f.y = clip.y;
              // AS: f.vx = this._x - xi + 5*(Math.random()-0.5)
              // xi is always reset to this._x at end of loop, so this._x - xi == 0
              f.vars.vx = (clip.x - xi) + 5 * (Math.random() - 0.5);
              // AS: f.vy = -5 * Math.random()
              f.vars.vy = -5 * Math.random();
              // xi = this._x; yi = this._y; (xi/yi track previous position,
              // but since they're set to clip.x/clip.y each iteration they
              // are always equal to clip.x/clip.y on the next read)
              c++;
            }
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_1_shoot/frame_106/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumee2Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _ctx: SpellContext,
  ): void {
    // No SOMA.playSound call found in the canonical AS scripts for spell 2018.
  }
}
