/**
 * Spell 1009 — Poupée Vaudou (Sadida voodoo doll).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1009/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The spell has a single authored
 * main timeline (sprite_21) that positions itself at _parent.cellFrom
 * on frame_1 — classic WorldAbsolute pattern. No `move`/`shoot`/
 * `duplicate` symbols are present; no projectile motion.
 *
 * Manifest animations (all in `animations[]`, no `librarySymbols[]`):
 *   - sprite_10  — 117-frame composite. frame_115: stop().
 *   - sprite_14  — 30-frame simple.    frame_28:  stop().
 *   - sprite_18  — 60-frame composite. frame_52:  stop().
 *   - sprite_20  — 6-frame composite.  (no scripts — plays through).
 *   - sprite_21  — 312-frame composite (the outermost driving timeline):
 *       frame_1:   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y
 *       frame_85:  SOMA.playSound("poupee_vodoo2")
 *       frame_121: SOMA.playSound("poupee_vodoo2")
 *       frame_187: SOMA.playSound("poupee")
 *       frame_208: this.end()  → signalHit
 *       frame_310: _parent.removeMovieClip() → complete()
 *
 * Main timeline (frame_2/DoAction.as): stop() — the outer SWF stops
 * immediately; sprite_21 drives everything.
 *
 * Because librarySymbols[] is empty in the manifest, NO `lib_` prefix
 * is used anywhere. All textures are loaded via the bare animation name.
 * Sounds listed in manifest.sounds are fired from sprite_21's frame
 * scripts to match the canonical AS timing.
 *
 * signalHit is called from sprite_21 frame_208 (this.end()).
 * complete() is called from sprite_21 frame_310 (_parent.removeMovieClip()).
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

    // ---- sprite_10 — 117-frame composite -------------------------
    // AS DefineSprite_10/frame_115/DoAction.as: stop();
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
            // AS DefineSprite_10/frame_115/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_14 — 30-frame simple ----------------------------
    // AS DefineSprite_14/frame_28/DoAction.as: stop();
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
            // AS DefineSprite_14/frame_28/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_18 — 60-frame composite -------------------------
    // AS DefineSprite_18/frame_52/DoAction.as: stop();
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
            // AS DefineSprite_18/frame_52/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — 6-frame composite --------------------------
    // No scripts — plays through and loops (no stop() in canonical AS).
    const sprite20Sym: SymbolDefinition = {
      name: "sprite_20",
      totalFrames: 6,
      frames: textures.getFrames("sprite_20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
    };

    // ---- sprite_21 — 312-frame driving timeline -----------------
    // AS DefineSprite_21/frame_1/DoAction.as:
    //   _X = _parent.cellFrom.x;
    //   _Y = _parent.cellFrom.y;
    // AS DefineSprite_21/frame_85/DoAction.as:
    //   SOMA.playSound("poupee_vodoo2");
    // AS DefineSprite_21/frame_121/DoAction.as:
    //   SOMA.playSound("poupee_vodoo2");
    // AS DefineSprite_21/frame_187/DoAction.as:
    //   SOMA.playSound("poupee");
    // AS DefineSprite_21/frame_208/DoAction.as:
    //   this.end();   → signalHit
    // AS DefineSprite_21/frame_310/DoAction.as:
    //   _parent.removeMovieClip();  → complete()
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
            // AS DefineSprite_21/frame_1/DoAction.as:
            // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
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
            // AS DefineSprite_21/frame_85/DoAction.as:
            // SOMA.playSound("poupee_vodoo2");
            this.soundCallback?.("poupee_vodoo2");
          },
        ],
        [
          120,
          () => {
            // AS DefineSprite_21/frame_121/DoAction.as:
            // SOMA.playSound("poupee_vodoo2");
            this.soundCallback?.("poupee_vodoo2");
          },
        ],
        [
          186,
          () => {
            // AS DefineSprite_21/frame_187/DoAction.as:
            // SOMA.playSound("poupee");
            this.soundCallback?.("poupee");
          },
        ],
        [
          207,
          () => {
            // AS DefineSprite_21/frame_208/DoAction.as:
            // this.end();  → damage popup at target
            this.runtime.signalHit();
          },
        ],
        [
          309,
          (clip) => {
            // AS DefineSprite_21/frame_310/DoAction.as:
            // _parent.removeMovieClip();
            clip.remove();
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

  // Captured so frameScripts inside sprite_21 can fire sounds.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_2/DoAction.as: stop();
    // The outer SWF stops on frame 2; sprite_21 is implicitly placed
    // on the main timeline. We attach it here so it starts ticking from
    // the next runtime frame.
    this.soundCallback = callbacks.playSound;
    this.root.attach(this.sprite21Sym, "sprite21", 1, context);
  }
}
