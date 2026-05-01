/**
 * Spell 2103 — Flèche Enflammée variant (Cra, same visual as 909).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2103/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Two parallel authored timelines:
 *   - sprite_19 (45 frames, caster-side): positions at cellFrom, rotates to
 *     angle, spawns cercle particles at frame 7, stops at frame 70.
 *   - sprite_33 (84 frames, target-side): positions at cellTo, rotates to
 *     angle, fires signalHit at frame 13, removes outer mc at frame 67.
 *
 * Library symbols:
 *   - lib_cercle — single-frame particle. onLoad seeds d, accx, x, sr, vx,
 *     vy, vt, va, vr, t. onEnterFrame rotates (vr decays 0.97), drifts X
 *     (vx multiplied by accx each frame), ramps scale via vt, removes when
 *     t < 0.
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * Implicit frame_1 placement of sprite_19 + sprite_33 handled in onSpellStart.
 *
 * The harness for displayType 50/51 sets container at world (0,0) and exposes
 * cellFrom/cellTo/angle on root.vars. Per-sprite frame_1 scripts position
 * children at absolute world coords.
 *
 * signalHit is fired manually from sprite_33 frame 13 (this.end() in AS).
 * complete() is fired from sprite_33 frame 67 (_parent.removeMovieClip() in AS).
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
    _context: SpellContext,
  ): void {
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_cercle — orange drift particle spawned by sprite_19 ----
    // AS: scripts/DefineSprite_3_cercle/frame_1/PlaceObject2_2_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //     CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,

      onLoad: (clip) => {
        // AS onClipEvent(load):
        //   d = 120 + (_parent._parent._parent.level - 1) * 32
        //   accx = 0.8 + 0.12 * Math.random()
        //   x = d * Math.random()
        //   if(random(4) == 1) { _Y = 5; sr = -1 } else { sr = 1; _Y = -5 }
        //   _xscale = 0; _yscale = 0; t = 5; _X = x
        //   va = 5 + 10 * Math.random()
        //   vr = (20 + 40 * Math.random()) * sr
        //   vt = (1 + random(1)) * ((d - x) / d)
        //   vx = 5 + 10 * Math.random()
        //
        // _parent._parent._parent chain: cercle → sprite_19 → root
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.12 * Math.random();
        const xStart = d * Math.random();
        let yStart: number;
        let sr: number;
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
        clip.vars.vt =
          (1 + Math.floor(Math.random() * 2)) * ((d - xStart) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },

      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame):
        //   _rotation = _rotation - (vr *= 0.97)
        //   _X = _X + (vx *= accx)
        //   t += vt -= 0.1
        //   _xscale = t; _yscale = t
        //   if(t < 0) { _parent.removeMovieClip() }
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        vr *= 0.97;
        // AS rotation in degrees → convert delta to radians
        clip.rotation -= (vr * Math.PI) / 180;
        vx *= accx;
        clip.x += vx;
        vt -= 0.1;
        t += vt;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        if (t < 0) {
          clip.remove();
        }
      },
    };

    // ---- sprite_19 — caster-side authored timeline (72 frames) ------
    // AS: scripts/DefineSprite_19/frame_1/DoAction.as  → position at cellFrom
    // AS: scripts/DefineSprite_19/frame_7/DoAction.as  → spawn cercle particles
    // AS: scripts/DefineSprite_19/frame_70/DoAction.as → stop()
    this.sprite19Sym = {
      name: "sprite_19",
      totalFrames: 72,
      frames: textures.getFrames("sprite_19"),
      anchorX: calculateAnchor({
        width: 171.35,
        height: 28,
        offsetX: -36.35,
        offsetY: -14.9,
      }).x,
      anchorY: calculateAnchor({
        width: 171.35,
        height: 28,
        offsetX: -36.35,
        offsetY: -14.9,
      }).y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_19/frame_1/DoAction.as:
            //   _X = _parent.cellFrom.x
            //   _Y = _parent.cellFrom.y - 50
            //   _rotation = _parent.angle
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
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
            // AS DefineSprite_19/frame_7/DoAction.as:
            //   nb = 10 + _parent.level * 3
            //   c = 1
            //   while(c < nb) { this.attachMovie("cercle","cercle" + c, c); c++ }
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
            // AS DefineSprite_19/frame_70/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_33 — target-side authored timeline (84 frames) ------
    // AS: scripts/DefineSprite_33/frame_1/DoAction.as  → position at cellTo
    // AS: scripts/DefineSprite_33/frame_13/DoAction.as → this.end() → signalHit
    // AS: scripts/DefineSprite_33/frame_67/DoAction.as → _parent.removeMovieClip()
    this.sprite33Sym = {
      name: "sprite_33",
      totalFrames: 84,
      frames: textures.getFrames("sprite_33"),
      anchorX: calculateAnchor({
        width: 224.15,
        height: 88.25,
        offsetX: -59.4,
        offsetY: -47.3,
      }).x,
      anchorY: calculateAnchor({
        width: 224.15,
        height: 88.25,
        offsetX: -59.4,
        offsetY: -47.3,
      }).y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_33/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x
            //   _Y = _parent.cellTo.y - 50
            //   _rotation = _parent.angle
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
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
            // AS DefineSprite_33/frame_13/DoAction.as: this.end() → damage popup
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_33/frame_67/DoAction.as: _parent.removeMovieClip()
            clip.remove();
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
    context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");
    // Implicit frame_1 placement of sprite_19 (caster-side) and
    // sprite_33 (target-side) on the main authored timeline.
    this.root.attach(this.sprite19Sym, "sprite19", 1, context);
    this.root.attach(this.sprite33Sym, "sprite33", 2, context);
  }
}
