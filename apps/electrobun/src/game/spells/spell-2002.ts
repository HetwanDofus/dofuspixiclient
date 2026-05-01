/**
 * Spell 2002 — (Unknown, likely a target-cell impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2002/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`,
 * or `_parent.cellFrom` reference — the single symbol `sprite_9` positions
 * itself at `_parent.cellTo` on its first meaningful frame (frame_4), which
 * is the canonical pattern for a target-anchored impact. No caster reference,
 * no projectile arc, no beam line → TargetCell.
 *
 * Library symbols: none (librarySymbols[] is empty in the manifest).
 *
 * Animations:
 *   - sprite_9 — 54-frame composite impact animation.
 *       frame_4  (index 3): position self at _parent.cellTo.
 *       frame_19 (index 18): this.end() → signalHit.
 *       frame_40 (index 39): _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sound. sprite_9 is
 * placed on the main timeline (the sole animation entry), attached in
 * onSpellStart.
 *
 * Note: sprite_9 has NO `lib_` prefix because it appears only in
 * `animations[]`, not in `librarySymbols[]`. Textures are fetched via
 * `textures.getFrames("sprite_9")`.
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

    // ---- sprite_9 — 54-frame target-cell impact animation --------
    // No lib_ prefix: appears only in animations[], not librarySymbols[].
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
          () => {
            // AS: DefineSprite_9/frame_19/DoAction.as
            // this.end() → signalHit (damage popup at target).
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
    // Main timeline: frame_2/DoAction.as → stop(); no sound.
    // sprite_9 is placed on the main timeline — attach it so it starts
    // ticking from the next runtime frame.
    this.root.attach(this.sprite9Sym, "sprite9", 1, context);
  }
}
