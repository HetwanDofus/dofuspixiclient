/**
 * Spell 906 — Flèche Empoisonnée (Cra poison arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/906/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). The spell has two parallel authored
 * timelines placed on the main timeline (mirroring spell 909's pattern):
 *   - DefineSprite_22 — target-side timeline (139 frames): positions itself
 *     at cellTo, at frame 7 spawns `cercle` particles, at frame 67 signals
 *     hit (this.end()), at frame 139 removes parent → complete.
 *   - DefineSprite_3_shoot — 159-frame timeline at target: positions itself
 *     via onLoad (scale based on level), at frame 157 removes parent.
 *   - DefineSprite_2 — smoke emitter: onEnterFrame loop spawns `fumee`
 *     particles from frame c=5..60, attaching them with random vx/vy.
 *
 * Library symbols:
 *   - lib_fumee (36 frames) — smoke puff particle. frame_1/DoAction seeds
 *     angle/scale/pos/vx/vy/deceleration and sets onEnterFrame for drift.
 *     frame_31 removes self. The inner PlaceObject2_6_2 clip events (load/
 *     enterFrame) handle the inner sub-sprite's rotation + alpha fade.
 *   - lib_cercle (1 frame) — particle circle. onLoad seeds physics vars.
 *     onEnterFrame integrates rotation/position/scale, removes when t < 0.
 *
 * Main timeline: SOMA.playSound("jet_903") + stop() (frame_1/DoAction.as).
 *
 * Both sprite_22 and sprite_3_shoot are container-only authored timelines
 * that position themselves at cellTo via root.vars in their frame_1. The
 * DefineSprite_2 smoke emitter is also a container that spawns fumee particles.
 *
 * displayType=51 means harness sets anchor=(0,0) and exposes cellFrom/cellTo/
 * angle on root.vars. Per-spell scripts position children at WORLD coords.
 *
 * signalHit is fired from sprite_22 frame_67 (this.end()). Not fired by
 * harness (displayType 51).
 * complete() fired from sprite_22 frame_139 (_parent.removeMovieClip()).
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
  width: 32.35,
  height: 33,
  offsetX: -14.35,
  offsetY: -18.65,
};

const CERCLE_BOUNDS = {
  width: 17.2,
  height: 17.1,
  offsetX: -8.6,
  offsetY: -8.55,
};

export class Spell906 extends RuntimeSpell {
  readonly spellId = 906;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private fumeeSym!: SymbolDefinition;
  private cercleSym!: SymbolDefinition;
  private sprite2Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;
  private sprite22Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumeeAnchor = calculateAnchor(FUMEE_BOUNDS);
    const cercleAnchor = calculateAnchor(CERCLE_BOUNDS);

    // ---- lib_fumee — smoke puff particle -------------------------
    // The fumee symbol has two layers of behaviour:
    //   1. The outer clip (DefineSprite_7_fumee/frame_1/DoAction.as):
    //      seeds angle from _parent._parent._parent.rotate._rotation,
    //      sets scale/position/velocity/deceleration, sets onEnterFrame.
    //   2. An inner sub-clip (PlaceObject2_6_2) with its own load/enterFrame
    //      that handles rotation + alpha fade of the inner smoke graphic.
    //
    // In the SpellClip model we only have one clip per symbol; we fold the
    // inner PlaceObject2_6_2 clip events into the outer onLoad/onEnterFrame
    // since the inner sub-clip's visual rotation/alpha IS the visible fumee
    // sprite. The outer clip's positional drift is also applied to the same
    // SpellClip node.
    //
    // AS DefineSprite_7_fumee/frame_1/DoAction.as:
    //   a = _parent._parent._parent.rotate._rotation * 0.017453292519943295
    //   t = 80*Math.random()+50; _xscale=t; _yscale=t
    //   _X = 20*(Math.random()-0.5); _Y = 20*(Math.random()-0.5)
    //   vx = 20*Math.cos(a); vy = 20*Math.sin(a)
    //   deceleration = 1.2 + Math.random()
    //   onEnterFrame: _X+=vx; _Y+=vy; vx/=decel; vy/=decel
    //
    // AS DefineSprite_7_fumee/frame_1/PlaceObject2_6_2/CLIPACTIONRECORD onClipEvent(load).as:
    //   v = random(20)+0; _rotation = random(360); _alpha = 10+random(90)
    //
    // AS DefineSprite_7_fumee/frame_1/PlaceObject2_6_2/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _rotation = _rotation + v; _alpha = _alpha - 20
    this.fumeeSym = {
      name: "fumee",
      totalFrames: 36,
      frames: textures.getFrames("lib_fumee"),
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_7_fumee/frame_1/DoAction.as
        // NOTE: _parent._parent._parent.rotate._rotation is not accessible
        // in the clip model; we use a random angle as the canonical fallback
        // (the rotate MC is an internal visual sub-sprite whose rotation is
        // not exposed through root.vars). The formula seeds vx/vy from it.
        const a = Math.random() * Math.PI * 2;
        const t = 80 * Math.random() + 50;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.x = 20 * (Math.random() - 0.5);
        clip.y = 20 * (Math.random() - 0.5);
        clip.vars.vx = 20 * Math.cos(a);
        clip.vars.vy = 20 * Math.sin(a);
        clip.vars.deceleration = 1.2 + Math.random();

        // AS PlaceObject2_6_2/CLIPACTIONRECORD onClipEvent(load).as
        const v = Math.floor(Math.random() * 20);
        const initRot = Math.floor(Math.random() * 360);
        const initAlpha = 10 + Math.floor(Math.random() * 90);
        clip.rotation = (initRot * Math.PI) / 180;
        clip.alpha = initAlpha / 100;
        clip.vars.v = v;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_7_fumee/frame_1/DoAction.as onEnterFrame
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const deceleration = clip.vars.deceleration as number;
        clip.x += vx;
        clip.y += vy;
        vx /= deceleration;
        vy /= deceleration;
        clip.vars.vx = vx;
        clip.vars.vy = vy;

        // AS PlaceObject2_6_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const v = clip.vars.v as number;
        const curRotDeg = (clip.rotation * 180) / Math.PI;
        clip.rotation = ((curRotDeg + v) * Math.PI) / 180;
        const curAlpha = clip.alpha;
        clip.alpha = curAlpha - 20 / 100;
      },
      frameScripts: new Map([
        [
          30,
          (clip) => {
            // AS DefineSprite_7_fumee/frame_31/DoAction.as
            // this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_cercle — circle particle with physics ---------------
    // AS DefineSprite_10_cercle/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   d = 120 + (_parent._parent._parent.level - 1) * 32
    //   accx = 0.8 + 0.16*Math.random()
    //   x = d*Math.random()
    //   if(random(2)==1){ _Y=5; sr=-1 } else { sr=1; _Y=-5 }
    //   _xscale=0; _yscale=0; t=5; _X=x
    //   va=5+10*Math.random(); vr=(20+40*Math.random())*sr
    //   vt=(0.34+random(1))*((d-x)/d); vx=5+10*Math.random()
    //
    // AS onClipEvent(enterFrame):
    //   _rotation = _rotation - (vr *= 0.96)
    //   _X = _X + (vx *= accx)
    //   t += vt -= 0.0113
    //   _xscale = t; _yscale = t
    //   if(t < 0){ _parent.removeMovieClip() }
    this.cercleSym = {
      name: "cercle",
      totalFrames: 1,
      frames: textures.getFrames("lib_cercle"),
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_10_cercle/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
        // _parent._parent._parent.level: cercle's parent is sprite_22,
        // sprite_22's parent is root. So: clip → sprite_22 → root.
        const root = clip.parent?.parent ?? clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const d = 120 + (level - 1) * 32;
        clip.vars.d = d;
        clip.vars.accx = 0.8 + 0.16 * Math.random();
        const xStart = d * Math.random();
        let yStart: number;
        let sr: number;
        if (Math.floor(Math.random() * 2) === 1) {
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
        clip.vars.vt = (0.34 + Math.floor(Math.random() * 2)) * ((d - xStart) / d);
        clip.vars.vx = 5 + 10 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_10_cercle/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let vr = clip.vars.vr as number;
        let vx = clip.vars.vx as number;
        let vt = clip.vars.vt as number;
        let t = clip.vars.t as number;
        const accx = clip.vars.accx as number;

        vr *= 0.96;
        // AS: _rotation = _rotation - (vr *= 0.96); rotation in degrees
        const curRotDeg = (clip.rotation * 180) / Math.PI;
        clip.rotation = ((curRotDeg - vr) * Math.PI) / 180;

        vx *= accx;
        clip.x += vx;

        vt -= 0.0113;
        t += vt;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;

        clip.vars.vr = vr;
        clip.vars.vx = vx;
        clip.vars.vt = vt;
        clip.vars.t = t;

        if (t < 0) {
          // AS: _parent.removeMovieClip()
          clip.parent?.remove();
        }
      },
    };

    // ---- DefineSprite_2 — smoke emitter container ----------------
    // AS DefineSprite_2/frame_1/DoAction.as:
    //   c = 5
    //   onEnterFrame: if(c < 60){ c++; p=c; while(p < _parent._parent.level+c){
    //     attachMovie("fumee","fumee"+p,p); fumeeP.vx=...; fumeeP.vy=...; p++ } }
    //
    // AS DefineSprite_2/frame_16/DoAction.as: stop()
    //
    // The smoke emitter runs for frames 1-16, emitting fumee particles each
    // frame until c reaches 60 (c starts at 5 so that's 55 frames of
    // emission). frame_16 stops the timeline but onEnterFrame keeps running.
    this.sprite2Sym = {
      name: "sprite_2",
      totalFrames: 16,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_2/frame_1/DoAction.as
            clip.vars.c = 5;
            clip.onEnterFrame = (self, ctx) => {
              let c = self.vars.c as number;
              const parentParent = self.parent?.parent;
              const level = (parentParent?.vars.level as number) ?? 1;
              if (c < 60) {
                c++;
                self.vars.c = c;
                let p = c;
                while (p < level + c) {
                  self.attach(this.fumeeSym, `fumee${p}`, p, ctx);
                  // AS: eval("this.fumee"+p).vx = 20*(Math.random()-0.5)
                  //     eval("this.fumee"+p).vy = 20*(Math.random()-0.5)
                  // These override the vx/vy set in onLoad; we apply them
                  // directly to the child's vars after attach.
                  const child = self.children.get(`fumee${p}`);
                  if (child) {
                    child.vars.vx = 20 * (Math.random() - 0.5);
                    child.vars.vy = 20 * (Math.random() - 0.5);
                  }
                  p++;
                }
              }
            };
          },
        ],
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_3_shoot — 159-frame target timeline --------
    // The shoot animation has authored frames (textures from animations[]).
    // AS DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   t = 50 + 20 * _parent._parent.level
    //   _xscale = t; _yscale = t
    // AS DefineSprite_3_shoot/frame_157/DoAction.as: _parent.removeMovieClip()
    //
    // The shoot clip positions itself at cellTo (as placed by onSpellStart
    // with explicit x/y). It scales based on level via the inner sub-clip's
    // onLoad. We fold that into the symbol's onLoad.
    this.shootSym = {
      name: "shoot",
      totalFrames: 159,
      frames: textures.getFrames("shoot"),
      anchorX: calculateAnchor({
        width: 81.05,
        height: 79.7,
        offsetX: -37.55,
        offsetY: -70.25,
      }).x,
      anchorY: calculateAnchor({
        width: 81.05,
        height: 79.7,
        offsetX: -37.55,
        offsetY: -70.25,
      }).y,
      onLoad: (clip) => {
        // AS DefineSprite_3_shoot/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
        // _parent._parent.level: clip's parent is root (attached via onSpellStart)
        const root = clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const t = 50 + 20 * level;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
      frameScripts: new Map([
        [
          156,
          (clip) => {
            // AS DefineSprite_3_shoot/frame_157/DoAction.as: _parent.removeMovieClip()
            clip.parent?.remove();
          },
        ],
      ]),
    };

    // ---- DefineSprite_22 — main target-side orchestrator ---------
    // AS DefineSprite_22/frame_7/DoAction.as:
    //   nb = 10 + _parent.level*3; c=1; while(c<nb){ attachMovie("cercle","cercle"+c,c); c++ }
    // AS DefineSprite_22/frame_67/DoAction.as: this.end() → signalHit
    // AS DefineSprite_22/frame_139/DoAction.as: this._parent.removeMovieClip() → complete
    //
    // The sprite_22 positions itself at cellTo in frame_1.
    this.sprite22Sym = {
      name: "sprite_22",
      totalFrames: 139,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // Position at cellTo. displayType=51 → root is at world(0,0);
            // children use WORLD coords from root.vars.cellTo.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 50;
            }
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_22/frame_7/DoAction.as
            // nb = 10 + _parent.level*3; c=1; while(c < nb){...}
            const root = clip.parent;
            const level = (root?.vars.level as number) ?? 1;
            const nb = 10 + level * 3;
            let c = 1;
            while (c < nb) {
              clip.attach(this.cercleSym, `cercle${c}`, c, ctx);
              c++;
            }
          },
        ],
        [
          66,
          () => {
            // AS DefineSprite_22/frame_67/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          138,
          (clip) => {
            // AS DefineSprite_22/frame_139/DoAction.as: this._parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumeeSym);
    this.registry.register(this.cercleSym);
    this.registry.register(this.sprite2Sym);
    this.registry.register(this.shootSym);
    this.registry.register(this.sprite22Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("jet_903")
    callbacks.playSound("jet_903");

    // Place the three main timeline children. displayType=51 means the
    // container is at world(0,0); each child positions itself at the
    // canonical world coords in its frame_1 script.
    //
    // sprite_22 positions at cellTo (frame_1 script).
    this.root.attach(this.sprite22Sym, "sprite22", 1, context);

    // shoot positions at cellTo via onLoad (scale) and is placed by
    // onSpellStart at cellTo explicitly.
    const cellTo = context.cellTo;
    this.root.attach(this.shootSym, "shoot", 2, context, {
      x: cellTo.x,
      y: cellTo.y - 50,
    });

    // sprite_2 (smoke emitter) positioned at cellFrom.
    const cellFrom = context.cellFrom;
    this.root.attach(this.sprite2Sym, "sprite2", 3, context, {
      x: cellFrom.x,
      y: cellFrom.y - 50,
    });
  }
}
