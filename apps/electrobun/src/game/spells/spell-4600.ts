/**
 * Spell 4600 — (Projectile Ballistic spell, likely a grenade/bomb-type).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/4600/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has:
 *   - `move` symbol (DefineSprite_19_move): 1-frame container. frame_1 sets up
 *     an onEnterFrame that spawns `fumee` smoke particles at the projectile's
 *     current position as it travels along the arc.
 *   - `shoot` symbol (DefineSprite_14_shoot): 78-frame impact composite.
 *     frame_1: plays "explosion" sound, resets _rotation = 0, stores xi/yi.
 *     frame_73: _parent.removeMovieClip() → spell complete.
 *   - `lib_fumee` (DefineSprite_21_fumee): 48-frame smoke particle.
 *     frame_1: seeds t (scale), gotoAndPlay(random(30)), sets scale, divides
 *     vx/vy, onEnterFrame drifts position with friction.
 *     frame_46: removeMovieClip().
 *
 * The harness configures displayType=30 (ProjectileBallistic), which
 * automatically attaches `move` at root, drives it along a parabolic arc,
 * and attaches `shoot` at the target on landing. The harness calls
 * runtime.signalHit() automatically — we must NOT call it again.
 *
 * Main timeline: sounds["explosion"] is on the shoot symbol's frame_1, not
 * the main timeline. onSpellStart is a no-op for sound (the manifest lists
 * "explosion" on frame 0 but this is the shoot's frame_1 sound, not a
 * top-level SOMA.playSound call).
 *
 * Library symbols:
 *   - lib_fumee — 48-frame smoke particle. frame_1 seeds scale/velocity,
 *     gotoAndPlay(random(30)), onEnterFrame drifts with 1.08 friction.
 *     frame_46 removes itself.
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
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.1,
};

export class Spell4600 extends RuntimeSpell {
  readonly spellId = 4600;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  private fumeeSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);

    // ---- lib_fumee — smoke particle spawned by move along the arc ----
    // AS: DefineSprite_21_fumee/frame_1/DoAction.as
    // AS: DefineSprite_21_fumee/frame_46/DoAction.as
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
            // AS DefineSprite_21_fumee/frame_1/DoAction.as
            // t = 50 * Math.random() + 50;
            // gotoAndPlay(random(30));
            // _xscale = t; _yscale = t;
            // vx /= 3 + 3 * Math.random();
            // vy /= 3 + random(3);
            // this.onEnterFrame = function() { _X += vx; _Y += vy; vx /= 1.08; vy /= 1.08; }
            const t = 50 * Math.random() + 50;
            clip.gotoAndPlay(Math.floor(Math.random() * 30));
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            const vxRaw = clip.vars.vx as number | undefined;
            const vyRaw = clip.vars.vy as number | undefined;
            clip.vars.vx = (vxRaw ?? 0) / (3 + 3 * Math.random());
            clip.vars.vy = (vyRaw ?? 0) / (3 + Math.floor(Math.random() * 3));
            clip.onEnterFrame = (c) => {
              // AS onEnterFrame: _X += vx; _Y += vy; vx /= 1.08; vy /= 1.08;
              const vx = c.vars.vx as number;
              const vy = c.vars.vy as number;
              c.x += vx;
              c.y += vy;
              c.vars.vx = vx / 1.08;
              c.vars.vy = vy / 1.08;
            };
          },
        ],
        [
          45,
          (clip) => {
            // AS DefineSprite_21_fumee/frame_46/DoAction.as
            // this.removeMovieClip();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- move — projectile container, spawns fumee smoke trail ----
    // AS: DefineSprite_19_move/frame_1/DoAction.as
    // 1-frame container; frame_1 sets up onEnterFrame to attach fumee
    // particles at the move clip's current position.
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
            // AS DefineSprite_19_move/frame_1/DoAction.as
            // xi = this._x; yi = this._y; nf = 1; c = 0;
            // this.onEnterFrame: attach fumee at current pos per frame
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
            clip.vars.nf = 1;
            clip.vars.c = 0;
            clip.onEnterFrame = (c2, ctx2) => {
              const nf = c2.vars.nf as number;
              let counter = c2.vars.c as number;
              const xi = c2.vars.xi as number;
              const yi = c2.vars.yi as number;
              const parent = c2.parent;
              if (!parent) {
                return;
              }
              for (let loc3 = 0; loc3 < nf; loc3++) {
                // AS: this._parent.attachMovie("fumee","fumee" + c, c + 10);
                // loc2._x = this._x; loc2._y = this._y;
                // loc2.vx = this._x - xi + 20*(Math.random()-0.5);
                // loc2.vy = this._y - yi + 20*(Math.random()-0.5);
                const instanceName = `fumee${counter}`;
                const depth = counter + 10;
                const fx = c2.x;
                const fy = c2.y;
                const child = parent.attach(fumeeSym, instanceName, depth, ctx2);
                child.x = fx;
                child.y = fy;
                child.vars.vx = fx - xi + 20 * (Math.random() - 0.5);
                child.vars.vy = fy - yi + 20 * (Math.random() - 0.5);
                counter++;
              }
              c2.vars.c = counter;
              c2.vars.xi = c2.x;
              c2.vars.yi = c2.y;
            };
          },
        ],
      ]),
    };

    // ---- shoot — 78-frame impact composite at target ----
    // AS: DefineSprite_14_shoot/frame_1/DoAction.as → SOMA.playSound("explosion")
    // AS: DefineSprite_14_shoot/frame_1/DoAction_2.as → _rotation = 0; xi = this._x; yi = this._y;
    // AS: DefineSprite_14_shoot/frame_73/DoAction.as → _parent.removeMovieClip()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 78,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({ width: 59.9, height: 52.3, offsetX: -29.1, offsetY: -45.65 }).x,
      anchorY: calculateAnchor({ width: 59.9, height: 52.3, offsetX: -29.1, offsetY: -45.65 }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_14_shoot/frame_1/DoAction.as
            // SOMA.playSound("explosion");
            // Note: sound is played here via the stored callback (captured in onSpellStart).
            // However, per the canonical AS the sound fires on shoot's frame_1.
            // We store the callback ref and call it here.
            const playSound = clip.vars._playSound as ((id: string) => void) | undefined;
            if (playSound) {
              playSound("explosion");
            }
            // AS DefineSprite_14_shoot/frame_1/DoAction_2.as
            // _rotation = 0; xi = this._x; yi = this._y;
            clip.rotation = 0;
            clip.vars.xi = clip.x;
            clip.vars.yi = clip.y;
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_14_shoot/frame_73/DoAction.as
            // _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // Store the playSound callback so shoot's frame_1 can fire it when
    // the projectile lands. The canonical AS calls SOMA.playSound("explosion")
    // from DefineSprite_14_shoot/frame_1/DoAction.as — we propagate it via vars.
    // We walk the shoot child once it's attached by the harness on landing,
    // so we store it on root.vars for shoot's frameScript to pick up.
    this.root.vars._playSound = callbacks.playSound;
  }
}
