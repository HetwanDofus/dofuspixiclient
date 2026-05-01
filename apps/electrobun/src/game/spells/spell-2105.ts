/**
 * Spell 2105 — (Unknown name, likely a Feca/Eniripsa buff or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2105/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * no `move`/`shoot`/`duplicate` symbols — pure impact animation at the
 * target cell. The manifest has no `librarySymbols[]` array; everything
 * is driven by the single `animations: ["anim1"]` composite sprite.
 *
 * The manifest defines four DefineSprite IDs that correspond to the
 * layers baked into `anim1`, but they are wired together as a single
 * composite. However, the scripts reveal distinct timeline behaviours:
 *
 *   - DefineSprite_4  — individual particle sprite.
 *       frame_1:  t = 100 + random(100); _xscale = _yscale = t; _rotation = random(360)
 *       frame_19: stop()
 *
 *   - DefineSprite_7  — mid-layer sprite.
 *       frame_1:  (empty)
 *       frame_46: stop()
 *
 *   - DefineSprite_9  — inner layer sprite.
 *       frame_64: stop()
 *
 *   - DefineSprite_10 — outer / root-level sprite (the main animated wrapper).
 *       frame_10: this.end()  → signalHit
 *       frame_70: stop(); _parent.removeMovieClip() → complete
 *
 * The manifest's single `anim1` animation is a 72-frame composite that
 * contains all the authored frame artwork. Because there are no
 * `librarySymbols[]` entries and no `attachMovie` calls in the AS scripts,
 * we model this as a single top-level `SymbolDefinition` whose timeline
 * drives the spell lifecycle, using the bare `"anim1"` texture key
 * (no `lib_` prefix).
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("pet"); (no stop)
 * → sound fires; the anim1 clip plays through its 72-frame timeline.
 *
 * Hit signal:  frame 10 of DefineSprite_10 → this.end() → signalHit.
 * Completion:  frame 70 of DefineSprite_10 → _parent.removeMovieClip() → complete.
 *
 * Since anim1 IS DefineSprite_10 (the outermost authored sprite), we
 * model the whole thing as a single SymbolDefinition with frameScripts
 * for frames 9 (hit) and 69 (complete), and attach it directly from
 * onSpellStart.
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

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite animation (mirrors DefineSprite_10) ----
    // The outermost authored sprite. Its timeline drives hit signal and
    // spell completion. The composite also embeds the behaviours of
    // DefineSprite_4, DefineSprite_7, and DefineSprite_9 as authored
    // sub-layers baked into the per-frame SVGs.
    //
    // DefineSprite_4/frame_1/DoAction.as:
    //   t = 100 + random(100); _xscale = _yscale = t; _rotation = random(360)
    //   → particle randomisation baked per-instance; since there are no
    //   separate attachMovie calls for these particles in any AS script,
    //   they are authored (placed via PlaceObject2) inside the SWF timeline
    //   and captured by the composite SVG raster. No runtime attach needed.
    //
    // DefineSprite_4/frame_19/DoAction.as: stop()
    // DefineSprite_7/frame_46/DoAction.as: stop()
    // DefineSprite_9/frame_64/DoAction.as: stop()
    //   → sub-layer stops embedded within the composite; the visual effect
    //   is preserved in the per-frame SVG artwork.
    //
    // DefineSprite_10/frame_10/DoAction.as: this.end() → signalHit
    // DefineSprite_10/frame_70/DoAction.as: stop(); _parent.removeMovieClip()
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
            // Signals hit to the combat system (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_10/frame_70/DoAction.as: stop(); _parent.removeMovieClip()
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
    context: SpellContext
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("pet");
    callbacks.playSound("pet");

    // Attach the main composite animation at the root. The harness has
    // already positioned root at the target cell (displayType=11).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
