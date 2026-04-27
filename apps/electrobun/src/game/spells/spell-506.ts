/**
 * Spell 506 — (Unknown name, likely a Sadida/Eniripsa spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/506/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no library symbols, no `move`/`shoot`/
 * `duplicate` references, no caster-anchored logic, no dual-timeline worldAbsolute
 * pattern. The spell is a single authored animation (`anim1`, 219 frames) rendered
 * at the target cell. The outer sprite (DefineSprite_9) drives everything:
 *
 *   - frame_1  (index 0):  SOMA.playSound("many_503")
 *   - frame_19 (index 18): SOMA.playSound("cc_wabbit")
 *   - frame_196 (index 195): this.end() → signalHit; stop()
 *
 * `librarySymbols` is empty in the manifest — the single `animations` entry
 * (`anim1`) drives the visual. `anim1` is the top-level timeline of DefineSprite_9,
 * so we register it as the root symbol and attach it from `onSpellStart`.
 *
 * Completion: frame_196 calls `this.end()` (→ signalHit) then `stop()`. After
 * `stop()`, the animation holds on the final frame indefinitely in canonical AS,
 * but for the combat sequencer we treat the `end()` call as the completion signal.
 * We fire both `signalHit` and `complete` at frame_196 (index 195) since no
 * further animation follows and the manifest's `stopFrame` is 195.
 *
 * Main timeline: sounds are authored inside DefineSprite_9's own frame scripts,
 * so they are handled inside the anim1 frameScripts below, not in onSpellStart.
 * onSpellStart simply attaches the anim1 child to root so it begins playing.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * Animations: anim1 (219 frames, target-cell).
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
  width: 118.1,
  height: 130.5,
  offsetX: -56.95,
  offsetY: -74.75,
};

export class Spell506 extends RuntimeSpell {
  readonly spellId = 506;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private cachedCallbacks?: SpellCallbacks;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main animated sprite at target cell -------------
    // Corresponds to DefineSprite_9 in the canonical SWF.
    // frame_1   (index 0):   SOMA.playSound("many_503")
    // frame_19  (index 18):  SOMA.playSound("cc_wabbit")
    // frame_196 (index 195): this.end(); stop();
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 219,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS: DefineSprite_9/frame_1/DoAction.as
            // SOMA.playSound("many_503");
            this.cachedCallbacks?.playSound("many_503");
          },
        ],
        [
          18,
          (_clip) => {
            // AS: DefineSprite_9/frame_19/DoAction.as
            // SOMA.playSound("cc_wabbit");
            this.cachedCallbacks?.playSound("cc_wabbit");
          },
        ],
        [
          195,
          (clip) => {
            // AS: DefineSprite_9/frame_196/DoAction.as
            // this.end();  → signal hit (damage popup)
            // stop();      → halt timeline
            this.runtime.signalHit();
            this.runtime.complete();
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
    // Cache callbacks so frame scripts can fire sounds.
    this.cachedCallbacks = callbacks;

    // Attach the anim1 sprite at depth 1 on the root so it starts
    // ticking from the next runtime frame. The root container is
    // already positioned at the target cell by the TargetCell harness.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
