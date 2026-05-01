/**
 * Spell 309 — Setag (Ecaflip tarot card strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/309/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single animated sprite
 * (sprite_91) that positions itself at cellTo on frame_1 and plays a
 * 144-frame authored timeline. No attachMovie calls, no projectile
 * motion, no library symbols — the content is entirely driven by the
 * sprite_91 timeline which is placed on the main timeline (implicitly
 * by the SWF's authored frame_1 PlaceObject2).
 *
 * The main timeline has `stop()` at frame_2, meaning the outer SWF
 * halts at frame 2 while sprite_91 plays out independently.
 *
 * sprite_91 timeline events:
 *   frame_1  (index 0):  position at cellTo.x / cellTo.y
 *   frame_16 (index 15): SOMA.playSound("setag_309a")
 *   frame_43 (index 42): SOMA.playSound("setag_309b")
 *   frame_70 (index 69): SOMA.playSound("setag_309b")
 *   frame_118 (index 117): SOMA.playSound("setag_309b")
 *   frame_127 (index 126): this.end() → signalHit
 *   frame_142 (index 141): _parent.removeMovieClip() → complete
 *
 * Library symbols: none (sprite_91 is in animations[], not librarySymbols[]).
 *
 * Main timeline: frame_2/DoAction.as → stop() (no-op from our side since
 * the harness root doesn't auto-play; onSpellStart attaches sprite_91).
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

const SPRITE_91_BOUNDS = {
  width: 79.15,
  height: 240.45,
  offsetX: -45.4,
  offsetY: -228.95,
};

export class Spell309 extends RuntimeSpell {
  readonly spellId = 309;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite91Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite91Anchor = calculateAnchor(SPRITE_91_BOUNDS);

    // sprite_91 lives in animations[] (not librarySymbols[]), so textures
    // are accessed under the bare name "sprite_91" (no lib_ prefix).
    this.sprite91Sym = {
      name: "sprite_91",
      totalFrames: 144,
      frames: textures.getFrames("sprite_91"),
      anchorX: sprite91Anchor.x,
      anchorY: sprite91Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_91/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // For displayType=11 the container is already anchored at
            // cellTo, so the sprite's local (0,0) IS cellTo. This
            // explicit positioning matches that behaviour. We still
            // honour the canonical script for correctness.
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
          15,
          () => {
            // AS DefineSprite_91/frame_16/DoAction.as
            // SOMA.playSound("setag_309a");
            this.soundCallback?.("setag_309a");
          },
        ],
        [
          42,
          () => {
            // AS DefineSprite_91/frame_43/DoAction.as
            // SOMA.playSound("setag_309b");
            this.soundCallback?.("setag_309b");
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_91/frame_70/DoAction.as
            // SOMA.playSound("setag_309b");
            this.soundCallback?.("setag_309b");
          },
        ],
        [
          117,
          () => {
            // AS DefineSprite_91/frame_118/DoAction.as
            // SOMA.playSound("setag_309b");
            this.soundCallback?.("setag_309b");
          },
        ],
        [
          126,
          () => {
            // AS DefineSprite_91/frame_127/DoAction.as
            // this.end() → canonical hit signal (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          141,
          (clip) => {
            // AS DefineSprite_91/frame_142/DoAction.as
            // _parent.removeMovieClip() → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite91Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frame scripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1: implicitly places sprite_91 at depth 1.
    // frame_2/DoAction.as → stop() (the outer container halts; sprite_91
    // continues independently, which the runtime already handles since
    // each clip ticks its own timeline).
    this.root.attach(this.sprite91Sym, "sprite91", 1, context);
  }
}
