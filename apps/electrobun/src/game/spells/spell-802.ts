/**
 * Spell 802 — Vlad (unknown class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/802/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`/`shoot`/`duplicate`
 * symbols, no caster-side anchoring, and no projectile motion — it is a
 * pure impact animation at the target cell. The manifest has a single
 * `animations: ["anim1"]` entry and NO `librarySymbols[]`, so all content
 * is driven by the single `anim1` composite timeline.
 *
 * However, the scripts reference several DefineSprite symbols:
 *   - DefineSprite_10 (127-frame outer container, frame_127 calls
 *     stop() + _parent.removeMovieClip() → spell complete). Has an inner
 *     child (PlaceObject2_9_1) whose onEnterFrame rotates it by 0.66
 *     degrees/frame.
 *   - DefineSprite_9 (inner child of DefineSprite_10, frame_61 sets
 *     _rotation = -40).
 *   - DefineSprite_7 (28-frame flicker sprite; frame_28 stop(); inner
 *     child at PlaceObject2_6_1 seeds xs/i on load and randomises
 *     alpha+scale every frame).
 *   - DefineSprite_6 (inner composite with two children:
 *     PlaceObject2_2_1 randomises alpha each frame;
 *     PlaceObject2_4_3 gotoAndStop(random(2)+1) each frame).
 *
 * Because the manifest has NO `librarySymbols[]`, all symbol texture
 * lookups use the bare animation name (NO `lib_` prefix). The only
 * authored frame content lives in `anim1`, which is the composite
 * exported timeline. The inner DefineSprite symbols are container-only
 * (frames: []) whose logic is entirely driven by frame scripts and
 * clip events.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("vlad_802").
 * The harness attaches nothing for TargetCell; we attach the anim1
 * symbol ourselves from onSpellStart so it starts ticking.
 *
 * signalHit: fired at the canonical impact frame. DefineSprite_10's
 * inner child (DefineSprite_9) sets _rotation = -40 at frame_61 —
 * this is the "impact moment". We fire signalHit there.
 *
 * complete: fired from DefineSprite_10/frame_127 (stop +
 * _parent.removeMovieClip).
 *
 * Library symbols (all container-only, no lib_ prefix needed):
 *   - "anim1"       — 129-frame top-level composite (the whole spell).
 *   - "sprite_10"   — 127-frame outer rotating container.
 *   - "sprite_9"    — inner child of sprite_10; frame_61 _rotation=-40.
 *   - "sprite_7"    — 28-frame flicker; frame_28 stop().
 *   - "sprite_6"    — composite with two animated sub-children.
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

const ANIM1_BOUNDS = {
  width: 212.2,
  height: 213.35,
  offsetX: -101.05,
  offsetY: -140.35,
};

export class Spell802 extends RuntimeSpell {
  readonly spellId = 802;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite_9 — inner child of sprite_10 --------------------
    // AS: DefineSprite_9/frame_61/DoAction.as → _rotation = -40
    // This is the canonical impact moment; we fire signalHit here.
    const sprite9Sym: SymbolDefinition = {
      name: "sprite_9",
      totalFrames: 61,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          60,
          (_clip) => {
            // AS: DefineSprite_9/frame_61/DoAction.as
            // _rotation = -40;
            // (rotation applied to the parent container sprite_10
            // via its onEnterFrame — this frame just marks impact)
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    // ---- sprite_6 — two-child composite -------------------------
    // AS: DefineSprite_6/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
    //   _alpha = random(150) - 100;
    // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/onClipEvent(enterFrame)
    //   gotoAndStop(random(2) + 1);
    //
    // PlaceObject2_2_1 and PlaceObject2_4_3 are children placed on
    // DefineSprite_6's authored timeline. We model them as sub-symbols
    // attached in sprite_6's frame_1 script.
    const sprite6Child1Sym: SymbolDefinition = {
      name: "sprite_6_child1",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        // _alpha = random(150) - 100;
        clip.alpha = (Math.floor(Math.random() * 150) - 100) / 100;
      },
    };

    const sprite6Child2Sym: SymbolDefinition = {
      name: "sprite_6_child2",
      totalFrames: 2,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_6/frame_1/PlaceObject2_4_3/onClipEvent(enterFrame)
        // gotoAndStop(random(2) + 1);
        clip.gotoAndStop(Math.floor(Math.random() * 2));
      },
    };

    const sprite6Sym: SymbolDefinition = {
      name: "sprite_6",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place the two authored children of DefineSprite_6
            clip.attach(sprite6Child1Sym, "child1", 2, ctx);
            clip.attach(sprite6Child2Sym, "child2", 4, ctx);
          },
        ],
      ]),
    };

    // ---- sprite_7 — 28-frame flicker ----------------------------
    // AS: DefineSprite_7/frame_28/DoAction.as → stop()
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(load)
    //   xs = _parent._xscale * 3;
    //   i = _parent.i;
    // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame)
    //   t = 100;
    //   _alpha = 30 + random(120);
    //   _xscale = t;
    //   _yscale = t;
    //
    // PlaceObject2_6_1 is a child placed on DefineSprite_7's timeline.
    // We model it as a sub-symbol attached in sprite_7's frame_1 script.
    const sprite7ChildSym: SymbolDefinition = {
      name: "sprite_7_child",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(load)
        // xs = _parent._xscale * 3;
        // i = _parent.i;
        const parent = clip.parent;
        const parentScaleX = parent?.scaleX ?? 1;
        clip.vars.xs = parentScaleX * 3;
        clip.vars.i = (parent?.vars.i as number) ?? 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/onClipEvent(enterFrame)
        // t = 100;
        // _alpha = 30 + random(120);
        // _xscale = t;
        // _yscale = t;
        const t = 100;
        clip.alpha = (30 + Math.floor(Math.random() * 120)) / 100;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
      },
    };

    const sprite7Sym: SymbolDefinition = {
      name: "sprite_7",
      totalFrames: 28,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach PlaceObject2_6_1 child on frame_1
            clip.attach(sprite7ChildSym, "flickerChild", 6, ctx);
          },
        ],
        [
          27,
          (clip) => {
            // AS: DefineSprite_7/frame_28/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_10 — 127-frame outer rotating container ---------
    // AS: DefineSprite_10/frame_127/DoAction.as → stop(); _parent.removeMovieClip()
    // AS: DefineSprite_10/frame_1/PlaceObject2_9_1/onClipEvent(enterFrame)
    //   _rotation = _rotation + 0.66;
    //
    // PlaceObject2_9_1 is a child placed on DefineSprite_10's authored
    // timeline (this is sprite_9). We attach it in sprite_10's frame_1.
    const sprite9RotatingSym: SymbolDefinition = {
      name: "sprite_9_rotating",
      totalFrames: 61,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onEnterFrame: (clip) => {
        // AS: DefineSprite_10/frame_1/PlaceObject2_9_1/onClipEvent(enterFrame)
        // _rotation = _rotation + 0.66;
        clip.rotation += (0.66 * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          60,
          (_clip) => {
            // AS: DefineSprite_9/frame_61/DoAction.as → _rotation = -40
            // This is the impact moment; signal the hit.
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    const sprite10Sym: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 127,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Place the inner rotating child (PlaceObject2_9_1 = sprite_9)
            clip.attach(sprite9RotatingSym, "innerRotating", 9, ctx);
          },
        ],
        [
          126,
          (clip) => {
            // AS: DefineSprite_10/frame_127/DoAction.as
            // stop();
            // _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- anim1 — 129-frame top-level composite ------------------
    // This is the main animation exported in animations[]. It is a
    // composite that contains DefineSprite_10, DefineSprite_7, and
    // DefineSprite_6 as children placed on its authored timeline.
    // We drive them from anim1's frame_1 script.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Attach the authored sub-sprites that make up the composite.
            // DefineSprite_10 is the outer rotating container (depth 9).
            // DefineSprite_7 is the flicker layer (some mid depth).
            // DefineSprite_6 is the composite alpha layer.
            clip.attach(sprite10Sym, "sprite10", 9, ctx);
            clip.attach(sprite7Sym, "sprite7", 7, ctx);
            clip.attach(sprite6Sym, "sprite6", 6, ctx);
          },
        ],
      ]),
    };

    this.anim1Sym = anim1Sym;

    this.registry.register(sprite9Sym);
    this.registry.register(sprite6Child1Sym);
    this.registry.register(sprite6Child2Sym);
    this.registry.register(sprite6Sym);
    this.registry.register(sprite7ChildSym);
    this.registry.register(sprite7Sym);
    this.registry.register(sprite9RotatingSym);
    this.registry.register(sprite10Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: frame_1/DoAction.as → SOMA.playSound("vlad_802");
    callbacks.playSound("vlad_802");
    // Attach the main composite animation at the root.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
