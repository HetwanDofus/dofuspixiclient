/**
 * Spell 2002 — (Unknown name, likely a Cra or elemental impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2002/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no move/shoot/duplicate symbols,
 * no caster-side references, no dual-anchored worldAbsolute pattern. A
 * single authored timeline (sprite_9, 54 frames) is placed on the main
 * timeline, positions itself at cellTo on frame_4, signals hit on
 * frame_19, and removes its parent (completing the spell) on frame_40.
 * This is the canonical single-impact-at-target pattern → TargetCell (11).
 *
 * Library symbols: none (librarySymbols[] is empty in manifest.json).
 *
 * Animations:
 *   - sprite_9 (54 frames, isComposite) — the full impact animation.
 *       frame_4:  _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 *                 (positions itself at target in world coords; since
 *                 displayType=11 the container is already at cellTo,
 *                 but the canonical AS uses _parent.cellTo directly —
 *                 we mirror it faithfully using root.vars.cellTo).
 *       frame_19: this.end() → signalHit (damage popup).
 *       frame_40: _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound.
 *
 * Because librarySymbols[] is empty, sprite_9 is registered using the
 * bare "sprite_9" key (no "lib_" prefix) with bounds from animations[0].
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

const SPRITE_9_BOUNDS = {
  width: 57.2,
  height: 221.55,
  offsetX: -28.6,
  offsetY: -206.2,
};

export class Spell2002 extends RuntimeSpell {
  readonly spellId = 2002;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);

    // sprite_9 — 54-frame impact animation anchored at target cell.
    // Not in librarySymbols[], so textures key has NO "lib_" prefix.
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 54,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_9/frame_4/DoAction.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            // Position self at the target cell using world coords
            // stored on root.vars by the harness (mirrors _parent.cellTo).
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
          18,
          (_clip) => {
            // AS: DefineSprite_9/frame_19/DoAction.as
            // this.end() → damage popup at target.
            this.runtime.signalHit();
          },
        ],
        [
          39,
          (clip) => {
            // AS: DefineSprite_9/frame_40/DoAction.as
            // _parent.removeMovieClip() → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite9Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: stop()
    // No SOMA.playSound call present in canonical AS.
    // Attach sprite_9 on the main timeline (implicit placement in canonical SWF).
    this.root.attach(this.sprite9Sym, "sprite9", 1, context);
  }
}
