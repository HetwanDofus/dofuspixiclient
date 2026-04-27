/**
 * Spell 2908 — (Unknown name, likely a buff/aura effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2908/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom`/`cellTo` usage
 * in its scripts. It is a single composite animation (`anim1`, 390 frames) anchored
 * at the target cell, with nested oscillating sub-sprites driven by clip events.
 *
 * Canonical AS layout:
 *
 *   - `anim1` (main timeline, 390 frames) — top-level animation.
 *       frame_13/DoAction.as: stop() — timeline halts at frame 13 after playing
 *         the intro, then the clip events on nested sub-sprites continue running.
 *       No librarySymbols[] in the manifest — `anim1` IS the top-level animation
 *       in `animations[]`. It is registered as a SymbolDefinition so the root can
 *       attach it, with `frames: textures.getFrames("anim1")` (no lib_ prefix).
 *
 *   The `anim1` composite contains three layers of nested sprites driven by
 *   PlaceObject2 clip events. From the script paths:
 *
 *   DefineSprite_9 — outermost oscillating container (390-frame timeline).
 *       PlaceObject2_8_1 onClipEvent(load): seeds t=0, vent, vy (upward drift).
 *       PlaceObject2_8_1 onClipEvent(enterFrame): drifts _X by vent, _Y by -vy;
 *         fades alpha after t > 330.
 *       frame_388/DoAction.as: _parent.removeMovieClip(); stop() → spell complete.
 *
 *   DefineSprite_8 — horizontal sway container inside DefineSprite_9.
 *       PlaceObject2_7_1 onClipEvent(load): seeds i=0, vamp (random amplitude).
 *       PlaceObject2_7_1 onClipEvent(enterFrame): _X = 10 * sin(i += vamp).
 *
 *   DefineSprite_7 — rotation oscillator inside DefineSprite_8 (or sibling).
 *       PlaceObject2_5_2 onClipEvent(load): seeds a=1.5.
 *       PlaceObject2_5_2 onClipEvent(enterFrame): _rotation = 10 * sin(a += _parent.vamp).
 *         → reads vamp from its parent (DefineSprite_8).
 *
 *   DefineSprite_5 — rotation oscillator at a deeper level.
 *       PlaceObject2_4_2 onClipEvent(load): seeds a=2.
 *       PlaceObject2_4_2 onClipEvent(enterFrame): _rotation = 15 * sin(a += _parent._parent.vamp).
 *         → reads vamp 2 levels up.
 *
 *   DefineSprite_4 — rotation oscillator at the deepest level.
 *       PlaceObject2_3_2 onClipEvent(load): seeds a=5.
 *       PlaceObject2_3_2 onClipEvent(enterFrame): _rotation = 20 * sin(a += _parent._parent._parent.vamp).
 *         → reads vamp 3 levels up.
 *
 * The manifest has NO librarySymbols[]. All content is in `animations[anim1]`.
 * The nested DefineSprite_* clips are authored INSIDE the anim1 composite and are
 * driven entirely by clip events wired in PlaceObject2 tags — they have no
 * independent `attachMovie` calls. We model them as SymbolDefinitions registered
 * in the registry so the anim1 frameScript at frame_0 can attach them explicitly,
 * reproducing the canonical PlaceObject2 placement order.
 *
 * signalHit: fired at frame 12 (canonical frame_13, the stop() frame — the impact
 * visual is fully visible at that point). complete() fired at frame 387 (canonical
 * frame_388, the _parent.removeMovieClip() + stop()).
 *
 * Library symbols:
 *   - anim1 — 390-frame composite outer clip. Attaches inner sprites on load;
 *     stops at frame 12; removes itself at frame 387.
 *   - sprite9inner — the PlaceObject2_8_1 clip inside DefineSprite_9. Drifts
 *     upward with vent/vy; fades after t>330.
 *   - sprite8inner — the PlaceObject2_7_1 horizontal sway clip inside DefineSprite_8.
 *     _X = 10*sin(i += vamp).
 *   - sprite7inner — the PlaceObject2_5_2 rotation clip inside DefineSprite_7/8.
 *     _rotation = 10*sin(a += parent.vamp).
 *   - sprite5inner — the PlaceObject2_4_2 rotation clip, reads vamp 2 levels up.
 *     _rotation = 15*sin(a += grandparent.vamp).
 *   - sprite4inner — the PlaceObject2_3_2 rotation clip, reads vamp 3 levels up.
 *     _rotation = 20*sin(a += great-grandparent.vamp).
 *
 * Main timeline (frame_13/DoAction.as): stop() only — no sound, no extra attaches.
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
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2908 extends RuntimeSpell {
  readonly spellId = 2908;
  readonly displayType = SpellDisplayType.TargetCell;

  // Hold references to inner symbol defs so anim1's frameScripts can attach them.
  private sprite9Sym!: SymbolDefinition;
  private sprite8Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite5Sym!: SymbolDefinition;
  private sprite4Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    // ---- sprite4inner — deepest rotation oscillator ----------------
    // AS: DefineSprite_4/frame_1/PlaceObject2_3_2/onClipEvent(load): a = 5
    // AS: DefineSprite_4/frame_1/PlaceObject2_3_2/onClipEvent(enterFrame):
    //       _rotation = 20 * Math.sin(a += _parent._parent._parent.vamp)
    //   → _parent._parent._parent is sprite8inner (which holds vamp).
    this.sprite4Sym = {
      name: "sprite4inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 5;
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_4/frame_1/PlaceObject2_3_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._parent._parent.vamp — clip's parent chain:
        //   sprite4inner → sprite5inner → sprite8inner (holds vamp)
        //   Actually the chain is:
        //   sprite4inner.parent = sprite5inner
        //   sprite5inner.parent = sprite8inner  (has vamp)
        //   sprite8inner.parent = sprite9inner
        // But DefineSprite_4 reads 3 levels up. Let's trace carefully:
        //   DefineSprite_4 is placed inside DefineSprite_5 (PlaceObject2_3_2 is inside DefineSprite_5? No.)
        //   Actually from the script paths:
        //     DefineSprite_4/frame_1/PlaceObject2_3_2 — so DefineSprite_4 contains PlaceObject2_3_2
        //     DefineSprite_5/frame_1/PlaceObject2_4_2 — DefineSprite_5 contains PlaceObject2_4_2
        //   The _parent hierarchy in AS for DefineSprite_4's clip (PlaceObject2_3_2):
        //     _parent = DefineSprite_4's mc
        //     _parent._parent = the mc that placed DefineSprite_4
        //     _parent._parent._parent = that mc's parent, which holds vamp
        //   Since vamp lives on DefineSprite_8's mc (PlaceObject2_7_1 inside DefineSprite_8),
        //   we need to walk up to it. In our model:
        //     sprite4inner.parent = the clip that attached sprite4inner = sprite5inner
        //     sprite5inner.parent = sprite8inner (which has vamp)
        //     sprite8inner.parent = sprite9inner
        //   But 3 levels up from sprite4inner's OWN parent would be:
        //     clip.parent = sprite5inner
        //     clip.parent.parent = sprite8inner (has vamp)  ← that's only 2 levels
        //   Hmm. Let's re-read the AS:
        //     `_rotation = 20 * Math.sin(a += _parent._parent._parent.vamp)`
        //   In AS, `this` is the PlaceObject2_3_2 clip. Its _parent is the mc that contains it.
        //   PlaceObject2_3_2 is inside DefineSprite_4. DefineSprite_4 IS the mc.
        //   Wait — PlaceObject2_3_2 is a clip INSIDE DefineSprite_4's frame_1. The onClipEvent
        //   handler is on the PlaceObject2 clip itself. So:
        //     this = PlaceObject2_3_2 clip  (our sprite4Sym instance)
        //     _parent = DefineSprite_4 host mc (the clip that has PlaceObject2_3_2 as a child)
        //   But in our model, sprite4inner IS placed directly into the parent that "is DefineSprite_4".
        //   The nesting we're implementing:
        //     anim1 attaches sprite9Sym (represents the DefineSprite_9 timeline)
        //     sprite9Sym attaches sprite8Sym (represents DefineSprite_8 timeline)
        //     sprite8Sym attaches sprite7Sym + sprite5Sym (siblings inside DefineSprite_8)
        //     sprite5Sym attaches sprite4Sym
        //   So clip (sprite4inner) parent chain:
        //     clip.parent = sprite5inner
        //     clip.parent.parent = sprite8inner  (has vamp)
        //     clip.parent.parent.parent = sprite9inner
        //   _parent._parent._parent in AS from the PlaceObject2_3_2 perspective inside DefineSprite_4:
        //     if DefineSprite_4 is placed inside DefineSprite_5, which is placed inside DefineSprite_8:
        //     this._parent = DefineSprite_4 instance holder
        //     Actually in Flash the PlaceObject2 clip's _parent is the clip that CONTAINS it via PlaceObject2.
        //     PlaceObject2_3_2 is INSIDE DefineSprite_4's frame_1, meaning DefineSprite_4 is this clip's _parent.
        //     DefineSprite_4 is placed inside ... (we need to figure out the nesting from context).
        //
        //   Given the _parent traversal depths in the AS:
        //     DefineSprite_7: reads _parent.vamp (1 level) → parent is DefineSprite_8
        //     DefineSprite_5: reads _parent._parent.vamp (2 levels) → grandparent is DefineSprite_8
        //       so DefineSprite_5 is nested 1 level deeper than DefineSprite_7 relative to DefineSprite_8
        //       OR DefineSprite_5 is inside DefineSprite_7 (then _parent = DefineSprite_7, _parent._parent = DefineSprite_8)
        //     DefineSprite_4: reads _parent._parent._parent.vamp (3 levels) → 3 levels up is DefineSprite_8
        //       so DefineSprite_4 is inside DefineSprite_5 (then: _parent=DefineSprite_5, ._parent=DefineSprite_7, ._parent=DefineSprite_8)
        //       OR DefineSprite_4 is inside DefineSprite_5 directly:
        //         _parent = DefineSprite_5's mc, _parent._parent = DefineSprite_7's mc, _parent._parent._parent = DefineSprite_8
        //
        //   Most consistent interpretation:
        //     DefineSprite_8 has vamp. Inside it:
        //       DefineSprite_7 (child of DefineSprite_8): _parent = DefineSprite_8 → 1 hop → correct
        //       DefineSprite_5 (child of DefineSprite_7): _parent = DefineSprite_7, _parent._parent = DefineSprite_8 → 2 hops → correct
        //       DefineSprite_4 (child of DefineSprite_5): _parent = DefineSprite_5, _parent._parent = DefineSprite_7, _parent._parent._parent = DefineSprite_8 → 3 hops → correct
        //
        //   So the nesting is: DefineSprite_8 → DefineSprite_7 → DefineSprite_5 → DefineSprite_4
        //   And DefineSprite_9 wraps DefineSprite_8 (the outermost drifting container).
        //   In our model:
        //     sprite9inner attaches sprite8inner
        //     sprite8inner attaches sprite7inner
        //     sprite7inner attaches sprite5inner
        //     sprite5inner attaches sprite4inner
        //   Chain from sprite4inner: parent=sprite5inner, parent=sprite7inner, parent=sprite8inner (has vamp)
        let a = clip.vars.a as number;
        const sprite8 = clip.parent?.parent?.parent;
        const vamp = (sprite8?.vars.vamp as number) ?? 0;
        a += vamp;
        clip.vars.a = a;
        clip.rotation = (20 * Math.sin(a) * Math.PI) / 180;
      },
    };

    // ---- sprite5inner — rotation oscillator (2 levels from vamp) --
    // AS: DefineSprite_5/frame_1/PlaceObject2_4_2/onClipEvent(load): a = 2
    // AS: DefineSprite_5/frame_1/PlaceObject2_4_2/onClipEvent(enterFrame):
    //       _rotation = 15 * Math.sin(a += _parent._parent.vamp)
    //   → parent=sprite7inner, parent.parent=sprite8inner (has vamp)
    this.sprite5Sym = {
      name: "sprite5inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 2;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_5/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent._parent.vamp: parent=sprite7inner, parent.parent=sprite8inner
        let a = clip.vars.a as number;
        const sprite8 = clip.parent?.parent;
        const vamp = (sprite8?.vars.vamp as number) ?? 0;
        a += vamp;
        clip.vars.a = a;
        clip.rotation = (15 * Math.sin(a) * Math.PI) / 180;

        // Attach sprite4inner on first frame if not yet attached
        if (!clip.children.has("sprite4")) {
          clip.attach(this.sprite4Sym, "sprite4", 1, ctx);
        }
      },
    };

    // ---- sprite7inner — rotation oscillator (1 level from vamp) ---
    // AS: DefineSprite_7/frame_1/PlaceObject2_5_2/onClipEvent(load): a = 1.5
    // AS: DefineSprite_7/frame_1/PlaceObject2_5_2/onClipEvent(enterFrame):
    //       _rotation = 10 * Math.sin(a += _parent.vamp)
    //   → parent=sprite8inner (has vamp)
    this.sprite7Sym = {
      name: "sprite7inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.a = 1.5;
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_7/frame_1/PlaceObject2_5_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _parent.vamp: parent=sprite8inner
        let a = clip.vars.a as number;
        const sprite8 = clip.parent;
        const vamp = (sprite8?.vars.vamp as number) ?? 0;
        a += vamp;
        clip.vars.a = a;
        clip.rotation = (10 * Math.sin(a) * Math.PI) / 180;

        // Attach sprite5inner on first frame if not yet attached
        if (!clip.children.has("sprite5")) {
          clip.attach(this.sprite5Sym, "sprite5", 2, ctx);
        }
      },
    };

    // ---- sprite8inner — horizontal sway container -----------------
    // AS: DefineSprite_8/frame_1/PlaceObject2_7_1/onClipEvent(load):
    //       i = 0; vamp = 0.1 * Math.random()
    // AS: DefineSprite_8/frame_1/PlaceObject2_7_1/onClipEvent(enterFrame):
    //       _X = 10 * Math.sin(i += vamp)
    //   Also contains DefineSprite_7 placed inside it (attaches sprite7inner).
    this.sprite8Sym = {
      name: "sprite8inner",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.i = 0;
        clip.vars.vamp = 0.1 * Math.random();
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let i = clip.vars.i as number;
        const vamp = clip.vars.vamp as number;
        i += vamp;
        clip.vars.i = i;
        clip.x = 10 * Math.sin(i);

        // Attach sprite7inner on first frame if not yet attached
        if (!clip.children.has("sprite7")) {
          clip.attach(this.sprite7Sym, "sprite7", 1, ctx);
        }
      },
    };

    // ---- sprite9inner — upward drift + fade wrapper ---------------
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(load):
    //       t = 0; vent = 0.16 + 0.16 * Math.random(); vy = 0.33 + 0.33 * Math.random()
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_1/onClipEvent(enterFrame):
    //       if (t++ > 330) { _alpha = _alpha - 1.67 }
    //       _X = _X + vent; _Y = _Y - vy
    // AS: DefineSprite_9/frame_388/DoAction.as: _parent.removeMovieClip(); stop()
    this.sprite9Sym = {
      name: "sprite9inner",
      totalFrames: 390,
      frames: textures.getFrames("anim1"),
      anchorX: calculateAnchor(ANIM1_BOUNDS).x,
      anchorY: calculateAnchor(ANIM1_BOUNDS).y,
      onLoad: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(load).as
        clip.vars.t = 0;
        clip.vars.vent = 0.16 + 0.16 * Math.random();
        clip.vars.vy = 0.33 + 0.33 * Math.random();
      },
      onEnterFrame: (clip, ctx) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        let t = clip.vars.t as number;
        if (t++ > 330) {
          clip.alpha = clip.alpha - 1.67 / 100;
        }
        clip.vars.t = t;
        const vent = clip.vars.vent as number;
        const vy = clip.vars.vy as number;
        clip.x = clip.x + vent;
        clip.y = clip.y - vy;

        // Attach sprite8inner on first tick if not yet present
        if (!clip.children.has("sprite8")) {
          clip.attach(this.sprite8Sym, "sprite8", 1, ctx);
        }
      },
      frameScripts: new Map([
        [
          387,
          (clip) => {
            // AS DefineSprite_9/frame_388/DoAction.as: _parent.removeMovieClip(); stop()
            // This is the outermost sprite of the spell — removing its parent
            // means the spell is complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- anim1 — top-level composite (the main spell animation) ---
    // This is not a library symbol — it is in animations[] — so no lib_ prefix.
    // It IS the root-level spell animation. We register it so the root can
    // attach it, which starts the whole nested tree.
    // The anim1 animation IS essentially the outer container that holds
    // DefineSprite_9 (sprite9inner). In canonical Flash, DefineSprite_9 is
    // placed on anim1's timeline via PlaceObject2_8_1.
    //
    // frame_13/DoAction.as: stop() — the anim1 timeline itself stops at frame 13.
    // We model anim1 as the outer "anim1" symbol that:
    //   - Has its own 390 frames of texture content
    //   - Attaches sprite9inner on frame 0 (the PlaceObject2_8_1 placement)
    //   - Stops at frame 12 (canonical frame_13)
    //   - signalHit at frame 12 (the stop frame = impact fully visible)
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 390,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // Canonical PlaceObject2_8_1 placement: attach sprite9inner as a child
            // of the anim1 clip. In Flash, DefineSprite_9 is placed inside the
            // anim1 DefineSprite at frame_1 via PlaceObject2_8_1.
            clip.attach(this.sprite9Sym, "sprite9", 1, ctx);
          },
        ],
        [
          12,
          (clip) => {
            // AS frame_13/DoAction.as: stop()
            // This is also our canonical hit signal — the intro animation has
            // played and the effect is fully on screen.
            clip.stop();
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite8Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Main timeline frame_13/DoAction.as is just `stop()` — no sound to play.
    // Attach the anim1 symbol so the whole spell tree starts ticking.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
