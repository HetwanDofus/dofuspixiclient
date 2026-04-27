/**
 * Spell 1054 — Sacrieur blood/sacrifice spell.
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1054/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored composite
 * animation (anim1, 306 frames) and no library symbols in the manifest —
 * meaning no `attachMovie` calls exist in the main timeline; all scripting
 * lives inside DefineSprite_22 (which IS the anim1 timeline). There are no
 * `move` / `shoot` / `duplicate` symbols, no projectile harness needed.
 * The animation plays at the target cell.
 *
 * Library symbols (none in manifest.librarySymbols — all are embedded within
 * the anim1 composite). The individual DefineSprite_ entries describe sub-
 * animations within the composite, but they are not standalone attachMovie
 * targets. We register the single "anim1" symbol to drive the main timeline.
 *
 * DefineSprite_22 timeline scripts:
 *   - frame_19  (index 18):  SOMA.playSound("sacrieur_1054")
 *   - frame_106 (index 105): SOMA.playSound("sacrieur_1054")
 *   - frame_196 (index 195): SOMA.playSound("sacrieur_1054")
 *   - frame_304 (index 303): _parent.removeMovieClip() → complete()
 *
 * Sub-sprite clip events embedded in the composite (informational — these
 * are baked into the per-frame SVGs and do not require separate registration):
 *   - DefineSprite_17 / DefineSprite_16: gotoAndPlay(random(30)) on load
 *   - DefineSprite_19: rotation / alpha / sine-wave xscale flicker
 *   - DefineSprite_21: rising/floating particle with alpha fade + removal
 *   - DefineSprite_20: random alpha flicker per frame
 *   - DefineSprite_18: random scale on load
 *   - DefineSprite_4:  gravity-bounce drop (v += 0.6, bounce at Y=0)
 *
 * Main timeline (onSpellStart): attach "anim1" at root; sounds are fired
 * from the anim1 frameScripts. The manifest lists sounds at frames 18, 105,
 * 195 (0-based) matching the canonical frame_19, frame_106, frame_196.
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
  width: 58.95,
  height: 46.3,
  offsetX: -22.6,
  offsetY: -30.3,
};

export class Spell1054 extends RuntimeSpell {
  readonly spellId = 1054;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 306-frame composite animation at target cell ----
    // This is the sole animation. DefineSprite_22 carries the frame
    // scripts. Sub-sprites (DefineSprite_4, 16-21) are baked into the
    // per-frame SVG textures; their clip-event physics are rendered
    // already. We only need to drive the timeline scripts here.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 306,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          // AS: DefineSprite_22/frame_19/DoAction.as
          // SOMA.playSound("sacrieur_1054");
          18,
          (_clip) => {
            this.soundCallback?.("sacrieur_1054");
          },
        ],
        [
          // AS: DefineSprite_22/frame_106/DoAction.as
          // SOMA.playSound("sacrieur_1054");
          105,
          (_clip) => {
            this.soundCallback?.("sacrieur_1054");
          },
        ],
        [
          // AS: DefineSprite_22/frame_196/DoAction.as
          // SOMA.playSound("sacrieur_1054");
          195,
          (_clip) => {
            this.soundCallback?.("sacrieur_1054");
            // frame_196 is also the canonical hit signal —
            // the spell visually impacts the target here.
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_22/frame_304/DoAction.as
          // _parent.removeMovieClip();
          303,
          (clip) => {
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
    // Capture callbacks so frameScripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Attach the main composite animation at the root. The harness has
    // already placed root at the target cell (TargetCell displayType).
    const anim1Sym = this.registry["symbols"]?.get("anim1") as
      | SymbolDefinition
      | undefined;

    // Resolve via registry directly — use root.attach with the registered symbol.
    // We need to look up from the registry; use a local reference built during registerSymbols.
    // Since registerSymbols runs before onSpellStart, we look it up now.
    const sym = this.registry.resolve("anim1");
    if (sym) {
      this.root.attach(sym, "anim1", 1, context);
    }
  }
}
