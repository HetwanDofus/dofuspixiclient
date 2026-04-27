/**
 * Spell 111 — Artillerie (Feca).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/111/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no projectile symbols (no `move`, `shoot`,
 * `duplicate`), no caster references, no world-absolute positioning. The animation
 * is a single impact composite at the target cell. No `librarySymbols[]` are present
 * in the manifest — all content lives in the top-level `animations: ["anim1"]` entry
 * and is driven by two authored sprites (DefineSprite_13 and DefineSprite_14, the
 * latter being the outer timeline wrapper) plus a random-jump sprite (DefineSprite_3).
 *
 * Canonical AS layout:
 *   - DefineSprite_3 (random jump): frame_1 does `gotoAndPlay(random(60) + 2)`.
 *     This is an internal child that selects a random start frame on the anim1
 *     composite so repeated hits don't all look identical.
 *   - DefineSprite_13 (sound emitter composite, plays through 31+ frames):
 *       frame_1:  SOMA.playSound("arty_111")
 *       frame_10: SOMA.playSound("arty_111")
 *       frame_19: SOMA.playSound("arty_111")
 *       frame_31: SOMA.playSound("arty_111")
 *   - DefineSprite_14 (outer 69-frame wrapper = anim1):
 *       frame_67: _parent.removeMovieClip(); stop() → spell complete.
 *
 * Because there are no `librarySymbols[]` entries, the `anim1` animation is a
 * flat composite sprite. We model it as a single SymbolDefinition named "anim1"
 * whose frame textures come from `textures.getFrames("anim1")` (no `lib_` prefix).
 *
 * The manifest's `sounds[]` array (frames 0, 9, 18, 30) mirrors DefineSprite_13's
 * frame_1/10/19/31 sounds. We fire these from within the anim1 frameScripts so
 * the sound timing matches the canonical authored timeline exactly.
 *
 * signalHit: fired at frame_1 of the anim1 symbol (frame index 0) — the canonical
 * AS has the first sound burst and the impact visual begin simultaneously at frame 1,
 * which is the appropriate moment to apply damage.
 *
 * complete: fired at frameScripts[66] (= AS frame_67) mirroring `_parent.removeMovieClip()`.
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
  width: 158,
  height: 168.15,
  offsetX: -82.55,
  offsetY: -162.05,
};

export class Spell111 extends RuntimeSpell {
  readonly spellId = 111;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);
    const anim1Frames = textures.getFrames("anim1");

    // ---- anim1 — 69-frame impact composite at target cell --------
    // Models the outer DefineSprite_14 wrapper plus the internal
    // DefineSprite_13 sound emitter and DefineSprite_3 random-jump
    // behaviour. All three authored sprites are collapsed into a single
    // SymbolDefinition since DefineSprite_13 and DefineSprite_3 are
    // internal compositor children whose only observable effects are
    // sounds and a random start-frame offset — both of which we handle
    // directly in the frameScripts below.
    //
    // Frame textures: textures.getFrames("anim1") — no lib_ prefix
    // because "anim1" is in manifest animations[], not librarySymbols[].
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 69,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      onLoad: (clip) => {
        // AS DefineSprite_3/frame_1/DoAction.as:
        //   gotoAndPlay(random(60) + 2);
        // The inner DefineSprite_3 selects a random starting frame so
        // repeated casts of the same spell look different. We mirror
        // this by jumping the whole anim1 clip to a random frame in
        // the same [1..60] range (0-based: [1..60]).
        const startFrame = Math.floor(Math.random() * 60) + 1;
        clip.gotoAndPlay(startFrame);
      },

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_13/frame_1/DoAction.as:
            //   SOMA.playSound("arty_111");
            // Also the canonical hit moment — fire signalHit here so
            // damage numbers appear when the first impact flash plays.
            this.soundCallback?.("arty_111");
            this.runtime.signalHit();
          },
        ],
        [
          9,
          () => {
            // AS DefineSprite_13/frame_10/DoAction.as:
            //   SOMA.playSound("arty_111");
            this.soundCallback?.("arty_111");
          },
        ],
        [
          18,
          () => {
            // AS DefineSprite_13/frame_19/DoAction.as:
            //   SOMA.playSound("arty_111");
            this.soundCallback?.("arty_111");
          },
        ],
        [
          30,
          () => {
            // AS DefineSprite_13/frame_31/DoAction.as:
            //   SOMA.playSound("arty_111");
            this.soundCallback?.("arty_111");
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_14/frame_67/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
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
    // Capture the sound callback so frameScripts inside anim1 can
    // fire sounds at canonical frames (DefineSprite_13 frame_1/10/19/31).
    this.soundCallback = callbacks.playSound;

    // Attach the anim1 composite at the root. The harness has already
    // positioned the container at the target cell (displayType=11).
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
