/**
 * Spell 905 — Flèche de Recul (Cra earth arrow / push arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/905/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` container
 * (DefineSprite_29_move) that is driven along a parabolic arc by the
 * harness, and a `shoot` container (DefineSprite_25_shoot) that is attached
 * at impact. This is the canonical ballistic pattern.
 *
 * Library symbols:
 *   - lib_fumee  — small smoke particle. frame_1: random scale [50,100)%,
 *                  gotoAndPlay random frame, divide inherited vx/vy.
 *                  onEnterFrame: drift X/Y with 1.067 friction. frame_46:
 *                  removeMovieClip.
 *   - lib_fumee2 — larger smoke particle. frame_1: random scale [80,100)%,
 *                  gotoAndPlay random frame, multiply inherited vx/vy by 2.
 *                  onEnterFrame: drift X/Y with 1.3 friction. frame_49:
 *                  removeMovieClip.
 *   - move       — 1-frame container. frame_1 seeds c=0, nf=level*0.5, xi/yi,
 *                  onEnterFrame spawns fumee particles along the arc path.
 *                  Also has a placed child (PlaceObject2_28_1) with
 *                  onClipEvent(load)/onClipEvent(enterFrame) — a rotating
 *                  visual element (DefineSprite_34 or DefineSprite_31) whose
 *                  scale is seeded from level and rotation oscillates.
 *   - shoot      — 96-frame container. frame_1: reset rotation, seed xi/yi/c,
 *                  spawn 3 fumee2 particles. frame_37: playSound("jet_905").
 *                  frame_40: spawn 9 more fumee2 particles. frame_94:
 *                  _parent.removeMovieClip → spell complete.
 *
 * The harness (displayType=30) drives `move` along the ballistic arc and
 * attaches `shoot` at landing, signalling hit automatically. We must NOT
 * call signalHit ourselves.
 *
 * Main timeline: no explicit frame_1/DoAction.as listed; no sound in
 * onSpellStart (the sound is on shoot/frame_37 instead).
 *
 * The PlaceObject2_28_1 clip inside `move` carries onClipEvent(load) and
 * onClipEvent(enterFrame) handlers. Per the manifest, this is a placed child
 * with a rotating visual (DefineSprite_34 / DefineSprite_31 both have only
 * `_rotation = random(360)` at frame_1, so we model the placed child as a
 * sub-symbol "moveInner" registered here). Its onLoad seeds amplitude `a=20`
 * and scale from level; its onEnterFrame oscillates rotation.
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

// --- Bounds from manifest.librarySymbols[] ---

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

  // Stored for use in shoot's frameScripts where we need to attach fumee2
  // particles onto shoot's parent (the root). We keep a reference to the
  // fumee2 symbol so both shoot/frame_1 and shoot/frame_40 can use it.
  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;

  // Stored for use inside move's onEnterFrame (the placed inner child symbol)
  private moveInnerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);

    // ---- lib_fumee — small smoke particle spawned by move's onEnterFrame --
    // AS: DefineSprite_36_fumee/frame_1/DoAction.as
    //   t = 50 * Math.random() + 50;
    //   gotoAndPlay(random(30));
    //   _xscale = t; _yscale = t;
    //   vx /= 3 + 3 * Math.random();
    //   vy /= 9 + random(3);
    //   this.onEnterFrame = function() { _X += vx; _Y += vy; vx /= 1.067; vy /= 1.067; }
    // AS: DefineSprite_36_fumee/frame_46/DoAction.as
    //   this.removeMovieClip();
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_36_fumee onEnterFrame (set in frame_1)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / 1.067;
        clip.vars.vy = vy / 1.067;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_36_fumee/frame_1/DoAction.as
            const t = 50 * Math.random() + 50;
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // vx/vy are seeded by the parent before attach; divide them here
            const vx = (clip.vars.vx as number | undefined) ?? 0;
            const vy = (clip.vars.vy as number | undefined) ?? 0;
            clip.vars.vx = vx / (3 + 3 * Math.random());
            clip.vars.vy = vy / (9 + Math.floor(Math.random() * 3));
          },
        ],
        [
          45,
          (clip) => {
            // AS: DefineSprite_36_fumee/frame_46/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee2 — larger smoke particle spawned by shoot ----------------
    // AS: DefineSprite_35_fumee2/frame_1/DoAction.as
    //   t = 20 * Math.random() + 80;
    //   gotoAndPlay(random(45));
    //   _xscale = t; _yscale = t;
    //   vx *= 2; vy *= 2;
    //   this.onEnterFrame = function() { _X += vx; _Y += vy; vx /= 1.3; vy /= 1.3; }
    // AS: DefineSprite_35_fumee2/frame_49/DoAction.as
    //   this.removeMovieClip();
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_35_fumee2 onEnterFrame (set in frame_1)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        clip.vars.vx = vx / 1.3;
        clip.vars.vy = vy / 1.3;
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_35_fumee2/frame_1/DoAction.as
            const t = 20 * Math.random() + 80;
            clip.gotoAndPlay(Math.floor(Math.random() * 45));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // vx/vy are seeded by the parent before attach; multiply by 2
            const vx = (clip.vars.vx as number | undefined) ?? 0;
            const vy = (clip.vars.vy as number | undefined) ?? 0;
            clip.vars.vx = vx * 2;
            clip.vars.vy = vy * 2;
          },
        ],
        [
          48,
          (clip) => {
            // AS: DefineSprite_35_fumee2/frame_49/DoAction.as
            clip.remove();
          },
        ],
      ]),
    };

    // ---- moveInner — the PlaceObject2_28_1 child inside move ---------------
    // AS: DefineSprite_29_move/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(load).as
    //   a = 20;
    //   t = 10 + 3 * _parent._parent.level;
    //   _xscale = t; _yscale = t;
    // AS: DefineSprite_29_move/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = 90 + a * Math.cos(i += 1);
    //   a /= 1.3;
    //
    // This is a rotating visual element (DefineSprite_34 or DefineSprite_31)
    // placed inside the move container. Both DefineSprite_34 and DefineSprite_31
    // have only `_rotation = random(360)` at frame_1 (a one-shot initial random
    // rotation), but the CLIPACTIONRECORD overrides rotation continuously.
    // We model it as a container-only symbol since it has no distinct texture
    // in the manifest (no lib_moveInner entry). We use frames: [] and drive
    // it purely through onLoad/onEnterFrame.
    this.moveInnerSym = {
      name: "moveInner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_29_move/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 20;
        clip.vars.i = 0;
        // _parent._parent.level: clip → moveInner → move → root
        const root = clip.parent?.parent;
        const level = (root?.vars.level as number) ?? 1;
        const t = 10 + 3 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_29_move/frame_1/PlaceObject2_28_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = 90 + a * Math.cos(i += 1)  (degrees → radians)
        // a /= 1.3
        let a = clip.vars.a as number;
        let i = clip.vars.i as number;
        i += 1;
        const rotDeg = 90 + a * Math.cos(i);
        clip.rotation = (rotDeg * Math.PI) / 180;
        a /= 1.3;
        clip.vars.a = a;
        clip.vars.i = i;
      },
    };

    // ---- move — 1-frame ballistic projectile container ----------------------
    // AS: DefineSprite_29_move/frame_1/DoAction.as
    //   xi = this._x; yi = this._y;
    //   nf = this._parent.level * 0.5;
    //   c = 0;
    //   this.onEnterFrame = function() { spawn fumee particles along path }
    //
    // The harness attaches `move` at (0,0) on the root and drives it along
    // the parabolic arc each tick. The move clip's onEnterFrame spawns fumee
    // particles at its current position and records xi/yi for velocity seeding.
    //
    // The placed child (PlaceObject2_28_1) is a visual indicator inside move —
    // we attach it from frame_1 as "moveInner".
    const fumeeSym = this.fumeeSym;
    const moveInnerSym = this.moveInnerSym;
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
            // AS: DefineSprite_29_move/frame_1/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            const level = (clip.parent?.vars.level as number) ?? 1;
            clip.vars.nf = level * 0.5;
            clip.vars.c = 0;

            // Attach the placed inner rotating child (PlaceObject2_28_1)
            // This mirrors the authored PlaceObject2 at frame_1 of move.
            clip.attach(moveInnerSym, "moveInner", 1, ctx);

            // Set up onEnterFrame for spawning fumee particles along arc
            clip.onEnterFrame = (self) => {
              // AS: DefineSprite_29_move/frame_1/DoAction.as (onEnterFrame closure)
              const nf = self.vars.nf as number;
              let c = self.vars.c as number;
              const xi = self.vars.xi as number;
              const yi = self.vars.yi as number;
              const parent = self.parent;
              if (!parent) {
                return;
              }
              let loc3 = 0;
              while (loc3 < nf) {
                const instanceName = `fumee${c}`;
                const f = parent.attach(fumeeSym, instanceName, c + 5, ctx);
                f.x = self.x;
                f.y = self.y;
                f.vars.vx = self.x - xi + 20 * (Math.random() - 0.5);
                f.vars.vy = self.y - yi + 20 * (Math.random() - 0.5);
                c++;
                loc3 = loc3 + 1;
              }
              self.vars.xi = self.x;
              self.vars.yi = self.y;
              self.vars.c = c;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 96-frame impact container ---------------------------------
    // AS: DefineSprite_25_shoot/frame_1/DoAction.as
    //   _rotation = 0; xi = this._x; yi = this._y;
    //   nf = this._parent.level * 2; c = 0;
    //   spawn 3 fumee2 particles at _parent (p < 3 loop)
    // AS: DefineSprite_25_shoot/frame_37/DoAction.as
    //   SOMA.playSound("jet_905");
    // AS: DefineSprite_25_shoot/frame_40/DoAction.as
    //   xi = this._x; yi = this._y;
    //   nf = this._parent.level * 2;
    //   spawn 9 fumee2 particles at _parent (p < 9 loop)
    // AS: DefineSprite_25_shoot/frame_94/DoAction.as
    //   _parent.removeMovieClip();

    // We need a callback reference for the sound played at frame_37.
    // The callbacks are only available in onSpellStart, so we capture them
    // via a class-level field set in onSpellStart.
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
            // AS: DefineSprite_25_shoot/frame_1/DoAction.as
            // _rotation = 0 overrides the harness-applied velocity angle
            clip.rotation = 0;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = ((clip.parent?.vars.level as number) ?? 1) * 2;
            clip.vars.c = 0;

            const parent = clip.parent;
            if (!parent) {
              return;
            }

            // Spawn 3 fumee2 particles attached to _parent (the root)
            let c = clip.vars.c as number;
            let xi = clip.vars.xi as number;
            let yi = clip.vars.yi as number;
            let p = 0;
            while (p < 3) {
              const instanceName = `fumee2${c}100`;
              const f = parent.attach(fumee2Sym, instanceName, c + 100, ctx);
              f.x = clip.x;
              f.y = clip.y - 30;
              f.vars.vx = clip.x - xi + 20 * (Math.random() - 0.5);
              f.vars.vy = clip.y - yi + 20 * (Math.random() - 0.5);
              c++;
              xi = clip.x;
              yi = clip.y;
              p++;
            }
            clip.vars.c = c;
            clip.vars.xi = xi;
            clip.vars.yi = yi;
          },
        ],
        [
          36,
          (_clip) => {
            // AS: DefineSprite_25_shoot/frame_37/DoAction.as
            // SOMA.playSound("jet_905")
            // Sound is played via the stored callback reference
            this.soundCallback?.("jet_905");
          },
        ],
        [
          39,
          (clip, ctx) => {
            // AS: DefineSprite_25_shoot/frame_40/DoAction.as
            const parent = clip.parent;
            if (!parent) {
              return;
            }

            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = ((parent.vars.level as number) ?? 1) * 2;

            let c = clip.vars.c as number;
            let xi = clip.vars.xi as number;
            let yi = clip.vars.yi as number;
            let p = 0;
            while (p < 9) {
              const instanceName = `fumee2${c}`;
              const f = parent.attach(fumee2Sym, instanceName, c + 200, ctx);
              f.x = clip.x;
              f.y = clip.y - 30;
              f.vars.vx = clip.x - xi + 20 * (Math.random() - 0.5);
              f.vars.vy = clip.y - yi + 20 * (Math.random() - 0.5);
              c++;
              xi = clip.x;
              yi = clip.y;
              p++;
            }
            clip.vars.c = c;
            clip.vars.xi = xi;
            clip.vars.yi = yi;
          },
        ],
        [
          93,
          (clip) => {
            // AS: DefineSprite_25_shoot/frame_94/DoAction.as
            // _parent.removeMovieClip() — kills the outer mc (root)
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.fumee2Sym);
    this.registry.register(this.moveInnerSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  // Sound callback captured from onSpellStart for use in shoot/frame_37
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Capture sound callback for deferred use in shoot/frame_37
    this.soundCallback = callbacks.playSound;
    // Main timeline for spell 905 has no explicit frame_1/DoAction.as listed
    // (the sound fires from shoot/frame_37 instead of the main timeline).
    // No child attaches needed here — the harness handles move/shoot.
  }
}
