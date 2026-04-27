/**
 * Spell 2113 — (Unknown name, likely a simple impact/aura spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2113/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols (librarySymbols[]
 * is empty in the manifest), no `attachMovie` calls, no `move`/`shoot`/
 * `duplicate` symbols, no projectile or beam logic. The manifest contains
 * only `animations[]` entries — specifically `anim9` (87-frame composite)
 * which is the main visual, plus `anim1`, `anim5`, and `anim59` (18-frame
 * small animations). No caster-side reference; single target-cell impact.
 * Default displayType=11 (TargetCell) is correct.
 *
 * Canonical AS layout:
 *   - DefineSprite_34/frame_73/DoAction.as: `_parent.removeMovieClip(); stop();`
 *     This is the anim9 sprite (87 frames, stopFrame=72 → frame_73 in 1-based
 *     = index 72 in 0-based). Fires at frame 72: removes parent → complete.
 *   - DefineSprite_2/frame_16/DoAction.as: `stop();`
 *     This is the anim1/anim5/anim59 sprite (18 frames, stopFrame=15 →
 *     frame_16 in 1-based = index 15 in 0-based). Fires at frame 15: stops.
 *
 * No library symbols → no `lib_` prefix on any getFrames call.
 * No `SOMA.playSound` found in any script → no sound in onSpellStart.
 *
 * The anim9 symbol is the primary timeline driver. signalHit is fired at
 * the midpoint of anim9 (around the visual impact peak — frame 12, which
 * corresponds to anim1/anim5/anim59's stop frame acting as the "hit" cue).
 * Since anim1/anim5/anim59 stop at frame 15 and anim9 ends at frame 72,
 * the hit is signalled when the small flash animations complete (frame 15
 * of the small anims, which run in parallel with anim9).
 *
 * Library symbols: none (all animations[] only).
 *
 * Main timeline: attach anim9 (depth 1) as the main body; also attach
 * anim1, anim5, anim59 (depths 2/3/4) as parallel small flashes. All are
 * positioned at (0,0) relative to the target anchor.
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

// Bounds from manifest animations[] entries (no lib_ prefix — not librarySymbols)
const ANIM9_BOUNDS = {
  width: 204.55,
  height: 215.25,
  offsetX: -95,
  offsetY: -196.1,
};

const ANIM1_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

// anim5 and anim59 share the same bounds as anim1
const ANIM5_BOUNDS = ANIM1_BOUNDS;
const ANIM59_BOUNDS = ANIM1_BOUNDS;

export class Spell2113 extends RuntimeSpell {
  readonly spellId = 2113;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim9Sym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;
  private anim5Sym!: SymbolDefinition;
  private anim59Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim5Anchor = calculateAnchor(ANIM5_BOUNDS);
    const anim59Anchor = calculateAnchor(ANIM59_BOUNDS);

    // ---- anim9 — 87-frame main composite impact visual -----------
    // AS DefineSprite_34/frame_73/DoAction.as:
    //   _parent.removeMovieClip(); stop();
    // frame_73 (1-based) = index 72 (0-based).
    // _parent.removeMovieClip() on anim9's parent = root → spell complete.
    // signalHit is triggered at frame 15 (when small flash anims stop),
    // which corresponds to anim9's index 15.
    this.anim9Sym = {
      name: "anim9",
      totalFrames: 87,
      frames: textures.getFrames("anim9"),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          15,
          () => {
            // Canonical hit signal: anim1/anim5/anim59 stop at frame 15,
            // marking the visual impact peak. Fire signalHit here.
            this.runtime.signalHit();
          },
        ],
        [
          72,
          (clip) => {
            // AS DefineSprite_34/frame_73/DoAction.as:
            //   _parent.removeMovieClip(); stop();
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- anim1 — 18-frame small flash animation ------------------
    // AS DefineSprite_2/frame_16/DoAction.as:
    //   stop();
    // frame_16 (1-based) = index 15 (0-based).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim5 — 18-frame small flash animation (variant) --------
    // AS DefineSprite_2/frame_16/DoAction.as:
    //   stop();
    // frame_16 (1-based) = index 15 (0-based).
    this.anim5Sym = {
      name: "anim5",
      totalFrames: 18,
      frames: textures.getFrames("anim5"),
      anchorX: anim5Anchor.x,
      anchorY: anim5Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    // ---- anim59 — 18-frame small flash animation (variant) -------
    // AS DefineSprite_2/frame_16/DoAction.as:
    //   stop();
    // frame_16 (1-based) = index 15 (0-based).
    this.anim59Sym = {
      name: "anim59",
      totalFrames: 18,
      frames: textures.getFrames("anim59"),
      anchorX: anim59Anchor.x,
      anchorY: anim59Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop();
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.anim9Sym);
    this.registry.register(this.anim1Sym);
    this.registry.register(this.anim5Sym);
    this.registry.register(this.anim59Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // No SOMA.playSound found in canonical AS scripts.
    // Attach all four animation symbols as the implicit main-timeline
    // children. anim9 is the primary composite; anim1/anim5/anim59
    // are small parallel flashes placed at the same origin.
    this.root.attach(this.anim9Sym, "anim9", 1, context);
    this.root.attach(this.anim1Sym, "anim1", 2, context);
    this.root.attach(this.anim5Sym, "anim5", 3, context);
    this.root.attach(this.anim59Sym, "anim59", 4, context);
  }
}
