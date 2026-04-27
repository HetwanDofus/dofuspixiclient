/**
 * Spell 1011 — Peur (Sadida fear spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1011/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile, no caster reference,
 * no `move`/`shoot`/`duplicate` harness symbols — it is a pure impact animation
 * at the target cell. The main timeline places a single `anim1` composite on the
 * target and plays it through.
 *
 * Library symbols: none (librarySymbols[] is empty in the manifest). All content
 * lives in the `animations[]` entry `anim1` (72 frames, composite).
 *
 * Authored sprite tree (from scripts[]):
 *   - DefineSprite_4 (appears to be a random-rotation/scale particle or sub-clip):
 *       frame_1: t = 100 + random(100); _xscale = _yscale = t; _rotation = random(360)
 *       frame_19: stop()
 *   - DefineSprite_7:
 *       frame_46: stop()
 *   - DefineSprite_9:
 *       frame_64: stop()
 *   - DefineSprite_10 (outer wrapper, 70 frames):
 *       frame_10: this.end() → signalHit
 *       frame_70: stop(); _parent.removeMovieClip() → complete
 *
 * Since librarySymbols[] is empty, all sprites are authored (baked into the
 * composite anim1 frames). DefineSprite_10 is the outermost authored timeline
 * driving hit + completion signals; we model it as the `anim1` symbol registered
 * under the bare `"anim1"` name (textures.getFrames("anim1")), with frameScripts
 * at frame_10 (hit) and frame_70 (complete).
 *
 * Main timeline: SOMA.playSound("pet") on frame_1.
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
  width: 205.7,
  height: 109.85,
  offsetX: -103.3,
  offsetY: -56.6,
};

export class Spell1011 extends RuntimeSpell {
  readonly spellId = 1011;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — composite impact animation at the target cell.
    // Models the outermost DefineSprite_10 timeline (70 frames) which
    // drives hit signalling at frame_10 and completion at frame_70.
    // The inner DefineSprite_4 / _7 / _9 sub-clips are baked into the
    // composite SVG frames extracted into anim1_*.svg — we do not need
    // to register them as separate symbols.
    //
    // AS DefineSprite_10/frame_10/DoAction.as → signalHit
    // AS DefineSprite_10/frame_70/DoAction.as → stop + _parent.removeMovieClip
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 72,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          9,
          (_clip) => {
            // AS DefineSprite_10/frame_10/DoAction.as: this.end()
            // Signals hit (damage popup) at the target cell.
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_10/frame_70/DoAction.as:
            //   stop();
            //   _parent.removeMovieClip();
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
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("pet");
    callbacks.playSound("pet");

    // Attach the anim1 composite at the root (target cell anchor).
    // The harness has already positioned the container at the target
    // for displayType=11; attaching anim1 at depth 1 places it there.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
