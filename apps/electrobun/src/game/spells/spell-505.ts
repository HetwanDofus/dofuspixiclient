/**
 * Spell 505 — Many (unknown Dofus class, likely Sadida or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/505/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no
 * `move`/`shoot`/`duplicate` symbols, and no `cellFrom`/`cellTo` world-
 * absolute positioning logic. The single `anim1` animation plays at the
 * target cell. The manifest lists no `librarySymbols[]` — only a bare
 * `animations: [{name: "anim1", ...}]` entry, so textures are loaded
 * via `textures.getFrames("anim1")` (no `lib_` prefix).
 *
 * AS layout:
 *   - `DefineSprite_16` — the main animation sprite (123 frames).
 *       frame_4  (AS frame_4): position self at _parent.cellFrom; call
 *                this.end() → signalHit.
 *       frame_121 (AS frame_121): _parent.removeMovieClip(); stop()
 *                → spell complete.
 *   - `frame_1/DoAction.as` (main timeline): SOMA.playSound("many_505").
 *
 * The `anim1` animation in the manifest corresponds to `DefineSprite_16`
 * at runtime. We register it as a symbol named "anim1" and attach it
 * from `onSpellStart` so the harness (TargetCell) positions the container
 * at the target cell, then the sprite optionally repositions itself to
 * cellFrom on frame_4 for the hit signal.
 *
 * signalHit: frame_4 of DefineSprite_16 → `this.end()` canonical.
 * complete:  frame_121 of DefineSprite_16 → `_parent.removeMovieClip()`.
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

const ANIM1_BOUNDS = {
  width: 518,
  height: 409.35,
  offsetX: -263.5,
  offsetY: -261.4,
};

export class Spell505 extends RuntimeSpell {
  readonly spellId = 505;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 (DefineSprite_16) — main animation at target -----
    // 123 frames total; frame_4 fires signalHit, frame_121 completes.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 123,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS scripts/DefineSprite_16/frame_4/DoAction.as:
            //   _X = _parent.cellFrom.x;
            //   _Y = _parent.cellFrom.y;
            //   this.end();
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            this.runtime.signalHit();
          },
        ],
        [
          120,
          (clip) => {
            // AS scripts/DefineSprite_16/frame_121/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as:
    //   SOMA.playSound("many_505");
    callbacks.playSound("many_505");

    // Attach the main animation sprite at depth 1 on the root.
    // The container is already positioned at cellTo by TargetCell harness.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
