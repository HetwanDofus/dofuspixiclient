/**
 * Spell 2057 — (Unknown name, likely a Cra/Eniripsa arrow or impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2057/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is a single animated sprite (sprite_9)
 * with no projectile, no caster-side content, no `move`/`shoot`/`duplicate`
 * library symbols, and no `_parent.cellFrom` references. The sprite positions
 * itself at `_parent.cellTo` on frame 16, signals a hit on frame 31 via
 * `this.end()`, and removes the outer mc on frame 52. This is a pure
 * target-cell impact animation — displayType 11 (TargetCell).
 *
 * Library symbols: none (no `librarySymbols[]` in manifest).
 *
 * animations[]:
 *   - sprite_9 — 66-frame composite impact animation. Positions itself at
 *     cellTo on frame 16. Signals hit on frame 31 (`this.end()`). Removes
 *     parent (spell complete) on frame 52.
 *
 * Main timeline: frame_2/DoAction.as → `stop();` (no sound).
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
  width: 205.2,
  height: 349.8,
  offsetX: -101.5,
  offsetY: -295.5,
};

export class Spell2057 extends RuntimeSpell {
  readonly spellId = 2057;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite9Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE_9_BOUNDS);

    // ---- sprite_9 — 66-frame target-cell impact animation --------
    // No librarySymbols entry — this animation is in `animations[]` only,
    // so textures are accessed with the bare name "sprite_9" (no lib_ prefix).
    //
    // frame_16/DoAction.as:  _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // frame_31/DoAction.as:  this.end();   → signalHit
    // frame_52/DoAction.as:  _parent.removeMovieClip();  → spell complete
    this.sprite9Sym = {
      name: "sprite_9",
      totalFrames: 66,
      frames: textures.getFrames("sprite_9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_9/frame_16/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // For displayType 11, the container is already anchored at
            // cellTo in world coords, so sprite_9's local position
            // should be (0, 0) to sit exactly on the target cell.
            // We still faithfully read cellTo from root.vars and
            // compute the container-local offset (which is zero for
            // displayType 11, since anchor == cellTo).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const anchor = { x: 0, y: 0 }; // container origin == cellTo for displayType 11
            if (cellTo) {
              clip.x = cellTo.x - (root?.parent ? 0 : 0);
              clip.y = cellTo.y - (root?.parent ? 0 : 0);
              // For TargetCell the harness places the container AT cellTo,
              // so the local offset is (0, 0). Explicitly set to be safe.
              clip.x = 0;
              clip.y = 0;
              void anchor; // suppress unused warning
            }
          },
        ],
        [
          30,
          () => {
            // AS DefineSprite_9/frame_31/DoAction.as
            // this.end() → damage popup / hit signal
            this.runtime.signalHit();
          },
        ],
        [
          51,
          (clip) => {
            // AS DefineSprite_9/frame_52/DoAction.as
            // _parent.removeMovieClip() → spell complete
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
    // Main timeline frame_2/DoAction.as: stop();
    // No sound. Attach sprite_9 so it starts ticking from the next frame.
    this.root.attach(this.sprite9Sym, "sprite9", 1, context);
  }
}
