/**
 * Spell 2011 — Larve / Larve spell (likely a Sadida-family larva projectile).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2011/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic):
 *   - Has `move` (DefineSprite_8_move) + `shoot` (DefineSprite_4_shoot).
 *   - `move` frame_1 attaches fumee (smoke trail) particles as the projectile flies.
 *   - `shoot` frame_1 spawns fumee2 smoke puffs on landing; frame_37 spawns more;
 *     frame_91 removes the parent (spell complete).
 *   - The harness drives the parabolic arc for `move` and fires signalHit on landing.
 *
 * Library symbols:
 *   - lib_fumee  (DefineSprite_15_fumee, 48 frames) — smoke trail particle.
 *                frame_1: randomise scale [50,100)%, jump to random frame [0,30),
 *                         divide inherited vx/vy by (3..6); onEnterFrame drifts
 *                         position by vx/vy with 1/1.067 friction per tick.
 *                frame_46: removeMovieClip.
 *   - lib_fumee2 (DefineSprite_14_fumee2, 51 frames) — impact smoke puff particle.
 *                frame_1: randomise scale [80,100)%, jump to random frame [0,45),
 *                         double inherited vx/vy; onEnterFrame drifts and decays at 1/1.1.
 *                frame_49: removeMovieClip.
 *   - move       — 1-frame container. frame_1 captures xi/yi and sets up an
 *                  onEnterFrame that emits `level` fumee particles per tick tracking
 *                  the harness-driven position.
 *   - shoot      — 93-frame container. frame_1 resets rotation, emits 3 fumee2
 *                  puffs; frame_37 emits 9 more; frame_91 removes parent → complete.
 *   - DefineSprite_13 (sprite_13) — helper that sets _rotation = random(360).
 *                  This is referenced from nowhere in the main scripts after analysis;
 *                  it is a cosmetic rotation randomiser — we register it defensively
 *                  but it is never attached by the primary flow. (It has no
 *                  attachMovie calls pointing to it in the provided scripts.)
 *
 * Main timeline frame_1: SOMA.playSound("larve_tir"); (no stop()).
 *
 * The harness fires signalHit automatically for displayType=30 on landing —
 * we must NOT call it again.
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
  width: 2.35,
  height: 5.5,
  offsetX: -3.05,
  offsetY: 0,
};

const FUMEE2_BOUNDS = {
  width: 13.25,
  height: 9.8,
  offsetX: -8.45,
  offsetY: -7.3,
};

export class Spell2011 extends RuntimeSpell {
  readonly spellId = 2011;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Keep typed references so shoot's frameScripts can capture them.
  private fumeeSym!: SymbolDefinition;
  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);

    // ---- lib_fumee — smoke trail particle during flight ----------
    // AS: DefineSprite_15_fumee/frame_1/DoAction.as
    //   t = 50 * Math.random() + 50
    //   gotoAndPlay(random(30))
    //   _xscale = _yscale = t
    //   vx /= 3 + 3 * Math.random()
    //   vy /= 3 + random(3)
    //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.067; vy /= 1.067
    // AS: DefineSprite_15_fumee/frame_46/DoAction.as
    //   removeMovieClip()
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 48,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_15_fumee/frame_1/DoAction.as
        const t = 50 * Math.random() + 50;
        clip.gotoAndPlay(Math.floor(Math.random() * 30));
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        // vx/vy are set by the parent before attach fires onLoad — read and
        // divide them here so later onEnterFrame uses the damped values.
        const rawVx = (clip.vars.vx as number) ?? 0;
        const rawVy = (clip.vars.vy as number) ?? 0;
        clip.vars.vx = rawVx / (3 + 3 * Math.random());
        clip.vars.vy = rawVy / (3 + Math.floor(Math.random() * 3));
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_15_fumee/frame_1/DoAction.as — onEnterFrame closure
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        vx /= 1.067;
        vy /= 1.067;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_15_fumee/frame_46/DoAction.as → 0-based = 45
          45,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_fumee2 — impact smoke puff particle -----------------
    // AS: DefineSprite_14_fumee2/frame_1/DoAction.as
    //   t = 20 * Math.random() + 80
    //   gotoAndPlay(random(45))
    //   _xscale = _yscale = t
    //   vx *= 2; vy *= 2
    //   onEnterFrame: _X += vx; _Y += vy; vx /= 1.1; vy /= 1.1
    // AS: DefineSprite_14_fumee2/frame_49/DoAction.as
    //   removeMovieClip()
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 51,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_14_fumee2/frame_1/DoAction.as
        const t = 20 * Math.random() + 80;
        clip.gotoAndPlay(Math.floor(Math.random() * 45));
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        const rawVx = (clip.vars.vx as number) ?? 0;
        const rawVy = (clip.vars.vy as number) ?? 0;
        clip.vars.vx = rawVx * 2;
        clip.vars.vy = rawVy * 2;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_14_fumee2/frame_1/DoAction.as — onEnterFrame closure
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;
        vx /= 1.1;
        vy /= 1.1;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
      },
      frameScripts: new Map([
        [
          // AS DefineSprite_14_fumee2/frame_49/DoAction.as → 0-based = 48
          48,
          (clip) => {
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — projectile body (flies along harness arc) --------
    // AS: DefineSprite_8_move/frame_1/DoAction.as
    //   xi = this._x; yi = this._y
    //   nf = _parent.level * 1
    //   onEnterFrame: emit nf fumee particles per tick at current position
    //     with vx/vy based on frame-to-frame delta + small jitter
    const fumeeSym = this.fumeeSym;
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
            // AS DefineSprite_8_move/frame_1/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            const level = (clip.parent?.vars.level as number) ?? 1;
            clip.vars.nf = level * 1;
            clip.vars.c = 0;

            clip.onEnterFrame = (self, ictx) => {
              // AS DefineSprite_8_move/frame_1/DoAction.as — onEnterFrame closure
              const nf = self.vars.nf as number;
              let c = self.vars.c as number;
              let xi = self.vars.xi as number;
              let yi = self.vars.yi as number;
              const parent = self.parent;
              if (!parent) {
                return;
              }
              let loc3 = 0;
              while (loc3 < nf) {
                const instanceName = `fumee${c}`;
                const child = parent.attach(fumeeSym, instanceName, c + 10, ictx);
                // Set position and velocity on the child BEFORE its onLoad
                // reads vx/vy. We must set them on vars because onLoad reads
                // clip.vars.vx / clip.vars.vy directly.
                // But attach() fires onLoad inside it, so we need to set vx/vy
                // on the child AFTER attach (onLoad reads vars.vx which may be
                // undefined at that point, giving NaN-safe 0 default above).
                // The canonical AS sets _loc2_.vx after the attachMovie call,
                // so we replicate that by overwriting the already-divided values.
                // We recalculate from scratch here matching the AS order:
                //   f._x = this._x; f._y = this._y;
                //   f.vx = this._x - xi + 6.67*(random-0.5);
                //   f.vy = this._y - yi + 6.67*(random-0.5);
                child.x = self.x;
                child.y = self.y;
                // Rewrite vx/vy AFTER attach (overwriting what onLoad computed
                // from the 0-default). This matches the AS execution order where
                // the parent sets _loc2_.vx after attachMovie returns (i.e. after
                // frame_1 actions ran inside attachMovie).
                child.vars.vx = (self.x - xi + 6.67 * (Math.random() - 0.5)) / (3 + 3 * Math.random());
                child.vars.vy = (self.y - yi + 6.67 * (Math.random() - 0.5)) / (3 + Math.floor(Math.random() * 3));
                c++;
                loc3++;
              }
              self.vars.c = c;
              self.vars.xi = self.x;
              self.vars.yi = self.y;
            };

            // Suppress unused ctx warning.
            void ctx;
          },
        ],
      ]),
    };

    // ---- shoot — 93-frame impact effect --------------------------
    // AS: DefineSprite_4_shoot/frame_1/DoAction.as
    //   _rotation = 0; xi=_x; yi=_y; nf=level*2; c=0
    //   spawn 3 fumee2 particles at (_x, _y-30)
    // AS: DefineSprite_4_shoot/frame_37/DoAction.as
    //   spawn 9 more fumee2 particles
    // AS: DefineSprite_4_shoot/frame_91/DoAction.as
    //   _parent.removeMovieClip() → complete
    const fumee2Sym = this.fumee2Sym;
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 93,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 132.8, height: 88.75, offsetX: -77.4, offsetY: -75.2 }).x,
      anchorY: calculateAnchor({ width: 132.8, height: 88.75, offsetX: -77.4, offsetY: -75.2 }).y,
      frameScripts: new Map([
        [
          // AS DefineSprite_4_shoot/frame_1/DoAction.as → 0-based = 0
          0,
          (clip, ctx) => {
            // AS DefineSprite_4_shoot/frame_1/DoAction.as
            // _rotation = 0  — override any harness-applied velocity rotation
            clip.rotation = 0;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = ((clip.parent?.vars.level as number) ?? 1) * 2;
            clip.vars.c = 0;

            const parent = clip.parent;
            if (!parent) {
              return;
            }

            let c = clip.vars.c as number;
            const xi = clip.vars.xi as number;
            const yi = clip.vars.yi as number;
            let localXi = xi;
            let localYi = yi;

            let p = 0;
            while (p < 3) {
              const instanceName = `fumee2${c}${200}`;
              const depth = c + 200;
              const child = parent.attach(fumee2Sym, instanceName, depth, ctx);
              child.x = clip.x;
              child.y = clip.y - 30;
              // Assign vx/vy after attach (overwriting onLoad's doubled values).
              // AS: f.vx = this._x - xi + 6.67*(random-0.5)
              //     note: xi/yi update inside the loop in the canonical AS.
              child.vars.vx = (clip.x - localXi + 6.67 * (Math.random() - 0.5)) * 2;
              child.vars.vy = (clip.y - localYi + 6.67 * (Math.random() - 0.5)) * 2;
              c++;
              localXi = clip.x;
              localYi = clip.y;
              p++;
            }
            clip.vars.c = c;
          },
        ],
        [
          // AS DefineSprite_4_shoot/frame_37/DoAction.as → 0-based = 36
          36,
          (clip, ctx) => {
            // AS DefineSprite_4_shoot/frame_37/DoAction.as
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = ((clip.parent?.vars.level as number) ?? 1) * 2;

            const parent = clip.parent;
            if (!parent) {
              return;
            }

            let c = clip.vars.c as number;
            let localXi = clip.vars.xi as number;
            let localYi = clip.vars.yi as number;

            let p = 0;
            while (p < 9) {
              const instanceName = `fumee2${c}`;
              const depth = c + 200;
              const child = parent.attach(fumee2Sym, instanceName, depth, ctx);
              child.x = clip.x;
              child.y = clip.y - 30;
              child.vars.vx = (clip.x - localXi + 6.67 * (Math.random() - 0.5)) * 2;
              child.vars.vy = (clip.y - localYi + 6.67 * (Math.random() - 0.5)) * 2;
              c++;
              localXi = clip.x;
              localYi = clip.y;
              p++;
            }
            clip.vars.c = c;
          },
        ],
        [
          // AS DefineSprite_4_shoot/frame_91/DoAction.as → 0-based = 90
          90,
          (clip) => {
            // AS DefineSprite_4_shoot/frame_91/DoAction.as
            // _parent.removeMovieClip() — kills the outer mc, ending the spell.
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
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("larve_tir");
    callbacks.playSound("larve_tir");
  }
}
