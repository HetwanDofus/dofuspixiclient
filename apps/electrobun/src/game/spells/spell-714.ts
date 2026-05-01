/**
 * Spell 714 — Grina (Sadida or similar earth/nature spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/714/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile, no caster reference, no
 * `move`/`shoot`/`duplicate` symbols — the spell is a pure impact at
 * the target cell. All authored visuals are placed on the main timeline
 * as static-timeline sprites (sprite_5, sprite_6, sprite_7, sprite_9,
 * sprite_10) which play out at the target, plus one library symbol
 * `sprite12` (characterId 12) that has a CLIPACTIONRECORD onEnterFrame
 * that fades alpha by 3.33/frame starting at frame_157, and whose
 * frame_184 signals completion via `_parent._parent.removeMovieClip()`.
 *
 * AS layout:
 *   - frame_1/DoAction.as:
 *       SOMA.playSound("grina_702");
 *
 *   - DefineSprite_6/frame_1/DoAction.as:
 *       gotoAndStop(random(8) + 1);   → random still frame [1..8]
 *
 *   - DefineSprite_9/frame_1/DoAction.as:
 *       gotoAndPlay(random(100) + 2); → randomise loop start [2..101]
 *   - DefineSprite_9/frame_121/DoAction.as:
 *       gotoAndPlay(2);               → loop back to frame 2
 *
 *   - DefineSprite_10/frame_118/DoAction.as:
 *       stop();
 *
 *   - lib_sprite12 (clipEvent, directlyDynamic):
 *       DefineSprite_12/frame_157/PlaceObject2_11_69/CLIPACTIONRECORD onClipEvent(enterFrame):
 *           _parent._alpha -= 3.33;   → fade-out once placed at frame 157
 *       DefineSprite_12/frame_184/DoAction.as:
 *           _parent._parent.removeMovieClip();  → spell complete
 *
 * The manifest shows sprite12 has a single placement at frame 0, depth 2,
 * of its parent sprite (parentSpriteId 13 — the outer composite clip).
 * Since the main timeline places the outer composite at target cell and
 * sprite12 is a library symbol with live clip-event handlers, we register
 * it and attach it from onSpellStart (main-timeline frame 1 placement).
 *
 * signalHit: fired from sprite_10's stop frame (frame 118, index 117) —
 * sprite_10 is the largest authored impact composite (120 frames, prominent
 * bounds). This matches the canonical "impact plays → hit registered" pattern.
 *
 * complete(): fired from sprite12's frame_184 script
 * (AS: _parent._parent.removeMovieClip()).
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

// Bounds from manifest.json librarySymbols[0] (sprite12)
const SPRITE12_BOUNDS = {
  width: 203.1,
  height: 113.6,
  offsetX: -91.7,
  offsetY: -61.85,
};

// Bounds from manifest.json animations for the static-timeline sprites
// that are registered as SymbolDefinitions for main-timeline placement.
const SPRITE6_BOUNDS = {
  width: 159.45,
  height: 115.5,
  offsetX: -104.3,
  offsetY: -70,
};

const SPRITE7_BOUNDS = {
  width: 168.05,
  height: 215.9,
  offsetX: -69.1,
  offsetY: -78.8,
};

const SPRITE9_BOUNDS = {
  width: 127.6,
  height: 71.4,
  offsetX: -56.05,
  offsetY: -37.95,
};

const SPRITE10_BOUNDS = {
  width: 301.45,
  height: 168.65,
  offsetX: -135.25,
  offsetY: 16.4,
};

export class Spell714 extends RuntimeSpell {
  readonly spellId = 714;
  readonly displayType = SpellDisplayType.TargetCell;

  // References held for onSpellStart attachment
  private sprite6Sym!: SymbolDefinition;
  private sprite7Sym!: SymbolDefinition;
  private sprite9Sym!: SymbolDefinition;
  private sprite10Sym!: SymbolDefinition;
  private sprite12Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const sprite7Anchor = calculateAnchor(SPRITE7_BOUNDS);
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const sprite10Anchor = calculateAnchor(SPRITE10_BOUNDS);
    const sprite12Anchor = calculateAnchor(SPRITE12_BOUNDS);

    // ---- sprite_6 — short impact flash (6 frames, random still) ----
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   gotoAndStop(random(8) + 1);
    // random(8) → [0..7], +1 → [1..8], but sprite_6 only has 6 frames.
    // Clamp to valid range [0..5].
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
            const frame = Math.min(Math.floor(Math.random() * 8), 5);
            clip.gotoAndStop(frame);
          },
        ],
      ]),
    };

    // ---- sprite_7 — main impact animation (57 frames) ---------------
    // No authored frame scripts — plays through all 57 frames.
    this.sprite7Sym = {
      name: "sprite_7",
      totalFrames: 57,
      frames: textures.getFrames("sprite_7"),
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
    };

    // ---- sprite_9 — looping background element (123 frames) ----------
    // AS DefineSprite_9/frame_1/DoAction.as:
    //   gotoAndPlay(random(100) + 2);  → jump to random frame [2..101]
    // AS DefineSprite_9/frame_121/DoAction.as:
    //   gotoAndPlay(2);               → loop back to frame 2
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
            const target = Math.floor(Math.random() * 100) + 2;
            clip.gotoAndPlay(target - 1);
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

    // ---- sprite_10 — large impact composite (120 frames, stops at 118) -
    // AS DefineSprite_10/frame_118/DoAction.as: stop();
    // Also the canonical signalHit frame — the large impact composite
    // completes its main action at frame 118 (index 117).
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
            // Signal hit at the canonical impact frame (stop = impact landed)
            this.runtime.signalHit();
          },
        ],
      ]),
    };

    // ---- lib_sprite12 — fade-out + completion composite (186 frames) --
    // directlyDynamic: true. Has CLIPACTIONRECORD onEnterFrame that starts
    // fading alpha at frame 157, and frame_184 removes the outer mc.
    //
    // The placement in manifest has parentSpriteId=13 at frame 0, depth 2,
    // with matrix: scaleX=0.7, scaleY=0.7, translateX=0, translateY=-0.05.
    //
    // onEnterFrame is active from the moment the clip exists; the canonical
    // CLIPACTIONRECORD onClipEvent(enterFrame) is placed at PlaceObject2 on
    // frame_157 of DefineSprite_12, meaning the enterFrame handler was
    // ATTACHED to the clip at frame 157. We model this by only starting the
    // fade-out behaviour once the clip's own currentFrame reaches 156 (0-based).
    // We track this with a vars flag.
    this.sprite12Sym = {
      name: "sprite12",
      totalFrames: 186,
      frames: textures.getFrames("lib_sprite12"),
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_12/frame_157/PlaceObject2_11_69/CLIPACTIONRECORD
        // onClipEvent(enterFrame): _parent._alpha -= 3.33;
        // The clip event is registered at frame 157 (0-based: 156).
        // Only start fading once we've reached that frame.
        if (clip.currentFrame >= 156) {
          clip.alpha = Math.max(0, clip.alpha - 3.33 / 100);
        }
      },
      frameScripts: new Map([
        [
          183,
          (clip) => {
            // AS DefineSprite_12/frame_184/DoAction.as:
            //   _parent._parent.removeMovieClip();
            // clip's parent is root → removeMovieClip on root's parent = spell done.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite7Sym);
    this.registry.register(this.sprite9Sym);
    this.registry.register(this.sprite10Sym);
    this.registry.register(this.sprite12Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("grina_702");
    callbacks.playSound("grina_702");

    // Attach all authored main-timeline sprites at the target cell (root is
    // already anchored there for displayType=11). Each gets its own depth so
    // they render in the correct stacking order.
    //
    // sprite_5 has no authored frame scripts and width/height=0 (no bounds)
    // — it is a background element. We attach it at depth 1.
    // sprite_6 at depth 2; sprite_7 at depth 3; sprite_9 at depth 4;
    // sprite_10 at depth 5; sprite12 (the library clip-event symbol) at
    // depth 6 with the placement matrix from the manifest (scale 0.7, y -0.05).

    // sprite_5 — no bounds in manifest (0×0), no scripts, just plays frames.
    // Register on-the-fly as a simple container.
    const sprite5Frames = textures.getFrames("sprite_5");
    const sprite5Sym: SymbolDefinition = {
      name: "sprite_5",
      totalFrames: Math.max(1, sprite5Frames.length),
      frames: sprite5Frames,
      anchorX: 0.5,
      anchorY: 0.5,
    };
    this.registry.register(sprite5Sym);
    this.root.attach(sprite5Sym, "sprite5", 1, context);

    this.root.attach(this.sprite6Sym, "sprite6", 2, context);
    this.root.attach(this.sprite7Sym, "sprite7", 3, context);
    this.root.attach(this.sprite9Sym, "sprite9", 4, context);
    this.root.attach(this.sprite10Sym, "sprite10", 5, context);

    // sprite12 placement from manifest librarySymbols[0].placements[0]:
    //   frame: 0, depth: 2, matrix: scaleX=0.7, scaleY=0.7, translateX=0, translateY=-0.05
    const sprite12Clip = this.root.attach(
      this.sprite12Sym,
      "sprite12",
      6,
      context,
      { x: 0, y: -0.05 }
    );
    sprite12Clip.scaleX = 0.6999969482421875;
    sprite12Clip.scaleY = 0.6999969482421875;
  }
}
