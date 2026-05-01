/**
 * Spell 1015 — (Earth/Rock impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1015/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline places two sprites at
 * world-absolute coords:
 *   - PlaceObject2_15_1 (DefineSprite_15): a "generator" sprite anchored at
 *     cellFrom (caster). Positioned on load at (_parent.cellFrom.x,
 *     _parent.cellFrom.y - 100). Contains DefineSprite_15/frame_70/stop().
 *     This is accessed by `sol` and `frag` as `_parent.gen` to read _x/_y/_rotation.
 *   - PlaceObject2_16_5 (DefineSprite_16 — the outer orchestration sprite):
 *     Also anchored near cellFrom. onLoad seeds motion state. onEnterFrame
 *     drives a ballistic arc by updating angle + position, spawning `frag`
 *     clips along the trajectory via attachMovie("frag", ...), and at the
 *     end spawning a `sol` clip at the landing position via
 *     attachMovie("sol", "solImpact", 1000, ...).
 *
 * Library symbols:
 *   - lib_frag — 72-frame projectile fragment. frame_1: positions self at
 *     _parent.gen._x/_y + _parent.gen._rotation. frame_70: removeMovieClip(this).
 *   - lib_sol  — 87-frame ground impact. frame_1: positions self at
 *     _parent.gen._x/_y. frame_85: stop().
 *
 * The outer DefineSprite_21 wraps the whole thing:
 *   frame_1:   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
 *   frame_52:  this.end()  → signalHit
 *   frame_124: _parent.removeMovieClip() → complete
 *
 * The "gen" sprite (PlaceObject2_15_1) acts purely as a transform source
 * for sol and frag children — they read gen._x, gen._y, gen._rotation.
 * We model gen as a simple container-only symbol whose onLoad sets its
 * position, and whose position is updated each tick by the orchestrator
 * (PlaceObject2_16_5) before it attaches frag/sol children.
 *
 * Because the outermost authored clip (DefineSprite_21) positions itself at
 * cellTo on frame_1 — and both sub-sprites read cellFrom from _parent (the
 * root), not from DefineSprite_21 — we use displayType=50 (WorldAbsolute)
 * so the root container sits at world (0,0) and all children position
 * themselves using absolute world coords from root.vars.cellFrom /
 * root.vars.cellTo.
 *
 * Hit signal: frame_52 of DefineSprite_21 (this.end() → signalHit).
 * Complete:   frame_124 of DefineSprite_21 (_parent.removeMovieClip() → complete).
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

// Bounds from manifest.json librarySymbols[]
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
  private genSym!: SymbolDefinition;
  private sprite21Sym!: SymbolDefinition;
  private orchestratorSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fragAnchor = calculateAnchor(FRAG_BOUNDS);
    const solAnchor = calculateAnchor(SOL_BOUNDS);

    // ---- lib_frag — 72-frame projectile fragment -----------------
    // AS DefineSprite_10_frag/frame_1/DoAction.as:
    //   _X = _parent.gen._x;
    //   _Y = _parent.gen._y;
    //   _rotation = _parent.gen._rotation;
    // AS DefineSprite_10_frag/frame_70/DoAction.as:
    //   removeMovieClip(this);
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
            clip.remove();
          },
        ],
      ]),
    };

    // ---- lib_sol — 87-frame ground impact ------------------------
    // AS DefineSprite_5_sol/frame_1/DoAction.as:
    //   _X = _parent.gen._x;
    //   _Y = _parent.gen._y;
    // AS DefineSprite_5_sol/frame_85/DoAction.as:
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
            clip.stop();
          },
        ],
      ]),
    };

    // ---- gen — container-only "generator" sprite -----------------
    // This is PlaceObject2_15_1 (DefineSprite_15). It acts as a
    // transform source for sol and frag — they read gen._x, gen._y,
    // gen._rotation. The orchestrator updates gen's position each frame
    // before attaching frag/sol children.
    //
    // AS frame_2/PlaceObject2_15_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y - 100;
    //   swapDepths(50);  (depth handled at attach-time)
    //
    // AS DefineSprite_15/frame_70/DoAction.as:
    //   stop();
    this.genSym = {
      name: "gen",
      totalFrames: 70,
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
      frameScripts: new Map([
        [
          69,
          (clip) => {
            // AS DefineSprite_15/frame_70/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- orchestrator — PlaceObject2_16_5 (DefineSprite_16) ------
    // This clip drives the ballistic motion and spawns frag/sol clips.
    //
    // AS frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(load).as:
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
    // AS frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   if(done) { return; }
    //   if(_Y < limy) {
    //     if(c++ % 5 == 0) { vr = (Math.random()-0.5)*50; }
    //     angle = Math.max(BASE-LIM, Math.min(BASE+LIM, angle+vr));
    //     _rotation = angle;
    //     var rad = angle * DEG2RAD;
    //     _X += VEL * cos(rad);
    //     _Y += VEL * sin(rad);
    //     rootMC.attachMovie("frag","frag"+c, c, {_x:_X,_y:_Y});
    //   } else {
    //     done = true;
    //     rootMC.attachMovie("sol","solImpact",1000,{_x:_X,_y:_Y});
    //   }
    this.orchestratorSym = {
      name: "orchestrator",
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
        if (cellFrom) {
          clip.x = cellFrom.x;
          clip.y = cellFrom.y - 100;
        }
        clip.vars.DEG2RAD = 0.017453292519943295;
        clip.vars.LIM = 50;
        clip.vars.BASE = 90;
        clip.vars.VEL = 7.67;
        clip.vars.angle = 90;
        clip.vars.vr = (Math.random() - 0.5) * 5;
        clip.vars.limy = clip.y + 90 + Math.random() * 20;
        clip.vars.done = false;
        clip.vars.c = 0;
      },
      onEnterFrame: (clip, ctx) => {
        // AS frame_2/PlaceObject2_16_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
        const done = clip.vars.done as boolean;
        if (done) {
          return;
        }

        const DEG2RAD = clip.vars.DEG2RAD as number;
        const LIM = clip.vars.LIM as number;
        const BASE = clip.vars.BASE as number;
        const VEL = clip.vars.VEL as number;
        const limy = clip.vars.limy as number;
        let angle = clip.vars.angle as number;
        let vr = clip.vars.vr as number;
        let c = clip.vars.c as number;

        const root = clip.parent;

        if (clip.y < limy) {
          // Increment c first (c++ means use current then increment)
          const cCurrent = c;
          c = c + 1;
          clip.vars.c = c;

          if (cCurrent % 5 === 0) {
            vr = (Math.random() - 0.5) * 50;
            clip.vars.vr = vr;
          }

          angle = Math.max(BASE - LIM, Math.min(BASE + LIM, angle + vr));
          clip.vars.angle = angle;

          // AS: _rotation = angle (degrees)
          clip.rotation = (angle * Math.PI) / 180;

          const rad = angle * DEG2RAD;
          clip.x = clip.x + VEL * Math.cos(rad);
          clip.y = clip.y + VEL * Math.sin(rad);

          // Update the gen sprite's transform so frag can read it
          const gen = root?.children.get("gen");
          if (gen) {
            gen.x = clip.x;
            gen.y = clip.y;
            gen.rotation = clip.rotation;
          }

          // rootMC.attachMovie("frag","frag"+c, c, {_x:_X,_y:_Y});
          if (root) {
            const fragClip = root.attach(
              this.fragSym,
              `frag${cCurrent}`,
              cCurrent,
              ctx
            );
            // The frag frame_1 script reads gen._x/_y/_rotation which we
            // updated above, but since attach fires frame_1 immediately,
            // we set position directly here as well to match the
            // initObject {_x:_X, _y:_Y} pattern from canonical AS.
            fragClip.x = clip.x;
            fragClip.y = clip.y;
            fragClip.rotation = clip.rotation;
          }
        } else {
          clip.vars.done = true;

          // Update gen one final time at landing position
          const gen = root?.children.get("gen");
          if (gen) {
            gen.x = clip.x;
            gen.y = clip.y;
            gen.rotation = clip.rotation;
          }

          // rootMC.attachMovie("sol","solImpact",1000,{_x:_X,_y:_Y});
          if (root) {
            const solClip = root.attach(
              this.solSym,
              "solImpact",
              1000,
              ctx
            );
            // Apply the initObject _x/_y directly (frame_1 also reads
            // gen, but initObject takes precedence in canonical AS).
            solClip.x = clip.x;
            solClip.y = clip.y;
          }
        }
      },
    };

    // ---- sprite_21 — outer wrapper: positions at cellTo, fires hit/complete
    // AS DefineSprite_21/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    // AS DefineSprite_21/frame_52/DoAction.as:
    //   this.end();  → signalHit
    // AS DefineSprite_21/frame_124/DoAction.as:
    //   _parent.removeMovieClip();  → complete
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
            // AS DefineSprite_21/frame_52/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          123,
          (clip) => {
            // AS DefineSprite_21/frame_124/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fragSym);
    this.registry.register(this.solSym);
    this.registry.register(this.genSym);
    this.registry.register(this.orchestratorSym);
    this.registry.register(this.sprite21Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_2/DoAction.as: stop()
    // The main timeline stops on frame_2 (the first authored frame with
    // content). We attach the three authored children:
    //   PlaceObject2_15_1 — gen sprite (depth 50 after swapDepths)
    //   PlaceObject2_16_5 — orchestrator sprite (depth 5)
    //   DefineSprite_21   — outer wrapper at cellTo (depth 1, implicit)

    // Attach gen first so orchestrator can reference it in its onLoad
    // (gen is placed before the orchestrator in AS timeline order).
    this.root.attach(this.genSym, "gen", 50, context);

    // Attach orchestrator — onLoad runs immediately and can find gen.
    this.root.attach(this.orchestratorSym, "orchestrator", 5, context);

    // Attach the outer DefineSprite_21 wrapper.
    this.root.attach(this.sprite21Sym, "sprite21", 1, context);
  }
}
