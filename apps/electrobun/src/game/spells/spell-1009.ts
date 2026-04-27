/**
 * Spell 1009 — Poupée Vaudou (Sadida voodoo doll).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1009/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main spell content lives inside
 * DefineSprite_21, which on frame_1 positions itself at `_parent.cellFrom`
 * — i.e. the caster cell — in world coords. This is the hallmark of the
 * WorldAbsolute pattern: the outer container is at world (0,0) and the
 * per-sprite scripts position children at absolute world coords using
 * `_parent.cellFrom` / `_parent.cellTo`.
 *
 * Authored animations (from manifest `animations[]`):
 *   - sprite_10  — 117-frame aura/ring, stops at frame 115 (`stop()`).
 *                  `isComposite: true`.
 *   - sprite_14  — 30-frame impact flash, stops at frame 28 (`stop()`).
 *   - sprite_18  — 60-frame horizontal beam/flash, stops at frame 52 (`stop()`).
 *   - sprite_20  — 6-frame looping particle/flash. No stop script.
 *   - sprite_21  — 312-frame master timeline (the dominant clip).
 *                  frame_1:  position at cellFrom (world coords).
 *                  frame_85: SOMA.playSound("poupee_vodoo2").
 *                  frame_121: SOMA.playSound("poupee_vodoo2").
 *                  frame_187: SOMA.playSound("poupee").
 *                  frame_208: this.end() → signalHit.
 *                  frame_310: _parent.removeMovieClip() → complete.
 *
 * Main timeline (frame_2/DoAction.as): stop() — so the main timeline
 * stops after frame 2 and sprite_21 drives all timing independently.
 *
 * No `librarySymbols[]` entries exist — all content is in `animations[]`
 * so textures use bare names (NO `lib_` prefix).
 *
 * The spell has no `move`/`shoot`/`duplicate` symbols, confirming
 * displayType=50 (WorldAbsolute) rather than any projectile type.
 *
 * Library symbols: none (librarySymbols[] is absent/empty in manifest).
 *
 * Sounds (from manifest `sounds[]`):
 *   - frame 84  → "poupee_vodoo2"  (but AS has it at frame_85, i.e. index 84)
 *   - frame 120 → "poupee_vodoo2"  (AS frame_121, index 120)
 *   - frame 186 → "poupee"         (AS frame_187, index 186)
 * These are driven by sprite_21's frame scripts; `onSpellStart` only
 * issues the entry sound if present (none here — main timeline is just stop()).
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

// Bounds from manifest animations[] entries (NO lib_ prefix for these).
const SPRITE_10_BOUNDS = {
  width: 82.2,
  height: 2.7,
  offsetX: -67.8,
  offsetY: -1.55,
};
const SPRITE_14_BOUNDS = {
  width: 19.9,
  height: 34.55,
  offsetX: -9.6,
  offsetY: -25.05,
};
const SPRITE_18_BOUNDS = {
  width: 280.4,
  height: 40.6,
  offsetX: -105.65,
  offsetY: -21.35,
};
const SPRITE_20_BOUNDS = {
  width: 125.6,
  height: 77.75,
  offsetX: -62.9,
  offsetY: -39.25,
};
const SPRITE_21_BOUNDS = {
  width: 312.65,
  height: 283.4,
  offsetX: -137.25,
  offsetY: -352.1,
};

export class Spell1009 extends RuntimeSpell {
  readonly spellId = 1009;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  // Hold references so onSpellStart can attach them.
  private sprite21Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite10Anchor = calculateAnchor(SPRITE_10_BOUNDS);
    const sprite14Anchor = calculateAnchor(SPRITE_14_BOUNDS);
    const sprite18Anchor = calculateAnchor(SPRITE_18_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE_20_BOUNDS);
    const sprite21Anchor = calculateAnchor(SPRITE_21_BOUNDS);

    // ---- sprite_10 — 117-frame aura/ring -------------------------
    // AS: DefineSprite_10/frame_115/DoAction.as → stop()
    // (frame_115 in 1-based AS = index 114 in 0-based runtime)
    const sprite10Sym: SymbolDefinition = {
      name: "sprite_10",
      totalFrames: 117,
      frames: textures.getFrames("sprite_10"),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      frameScripts: new Map([
        [
          114,
          (clip) => {
            // AS: DefineSprite_10/frame_115/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_14 — 30-frame impact flash -----------------------
    // AS: DefineSprite_14/frame_28/DoAction.as → stop()
    // (frame_28 in 1-based AS = index 27 in 0-based runtime)
    const sprite14Sym: SymbolDefinition = {
      name: "sprite_14",
      totalFrames: 30,
      frames: textures.getFrames("sprite_14"),
      anchorX: sprite14Anchor.x,
      anchorY: sprite14Anchor.y,
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: DefineSprite_14/frame_28/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_18 — 60-frame horizontal beam --------------------
    // AS: DefineSprite_18/frame_52/DoAction.as → stop()
    // (frame_52 in 1-based AS = index 51 in 0-based runtime)
    const sprite18Sym: SymbolDefinition = {
      name: "sprite_18",
      totalFrames: 60,
      frames: textures.getFrames("sprite_18"),
      anchorX: sprite18Anchor.x,
      anchorY: sprite18Anchor.y,
      frameScripts: new Map([
        [
          51,
          (clip) => {
            // AS: DefineSprite_18/frame_52/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — 6-frame looping particle --------------------
    // No stop script — loops naturally.
    const sprite20Sym: SymbolDefinition = {
      name: "sprite_20",
      totalFrames: 6,
      frames: textures.getFrames("sprite_20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
    };

    // ---- sprite_21 — 312-frame master timeline -------------------
    // This is the dominant clip. It positions itself at cellFrom on
    // frame_1, plays sounds at frames 85/121/187, calls end() at
    // frame_208 (signalHit), and removes the outer mc at frame_310
    // (complete).
    //
    // AS frame indices (1-based) → runtime indices (0-based):
    //   frame_1   → 0
    //   frame_85  → 84
    //   frame_121 → 120
    //   frame_187 → 186
    //   frame_208 → 207
    //   frame_310 → 309
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 312,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_21/frame_1/DoAction.as
            // _X = _parent.cellFrom.x;
            // _Y = _parent.cellFrom.y;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          84,
          () => {
            // AS: DefineSprite_21/frame_85/DoAction.as
            // SOMA.playSound("poupee_vodoo2");
            this.soundCallback?.("poupee_vodoo2");
          },
        ],
        [
          120,
          () => {
            // AS: DefineSprite_21/frame_121/DoAction.as
            // SOMA.playSound("poupee_vodoo2");
            this.soundCallback?.("poupee_vodoo2");
          },
        ],
        [
          186,
          () => {
            // AS: DefineSprite_21/frame_187/DoAction.as
            // SOMA.playSound("poupee");
            this.soundCallback?.("poupee");
          },
        ],
        [
          207,
          () => {
            // AS: DefineSprite_21/frame_208/DoAction.as
            // this.end() — canonical signalHit (damage popup).
            this.runtime.signalHit();
          },
        ],
        [
          309,
          (clip) => {
            // AS: DefineSprite_21/frame_310/DoAction.as
            // _parent.removeMovieClip() — spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite10Sym);
    this.registry.register(sprite14Sym);
    this.registry.register(sprite18Sym);
    this.registry.register(sprite20Sym);
    this.registry.register(this.sprite21Sym);
  }

  // Capture the playSound callback so frame scripts inside sprite_21
  // can issue sounds at their canonical frames.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture for use by sprite_21 frame scripts.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop() — nothing else to do
    // at entry time for sounds. The main timeline has no explicit
    // entry sound.

    // Attach sprite_21 as the master driving clip. It self-positions
    // to cellFrom in its frame_1 script.
    this.root.attach(this.sprite21Sym, "sprite21", 1, context);
  }
}
