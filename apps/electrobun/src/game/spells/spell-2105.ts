/**
 * Spell 2105 — Unknown (likely a simple impact/buff spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2105/scripts/scripts/
 *
 * displayType=11 (TargetCell). No `move`/`shoot`/`duplicate` symbols,
 * no caster-relative or world-absolute positioning — all content plays
 * at the target cell. The manifest has a single `animations["anim1"]`
 * entry (no `librarySymbols[]`), so textures are accessed without any
 * `lib_` prefix.
 *
 * Sprite / symbol layout (from scripts list):
 *   - DefineSprite_4 (anim1 sub-sprite): frame_1 randomises scale
 *     [100–200%] and rotation [0–360°] then plays; stops at frame_19.
 *   - DefineSprite_7: empty frame_1; stops at frame_46.
 *   - DefineSprite_9: stops at frame_64.
 *   - DefineSprite_10 (outer timeline):
 *       frame_10: `this.end()` → signalHit.
 *       frame_70: `stop(); _parent.removeMovieClip()` → complete.
 *
 * Because `librarySymbols` is empty in the manifest, the whole animation
 * is a single authored composite `anim1` timeline (72 frames). The
 * DefineSprite_* numbering corresponds to sub-sprites composed inside
 * `anim1`; at the RuntimeSpell level we treat the whole thing as one
 * `anim1` symbol whose frame scripts handle hit + completion signals at
 * the canonical frames derived from the outermost DefineSprite_10 timeline
 * (frame_10 = hit, frame_70 = complete/stop).
 *
 * Main timeline: `SOMA.playSound("pet");` on frame_1.
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

export class Spell2105 extends RuntimeSpell {
  readonly spellId = 2105;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — composite 72-frame impact animation at the target cell.
    // The outermost authored timeline is DefineSprite_10 (72 frames):
    //   frame_10: this.end()              → signalHit
    //   frame_70: stop(); _parent.removeMovieClip() → complete
    //
    // DefineSprite_4 (sub-sprite inside anim1):
    //   frame_1 randomises _xscale/_yscale [100–200] and _rotation [0–360°].
    //   frame_19: stop().
    // We cannot drive DefineSprite_4's frame_1 script independently at
    // runtime (it's baked into the composite SVG frames), but we DO need
    // to honour the top-level timeline signals at frames 10 and 70.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 72,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_10/frame_10/DoAction.as → this.end()
          // Signals that the spell has hit the target (damage popup).
          9,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_10/frame_70/DoAction.as → stop(); _parent.removeMovieClip()
          // Stops the timeline and removes the outer movie clip, ending the spell.
          69,
          (clip) => {
            clip.stop();
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
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("pet");
    callbacks.playSound("pet");

    // Attach the anim1 composite at the root (target cell anchor).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
