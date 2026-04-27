/**
 * Spell 1001 — Lichen (Osamodas / Licorne).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1001/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no move/shoot/duplicate/dual-anchor
 * pattern — the spell is a single animated composite (anim1) that plays at
 * the target cell. No librarySymbols entries exist in the manifest; all
 * content is driven by the top-level `animations: ["anim1"]` entry.
 *
 * The manifest lists one animation (`anim1`, 150 frames) which maps to
 * `DefineSprite_23` in the canonical SWF. Its authored scripts are:
 *
 *   - frame_1:   SOMA.playSound("licrounch_1001")
 *   - frame_37:  SOMA.playSound("licrounch_1001b")
 *   - frame_109: this.end()  → signalHit (damage popup)
 *   - frame_109: PlaceObject2_22_144/onClipEvent(enterFrame) — child clip
 *                fades out: _parent._alpha -= 3.34 each tick until removed
 *   - frame_148: _parent.removeMovieClip(); stop() → spell complete
 *
 * DefineSprite_4/frame_28 and DefineSprite_3/frame_49 are sub-composites
 * baked into the anim1 texture strip by the exporter; their `stop()` scripts
 * are already encoded in the rendered frames, so no separate symbol
 * registration is needed.
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("licrounch_1001")
 * This duplicates what DefineSprite_23/frame_1 already does; we call it once
 * from onSpellStart as the canonical behaviour.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest.json).
 *
 * The fade-out starting at frame 109 is handled via an onEnterFrame on the
 * anim1 clip itself (ported from the CLIPACTIONRECORD on the child placed at
 * frame 109 — _parent._alpha -= 3.34, which in context refers to the anim1
 * sprite's alpha decrementing each Flash frame once that child is placed).
 * We activate this behaviour via a flag set in the frame_109 script.
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
  width: 131.1,
  height: 108.15,
  offsetX: -62.75,
  offsetY: -63.45,
};

export class Spell1001 extends RuntimeSpell {
  readonly spellId = 1001;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main animated composite at target cell ----------
    // Corresponds to DefineSprite_23 in the canonical SWF.
    // 150 frames total; stopFrame=147 in manifest but canonical AS
    // removes the clip at frame_148 (index 147) and stops there.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_23/frame_109/PlaceObject2_22_144/
        //    CLIPACTIONRECORD onClipEvent(enterFrame).as
        // This clip event is placed at frame_109 on a child whose
        // _parent is the anim1 clip. We activate the fade once the
        // flag is set and run it every subsequent tick.
        if (clip.vars.fading === true) {
          clip.alpha -= 3.34 / 100;
          if (clip.alpha < 0) {
            clip.alpha = 0;
          }
        }
      },
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_23/frame_1/DoAction.as
            // SOMA.playSound("licrounch_1001")
            // Sound is played from onSpellStart (main timeline) to
            // avoid double-firing; this entry is kept as a canonical
            // marker but we guard against duplicate playback.
            // (onSpellStart already fires it before the first tick.)
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_23/frame_37/DoAction.as
            // SOMA.playSound("licrounch_1001b")
            this.soundCallback?.("licrounch_1001b");
          },
        ],
        [
          108,
          (clip) => {
            // AS DefineSprite_23/frame_109/DoAction.as
            // this.end() → signalHit (damage popup at target)
            this.runtime.signalHit();
            // Activate the per-frame fade-out driven by the
            // PlaceObject2_22_144 onClipEvent(enterFrame) placed here.
            clip.vars.fading = true;
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_23/frame_148/DoAction.as
            // _parent.removeMovieClip(); stop();
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
    // AS scripts/frame_1/DoAction.as
    // SOMA.playSound("licrounch_1001");
    this.soundCallback = callbacks.playSound;
    callbacks.playSound("licrounch_1001");

    // Attach the main animation composite at the target cell (root is
    // already anchored at target for TargetCell displayType).
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
