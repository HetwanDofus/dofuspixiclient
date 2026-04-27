/**
 * Spell 614 — Esquive (Dodge/Evasion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/614/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile, no caster-anchored
 * content, no `move`/`shoot`/`duplicate` symbols, and no `_parent.cellFrom`/
 * `_parent.cellTo` dual-anchoring. It is a single impact animation at the target
 * cell — the classic TargetCell pattern.
 *
 * The manifest has NO `librarySymbols[]` entries. All content comes from the
 * single `animations: [{name: "anim1", frameCount: 102}]` entry. The AS scripts
 * reference `DefineSprite_8`, `DefineSprite_9`, `DefineSprite_10`, and
 * `DefineSprite_11` — these are sub-sprites whose timelines are baked into the
 * composite `anim1` frames. Since none of them are `attachMovie`-ed from AS (they
 * are placed statically on the authored timeline), we model the outermost wrapper
 * (DefineSprite_11, 102 frames) as the sole registered symbol.
 *
 * Symbol layout:
 *   - `anim1` (102-frame composite) — the entire spell visual. The AS scripts
 *     that fire on sub-sprites (DefineSprite_8, _9, _10) are authored timeline
 *     clip events baked into the composite; we cannot drive them independently
 *     without per-symbol frame extraction. What we CAN and MUST port are the
 *     DefineSprite_11 frame scripts that play sounds and complete the spell:
 *       frame_13 (index 12): SOMA.playSound("dodge_607b")
 *       frame_22 (index 21): SOMA.playSound("dodge_614")
 *       frame_100 (index 99): _parent.removeMovieClip() → complete
 *
 * Sub-sprite clip events (DefineSprite_8 PlaceObject2_5_2, DefineSprite_9
 * PlaceObject2_8_1) are embedded in the baked composite SVG frames and do not
 * need to be driven separately by the runtime — the visual output is already
 * baked per-frame.
 *
 * Sounds: The manifest lists frame 12 → "dodge_607b" and frame 21 → "dodge_614",
 * which exactly matches the DefineSprite_11 frame scripts. We fire them from the
 * anim1 symbol's frameScripts.
 *
 * signalHit: fired at frame_13 (index 12), the first impact sound frame.
 * complete:  fired at frame_100 (index 99), the _parent.removeMovieClip() frame.
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
  width: 378.75,
  height: 473.15,
  offsetX: -188.85,
  offsetY: -343.05,
};

export class Spell614 extends RuntimeSpell {
  readonly spellId = 614;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback: ((id: string) => void) | undefined;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 102-frame composite impact animation ------------
    // Outer wrapper corresponds to DefineSprite_11 (102 frames).
    // AS DefineSprite_11/frame_13/DoAction.as: SOMA.playSound("dodge_607b")
    // AS DefineSprite_11/frame_22/DoAction.as: SOMA.playSound("dodge_614")
    // AS DefineSprite_11/frame_100/DoAction.as: _parent.removeMovieClip()
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 102,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip) => {
            // AS DefineSprite_11/frame_13/DoAction.as
            this.runtime.signalHit();
            this.soundCallback?.("dodge_607b");
          },
        ],
        [
          21,
          (_clip) => {
            // AS DefineSprite_11/frame_22/DoAction.as
            this.soundCallback?.("dodge_614");
          },
        ],
        [
          99,
          (clip) => {
            // AS DefineSprite_11/frame_100/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback so frameScripts can fire sounds mid-animation.
    this.soundCallback = callbacks.playSound;

    // Attach the main animation at the root. For displayType=11 (TargetCell)
    // the container is already anchored at the target cell, so we attach at (0,0).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
