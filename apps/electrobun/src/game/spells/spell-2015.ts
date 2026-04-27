/**
 * Spell 2015 — (Projectile Ballistic with smoke trails).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2015/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Detection rationale:
 *   - manifest has a `move` symbol (DefineSprite_4_move) and a `shoot`
 *     symbol (DefineSprite_1_shoot) — the canonical ballistic signature.
 *   - `move/frame_1` spawns "fumee" smoke particles continuously as it
 *     travels, driven by an onEnterFrame on the move clip itself.
 *   - `shoot/frame_1` resets `_rotation = 0` (canonical ballistic override),
 *     then spawns a burst of "fumee2" explosion particles.
 *   - `shoot/frame_73` calls `_parent.removeMovieClip()` → spell complete.
 *   - The harness drives the parabolic arc, lands move → attaches shoot,
 *     and fires signalHit automatically. We must NOT call signalHit ourselves.
 *
 * Library symbols:
 *   - lib_fumee2  — 66-frame smoke puff (explosion variant). frame_1 seeds
 *                   physics (scale, vy*2, bounce yi). frame_64 removes self.
 *                   Used by shoot/frame_1 (the impact burst).
 *   - lib_fumee   — 48-frame smoke puff (trail variant). frame_1 seeds
 *                   physics (scale, vx/vy division). frame_46 removes self.
 *                   Used by move's onEnterFrame (the travel trail).
 *
 * Container symbols:
 *   - move (DefineSprite_4_move) — empty container, 1 frame. frame_1
 *     seeds xi/yi/nf/c and installs onEnterFrame that continuously spawns
 *     "fumee" trail particles at its current position. Also has two authored
 *     rotating children (depths 2 and 4) that spin +50 deg/frame.
 *   - shoot (DefineSprite_1_shoot) — empty container, 75 frames. frame_1
 *     resets rotation to 0, spawns 5 "fumee2" explosion particles.
 *     frame_73 removes parent → complete.
 *
 * Main timeline: no SOMA.playSound found in decompiled scripts.
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
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};

const FUMEE_BOUNDS = {
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
    _context: SpellContext,
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);

    // ---- lib_fumee2 — explosion smoke puff (impact burst) --------
    // AS: DefineSprite_9_fumee2/frame_1/DoAction.as
    //     DefineSprite_9_fumee2/frame_64/DoAction.as
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 66,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_9_fumee2/frame_1/DoAction.as
            const t = 20 * Math.random() + 80;
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // vx stays as set by caller; vy is doubled
            const vx = (clip.vars.vx as number | undefined) ?? 0;
            let vy = (clip.vars.vy as number | undefined) ?? 0;
            vy *= 2;
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            const yi = clip.y - 15 + 30 * Math.random();
            clip.vars.yi = yi;
            // AS: this.onEnterFrame = function() { ... }
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_9_fumee2/frame_1/DoAction.as — onEnterFrame
              const cvx = c.vars.vx as number;
              let cvy = c.vars.vy as number;
              const cyi = c.vars.yi as number;
              c.x += cvx;
              c.y += cvy;
              if (c.y > cyi) {
                cvy = -cvy / 2;
                c.vars.vx = (c.vars.vx as number) * 0.7;
                c.y = cyi;
              }
              cvy += 1.5;
              c.vars.vy = cvy;
            };
          },
        ],
        [
          64,
          (clip) => {
            // AS DefineSprite_9_fumee2/frame_64/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee — trail smoke puff (travel trail) -------------
    // AS: DefineSprite_10_fumee/frame_1/DoAction.as
    //     DefineSprite_10_fumee/frame_46/DoAction.as
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
            // AS DefineSprite_10_fumee/frame_1/DoAction.as
            const t = 50 * Math.random() + 50;
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            let vx = (clip.vars.vx as number | undefined) ?? 0;
            let vy = (clip.vars.vy as number | undefined) ?? 0;
            vx /= 3 + 3 * Math.random();
            vy /= 3 + Math.floor(Math.random() * 3);
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            // AS: this.onEnterFrame = function() { ... }
            clip.onEnterFrame = (c) => {
              // AS DefineSprite_10_fumee/frame_1/DoAction.as — onEnterFrame
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
          46,
          (clip) => {
            // AS DefineSprite_10_fumee/frame_46/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- _move_rotator — synthetic rotating child inside move ----
    // AS: DefineSprite_4_move/frame_1/PlaceObject2_3_4/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //     DefineSprite_4_move/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    // Both authored children spin +50 degrees per frame.
    const rotatingChildSym: SymbolDefinition = {
      name: "_move_rotator",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _rotation = _rotation + 50
        clip.rotation += (50 * Math.PI) / 180;
      },
    };
    this.registry.register(rotatingChildSym);

    // ---- move — 1-frame container, spawns fumee trail particles --
    // AS: DefineSprite_4_move/frame_1/DoAction.as
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
            // AS DefineSprite_4_move/frame_1/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 0.33;
            clip.vars.c = 0;

            // Attach the two authored rotating children (PlaceObject2_3_2 depth 2,
            // PlaceObject2_3_4 depth 4).
            clip.attach(rotatingChildSym, "_rotator2", 2, ctx);
            clip.attach(rotatingChildSym, "_rotator4", 4, ctx);

            // AS: this.onEnterFrame = function() { ... }
            clip.onEnterFrame = (c, ectx) => {
              // AS DefineSprite_4_move/frame_1/DoAction.as — onEnterFrame
              const nf = c.vars.nf as number;
              let counter = c.vars.c as number;
              const parentClip = c.parent;
              if (!parentClip) {
                return;
              }
              let loc3 = 0;
              while (loc3 < nf) {
                const instanceName = `fumee${counter}`;
                const child = parentClip.attach(
                  this.fumeeSym,
                  instanceName,
                  counter + 10,
                  ectx,
                );
                child.x = c.x;
                child.y = c.y;
                child.vars.vx =
                  c.x - (c.vars.xi as number) +
                  6.67 * (Math.random() - 0.5);
                child.vars.vy =
                  c.y - (c.vars.yi as number) +
                  6.67 * (Math.random() - 0.5);
                counter++;
                loc3 += 1;
              }
              c.vars.c = counter;
              c.vars.xi = c.x;
              c.vars.yi = c.y;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 75-frame container, spawns fumee2 on impact -----
    // AS: DefineSprite_1_shoot/frame_1/DoAction.as
    //     DefineSprite_1_shoot/frame_73/DoAction.as
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
            // AS DefineSprite_1_shoot/frame_1/DoAction.as
            // Override the harness-applied projectile-velocity rotation.
            clip.rotation = 0;
            const xi = clip.x;
            const yi = clip.y;
            let c = 0;
            let p = 0;
            while (p < 5) {
              const instanceName = `fumee2${c}200`;
              const parentClip = clip.parent;
              if (parentClip) {
                const f = parentClip.attach(
                  this.fumee2Sym,
                  instanceName,
                  c + 200,
                  ctx,
                );
                f.x = clip.x;
                f.y = clip.y;
                // AS: f.vx = this._x - xi + 5 * (Math.random() - 0.5)
                // xi == clip.x on entry so delta is 0 on the first (and only)
                // set of iterations — matches canonical behaviour.
                f.vars.vx = clip.x - xi + 5 * (Math.random() - 0.5);
                f.vars.vy = -7 * Math.random();
              }
              c++;
              p++;
            }
          },
        ],
        [
          73,
          (clip) => {
            // AS DefineSprite_1_shoot/frame_73/DoAction.as
            // _parent.removeMovieClip() — kill the whole spell.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumee2Sym);
    this.registry.register(this.fumeeSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // No SOMA.playSound found in the decompiled main timeline scripts.
    // The harness handles all child attaches for displayType=30.
  }
}
