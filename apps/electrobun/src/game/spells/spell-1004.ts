/**
 * Spell 1004 — (Unknown name, likely a self-buff or target-impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1004/scripts/scripts/
 *
 * displayType=11 (TargetCell). The manifest has a single `animations[]` entry
 * (`anim1`, 134 frames, no `librarySymbols[]`) and no `move`/`shoot`/`duplicate`
 * symbols. There is no projectile, no beam, no dual-anchor pattern. This is a
 * pure impact animation that plays at the target cell.
 *
 * The SWF is a single DefineSprite_32 timeline (134 frames) wrapping a child
 * DefineSprite_30 (19 frames).  The relevant scripts are:
 *
 *   - DefineSprite_32/frame_59/DoAction.as  → `this.end()` → signalHit
 *   - DefineSprite_32/frame_133/DoAction.as → `_parent.removeMovieClip(); stop();`
 *                                             → spell complete
 *   - DefineSprite_30/frame_19/DoAction.as  → `stop();` (inner sub-sprite halts)
 *
 * The manifest has no `librarySymbols[]`, so all textures live under the bare
 * animation name `anim1` (no `lib_` prefix). Because `librarySymbols` is empty
 * there is no runtime `attachMovie` — the animation is a single pre-composed
 * sprite whose frame textures are already exported as `anim1_*.svg`. We register
 * it as one `SymbolDefinition` with the relevant frameScripts and attach it
 * from `onSpellStart`.
 *
 * Library symbols: none (librarySymbols[] is absent/empty).
 *
 * Main timeline: attaches `anim1` at depth 1, no sound specified in AS files.
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
  width: 81.4,
  height: 71.4,
  offsetX: -49.4,
  offsetY: -106.7,
};

export class Spell1004 extends RuntimeSpell {
  readonly spellId = 1004;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 134-frame composite impact animation at target cell ----
    // The entire spell visual lives in this single sprite.
    //
    // DefineSprite_32/frame_59/DoAction.as  → this.end()  → signalHit
    // DefineSprite_32/frame_133/DoAction.as → _parent.removeMovieClip(); stop();
    //
    // Note: DefineSprite_30/frame_19/DoAction.as contains `stop()` for an inner
    // sub-sprite baked into the pre-rendered composite frames — no separate
    // runtime attach is needed for it since it has no dynamic clip-event handlers.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 134,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_32/frame_59/DoAction.as: this.end();
          // frame_59 → index 58 (0-based)
          58,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_32/frame_133/DoAction.as: _parent.removeMovieClip(); stop();
          // frame_133 → index 132 (0-based)
          132,
          (clip) => {
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: attach the single composite animation at depth 1.
    // No SOMA.playSound call found in the provided AS files.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
