/**
 * Spell 2103 — (Cra fire arrow variant, likely "Flèche Enflammée" / similar Cra spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2103/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Detection reasoning:
 *   - Two parallel authored timelines: sprite_19 (caster-side, 72 frames) and
 *     sprite_33 (target-side, 84 frames).
 *   - sprite_19/frame_1 reads `_parent.cellFrom` and positions itself there.
 *   - sprite_33/frame_1 reads `_parent.cellTo` and positions itself there.
 *   - Both read `_parent.angle` for rotation.
 *   - This is the canonical dual-anchored WorldAbsolute pattern (50/51).
 *   - No `move`/`shoot`/`duplicate` symbols → not a projectile or beam type.
 *   - Main timeline has a frame_2 sound+stop → WorldAbsoluteAlt (51), matching spell 909.
 *
 * Library symbols:
 *   - lib_cercle — single-frame orange particle. onLoad seeds d, accx, x, sr, vr, vt, vx, va, t.
 *                  onEnterFrame rotates (vr decays 0.97×), X drifts (vx grows by accx factor),
 *                  scale ramps via t+vt, removes when t < 0.
 *
 * Authored timelines (animations[], NOT librarySymbols[]):
 *   - sprite_19 — caster-side, 72 frames. frame_1: position at cellFrom, rotate to angle.
 *                 frame_7: spawn 10 + level*3 cercle particles. frame_70: stop().
 *   - sprite_33 — target-side, 84 frames. frame_1: position at cellTo, rotate to angle.
 *                 frame_13: signalHit (this.end()). frame_67: _parent.removeMovieClip() → complete().
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * onSpellStart attaches sprite_19 and sprite_33 to root, then plays the sound.
 *
 * NOTE: signalHit is called from sprite_33's frame_13 (not harness-driven, since
 * displayType is not 30/31). complete() is called from sprite_33's frame_67.
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

const CERCLE_BOUNDS = {
  width: 34.75,
  height: 34.4,
  offsetX: -17.2,
  offsetY: -17.3,
};

export class Spell2103 extends RuntimeSpell {
  readonly spellId = 2103;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private cercleSym!: SymbolDefinition;
  private sprite19Sym!: SymbolDefinition;
  private sprite33Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_cercle — orange particle spawned from caster-side sprite_19 ----
    // AS: DefineSprite_3_cercle/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3_cercle/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS: onClipEvent(load)
        // _parent._parent._parent.level:
        //   cercle's _parent is sprite_19, sprite_19's _parent is root.
        //   So: clip → sprite_19 → root. We collapse to clip.parent?.parent.
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.12 * Math.random();
        const xStart = d * Math.random();
        let yStart: number;
        let sr: number;
        // AS: if(random(4) == 1) — note: 1/4 chance (not 1/2 as in spell 909)
        if (Math.floor(Math.random() * 4) === 1) {
          yStart = 5;
          sr = -1;
        } else {
          sr = 1;
          yStart = -5;
        }
        clip.scaleX = 0;
        clip.scaleY = 0;
        clip.vars.t = 5;
        clip.x = xStart;
        clip.y = yStart;
        clip.vars.va = 5 + 10 * Math.random();
        clip.vars.vr = (20 + 40 * Math.random()) * sr;
        // AS: vt = (1 + random(1)) * ((d - x) / d)
        clip.vars.vt = (1 + Math.floor(Math.random() * 1)) * ((d - xStart) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: onClipEvent(enterFrame)
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        // AS: _rotation = _rotation - (vr *= 0.97)
        vr *= 0.97;
        clip.rotation -= (vr * Math.PI) / 180;

        // AS: _X = _X + (vx *= accx)
        vx *= accx;
        clip.x += vx;

        // AS: t += vt -= 0.1
        vt -= 0.1;
        t += vt;

        // AS: _xscale = t; _yscale = t
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        // AS: if(t < 0) { _parent.removeMovieClip(); }
        if (t < 0) {
          clip.remove();
        }
      },
    };

    // ---- sprite_19 — caster-side timeline (72 frames) ----
    // Positions at cellFrom, rotates to angle, spawns cercle particles at frame 7,
    // stops at frame 70.
    this.sprite19Sym = {
      name: "sprite_19",
      totalFrames: 72,
      frames: textures.getFrames("sprite_19"),
      anchorX: calculateAnchor({ width: 171.35, height: 28, offsetX: -36.35, offsetY: -14.9 }).x,
      anchorY: calculateAnchor({ width: 171.35, height: 28, offsetX: -36.35, offsetY: -14.9 }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_19/frame_1/DoAction.as
            // _X = _parent.cellFrom.x;
            // _Y = _parent.cellFrom.y - 50;
            // _rotation = _parent.angle;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 50;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS: DefineSprite_19/frame_7/DoAction.as
            // nb = 10 + _parent.level * 3;
            // c = 1; while(c < nb) { this.attachMovie("cercle","cercle"+c,c); c++; }
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const nb = 10 + level * 3;
            for (let c = 1; c < nb; c++) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
            }
          },
        ],
        [
          69,
          (clip) => {
            // AS: DefineSprite_19/frame_70/DoAction.as
            // stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_33 — target-side timeline (84 frames) ----
    // Positions at cellTo, rotates to angle.
    // frame_13: this.end() → signalHit.
    // frame_67: _parent.removeMovieClip() → complete.
    this.sprite33Sym = {
      name: "sprite_33",
      totalFrames: 84,
      frames: textures.getFrames("sprite_33"),
      anchorX: calculateAnchor({ width: 224.15, height: 88.25, offsetX: -59.4, offsetY: -47.3 }).x,
      anchorY: calculateAnchor({ width: 224.15, height: 88.25, offsetX: -59.4, offsetY: -47.3 }).y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_33/frame_1/DoAction.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y - 50;
            // _rotation = _parent.angle;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 50;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          12,
          () => {
            // AS: DefineSprite_33/frame_13/DoAction.as
            // this.end() → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS: DefineSprite_33/frame_67/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite19Sym);
    this.registry.register(this.sprite33Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: frame_2/DoAction.as
    // SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Implicit frame_1 placement of sprite_19 + sprite_33 on the main timeline.
    // Attach them so they start ticking from the next runtime frame.
    this.root.attach(this.sprite19Sym, "sprite19", 1, context);
    this.root.attach(this.sprite33Sym, "sprite33", 2, context);
  }
}
