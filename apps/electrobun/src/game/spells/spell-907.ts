/**
 * Spell 907 — Flèche de Glace (Cra ice arrow / "many" variant).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/907/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no move/shoot/duplicate
 * symbols and no caster-reference in the scripts — it is a pure
 * impact effect anchored at the target cell. The single authored
 * timeline (DefineSprite_15, 244 frames) lives entirely at the target
 * and removes the outer mc at frame_244.
 *
 * Library symbols (all attached inside the composite anim1 timeline):
 *
 *   DefineSprite_10 — "flash" cross sprite. frame_1 seeds rotation,
 *     alpha, i on the parent vars. PlaceObject2_9_1 child reads those
 *     and animates _xscale = 100*sin(i += 0.067) each frame.
 *
 *   DefineSprite_3  — "drop" falling particle. PlaceObject2_2_1 child:
 *     onLoad seeds v=0; onEnterFrame integrates gravity (v += 0.6),
 *     bounces at Y=0 with v = -5*random, drifts X.
 *
 *   DefineSprite_13 — "cross2" double-axis cross sprite. Has TWO
 *     placed children: PlaceObject2_6_1 (sin scaler) and
 *     PlaceObject2_12_5 (cos scaler), mirroring DefineSprite_10's
 *     inner child for both axes.
 *
 *   DefineSprite_14 — "orb" rising/fading orb. PlaceObject2_13_1:
 *     onLoad seeds p,i,v2,rotation,_alpha=130,_parent._alpha=10,v.
 *     onEnterFrame: fades parent in while Y > -100, fades out when
 *     Y < -100 (removes when alpha < 0); rotates; oscillates X/Y;
 *     adjusts own alpha when cos(i) < 0.
 *
 *   DefineSprite_15 — outer 244-frame composite timeline. frame_244
 *     calls `_parent.removeMovieClip()` and signals spell completion.
 *
 * Because librarySymbols[] is empty in the manifest, there is NO
 * lib_ prefix — anim1 is the only entry in animations[], and it is
 * the rendered composite. The inner DefineSprite symbols are not
 * individually addressable via textures; anim1 holds the baked
 * composite frames. We register the outer container (anim1Sym) whose
 * frame_244 fires complete(), and for the inner symbols we register
 * them as container-only stubs so the runtime tree is structurally
 * correct even though visual content is provided by the baked anim1
 * frames.
 *
 * Main timeline: SOMA.playSound("many_504"); (frame_1/DoAction.as)
 *
 * signalHit: fired at frame_244 (the canonical impact completion),
 * just before complete(). No earlier hit frame is specified in the
 * canonical AS, so we colocate hit + complete at the terminal frame.
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

// anim1 bounds from manifest.json animations[0]
const ANIM1_BOUNDS = {
  width: 43.75,
  height: 22.45,
  offsetX: -22.6,
  offsetY: -11,
};

export class Spell907 extends RuntimeSpell {
  readonly spellId = 907;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_10 inner child (PlaceObject2_9_1) ----------
    // This is the "flash" sub-child placed INSIDE DefineSprite_10.
    // We model it as a container-only stub; its visual comes from the
    // baked anim1 composite. The canonical behaviour is captured in
    // onLoad + onEnterFrame so the runtime logic is correct.
    const sprite10ChildSym: SymbolDefinition = {
      name: "sprite10child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const parent = clip.parent;
        const rotDeg = (parent?.vars.rotation as number) ?? 0;
        const alphaPct = (parent?.vars.alpha as number) ?? 100;
        const iVal = (parent?.vars.i as number) ?? 0;
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = alphaPct / 100;
        clip.vars.i = iVal;
      },
      // AS DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let i = clip.vars.i as number;
        i += 0.067;
        clip.scaleX = (100 * Math.sin(i)) / 100;
        clip.vars.i = i;
      },
    };

    // ---- DefineSprite_10 — "flash" cross container ---------------
    // AS DefineSprite_10/frame_1/DoAction.as:
    //   rotation = random(360) - 90;
    //   alpha = random(50) + 40;
    //   i = Math.random() * 6;
    // These are set on the PARENT (the DefineSprite_10 clip itself)
    // so the placed child (sprite10ChildSym) can read them via
    // _parent.rotation etc.
    const sprite10Sym: SymbolDefinition = {
      name: "sprite10",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_10/frame_1/DoAction.as
            clip.vars.rotation = Math.floor(Math.random() * 360) - 90;
            clip.vars.alpha = Math.floor(Math.random() * 50) + 40;
            clip.vars.i = Math.random() * 6;
            // Place the inner child (PlaceObject2_9_1)
            clip.attach(sprite10ChildSym, "child1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_3 inner child (PlaceObject2_2_1) -----------
    // Falling ice drop particle physics.
    const sprite3ChildSym: SymbolDefinition = {
      name: "sprite3child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.v = 0;
        // vx is read in enterFrame but not seeded in load — AS
        // leaves it undefined (treated as 0 initially). We seed it
        // to 0 explicitly so the cast is safe.
        clip.vars.vx = 0;
      },
      // AS DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let v = clip.vars.v as number;
        let vx = clip.vars.vx as number;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        if (clip.y > 0) {
          clip.y = 0;
          v = -5 * Math.random();
          vx = -2.5 * Math.random() + 1.25;
        }
        clip.vars.v = v;
        clip.vars.vx = vx;
      },
    };

    // ---- DefineSprite_3 — "drop" falling particle container ------
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            clip.attach(sprite3ChildSym, "child1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_13 inner child 1 (PlaceObject2_6_1) --------
    // sin scaler — mirrors sprite10ChildSym but lives inside sprite13.
    const sprite13Child1Sym: SymbolDefinition = {
      name: "sprite13child1",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_13/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const parent = clip.parent;
        const rotDeg = (parent?.vars.rotation as number) ?? 0;
        const alphaPct = (parent?.vars.alpha as number) ?? 100;
        const iVal = (parent?.vars.i as number) ?? 0;
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = alphaPct / 100;
        clip.vars.i = iVal;
      },
      // AS DefineSprite_13/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let i = clip.vars.i as number;
        i += 0.067;
        clip.scaleX = (100 * Math.sin(i)) / 100;
        clip.vars.i = i;
      },
    };

    // ---- DefineSprite_13 inner child 2 (PlaceObject2_12_5) -------
    // cos scaler — complementary axis to child1.
    const sprite13Child2Sym: SymbolDefinition = {
      name: "sprite13child2",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_13/frame_1/PlaceObject2_12_5/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        const parent = clip.parent;
        const rotDeg = (parent?.vars.rotation as number) ?? 0;
        const alphaPct = (parent?.vars.alpha as number) ?? 100;
        const iVal = (parent?.vars.i as number) ?? 0;
        clip.rotation = (rotDeg * Math.PI) / 180;
        clip.alpha = alphaPct / 100;
        clip.vars.i = iVal;
      },
      // AS DefineSprite_13/frame_1/PlaceObject2_12_5/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        let i = clip.vars.i as number;
        i += 0.067;
        clip.scaleX = (100 * Math.cos(i)) / 100;
        clip.vars.i = i;
      },
    };

    // ---- DefineSprite_13 — "cross2" double-axis cross container --
    // Seeds the same rotation/alpha/i vars as DefineSprite_10 so its
    // two children can read them. The canonical AS for DefineSprite_13
    // does not have a DoAction frame_1 script of its own — the vars
    // must be set by whoever attaches sprite13 (the outer timeline).
    // We seed them here in the frameScripts[0] entry to ensure both
    // children receive valid values regardless of attach context.
    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Seed parent vars so children's onLoad can read them.
            // (Canonical: set by outer timeline before/during attach.)
            if (clip.vars.rotation === undefined) {
              clip.vars.rotation = Math.floor(Math.random() * 360) - 90;
            }
            if (clip.vars.alpha === undefined) {
              clip.vars.alpha = Math.floor(Math.random() * 50) + 40;
            }
            if (clip.vars.i === undefined) {
              clip.vars.i = Math.random() * 6;
            }
            clip.attach(sprite13Child1Sym, "child1", 1, ctx);
            clip.attach(sprite13Child2Sym, "child2", 2, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_14 inner child (PlaceObject2_13_1) ---------
    // Rising/fading orb particle physics.
    const sprite14ChildSym: SymbolDefinition = {
      name: "sprite14child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      // AS DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as
      onLoad: (clip) => {
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 130 / 100; // _alpha = 130 (clamped to 1 in Pixi)
        // _parent._alpha = 10 — set the parent (sprite14) alpha
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.66 * Math.random();
      },
      // AS DefineSprite_14/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      onEnterFrame: (clip) => {
        const parent = clip.parent;
        if (!parent) {
          return;
        }

        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v2 = clip.vars.v2 as number;
        const v = clip.vars.v as number;

        // Fade parent in while _Y > -100 (in Flash coords; positive Y
        // is down, so _Y > -100 means not yet risen far enough up).
        // In our runtime Y axis: clip.y > -100 means within 100px above origin.
        if (clip.y > -100 && parent.alpha < 1.0) {
          parent.alpha = Math.min(1.0, parent.alpha + 15 / 100);
        }

        if (clip.y < -100) {
          parent.alpha = parent.alpha - 15 / 100;
          if (parent.alpha < 0) {
            parent.visible = false;
            // _parent.removeMovieClip()
            parent.remove();
            return;
          }
        }

        // _rotation = _rotation + 1.3 (degrees)
        clip.rotation += (1.3 * Math.PI) / 180;

        // _Y = 5 * cos(i) + (p -= v)
        p -= v;
        clip.y = 5 * Math.cos(i) + p;

        // _X = 25 * sin(i += v2)
        i += v2;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // _alpha = 80 * cos(i) + 100  (Flash 0-100 scale)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }

        clip.vars.p = p;
        clip.vars.i = i;
      },
    };

    // ---- DefineSprite_14 — "orb" rising particle container -------
    const sprite14Sym: SymbolDefinition = {
      name: "sprite14",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            clip.attach(sprite14ChildSym, "child1", 1, ctx);
          },
        ],
      ]),
    };

    // ---- DefineSprite_15 / anim1 — outer 244-frame composite -----
    // This is the baked composite animation (anim1 in manifest).
    // frame_244/DoAction.as: _parent.removeMovieClip(); stop();
    // We wire signalHit + complete at frame index 243 (AS frame_244).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 246,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          243,
          (clip) => {
            // AS DefineSprite_15/frame_244/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.stop();
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite10ChildSym);
    this.registry.register(sprite10Sym);
    this.registry.register(sprite3ChildSym);
    this.registry.register(sprite3Sym);
    this.registry.register(sprite13Child1Sym);
    this.registry.register(sprite13Child2Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(sprite14ChildSym);
    this.registry.register(sprite14Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("many_504");
    callbacks.playSound("many_504");

    // Attach the outer composite animation at root. The harness for
    // TargetCell leaves the root at (0,0) == target cell coords, so
    // anim1 renders centred on the target.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
