/**
 * Spell 706 — Grina (Sacrieur / Iop melee strike).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/706/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` symbol — the single `anim1` animation plays
 * at the target cell. The manifest has NO `librarySymbols[]` entries; all
 * content lives in the single `animations[]` entry `anim1`.
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("grina_706")
 *   - frame_115/DoAction.as: this.removeMovieClip() → spell complete
 *
 * The `anim1` symbol is the entire visual — 60 authored frames in the
 * exported SVG strip. It is NOT a library symbol (librarySymbols is absent
 * from the manifest), so textures are loaded with the bare key `"anim1"`
 * (no `lib_` prefix).
 *
 * Two internal DefineSprite symbols are present in the AS source but are
 * pre-composited into the `anim1` SVG frames by the exporter:
 *   - DefineSprite_3: frame_1 picks a random still frame via
 *     `gotoAndStop(random(3)+1)` — visual variation baked into the rendered
 *     frames.
 *   - DefineSprite_5: frame_1 picks trajectory variant (`traj1`) and plays;
 *     stops at frames 58, 118, 178.
 *   - DefineSprite_8: stops at frame 58.
 * None of these have onClipEvent handlers; all their behaviour is captured
 * in the pre-rendered SVG composite. No runtime CLIPACTIONRECORD handling
 * is needed.
 *
 * signalHit is called at the visual impact — the animation is 60 frames of
 * content; we fire it at the midpoint (frame 29, ~0 based) which corresponds
 * roughly to the strike contact. The spell completes at the main-timeline
 * frame_115 canonical removal (mapped to frame index 114, 0-based).
 * Because the exported `anim1` only has 60 frames, we stop the anim1 clip
 * at its last frame (frame 57 per stopFrame in manifest = index 57) and fire
 * complete from the outer main-timeline frame_115 script (index 114).
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
  width: 837.4,
  height: 390.55,
  offsetX: -383.9,
  offsetY: -172.2,
};

export class Spell706 extends RuntimeSpell {
  readonly spellId = 706;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main visual, 60 frames -------------------------
    // The entire spell visual. No library symbols are involved; this
    // is the sole animation entry from manifest.animations[].
    // Texture key is bare "anim1" (no lib_ prefix — not a librarySymbol).
    //
    // stopFrame in manifest = 57 (0-based index 57), so we stop at frame
    // index 57. signalHit fires at frame index 12 (roughly the first third,
    // canonical impact moment for a melee strike at this speed).
    //
    // AS DefineSprite_8/frame_58/DoAction.as: stop()
    // AS DefineSprite_5/frame_58/DoAction.as: stop()
    // These are internal sub-sprite stops; the composite anim1 naturally
    // ceases motion at its stopFrame. We honour this by calling clip.stop()
    // at frame index 57.
    const anim1Frames = textures.getFrames("anim1");
    const anim1Total = anim1Frames.length > 0 ? anim1Frames.length : 60;

    this.anim1Sym = {
      name: "anim1",
      totalFrames: anim1Total,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          12,
          (_clip) => {
            // Canonical impact moment — fire hit signal so damage
            // popups appear at the strike contact frame.
            this.runtime.signalHit();
          },
        ],
        [
          57,
          (clip) => {
            // AS DefineSprite_8/frame_58/DoAction.as + manifest stopFrame=57
            // (0-based index 57): stop the animation at its authored end.
            clip.stop();
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
    // AS frame_1/DoAction.as: SOMA.playSound("grina_706");
    callbacks.playSound("grina_706");

    // Attach the main anim1 clip at the root (target cell).
    // The main timeline implicitly places the composite sprite at depth 1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);

    // Wire the main-timeline frame_115 completion into the root's
    // onEnterFrame so we can monitor elapsed frames and fire complete().
    // AS frame_115/DoAction.as: this.removeMovieClip() — removes the
    // outer mc, ending the spell. Frame 115 is 1-based → index 114.
    // We track this on the root clip via a frame counter in vars.
    this.root.vars._mainFrame = 0;
    this.root.onEnterFrame = (_clip) => {
      const f = (this.root.vars._mainFrame as number) + 1;
      this.root.vars._mainFrame = f;
      if (f >= 114) {
        // AS frame_115/DoAction.as: this.removeMovieClip()
        this.root.onEnterFrame = null;
        this.runtime.complete();
      }
    };
  }
}
