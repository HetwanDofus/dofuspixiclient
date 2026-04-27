/**
 * Spell 1015 — (Ecaflip / Roue de la Fortune style fire-ball drop).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1015/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The outer sprite (DefineSprite_21) positions
 * itself at _parent.cellTo in its frame_1, reads _parent.cellFrom on the two
 * main-timeline clips (PlaceObject2_15 and PlaceObject2_16), and signals hit
 * from frame_52. frame_124 calls _parent.removeMovieClip() → complete().
 *
 * Architecture:
 *   DefineSprite_21 ("sprite21") — 124-frame outer container placed at cellTo.
 *     frame_1:  self._X = _parent.cellTo.x; self._Y = _parent.cellTo.y
 *     frame_52: this.end() → signalHit
 *     frame_124: _parent.removeMovieClip() → complete
 *
 *   main-timeline frame_2 places TWO clips with clip events:
 *     PlaceObject2_15_1 ("gen"):
 *       onLoad: _X = cellFrom.x; _Y = cellFrom.y - 100; swapDepths(50)
 *       (static reference point — "gen" — that sol and frag read for their
 *        initial position/rotation)
 *
 *     PlaceObject2_16_5 ("shooter"):
 *       onLoad:  seeds angle=90, vr, limy, done, c; positions at cellFrom - 100y
 *       onEnterFrame: steers angle randomly (±50 deg around BASE=90), moves at
 *                     VEL=7.67 px/frame; every 5 ticks spawns a "frag" lib
 *                     symbol; when _Y >= limy attaches a "sol" lib symbol then
 *                     sets done=true (no more motion).
 *
 *   lib_sol  — 87-frame ground-impact glow. frame_1 positions at gen._x/gen._y;
 *              frame_85 stops.
 *   lib_frag — 72-frame fire-trail fragment. frame_1 positions at gen._x/gen._y
 *              and copies gen._rotation; frame_70 removes self.
 *
 *   DefineSprite_15 ("sprite15") — separate inner sprite with a frame_70 stop.
 *
 * Library symbols registered: "frag", "sol".
 *
 * The harness for displayType=50 leaves root at world (0,0). This spell places
 * sprite21 at cellTo (world abs) from its own frame_1, and the main-timeline
 * gen/shooter clips at cellFrom (world abs) from their onLoad handlers. That is
 * exactly the WorldAbsolute pattern.
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

const FRAG_BOUNDS = {
  width: 687.05,
  height: 44.95,
  offsetX: -346.2,
  offsetY: -22.95,
};

const SOL_BOUNDS = {
  width: 132.05,
  height: 90.3,
  offsetX: -69.7,
  offsetY: -82.45,
};

export class Spell1015 extends RuntimeSpell {
  readonly spellId = 1015;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private fragSym!: SymbolDefinition;
  private solSym!: SymbolDefinition;
  private sprite21Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private genSym!: SymbolDefinition;
  private shooterSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const fragAnchor = calculateAnchor(FRAG_BOUNDS);
    const solAnchor = calculateAnchor(SOL_BOUNDS);

    // ---- lib_frag — 72-frame fire-trail fragment -----------------
    // AS: DefineSprite_10_frag/frame_1/DoAction.as
    //   _X = _parent.gen._x;
    //   _Y = _parent.gen._y;
    //   _rotation = _parent.gen._rotation;
    // AS: DefineSprite_10_frag/frame_70/DoAction.as
    //   removeMovieClip(this);
    //
    // Note: frag is attachMovie'd by the shooter's onEnterFrame with
    // {_x, _y} initObject overriding position. frame_1 ALSO sets the
    // position from gen, but the initObject values take effect before
    // frame_1 fires (canonical Flash: initObject applied at construction,
    // frame_1 DoAction then runs). To stay faithful we read gen from the
    // parent (shooter's parent = root) in frame_1, mirroring the AS
    // `_parent.gen` reference chain exactly. In practice the shooter
    // already passed {_x, _y} so the frame_1 assignment is redundant,
    // but we port it for correctness.
    this.fragSym = {
      name: "frag",
      totalFrames: 72,
      frames: textures.getFrames("lib_frag"),
      anchorX: fragAnchor.x,
      anchorY: fragAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10_frag/frame_1/DoAction.as
            // _parent here is the clip that called attachMovie — in
            // the shooter path that is the root (shooter.parent is root;
            // frag is attached to root via rootMC.attachMovie).
            const root = clip.parent;
            const gen = root?.children.get("gen");
            if (gen) {
              clip.x = gen.x;
              clip.y = gen.y;
              clip.rotation = gen.rotation;
            }
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_10_frag/frame_70/DoAction.as
            // removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_sol — 87-frame ground-impact glow -------------------
    // AS: DefineSprite_5_sol/frame_1/DoAction.as
    //   _X = _parent.gen._x;
    //   _Y = _parent.gen._y;
    // AS: DefineSprite_5_sol/frame_85/DoAction.as
    //   stop();
    this.solSym = {
      name: "sol",
      totalFrames: 87,
      frames: textures.getFrames("lib_sol"),
      anchorX: solAnchor.x,
      anchorY: solAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_5_sol/frame_1/DoAction.as
            // _parent.gen references the gen clip on root
            const root = clip.parent;
            const gen = root?.children.get("gen");
            if (gen) {
              clip.x = gen.x;
              clip.y = gen.y;
            }
          },
        ],
        [
          84,
          (clip) => {
            // AS DefineSprite_5_sol/frame_85/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_21 — outer 124-frame container placed at cellTo --
    // AS: DefineSprite_21/frame_1/DoAction.as
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    // AS: DefineSprite_21/frame_52/DoAction.as
    //   this.end(); → signalHit
    // AS: DefineSprite_21/frame_124/DoAction.as
    //   _parent.removeMovieClip(); → complete
    this.sprite21Sym = {
      name: "sprite21",
      totalFrames: 124,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_21/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          51,
          () => {
            // AS DefineSprite_21/frame_52/DoAction.as
            // this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          123,
          (clip) => {
            // AS DefineSprite_21/frame_124/DoAction.as
            // _parent.removeMovieClip()
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_15 — inner sprite with frame_70 stop -------
    // AS: DefineSprite_15/frame_70/DoAction.as
    //   stop();
    this.sprite15Sym = {
      name: "sprite15",
      totalFrames: 70,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          69,
          (clip) => {
            // AS DefineSprite_15/frame_70/DoAction.as
            // stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- gen — static reference clip (PlaceObject2_15_1) ---------
    // AS: frame_2/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 100;
    //   swapDepths(50);  ← no-op in our runtime
    //
    // This clip is referenced by sol and frag as `_parent.gen` to get
    // the current spawn position/rotation. It is a static marker that
    // the "shooter" clip updates in lockstep (the shooter's _X/_Y
    // represent gen's position — in canonical AS they ARE the same clip
    // object via PlaceObject2_16_5, but here we use a dedicated "gen"
    // clip that the shooter keeps in sync).
    this.genSym = {
      name: "gen",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as
          | { x: number; y: number }
          | undefined;
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y - 100;
        }
      },
    };

    // ---- shooter — motion + spawner clip (PlaceObject2_16_5) -----
    // AS: frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(load).as
    //   var rootMC = _parent;
    //   var DEG2RAD = 0.017453292519943295;
    //   var LIM = 50;
    //   var BASE = 90;
    //   var VEL = 7.67;
    //   _X = rootMC.cellFrom.x;
    //   _Y = rootMC.cellFrom.y - 100;
    //   angle = BASE;
    //   vr = (Math.random() - 0.5) * 5;
    //   limy = _Y + 90 + Math.random() * 20;
    //   done = false;
    //   c = 0;
    //
    // AS: frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   if(done) { return; }
    //   if(_Y < limy) {
    //     if(c++ % 5 == 0) { vr = (Math.random()-0.5)*50; }
    //     angle = Math.max(BASE-LIM, Math.min(BASE+LIM, angle+vr));
    //     _rotation = angle;
    //     _X += VEL * Math.cos(angle * DEG2RAD);
    //     _Y += VEL * Math.sin(angle * DEG2RAD);
    //     rootMC.attachMovie("frag","frag"+c, c, {_x:_X, _y:_Y});
    //   } else {
    //     done = true;
    //     rootMC.attachMovie("sol","solImpact",1000,{_x:_X,_y:_Y});
    //   }
    this.shooterSym = {
      name: "shooter",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(load).as
        const root = clip.parent;
        const cellFrom = root?.vars.cellFrom as
          | { x: number; y: number }
          | undefined;
        const startX = cellFrom?.x ?? 0;
        const startY = (cellFrom?.y ?? 0) - 100;
        clip.x = startX;
        clip.y = startY;
        clip.vars.angle = 90;
        clip.vars.vr = (Math.random() - 0.5) * 5;
        clip.vars.limy = startY + 90 + Math.random() * 20;
        clip.vars.done = false;
        clip.vars.c = 0;

        // Keep gen in sync from the start
        const gen = root?.children.get("gen");
        if (gen) {
          gen.x = startX;
          gen.y = startY;
        }
      },
      onEnterFrame: (clip, ctx) => {
        // AS frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
        if (clip.vars.done as boolean) {
          return;
        }

        const DEG2RAD = 0.017453292519943295;
        const LIM = 50;
        const BASE = 90;
        const VEL = 7.67;

        const limy = clip.vars.limy as number;
        let angle = clip.vars.angle as number;
        let vr = clip.vars.vr as number;
        let c = clip.vars.c as number;

        if (clip.y < limy) {
          if (c % 5 === 0) {
            vr = (Math.random() - 0.5) * 50;
            clip.vars.vr = vr;
          }
          c++;
          clip.vars.c = c;

          angle = Math.max(BASE - LIM, Math.min(BASE + LIM, angle + vr));
          clip.vars.angle = angle;

          // AS: _rotation = angle  (degrees)
          clip.rotation = (angle * Math.PI) / 180;

          const rad = angle * DEG2RAD;
          clip.x += VEL * Math.cos(rad);
          clip.y += VEL * Math.sin(rad);

          // Keep the gen marker in sync so that frag/sol frame_1 reads
          // the correct spawn position.
          const root = clip.parent;
          const gen = root?.children.get("gen");
          if (gen) {
            gen.x = clip.x;
            gen.y = clip.y;
            gen.rotation = clip.rotation;
          }

          // rootMC.attachMovie("frag","frag"+c, c, {_x:_X, _y:_Y})
          // The {_x, _y} initObject sets the clip's initial position
          // before frame_1 fires; we pass it as a transform to attach().
          if (root) {
            root.attach(this.fragSym, `frag${c}`, c, ctx, {
              x: clip.x,
              y: clip.y,
              rotation: clip.rotation,
            });
          }
        } else {
          clip.vars.done = true;

          // rootMC.attachMovie("sol","solImpact",1000,{_x:_X,_y:_Y})
          const root = clip.parent;
          if (root) {
            root.attach(this.solSym, "solImpact", 1000, ctx, {
              x: clip.x,
              y: clip.y,
            });
          }
        }
      },
    };

    this.registry.register(this.fragSym);
    this.registry.register(this.solSym);
    this.registry.register(this.sprite21Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.genSym);
    this.registry.register(this.shooterSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: stop()
    // PlaceObject2_15_1 (gen) and PlaceObject2_16_5 (shooter) are placed
    // on the timeline at frame_2 with their clip events. We attach them
    // here so they start ticking from the next runtime frame.

    // sprite21 is placed on the main timeline as well (the outer container
    // that holds the hit and completion signals, anchored at cellTo).
    this.root.attach(this.sprite21Sym, "sprite21", 21, context);

    // gen — static position marker read by frag/sol frame_1 scripts
    this.root.attach(this.genSym, "gen", 15, context);

    // shooter — steering + spawner
    this.root.attach(this.shooterSym, "shooter", 16, context);
  }
}
