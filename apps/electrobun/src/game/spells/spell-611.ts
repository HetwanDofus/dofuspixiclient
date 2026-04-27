/**
 * Spell 611 — Esquive (Dodge / Feca or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/611/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has explicit `move` and `shoot`
 * symbols driven by the harness along a parabolic arc. `move` is a 2-frame
 * composite container that carries pre-placed leaf/debris particles (DefineSprite_13,
 * i.e. symbol 13) which slide horizontally on load. On frame_2 it stores the arc
 * landing rotation on `roti` and stops. `shoot` is a 144-frame composite container
 * that at frame_1 removes the `move` clip and owns several pre-placed sub-clips:
 *   - Multiple PlaceObject2_9_* instances of DefineSprite_9 (tumbling leaf particles)
 *     each with a PlaceObject2_8_1 child (DefineSprite_8, a 4-frame static graphic
 *     that picks a random start frame on load).
 *   - One PlaceObject2_3_3 instance (DefineSprite_3, a 16-frame burst graphic, stops
 *     at frame 16) whose onLoad sets its rotation to `_parent._parent.roti`.
 *   - At frame 109 a PlaceObject2_10_1 child (DefineSprite_2, a 46-frame graphic,
 *     stops at frame 46) with an onEnterFrame that fades `_parent._alpha -= 3`.
 *   - frame_142: stop().
 *
 * Because `shoot` and `move` appear in `animations[]` only (NOT in `librarySymbols[]`),
 * their texture keys are the bare animation names "shoot" and "move" — NO "lib_" prefix.
 * The manifest has NO librarySymbols entries.
 *
 * The harness fires `signalHit()` automatically on ballistic landing (displayType 30).
 * `complete()` is fired from shoot's frame_142 (the canonical stop + end of animation).
 *
 * Library symbols overview (all inlined as authored composites, frames carried by textures):
 *   - "shoot" — 144-frame impact composite. frame_1 removes move; frame_142 stops + complete.
 *   - "move"  — 2-frame projectile container. frame_2 stores roti, stops.
 *
 * Pre-placed children modelled as nested SymbolDefinitions:
 *   - DefineSprite_13 (leaf drifter, inside move): onLoad seeds v; onEnterFrame drifts X.
 *   - DefineSprite_9 (tumbling particle, inside shoot): onLoad seeds roti/dv/v/vx/vy/p/cacc;
 *     has its own onEnterFrame (AS `this.onEnterFrame` set in DoAction); carries a
 *     DefineSprite_8 child (c) as PlaceObject2_8_1.
 *   - DefineSprite_8 (4-frame static, child of DefineSprite_9): onLoad picks random frame.
 *   - DefineSprite_3 (16-frame burst, inside shoot): frame_16 stops. onLoad sets rotation
 *     to _parent._parent.roti.
 *   - DefineSprite_2 (46-frame fade-out, inside shoot): frame_46 stops. Its placed child
 *     (PlaceObject2_10_1) has onEnterFrame that fades _parent._alpha.
 *
 * Main timeline: SOMA.playSound("dodge_601") — no explicit child attaches (harness handles
 * move/shoot for displayType 30).
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

// --- Bounds from manifest animations[] entries ---
const SHOOT_BOUNDS = {
  width: 108.5,
  height: 43.5,
  offsetX: -66,
  offsetY: -27.25,
};
const MOVE_BOUNDS = {
  width: 161.15,
  height: 44.1,
  offsetX: -98.4,
  offsetY: -21.7,
};

export class Spell611 extends RuntimeSpell {
  readonly spellId = 611;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- DefineSprite_8 — 4-frame static sub-graphic (child "c" of DefineSprite_9) ----
    // These are pre-placed inside each DefineSprite_9 instance as PlaceObject2_8_1.
    // onLoad: gotoAndStop(random(_totalframes) + 1) → picks a random frame and stops.
    const sprite8Sym: SymbolDefinition = {
      name: "sprite8",
      totalFrames: 4,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_11_shoot/frame_1/PlaceObject2_9_*/child onClipEvent(load)
        // and also via DefineSprite_8/frame_1/DoAction.as: gotoAndStop(random(4)+1)
        const frame = Math.floor(Math.random() * clip.totalFrames);
        clip.gotoAndStop(frame);
      },
    };

    // ---- DefineSprite_9 — tumbling leaf particle (multiple instances inside shoot) ----
    // AS: DefineSprite_9/frame_1/DoAction.as — seeds physics vars and sets up onEnterFrame.
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(load) — seeds vrot/vrot2 on child "c".
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(enterFrame) — spins child "c".
    //
    // The authored DoAction seeds physics on "this" (the sprite9 clip) and references
    // "c" which is the pre-placed PlaceObject2_8_1 child. We model "c" as sprite8Sym
    // attached during sprite9's frame_1 script, then store a reference in vars.
    const sprite9Sym: SymbolDefinition = {
      name: "sprite9",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_9/frame_1/DoAction.as
            // roti = _parent._parent.roti - 30 + 60 * Math.random();
            // c._rotation = roti;
            // dv = 1.05 + 0.2 * Math.random();
            // v = 3 + 10 * Math.random();
            // vx = v * Math.cos(roti * PI / 180);
            // vy = v * Math.sin(roti * PI / 180);
            // p = 60 - random(30);
            // cacc = 0.3 + 0.3 * Math.random();
            const parentParent = clip.parent?.parent;
            const roti =
              ((parentParent?.vars.roti as number) ?? 0) -
              30 +
              60 * Math.random();
            clip.vars.roti = roti;

            // Attach child "c" (DefineSprite_8) and set its rotation.
            const childC = clip.attach(sprite8Sym, "c", 1, ctx);
            childC.rotation = (roti * Math.PI) / 180;

            const dv = 1.05 + 0.2 * Math.random();
            const v = 3 + 10 * Math.random();
            const vx = v * Math.cos((roti * Math.PI) / 180);
            const vy = v * Math.sin((roti * Math.PI) / 180);
            const p = 60 - Math.floor(Math.random() * 30);
            const cacc = 0.3 + 0.3 * Math.random();

            clip.vars.dv = dv;
            clip.vars.vx = vx;
            clip.vars.vy = vy;
            clip.vars.p = p;
            clip.vars.cacc = cacc;

            // Seed vrot/vrot2 on child c (mirrors PlaceObject2_8_1 onClipEvent(load))
            // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load)
            childC.vars.vrot = -25 + 50 * Math.random();
            childC.vars.vrot2 = -0.3 + 0.6 * Math.random();
            childC.vars.i = 0;

            // Wire child c's onEnterFrame (mirrors PlaceObject2_8_1 onClipEvent(enterFrame))
            // AS: if(_Y < _parent.p) { vrot2 /= 1.16; _xscale = 50*sin(i+=vrot2); _rotation += vrot; }
            childC.onEnterFrame = (c) => {
              const parentP = c.parent?.vars.p as number;
              if (c.y < parentP) {
                let vrot2 = c.vars.vrot2 as number;
                const vrot = c.vars.vrot as number;
                let i = c.vars.i as number;
                vrot2 /= 1.16;
                i += vrot2;
                c.scaleX = (50 * Math.sin(i)) / 100;
                c.rotation += (vrot * Math.PI) / 180;
                c.vars.vrot2 = vrot2;
                c.vars.i = i;
              }
            };
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_9/frame_1/DoAction.as — this.onEnterFrame
        // if(c._y < p) { c._y += cacc; _X += vx; _Y += vy; vx /= dv; vy /= dv; }
        const p = clip.vars.p as number;
        const childC = clip.children.get("c");
        if (!childC) {
          return;
        }
        if (childC.y < p) {
          const cacc = clip.vars.cacc as number;
          let vx = clip.vars.vx as number;
          let vy = clip.vars.vy as number;
          const dv = clip.vars.dv as number;
          childC.y += cacc;
          clip.x += vx;
          clip.y += vy;
          vx /= dv;
          vy /= dv;
          clip.vars.vx = vx;
          clip.vars.vy = vy;
        }
      },
    };

    // ---- DefineSprite_3 — 16-frame burst graphic inside shoot ----
    // AS: DefineSprite_3/frame_16/DoAction.as: stop()
    // AS: DefineSprite_11_shoot/frame_1/PlaceObject2_3_3/onClipEvent(load):
    //   _rotation = _parent._parent.roti;
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 16,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_11_shoot/frame_1/PlaceObject2_3_3/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = _parent._parent.roti
        const roti = (clip.parent?.parent?.vars.roti as number) ?? 0;
        clip.rotation = (roti * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS: DefineSprite_3/frame_16/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_2 — 46-frame fade graphic inside shoot ----
    // AS: DefineSprite_2/frame_46/DoAction.as: stop()
    // AS: DefineSprite_11_shoot/frame_109/PlaceObject2_10_1/onClipEvent(enterFrame):
    //   _parent._alpha -= 3
    // The PlaceObject2_10_1 child is placed at frame_109 of shoot (not frame_1).
    // We model sprite2 itself as the fade target; it is attached at shoot's frame 108
    // and its onEnterFrame fades itself (mirroring "_parent._alpha -= 3" where _parent
    // was the outer shoot clip). Since the child's enterFrame fires on the child but
    // decrements _parent._alpha, we implement it as the child fading the shoot parent.
    const sprite2Sym: SymbolDefinition = {
      name: "sprite2",
      totalFrames: 46,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_11_shoot/frame_109/PlaceObject2_10_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._alpha -= 3  (the child's _parent is shoot)
        const parent = clip.parent;
        if (parent) {
          parent.alpha = Math.max(0, parent.alpha - 3 / 100);
        }
      },
      frameScripts: new Map([
        [
          45,
          (clip) => {
            // AS: DefineSprite_2/frame_46/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_13 — horizontal drifter inside move ----
    // AS: DefineSprite_13/frame_1/DoAction.as
    // v = 2 * Math.random() - 3; this.onEnterFrame = function() { _X += v; }
    // Multiple instances are pre-placed inside move (PlaceObject2_13_1/5/9/13/17/21).
    // Each gets a random horizontal velocity. We model this as a single SymbolDefinition
    // with an onEnterFrame.
    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_13/frame_1/DoAction.as
            // v = 2 * Math.random() - 3;
            clip.vars.v = 2 * Math.random() - 3;
          },
        ],
      ]),
      onEnterFrame: (clip) => {
        // AS: DefineSprite_13/frame_1/DoAction.as — this.onEnterFrame
        // _X = _X + v;
        const v = clip.vars.v as number;
        clip.x += v;
      },
    };

    // ---- move — 2-frame projectile container ----
    // Manifest: animations[]{name:"move"}, no lib_ prefix.
    // Pre-placed children: 6 instances of DefineSprite_13 (PlaceObject2_13_1/5/9/13/17/21),
    // each with onLoad: gotoAndStop(random(_totalframes)+1) — but sprite13 has totalFrames=1
    // so this is a no-op; the meaningful init is in sprite13's own frame_1 DoAction.
    // AS: DefineSprite_14_move/frame_1/PlaceObject2_13_*/onClipEvent(load): gotoAndStop(random+1)
    // AS: DefineSprite_14_move/frame_2/DoAction.as: _parent.roti = _rotation; stop()
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 2,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_14_move/frame_1 — attach 6 drift particles
            // PlaceObject2_13_1, _5, _9, _13, _17, _21
            const depths = [1, 5, 9, 13, 17, 21];
            for (const depth of depths) {
              const inst = clip.attach(
                sprite13Sym,
                `sprite13_${depth}`,
                depth,
                ctx,
              );
              // AS: PlaceObject2_13_*/onClipEvent(load): gotoAndStop(random(_totalframes)+1)
              // sprite13 totalFrames=1, so this resolves to gotoAndStop(0) — no-op effectively
              const frame = Math.floor(Math.random() * inst.totalFrames);
              inst.gotoAndStop(frame);
            }
          },
        ],
        [
          1,
          (clip) => {
            // AS: DefineSprite_14_move/frame_2/DoAction.as
            // _parent.roti = _rotation; stop();
            const parent = clip.parent;
            if (parent) {
              // _rotation here is the move clip's rotation (set by harness ballistic arc)
              // in AS degrees; clip.rotation is in radians, convert back to degrees for roti.
              parent.vars.roti = (clip.rotation * 180) / Math.PI;
            }
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 144-frame impact composite ----
    // Manifest: animations[]{name:"shoot"}, no lib_ prefix.
    // Pre-placed at frame_1:
    //   - PlaceObject2_9_15/17/19/21/23/25 — 6 instances of DefineSprite_9 (tumbling leaves)
    //     each with onLoad: gotoAndStop(random(_totalframes)+1) — sprite9 has totalFrames=1.
    //   - PlaceObject2_3_3 — 1 instance of DefineSprite_3 (burst)
    // Placed at frame_109:
    //   - PlaceObject2_10_1 — 1 instance of DefineSprite_2 (fade-out child)
    // AS: DefineSprite_11_shoot/frame_1/DoAction.as: _parent.move.removeMovieClip()
    // AS: DefineSprite_11_shoot/frame_142/DoAction.as: stop()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 144,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_11_shoot/frame_1/DoAction.as
            // _parent.move.removeMovieClip() — kill the move clip on the outer mc (root)
            const parent = clip.parent;
            if (parent) {
              const moveClip = parent.children.get("move");
              if (moveClip) {
                moveClip.remove();
              }
            }

            // AS: PlaceObject2_9_15/17/19/21/23/25 — 6 tumbling leaf particles
            const leafDepths = [15, 17, 19, 21, 23, 25];
            for (const depth of leafDepths) {
              const inst = clip.attach(sprite9Sym, `sprite9_${depth}`, depth, ctx);
              // AS: PlaceObject2_9_*/onClipEvent(load): gotoAndStop(random(_totalframes)+1)
              const frame = Math.floor(Math.random() * inst.totalFrames);
              inst.gotoAndStop(frame);
            }

            // AS: PlaceObject2_3_3 — burst graphic
            clip.attach(sprite3Sym, "sprite3_3", 3, ctx);
          },
        ],
        [
          108,
          (clip, ctx) => {
            // AS: DefineSprite_11_shoot/frame_109 — places PlaceObject2_10_1 (DefineSprite_2)
            clip.attach(sprite2Sym, "sprite2_1", 1, ctx);
          },
        ],
        [
          141,
          (clip) => {
            // AS: DefineSprite_11_shoot/frame_142/DoAction.as: stop()
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite8Sym);
    this.registry.register(sprite9Sym);
    this.registry.register(sprite3Sym);
    this.registry.register(sprite2Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("dodge_601")
    callbacks.playSound("dodge_601");
  }
}
