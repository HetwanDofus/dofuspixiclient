/**
 * Spell 905 — Flèche de Recul (Cra wind arrow / pushback arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/905/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). Indicators:
 *   - Has both `move` and `shoot` library symbols (the harness expects these).
 *   - `move` frame_1 onEnterFrame spawns `fumee` smoke trail particles as it
 *     flies, and a PlaceObject2 child (DefineSprite_31) spins a rotation widget.
 *   - `shoot` is a 96-frame container anchored at the target on landing:
 *     frame_1 spawns 3 `fumee2` impact puffs; frame_37 plays sound "jet_905";
 *     frame_40 spawns 9 more `fumee2` puffs; frame_94 calls
 *     `_parent.removeMovieClip()` → `complete()`.
 *   - The harness fires `signalHit()` automatically on landing for displayType 30
 *     — no manual call needed.
 *
 * Library symbols:
 *   - lib_fumee  — small smoke trail particle. frame_1 seeds random scale
 *                  [50–100]%, randomises playhead offset, divides inherited
 *                  vx/vy by a dampening factor, then onEnterFrame integrates
 *                  position with 1.067 friction. frame_46 removes self.
 *   - lib_fumee2 — larger impact smoke puff. frame_1 seeds scale [80–100]%,
 *                  randomises playhead, multiplies inherited vx/vy ×2, then
 *                  onEnterFrame integrates with 1.3 friction. frame_49 removes.
 *   - move       — container-only 1-frame symbol. frame_1 DoAction sets up
 *                  xi/yi tracking + onEnterFrame that spawns `fumee` particles
 *                  each tick. PlaceObject2_28_1 is a child widget that loads
 *                  with a scale proportional to level and wobbles its rotation
 *                  each frame via cosine decay.
 *   - shoot      — container-only 96-frame symbol. frame_1 resets rotation,
 *                  spawns 3 `fumee2`; frame_37 plays sound; frame_40 spawns
 *                  9 more `fumee2`; frame_94 kills parent + completes spell.
 *
 * Main timeline: no explicit SOMA.playSound on the outer frame_1 (the sound
 * is fired from inside shoot's frame_37 script). onSpellStart is a no-op
 * beyond what the harness sets up.
 *
 * NOTE: DefineSprite_34 and DefineSprite_31 both have a simple
 * `_rotation = random(360)` frame_1 script — these are the authored spinning
 * sub-children placed inside `move` and `shoot` by PlaceObject2 in the SWF.
 * They appear as the PlaceObject2_28_1 child inside move. We port this via
 * the move symbol's onLoad, which is where the CLIPACTIONRECORD onClipEvent(load)
 * fires, plus onEnterFrame for the wobble.
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
  width: 10.05,
  height: 11.75,
  offsetX: -4.15,
  offsetY: -5,
};

const FUMEE2_BOUNDS = {
  width: 13.75,
  height: 19.75,
  offsetX: -7.85,
  offsetY: -15.6,
};

export class Spell905 extends RuntimeSpell {
  readonly spellId = 905;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);

    // ---- lib_fumee — small smoke trail particle ------------------
    // Spawned by `move` onEnterFrame as the projectile flies.
    //
    // AS DefineSprite_36_fumee/frame_1/DoAction.as:
    //   t = 50 * Math.random() + 50;
    //   gotoAndPlay(random(30));
    //   _xscale = t; _yscale = t;
    //   vx /= 3 + 3 * Math.random();
    //   vy /= 9 + random(3);
    //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.067; vy /= 1.067;
    //
    // AS DefineSprite_36_fumee/frame_46/DoAction.as:
    //   this.removeMovieClip();
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
            // AS DefineSprite_36_fumee/frame_1/DoAction.as
            const t = 50 * Math.random() + 50;
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // vx and vy were set on the clip by the spawner before frame_1 fires.
            // At frame_1 (= frameScripts[0]) they are already on clip.vars.
            const vx = (clip.vars.vx as number) ?? 0;
            const vy = (clip.vars.vy as number) ?? 0;
            clip.vars.vx = vx / (3 + 3 * Math.random());
            clip.vars.vy = vy / (9 + Math.floor(Math.random() * 3));
            clip.onEnterFrame = (c) => {
              // AS onEnterFrame inside DefineSprite_36_fumee/frame_1/DoAction.as
              const cvx = c.vars.vx as number;
              const cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              c.vars.vx = cvx / 1.067;
              c.vars.vy = cvy / 1.067;
            };
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_36_fumee/frame_46/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee2 — larger impact smoke puff ------------------
    // Spawned by `shoot` at frames 1 and 40.
    //
    // AS DefineSprite_35_fumee2/frame_1/DoAction.as:
    //   t = 20 * Math.random() + 80;
    //   gotoAndPlay(random(45));
    //   _xscale = t; _yscale = t;
    //   vx *= 2; vy *= 2;
    //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.3; vy /= 1.3;
    //
    // AS DefineSprite_35_fumee2/frame_49/DoAction.as:
    //   this.removeMovieClip();
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
            // AS DefineSprite_35_fumee2/frame_1/DoAction.as
            const t = 20 * Math.random() + 80;
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const vx = (clip.vars.vx as number) ?? 0;
            const vy = (clip.vars.vy as number) ?? 0;
            clip.vars.vx = vx * 2;
            clip.vars.vy = vy * 2;
            clip.onEnterFrame = (c) => {
              // AS onEnterFrame inside DefineSprite_35_fumee2/frame_1/DoAction.as
              const cvx = c.vars.vx as number;
              const cvy = c.vars.vy as number;
              c.x += cvx;
              c.y += cvy;
              c.vars.vx = cvx / 1.3;
              c.vars.vy = cvy / 1.3;
            };
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_35_fumee2/frame_49/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — projectile container (1 frame) ------------------
    // The harness attaches `move` at root and drives it along the
    // parabolic arc. This symbol:
    //   - Has a PlaceObject2_28_1 child widget (DefineSprite_31) whose
    //     onClipEvent(load) sets scale from level and whose
    //     onClipEvent(enterFrame) wobbles rotation.
    //   - Has a frame_1 DoAction that sets up xi/yi tracking and an
    //     onEnterFrame that spawns `fumee` trail particles each tick.
    //
    // We model the PlaceObject2_28_1 widget via onLoad + onEnterFrame
    // on the move clip itself (since it is the only authored child).
    //
    // AS DefineSprite_29_move/frame_1/PlaceObject2_28_1/
    //    CLIPACTIONRECORD onClipEvent(load).as:
    //   a = 20; t = 10 + 3 * _parent._parent.level;
    //   _xscale = t; _yscale = t;
    //
    // AS DefineSprite_29_move/frame_1/PlaceObject2_28_1/
    //    CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = 90 + a * Math.cos(i += 1); a /= 1.3;
    //
    // AS DefineSprite_29_move/frame_1/DoAction.as:
    //   xi = this._x; yi = this._y;
    //   nf = this._parent.level * 0.5; c = 0;
    //   onEnterFrame: spawns nf `fumee` particles per tick, tracking xi/yi.
    const fumeeSym = this.fumeeSym;
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_29_move/frame_1/PlaceObject2_28_1/
        //    CLIPACTIONRECORD onClipEvent(load).as
        // _parent._parent.level — PlaceObject2's parent is `move`,
        // move's parent is root. We walk: clip → root.
        const root = clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        clip.vars.widgetA = 20;
        clip.vars.widgetI = 0;
        const t = 10 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_29_move/frame_1/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            clip.vars.nf = level * 0.5;
            clip.vars.c = 0;
            clip.onEnterFrame = (c, ectx) => {
              // AS onEnterFrame inside DefineSprite_29_move/frame_1/DoAction.as
              const nf = c.vars.nf as number;
              let counter = c.vars.c as number;
              const xi = c.vars.xi as number;
              const yi = c.vars.yi as number;

              // Widget wobble — mirrors PlaceObject2_28_1 onClipEvent(enterFrame)
              // AS: _rotation = 90 + a * Math.cos(i += 1); a /= 1.3;
              let widgetA = c.vars.widgetA as number;
              let widgetI = c.vars.widgetI as number;
              widgetI += 1;
              c.rotation =
                ((90 + widgetA * Math.cos(widgetI)) * Math.PI) / 180;
              widgetA /= 1.3;
              c.vars.widgetA = widgetA;
              c.vars.widgetI = widgetI;

              // Spawn fumee trail particles
              for (let loc3 = 0; loc3 < nf; loc3++) {
                const instName = `fumee${counter}`;
                const child = c.parent?.attach(
                  fumeeSym,
                  instName,
                  counter + 5,
                  ectx,
                );
                if (child) {
                  child.x = c.x;
                  child.y = c.y;
                  child.vars.vx = c.x - xi + 20 * (Math.random() - 0.5);
                  child.vars.vy = c.y - yi + 20 * (Math.random() - 0.5);
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

    // ---- shoot — 96-frame impact container ----------------------
    // The harness attaches `shoot` at the landing position when the
    // parabolic arc completes (displayType 30 → signalHit fired by
    // harness, not here).
    //
    // AS DefineSprite_25_shoot/frame_1/DoAction.as:
    //   _rotation = 0; xi = this._x; yi = this._y;
    //   nf = level * 2; c = 0;
    //   spawn 3 fumee2 particles at (this._x, this._y - 30)
    //   with vx/vy deltas from xi/yi.
    //
    // AS DefineSprite_25_shoot/frame_37/DoAction.as:
    //   SOMA.playSound("jet_905");
    //
    // AS DefineSprite_25_shoot/frame_40/DoAction.as:
    //   spawn 9 more fumee2 particles.
    //
    // AS DefineSprite_25_shoot/frame_94/DoAction.as:
    //   _parent.removeMovieClip();
    const fumee2Sym = this.fumee2Sym;
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 96,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 192.35,
        height: 158.45,
        offsetX: -87.85,
        offsetY: -114.75,
      }).x,
      anchorY: calculateAnchor({
        width: 192.35,
        height: 158.45,
        offsetX: -87.85,
        offsetY: -114.75,
      }).y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_25_shoot/frame_1/DoAction.as
            // Override any velocity-angle rotation the harness applied.
            clip.rotation = 0;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.c = 0;

            // Spawn 3 fumee2 impact puffs
            let counter = clip.vars.c as number;
            const xi = clip.vars.xi as number;
            const yi = clip.vars.yi as number;
            let curXi = xi;
            let curYi = yi;
            for (let p = 0; p < 3; p++) {
              const instName = `fumee2${counter}100`;
              const child = clip.parent?.attach(
                fumee2Sym,
                instName,
                counter + 100,
                ctx,
              );
              if (child) {
                child.x = clip.x;
                child.y = clip.y - 30;
                child.vars.vx =
                  clip.x - curXi + 20 * (Math.random() - 0.5);
                child.vars.vy =
                  clip.y - curYi + 20 * (Math.random() - 0.5);
              }
              counter++;
              curXi = clip.x;
              curYi = clip.y;
            }
            clip.vars.c = counter;
          },
        ],
        [
          36,
          () => {
            // AS DefineSprite_25_shoot/frame_37/DoAction.as
            // Sound is played from inside shoot — capture via stored callback.
            this.shootSoundCallback?.("jet_905");
          },
        ],
        [
          39,
          (clip, ctx) => {
            // AS DefineSprite_25_shoot/frame_40/DoAction.as
            // Spawn 9 more fumee2 particles.
            let counter = clip.vars.c as number;
            const xi = clip.vars.xi as number;
            const yi = clip.vars.yi as number;
            let curXi = xi;
            let curYi = yi;
            for (let p = 0; p < 9; p++) {
              const instName = `fumee2${counter}`;
              const child = clip.parent?.attach(
                fumee2Sym,
                instName,
                counter + 200,
                ctx,
              );
              if (child) {
                child.x = clip.x;
                child.y = clip.y - 30;
                child.vars.vx =
                  clip.x - curXi + 20 * (Math.random() - 0.5);
                child.vars.vy =
                  clip.y - curYi + 20 * (Math.random() - 0.5);
              }
              counter++;
              curXi = clip.x;
              curYi = clip.y;
            }
            clip.vars.c = counter;
          },
        ],
        [
          93,
          (clip) => {
            // AS DefineSprite_25_shoot/frame_94/DoAction.as
            // _parent.removeMovieClip() — kills the whole spell.
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

  /** Stored so frame_37 inside shoot can fire the sound callback. */
  private shootSoundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // The outer main-timeline has no SOMA.playSound — sound fires from
    // shoot/frame_37 instead. Store the callback for use there.
    this.shootSoundCallback = callbacks.playSound;
  }
}
