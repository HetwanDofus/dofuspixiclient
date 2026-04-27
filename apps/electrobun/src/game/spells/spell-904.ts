/**
 * Spell 904 — Flèche de Glace (Cra ice arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/904/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no `move`/`shoot`/`duplicate` library
 * symbols, no caster-side reference, no dual-anchor pattern. The spell is a
 * single composite animation (`anim1`, 318 frames) anchored at the target cell,
 * with several runtime-spawned particle sub-sprites driven by clip events. This
 * is the canonical "impact at target" pattern → TargetCell.
 *
 * The manifest has NO `librarySymbols[]` entries, so all texture references use
 * bare animation names (no `lib_` prefix). The `anim1` animation is the main
 * authored timeline (318 frames, `isComposite: true`). The AS scripts define
 * five sub-sprite symbols that live inside the composite:
 *
 *   - DefineSprite_9  — scale-randomised snowflake/petal placed inside the
 *                       composite. onLoad seeds `t` ∈ [80,130] and sets xscale/yscale.
 *
 *   - DefineSprite_10 — wobbling blade particle. onLoad seeds rotation, alpha,
 *                       phase `i`. onEnterFrame oscillates xscale via sin(i+=0.1).
 *
 *   - DefineSprite_3  — bouncing ice shard. onLoad: v=0. onEnterFrame: gravity
 *                       (v+=0.6), bounce at Y≥0 (v = -5*rand, vx = rand*[-1.25,1.25]).
 *
 *   - DefineSprite_13 — rising spiral snowflake. onLoad seeds phase/velocity vars,
 *                       sets _parent._alpha=10. onEnterFrame: rise+oscillate, fade
 *                       in while Y>-100, fade out+remove below -100.
 *
 *   - DefineSprite_12 — flickering alpha particle. onEnterFrame: _alpha = random(170).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("jet_904").
 *
 * Completion: DefineSprite_14/frame_316/DoAction.as calls
 * `_parent.removeMovieClip(); stop();` — this is the outer mc removal. We model
 * the main `anim1` symbol with totalFrames=318, and fire `signalHit` early
 * (frame 1, immediate impact) and `complete` at frame 315 (0-based, matching
 * canonical frame_316).
 *
 * Because the manifest has no `librarySymbols[]`, the sub-sprites are authored
 * as part of the composite `anim1` timeline (their AS scripts are PlaceObject2
 * clip events on instances placed within DefineSprite_14, which IS the `anim1`
 * composite). We register each as a SymbolDefinition with `frames: []`
 * (container-only; they have no extractable per-frame textures independent of
 * the composite) and attach them manually — but since `anim1` is `isComposite`
 * and the sub-sprites are already baked into the composite SVG frames, the
 * simplest 1:1 port is to register `anim1` as the single played symbol and
 * fire the correct lifecycle signals from its frame scripts.
 *
 * The sub-sprite clip events (DefineSprite_3/9/10/12/13) are authored INSIDE
 * the composite and will render as part of the baked SVG frames. We still
 * register their SymbolDefinitions so the registry is complete in case the
 * runtime attempts to resolve them, but their primary visual is already in
 * the composite `anim1` frames.
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

// Bounds for anim1 (from manifest animations[0])
const ANIM1_BOUNDS = {
  width: 54,
  height: 42.15,
  offsetX: -22.6,
  offsetY: -21.3,
};

export class Spell904 extends RuntimeSpell {
  readonly spellId = 904;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_9 — scale-randomised snowflake particle ----
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
    // Container-only sub-sprite baked into composite; registered for completeness.
    const sprite9Sym: SymbolDefinition = {
      name: "sprite9",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: t = 80 + random(50); _xscale = t; _yscale = t;
        const t = 80 + Math.floor(Math.random() * 50);
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    // ---- DefineSprite_10 — wobbling blade particle ---------------
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite10Sym: SymbolDefinition = {
      name: "sprite10",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: _rotation = random(360) - 90; _alpha = random(50) + 40; i = Math.random() * 6;
        clip.rotation = ((Math.floor(Math.random() * 360) - 90) * Math.PI) / 180;
        clip.alpha = (Math.floor(Math.random() * 50) + 40) / 100;
        clip.vars.i = Math.random() * 6;
      },
      onEnterFrame: (clip) => {
        // AS: _xscale = 100 * Math.sin(i += 0.1);
        let i = clip.vars.i as number;
        i += 0.1;
        clip.vars.i = i;
        clip.scaleX = (100 * Math.sin(i)) / 100;
      },
    };

    // ---- DefineSprite_3 — bouncing ice shard --------------------
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_3/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite3Sym: SymbolDefinition = {
      name: "sprite3",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: v = 0;
        clip.vars.v = 0;
      },
      onEnterFrame: (clip) => {
        // AS: _Y = _Y + v; _X = _X + vx; v += 0.6;
        // if (_Y > 0) { _Y = 0; v = -5 * Math.random(); vx = -2.5 * Math.random() + 1.25; }
        let v = clip.vars.v as number;
        const vx = (clip.vars.vx as number | undefined) ?? 0;
        clip.y += v;
        clip.x += vx;
        v += 0.6;
        clip.vars.v = v;
        if (clip.y > 0) {
          clip.y = 0;
          clip.vars.v = -5 * Math.random();
          clip.vars.vx = -2.5 * Math.random() + 1.25;
        }
      },
    };

    // ---- DefineSprite_13 — rising spiral snowflake ---------------
    // AS: DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_13/frame_1/PlaceObject2_12_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite13Sym: SymbolDefinition = {
      name: "sprite13",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: p = 0; i = 0; v2 = 0.03 + 0.06 * Math.random();
        //     _rotation = random(360); _alpha = 130; _parent._alpha = 10;
        //     v = 0.3 + 0.66 * Math.random();
        clip.vars.p = 0;
        clip.vars.i = 0;
        clip.vars.v2 = 0.03 + 0.06 * Math.random();
        clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
        clip.alpha = 130 / 100;
        if (clip.parent) {
          clip.parent.alpha = 10 / 100;
        }
        clip.vars.v = 0.3 + 0.66 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS: if (_Y > -100 & _parent._alpha < 100) { _parent._alpha += 15; }
        //     if (_Y < -100) {
        //       _parent._alpha -= 15;
        //       if (_parent._alpha < 0) { _parent._visible = 0; this.stop = 1; _parent.removeMovieClip(); }
        //     }
        //     _rotation = _rotation + 1.3;
        //     _Y = 5 * Math.cos(i) + (p -= v);
        //     _X = 25 * Math.sin(i += v2);
        //     if (Math.cos(i) < 0) { _alpha = 80 * Math.cos(i) + 100; }
        let p = clip.vars.p as number;
        let i = clip.vars.i as number;
        const v = clip.vars.v as number;
        const v2 = clip.vars.v2 as number;

        const parent = clip.parent;
        if (parent) {
          if (clip.y > -100 && parent.alpha < 1.0) {
            parent.alpha = Math.min(1.0, parent.alpha + 15 / 100);
          }
          if (clip.y < -100) {
            parent.alpha -= 15 / 100;
            if (parent.alpha < 0) {
              parent.visible = false;
              parent.remove();
              return;
            }
          }
        }

        clip.rotation += (1.3 * Math.PI) / 180;
        p -= v;
        clip.vars.p = p;
        clip.y = 5 * Math.cos(i) + p;
        i += v2;
        clip.vars.i = i;
        clip.x = 25 * Math.sin(i);

        if (Math.cos(i) < 0) {
          // AS: _alpha = 80 * Math.cos(i) + 100  (0-100 range)
          clip.alpha = (80 * Math.cos(i) + 100) / 100;
        }
      },
    };

    // ---- DefineSprite_12 — flickering alpha particle -------------
    // AS: DefineSprite_12/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const sprite12Sym: SymbolDefinition = {
      name: "sprite12",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: _alpha = random(170);
        clip.alpha = Math.floor(Math.random() * 170) / 100;
      },
    };

    // ---- anim1 — main composite animation, 318 frames -----------
    // This is the root visual for the spell. DefineSprite_14 is the
    // outer SWF symbol that contains this composite timeline.
    // frame_316/DoAction.as: _parent.removeMovieClip(); stop();
    // We fire signalHit at frame 0 (immediate impact at target cell)
    // and complete at frame 315 (0-based = AS frame_316).
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 318,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // First frame of impact — signal hit so damage popup appears.
            this.runtime.signalHit();
          },
        ],
        [
          315,
          (clip) => {
            // AS: DefineSprite_14/frame_316/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite9Sym);
    this.registry.register(sprite10Sym);
    this.registry.register(sprite3Sym);
    this.registry.register(sprite13Sym);
    this.registry.register(sprite12Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("jet_904");
    callbacks.playSound("jet_904");

    // Attach the main composite animation at the root (depth 1).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
