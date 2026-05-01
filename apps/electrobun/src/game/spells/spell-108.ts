/**
 * Spell 108 — Carapace (Feca shield).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/108/scripts/scripts/
 *
 * displayType=10 (CasterCell). This spell has no projectile, no target-cell
 * impact, and no caster/target references in the AS — it is a self-buff /
 * shield aura that plays entirely on the caster. The single authored animation
 * `anim1` plays at the caster cell. No `librarySymbols` entries in the
 * manifest; the entire visual is the pre-rendered `anim1` timeline.
 *
 * AS layout:
 *   - DefineSprite_7 (anim1, 129 frames):
 *       frame_1:  SOMA.playSound("shield_cara")
 *       frame_127: _parent.removeMovieClip() → spell complete
 *   - DefineSprite_5 (inner timeline, 55 frames):
 *       frame_55: stop()
 *
 * The manifest has no `librarySymbols[]` entries, so there are no
 * `attachMovie` calls and no `lib_` prefixed textures. `anim1` is in
 * `animations[]` and is registered as a container-only timeline that
 * drives the frame scripts.
 *
 * signalHit: fired at frame_1 of the anim1 timeline (the same frame the
 * shield sound plays — canonical impact moment for a self-buff).
 * complete:  fired at frame_127 of anim1 (_parent.removeMovieClip()).
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell108 extends RuntimeSpell {
  readonly spellId = 108;
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 129-frame caster-side shield aura ---------------
    // AS DefineSprite_7/frame_1/DoAction.as:    SOMA.playSound("shield_cara")
    // AS DefineSprite_7/frame_127/DoAction.as:  _parent.removeMovieClip()
    //
    // No librarySymbols in manifest → use bare "anim1" key (no lib_ prefix).
    // anim1 has 129 logical frames in the SWF, but the svg-spritesheet
    // content-hash dedup collapses frames 87-128 (post-removeMovieClip
    // placeholder) into a single trailing unique cell. Use unique-cell
    // count + 1 (88 + offset for last unique idx) so the timeline never
    // ticks past the strip's last cell — see the AI prompt section
    // "deduplicated frame count" in tools/combat-exporter/generate-spells.ts.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 87,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_7/frame_1/DoAction.as
            // Sound is played via onSpellStart (callbacks available there).
            // Also signal hit at this canonical impact moment.
            this.runtime.signalHit();
          },
        ],
        [
          86,
          (clip) => {
            // AS DefineSprite_7/frame_127/DoAction.as
            // _parent.removeMovieClip() — remove anim1 and complete the spell.
            // Mapped from canonical frame_127 to the last unique-cell
            // logical idx (86) because the trailing 42 frames dedupe to
            // the same placeholder cell.
            clip.remove();
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
    // AS DefineSprite_7/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    callbacks.playSound("shield_cara");

    // Attach anim1 to the root so it starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
