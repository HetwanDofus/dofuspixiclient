/**
 * Spell 308 — Licorne (Eniripsa / Licorne attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/308/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The spell has a single composite sprite
 * (sprite_24) whose frame_1 positions itself at _parent.cellTo in WORLD
 * coords — the canonical pattern for WorldAbsolute. No librarySymbols[]
 * entries exist; sprite_18 and sprite_22 are sub-animations baked into the
 * composite sprite_24 and are NOT attached via attachMovie. The harness
 * places the container at world origin (0,0); sprite_24 positions itself
 * via cellTo in its frame_1 script.
 *
 * Animation layout (all in animations[], no librarySymbols):
 *   - sprite_18 — 81-frame sub-animation (stopFrame=78); frame_79 → stop().
 *   - sprite_22 — 78-frame sub-animation (stopFrame=75); frame_76 → stop().
 *   - sprite_24 — 132-frame composite, isComposite=true. The main orchestrator:
 *       frame_1:   _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *       frame_52:  SOMA.playSound("licrounch_1008")
 *       frame_82:  this.end() → signalHit
 *       frame_130: _parent.removeMovieClip() → spell complete
 *
 * Main timeline frame_2: stop() — no sound on main timeline.
 *
 * Because sprite_24 is the top-level animation that positions itself,
 * we attach it from onSpellStart. sprite_18 and sprite_22 are sub-
 * animations embedded inside the composite sprite_24 asset and are
 * represented by the composite frames; they do not need separate
 * SymbolDefinition registration (their stop() scripts are irrelevant
 * to the runtime since their content is baked into sprite_24 frames).
 * Only sprite_24 needs to be registered as a SymbolDefinition with its
 * timeline scripts.
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

    // ---- sprite_24 — main composite animation, positions at cellTo ----
    // 132 frames total. Orchestrates the full spell sequence:
    //   frame_1:   position self at target cell
    //   frame_52:  play impact sound
    //   frame_82:  signal hit (damage popup)
    //   frame_130: remove parent → spell complete
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
            // AS: scripts/DefineSprite_24/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
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
            // AS: scripts/DefineSprite_24/frame_52/DoAction.as
            // SOMA.playSound("licrounch_1008");
            // Sound is captured and played via the stored callback.
            this.playSoundCallback?.("licrounch_1008");
          },
        ],
        [
          81,
          () => {
            // AS: scripts/DefineSprite_24/frame_82/DoAction.as
            // this.end() → signal hit (damage popup at target)
            this.runtime.signalHit();
          },
        ],
        [
          129,
          (clip) => {
            // AS: scripts/DefineSprite_24/frame_130/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite24Sym);
  }

  private playSoundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts (frame_52).
    this.playSoundCallback = callbacks.playSound;

    // Main timeline frame_2: stop() — no sound on main timeline.
    // Attach sprite_24 as the top-level orchestrator.
    // sprite_24's frame_1 will position itself at cellTo on the first tick.
    this.root.attach(this.sprite24Sym, "sprite_24", 1, context);
  }
}
