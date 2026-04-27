/**
 * Spell 714 — Grina (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/714/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * no duplicate/beam logic. All authored content is a single multi-layered
 * impact at the target cell. The manifest has no librarySymbols[] entries —
 * all content lives in the top-level animations[] list. The spell is driven
 * by four parallel authored timelines attached directly in onSpellStart:
 *
 *   - sprite_5  (58 frames)  — simple looping background element; no scripts.
 *   - sprite_6  (6 frames)   — frame_1 randomises start position via
 *                              gotoAndStop(random(8) + 1).
 *   - sprite_9  (123 frames) — frame_1 jumps to a random play position
 *                              (gotoAndPlay(random(100) + 2)); frame_121
 *                              loops back to frame_2 (gotoAndPlay(2)).
 *   - sprite_10 (120 frames) — plays through; frame_118 stops the clip.
 *   - sprite_12 (186 frames) — longest-lived timeline. frame_157 places a
 *                              child with an onEnterFrame that fades the
 *                              parent (_alpha -= 3.33 per tick). frame_184
 *                              calls _parent._parent.removeMovieClip() — i.e.
 *                              removes the outer mc (== our root) and signals
 *                              spell completion.
 *
 * signalHit: fired at sprite_10 frame_118 (the stop/impact frame of the
 *            main blast), which canonically coincides with the peak of the
 *            visual hit. displayType=11 requires manual signalHit.
 *
 * complete(): fired at sprite_12 frame_184 (_parent._parent.removeMovieClip).
 *
 * Library symbols: none (librarySymbols[] is empty in manifest). All
 *   textures referenced via bare animation names (no lib_ prefix).
 *
 * Main timeline: SOMA.playSound("grina_702"); (no stop, all children placed
 *   implicitly on the main timeline — we attach them in onSpellStart).
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

// Bounds from manifest animations[] entries (no librarySymbols[]).
const SPRITE_6_BOUNDS = {
  width: 159.45,
  height: 115.5,
  offsetX: -104.3,
  offsetY: -70,
};
const SPRITE_7_BOUNDS = {
  width: 168.05,
  height: 215.9,
  offsetX: -69.1,
  offsetY: -78.8,
};
const SPRITE_9_BOUNDS = {
  width: 127.6,
  height: 71.4,
  offsetX: -56.05,
  offsetY: -37.95,
};
const SPRITE_10_BOUNDS = {
  width: 301.45,
  height: 168.65,
  offsetX: -135.25,
  offsetY: 16.4,
};
const SPRITE_12_BOUNDS = {
  width: 203.1,
  height: 113.6,
  offsetX: -91.7,
  offsetY: -61.85,
};

export class Spell714 extends RuntimeSpell {
  readonly spellId = 714;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite5Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- sprite_5 — background looping element (58 frames, no scripts) ----
    // No bounds in manifest (width/height/offsetX/offsetY all 0). Use
    // centred anchor as default.
    this.sprite5Sym = {
      name: "sprite_5",
      totalFrames: 58,
      frames: textures.getFrames("sprite_5"),
      anchorX: 0.5,
      anchorY: 0.5,
    };

    // ---- sprite_6 — 6-frame element, random start frame ----------------
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   gotoAndStop(random(8) + 1);
    // Note: random(8) gives [0,7], so gotoAndStop result is [1,8].
    // The sprite only has 6 authored frames; clamp is handled by
    // SpellClip.gotoAndStop internally (clampFrame). We translate 1-8
    // to 0-based as (random(8) + 1 - 1) = random(8).
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 6,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as: gotoAndStop(random(8) + 1)
            clip.gotoAndStop(Math.floor(Math.random() * 8));
          },
        ],
      ]),
    };

    // ---- sprite_7 — authored composite (57 frames, no scripts) ----------
    // sprite_7 appears in animations[] with full bounds but no AS scripts.
    // It plays through as a simple authored animation.
    const sprite7Anchor = calculateAnchor(SPRITE_7_BOUNDS);
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 57,
      frames: textures.getFrames("sprite_7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
    };

    // ---- sprite_9 — 123-frame looping element with random start ----------
    // AS DefineSprite_9/frame_1/DoAction.as:
    //   gotoAndPlay(random(100) + 2);
    //   → 0-based: gotoAndPlay(random(100) + 1)  [range 1..100]
    // AS DefineSprite_9/frame_121/DoAction.as:
    //   gotoAndPlay(2);
    //   → 0-based: gotoAndPlay(1)
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 123,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_9/frame_1/DoAction.as: gotoAndPlay(random(100) + 2)
            clip.gotoAndPlay(Math.floor(Math.random() * 100) + 1);
          },
        ],
        [
          120,
          (clip) => {
            // AS DefineSprite_9/frame_121/DoAction.as: gotoAndPlay(2)
            clip.gotoAndPlay(1);
          },
        ],
      ]),
    };

    // ---- sprite_10 — main blast (120 frames, stops at frame 118) --------
    // AS DefineSprite_10/frame_118/DoAction.as: stop()
    // Also the canonical hit frame — signal hit here.
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    this.sprite10Sym = {
      name: "sprite_10",
      totalFrames: 120,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          117,
          (clip) => {
            // AS DefineSprite_10/frame_118/DoAction.as: stop()
            clip.stop();
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    // ---- sprite_12 — longest-lived timeline (186 frames) ----------------
    // AS DefineSprite_12/frame_157/PlaceObject2_11_69/CLIPACTIONRECORD
    //   onClipEvent(enterFrame).as:
    //   _parent._alpha -= 3.33;
    //   → applied to sprite_12 itself via a synthetic onEnterFrame that
    //     activates starting at frame 157. We implement this by hooking a
    //     flag in vars on the frame_157 script and checking it in an
    //     onEnterFrame on the clip.
    //
    // AS DefineSprite_12/frame_184/DoAction.as:
    //   _parent._parent.removeMovieClip();
    //   → outer mc = this.root; signal complete.
    //
    // The canonical AS places a child clip (PlaceObject2_11_69) at
    // frame_157 whose ONLY behaviour is the _parent._alpha -= 3.33
    // enterFrame. We model this as an onEnterFrame directly on sprite_12
    // that becomes active once the fading starts.
    const sprite12Anchor = calculateAnchor(SPRITE_12_BOUNDS);
    this.sprite12Sym = {
      name: "sprite_12",
      totalFrames: 186,
      frames: textures.getFrames("sprite_12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/frame_157/PlaceObject2_11_69/CLIPACTIONRECORD
        // onClipEvent(enterFrame).as: _parent._alpha -= 3.33
        // Only active after the fading child is placed (frame 157+).
        if (clip.vars.fading) {
          clip.alpha = Math.max(0, clip.alpha - 3.33 / 100);
        }
      },
      frameScripts: new Map([
        [
          156,
          (clip) => {
            // AS DefineSprite_12/frame_157: PlaceObject2_11_69 places the
            // fading child whose enterFrame decrements _parent._alpha.
            // We activate fading via vars flag instead of a real child clip.
            clip.vars.fading = true;
          },
        ],
        [
          183,
          (clip) => {
            // AS DefineSprite_12/frame_184/DoAction.as:
            // _parent._parent.removeMovieClip() — removes the outer mc.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite5Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite12Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("grina_702");
    callbacks.playSound("grina_702");

    // Attach all authored timeline children. In the canonical SWF these
    // are placed implicitly by the main timeline's PlaceObject2 records.
    // displayType=11 (TargetCell): root container is positioned at target
    // cell by spell-view; all children attach at root (0,0).
    this.root.attach(this.sprite5Sym, "sprite5", 1, context);
    this.root.attach(this.sprite6Sym, "sprite6", 2, context);
    this.root.attach(this.sprite7Sym, "sprite7", 3, context);
    this.root.attach(this.sprite9Sym, "sprite9", 4, context);
    this.root.attach(this.sprite10Sym, "sprite10", 5, context);
    this.root.attach(this.sprite12Sym, "sprite12", 6, context);
  }
}
