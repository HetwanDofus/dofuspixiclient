/**
 * Spell 2071 — Unknown (displayType=11 TargetCell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2071/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has no projectile motion, no caster
 * reference, and no `move`/`shoot`/`duplicate` symbols. It is a single
 * impact animation anchored at the target cell. The manifest has no
 * `librarySymbols[]` entry — only a single `animations[]` entry named
 * `anim1`. There is no top-level main-timeline sound.
 *
 * Library symbols:
 *   None. The AS scripts (DefineSprite_7, DefineSprite_8) drive the
 *   `anim1` composite animation which is the sole visual.
 *
 * Symbol layout (inferred from script paths and manifest):
 *   - `anim1` (DefineSprite_8, 111 frames, isComposite=true):
 *       • Internally spawns instances of DefineSprite_7 particles.
 *       • frame_109/DoAction.as: `_parent.removeMovieClip(); stop();`
 *         → signals spell complete.
 *
 *   - DefineSprite_7 — particle sprite within anim1 (106 frames):
 *       • frame_1/DoAction.as: seeds scale [50,110]%, vx ∈ [-3,3],
 *         vy ∈ [-3,-8]; installs onEnterFrame for physics; jumps to
 *         random frame in [1,30].
 *       • frame_106/DoAction.as: stop().
 *       • onEnterFrame: integrate position + 0.9 friction per axis.
 *
 * Because the manifest has no `librarySymbols[]`, the composite anim1
 * timeline is rendered directly via `textures.getFrames("anim1")` (no
 * `lib_` prefix). The DefineSprite_7 sub-particles are baked into the
 * composite frames by the exporter and do not need separate registration.
 *
 * signalHit: fired at frame_109 (index 108) — the same frame that
 * removes the outer mc, which is the canonical impact moment.
 * complete(): fired at the same frame script (frame_109 / index 108).
 *
 * Main timeline: no sound, no explicit child attaches beyond what the
 * harness sets up. `onSpellStart` is a no-op.
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
  width: 54.6,
  height: 44.9,
  offsetX: -27.3,
  offsetY: -21.8,
};

export class Spell2071 extends RuntimeSpell {
  readonly spellId = 2071;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite impact animation at target cell -------
    // The composite bakes the DefineSprite_7 particle behaviour into
    // per-frame SVG textures. We still wire the timeline scripts so
    // signalHit / complete fire at the correct canonical moment.
    //
    // AS DefineSprite_8/frame_109/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 111,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          108,
          (_clip) => {
            // AS DefineSprite_8/frame_109/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            // frame_109 (0-based: 108) is the canonical removal frame.
            // Signal hit at impact and complete the spell.
            this.runtime.signalHit();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No canonical SOMA.playSound on the main timeline for this spell.
    // Attach anim1 at root so it starts playing immediately.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
