/**
 * Spell 108 — Carapace (Feca shield spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/108/scripts/scripts/
 *
 * displayType=11 (TargetCell). This is a single-impact animation at the target
 * cell — no projectile, no caster reference, no dual timelines. The manifest
 * has no librarySymbols and no attachMovie calls; all visual content is a single
 * authored `anim1` timeline (129 frames). This matches the TargetCell pattern.
 *
 * AS layout:
 *   - DefineSprite_7 (anim1, 129 frames):
 *       frame_1:  SOMA.playSound("shield_cara")
 *       frame_127: _parent.removeMovieClip() → spell complete
 *   - DefineSprite_5 (inner sub-sprite, 55 frames):
 *       frame_55: stop()
 *
 * The `anim1` symbol maps to the `animations[]` entry (no `lib_` prefix).
 * DefineSprite_5 is an authored sub-sprite within anim1's visual content;
 * its frame_55 stop() is baked into the composite frames — we do not need to
 * register it separately as it is not attached via attachMovie.
 *
 * signalHit is fired at frame_1 of anim1 (the initial impact frame, canonical
 * for a caster-side shield spell). complete() is fired at frame_127 per the
 * canonical _parent.removeMovieClip().
 *
 * Main timeline: sound is played inside DefineSprite_7/frame_1 (the anim1
 * symbol's own frame_1 script), so we play it from the frameScripts[0] handler
 * rather than onSpellStart. onSpellStart attaches anim1 to root.
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
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 129-frame shield impact composite ---------------
    // AS DefineSprite_7/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    // AS DefineSprite_7/frame_127/DoAction.as: _parent.removeMovieClip()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, _ctx) => {
            // AS DefineSprite_7/frame_1/DoAction.as
            // Play the shield sound at the first frame of impact.
            this.soundCallback?.("shield_cara");
            // Signal hit at the first visible impact frame.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_7/frame_127/DoAction.as
            // _parent.removeMovieClip() — anim1's parent is root (the outer mc).
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
    // Capture sound callback so frameScripts[0] can fire it.
    this.soundCallback = callbacks.playSound;

    // Attach the main anim1 symbol to root so it begins ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
