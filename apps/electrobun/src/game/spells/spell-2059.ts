/**
 * Spell 2059 — Projectile spell (smoke trail + impact puffs).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2059/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). Detection rationale:
 *   - Has a `move` symbol (DefineSprite_6_move) — a projectile that spawns `fumee`
 *     trail particles along its path via onEnterFrame.
 *   - Has a `shoot` symbol (DefineSprite_3_shoot) — 75-frame impact clip; frame_1
 *     resets _rotation=0 (canonical ProjectileLinear shoot override), spawns 7
 *     `fumee2` smoke puffs at _parent; frame_73 calls _parent.removeMovieClip().
 *   - No parabolic arc / gravity math → NOT ballistic (30/31).
 *   - No `duplicate` symbol → NOT beam (40/41).
 *   - No dual-timeline cellFrom/cellTo positioning → NOT WorldAbsolute (50/51).
 *   - Shoot resets _rotation=0 on frame_1 → canonical ProjectileLinear pattern.
 *   → displayType=20 (ProjectileLinear).
 *
 * Library symbols (from manifest.json librarySymbols[]):
 *   - lib_fumee2 (51 frames) — impact smoke puff. Spawned by shoot/frame_1 at
 *     the impact point (_parent coords). frame_1: randomise scale (80-100%),
 *     gotoAndPlay(random(45)), vx*=2 / vy*=2, onEnterFrame drifts x/y and adds
 *     gravity (vy+=0.5). frame_49: removeMovieClip(this).
 *   - lib_fumee (48 frames) — flight trail wisp. Spawned by move's onEnterFrame
 *     along the trajectory. frame_1: randomise scale (50-100%),
 *     gotoAndPlay(random(30)), dampen vx/(3+3r) and vy/(3+random(3)),
 *     onEnterFrame drifts with friction (vx/=1.2, vy/=1.2). frame_46:
 *     removeMovieClip(this).
 *
 * Container-only symbols:
 *   - move  — no authored textures. frame_1 seeds xi/yi, nf=2, starts onEnterFrame
 *             that spawns 2 fumee wisps per tick at the projectile's current position.
 *             The harness drives the container linearly toward the target.
 *   - shoot — no authored textures. 75 frames. frame_1 resets rotation=0, spawns
 *             7 fumee2 puffs on _parent. frame_73: _parent.removeMovieClip() →
 *             runtime.complete().
 *
 * Main timeline: no SOMA.playSound in provided scripts; onSpellStart is a no-op.
 * signalHit: fired from shoot/frame_1 (displayType 20 — harness does NOT signal hit).
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

export class Spell2059 extends RuntimeSpell {
  readonly spellId = 2059;
  readonly displayType = SpellDisplayType.ProjectileLinear;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);

    // ---- lib_fumee2 — impact smoke puff (51 frames) ----------------
    // AS: DefineSprite_11_fumee2/frame_1/DoAction.as
    //     DefineSprite_11_fumee2/frame_49/DoAction.as
    const fumee2Sym: SymbolDefinition = {
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
            // onEnterFrame: _X += vx; _Y += vy; vy += 0.5;
            const t = 20 * Math.random() + 80;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.vars.vx = (clip.vars.vx as number) * 2;
            clip.vars.vy = (clip.vars.vy as number) * 2;
            // gotoAndPlay(random(45)) — AS 1-based, random(45) gives 0-44,
            // so gotoAndPlay(0..44) → gotoAndPlay(N-1) in runtime means
            // we pass the 0-based index directly since random(45) is already
            // 0-based (0 to 44). gotoAndPlay(0) in AS = frame 1 = index 0.
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
            clip.onEnterFrame = (self) => {
              // AS DefineSprite_11_fumee2/frame_1/DoAction.as — onEnterFrame closure
              const vx = self.vars.vx as number;
              const vy = self.vars.vy as number;
              self.x += vx;
              self.y += vy;
              self.vars.vy = vy + 0.5;
            };
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

    // ---- lib_fumee — flight trail wisp (48 frames) -----------------
    // AS: DefineSprite_13_fumee/frame_1/DoAction.as
    //     DefineSprite_13_fumee/frame_46/DoAction.as
    const fumeeSym: SymbolDefinition = {
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
            // vx /= 3 + 3 * Math.random(); vy /= 3 + random(3);
            // onEnterFrame: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
            const t = 50 * Math.random() + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            clip.vars.vx =
              (clip.vars.vx as number) / (3 + 3 * Math.random());
            clip.vars.vy =
              (clip.vars.vy as number) / (3 + Math.floor(Math.random() * 3));
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            clip.onEnterFrame = (self) => {
              // AS DefineSprite_13_fumee/frame_1/DoAction.as — onEnterFrame closure
              const vx = self.vars.vx as number;
              const vy = self.vars.vy as number;
              self.x += vx;
              self.y += vy;
              self.vars.vx = vx / 1.2;
              self.vars.vy = vy / 1.2;
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

    // ---- move — projectile container (no authored textures) ---------
    // AS: DefineSprite_6_move/frame_1/DoAction.as
    // frame_1 seeds xi/yi at current position, nf=2, starts onEnterFrame that
    // spawns 2 fumee wisps per tick at move's current position with
    // delta-velocity relative to the previous position.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_6_move/frame_1/DoAction.as
            // xi = this._x; yi = this._y; nf = 2; c = 0;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 2;
            clip.vars.c = 0;
            clip.onEnterFrame = (self) => {
              // AS DefineSprite_6_move/frame_1/DoAction.as — onEnterFrame closure
              // while(_loc3_ < nf) { attachMovie("fumee","fumee"+c, c+5); ... }
              const nf = self.vars.nf as number;
              let c = self.vars.c as number;
              const xi = self.vars.xi as number;
              const yi = self.vars.yi as number;
              const parent = self.parent;
              if (!parent) {
                return;
              }
              for (let loc3 = 0; loc3 < nf; loc3++) {
                const instanceName = `fumee${c}`;
                parent.attach(fumeeSym, instanceName, c + 5, ctx);
                const loc2 = parent.children.get(instanceName);
                if (loc2) {
                  loc2.x = self.x;
                  loc2.y = self.y;
                  loc2.vars.vx = self.x - xi + 10 * (Math.random() - 0.5);
                  loc2.vars.vy = self.y - yi + 10 * (Math.random() - 0.5);
                }
                c++;
              }
              self.vars.c = c;
              self.vars.xi = self.x;
              self.vars.yi = self.y;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 75-frame impact container (no authored textures) ---
    // AS: DefineSprite_3_shoot/frame_1/DoAction.as
    //     DefineSprite_3_shoot/frame_73/DoAction.as
    //
    // frame_1: _rotation=0 (canonical ProjectileLinear reset), seed xi/yi,
    //          spawn 7 fumee2 particles attached to _parent at shoot's position.
    //          AS: "fumee2" + c + 200 — in AS string+int+int, the + associates
    //          left-to-right: ("fumee2" + c) + 200 gives e.g. "fumee20200",
    //          "fumee21200", ... (c starts at 0, depth = c+200 = 200,201,...).
    // frame_73: _parent.removeMovieClip() → complete.
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
            // xi = this._x; yi = this._y; c = 0; p = 0;
            // while(p < 7) {
            //   _parent.attachMovie("fumee2","fumee2"+c+200, c+200);
            //   f._x = this._x; f._y = this._y - 30;
            //   f.vx = this._x - xi + 5*(Math.random()-0.5);
            //   f.vy = -7 * Math.random();
            //   c++; xi=this._x; yi=this._y; p++;
            // }
            clip.rotation = 0;
            let xi = clip.x;
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            for (let c = 0; c < 7; c++) {
              // AS string concat: "fumee2" + c + 200 = "fumee2" + (c as string) + "200"
              // e.g. c=0 → "fumee20200", c=1 → "fumee21200", depth = c+200
              const instanceName = `fumee2${c}200`;
              parent.attach(fumee2Sym, instanceName, c + 200, ctx);
              const f = parent.children.get(instanceName);
              if (f) {
                f.x = clip.x;
                f.y = clip.y - 30;
                f.vars.vx = clip.x - xi + 5 * (Math.random() - 0.5);
                f.vars.vy = -7 * Math.random();
              }
              xi = clip.x;
            }
            // displayType=20 (ProjectileLinear) — harness does NOT call signalHit.
            // Signal hit at impact frame (shoot/frame_1).
            this.runtime.signalHit();
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

    this.registry.register(fumee2Sym);
    this.registry.register(fumeeSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No SOMA.playSound found in the canonical main-timeline scripts.
    // The harness (displayType=20 ProjectileLinear) attaches `move` and
    // `shoot` automatically — no explicit child attaches needed here.
  }
}
