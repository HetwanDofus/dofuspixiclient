/**
 * Spell 308 — (Licorne / Licorne, Eniripsa area).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/308/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline has no library symbols
 * and no projectile motion. Instead, it places a single composite sprite
 * (sprite_24) on the main timeline whose frame_1 positions itself at
 * _parent.cellTo in world coords — the canonical WorldAbsolute pattern.
 * sprite_24 is a 132-frame composite that:
 *   - frame_1:   positions self at cellTo (world coords)
 *   - frame_52:  plays sound "licrounch_1008"
 *   - frame_82:  this.end() → signalHit
 *   - frame_130: _parent.removeMovieClip() → spell complete
 *
 * sprite_18 (81 frames) and sprite_22 (78 frames) appear to be sub-sprites
 * embedded within the composite sprite_24 rendering (isComposite: true).
 * Their only scripts are stop() at their respective last frames (frame_79
 * and frame_76), which are baked into the composite SVGs. They are not
 * independently attached by AS code, so they do not need separate
 * SymbolDefinitions — their content is pre-rendered into sprite_24.
 *
 * The main timeline frame_2 script is just stop(); the harness handles
 * WorldAbsolute anchoring. We attach sprite_24 from onSpellStart.
 *
 * Library symbols: none (manifest.librarySymbols is absent / empty).
 *
 * Animations:
 *   - sprite_18: 81-frame sub-animation (baked into sprite_24 composite)
 *   - sprite_22: 78-frame sub-animation (baked into sprite_24 composite)
 *   - sprite_24: 132-frame composite impact animation at cellTo
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

const SPRITE_24_BOUNDS = {
  width: 97.25,
  height: 460.1,
  offsetX: -52.25,
  offsetY: -458.35,
};

export class Spell308 extends RuntimeSpell {
  readonly spellId = 308;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite24Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite24Anchor = calculateAnchor(SPRITE_24_BOUNDS);

    // ---- sprite_24 — 132-frame composite impact at cellTo --------
    // Drives the full spell visual: positioning, sound cue, hit signal,
    // and completion.
    //
    // AS DefineSprite_24/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x;
    //   _Y = _parent.cellTo.y;
    //
    // AS DefineSprite_24/frame_52/DoAction.as:
    //   SOMA.playSound("licrounch_1008");
    //
    // AS DefineSprite_24/frame_82/DoAction.as:
    //   this.end();
    //
    // AS DefineSprite_24/frame_130/DoAction.as:
    //   _parent.removeMovieClip();
    this.sprite24Sym = {
      name: "sprite_24",
      totalFrames: 132,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_24/frame_1/DoAction.as
            // Position self at cellTo in world coords.
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
          51,
          () => {
            // AS DefineSprite_24/frame_52/DoAction.as
            // Sound is played from onSpellStart via the stored callback;
            // manifest lists sound at frame 51 (0-based) — fire it here.
            this.soundCallback?.("licrounch_1008");
          },
        ],
        [
          81,
          () => {
            // AS DefineSprite_24/frame_82/DoAction.as
            // this.end() → signalHit (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          129,
          (clip) => {
            // AS DefineSprite_24/frame_130/DoAction.as
            // _parent.removeMovieClip() → spell complete.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite24Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame_52 of sprite_24 can fire it.
    this.soundCallback = callbacks.playSound;

    // Attach sprite_24 on the main timeline. For WorldAbsolute the
    // container is at world (0,0); sprite_24's frame_1 script positions
    // it at cellTo internally.
    this.root.attach(this.sprite24Sym, "sprite24", 1, context);
  }
}
