/**
 * Spell 2063 — (Unknown name, likely a Sacrier/Iop thorn/spike spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2063/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move`, `shoot`, `duplicate`, or
 * dual-anchored pattern. The single authored sprite (DefineSprite_8) plays a
 * 61-frame timeline at the target cell, fires two mid-timeline sounds, then
 * calls `_parent.removeMovieClip()` on frame 61. This is the canonical
 * "impact at target" pattern → TargetCell (11).
 *
 * Manifest layout:
 *   animations:
 *     - anim1  (18 frames) — small sprite variant (directional?)
 *     - anim5  (18 frames) — small sprite variant
 *     - anim9  (75 frames) — large main impact composite (85×93)
 *     - anim19 (18 frames) — small sprite variant
 *     - anim23 (18 frames) — small sprite variant
 *
 *   librarySymbols: (none)
 *
 *   DefineSprite_8 — main timeline container, 61 frames:
 *     frame_1  (index 0): SOMA.playSound("herbe")
 *     frame_22 (index 21): SOMA.playSound("pic")   → signalHit
 *     frame_37 (index 36): SOMA.playSound("pic")
 *     frame_61 (index 60): _parent.removeMovieClip(); stop() → complete()
 *
 *   DefineSprite_2 — short 18-frame sub-sprite:
 *     frame_16 (index 15): stop()
 *
 * Since librarySymbols[] is empty in the manifest, there is no `lib_` prefix
 * for any texture key. The animation textures are accessed by bare name.
 *
 * DefineSprite_8 is the outer long-lived container whose final frame drives
 * completion. It maps to `anim9` (75 frames, large impact). DefineSprite_2
 * maps to the short 18-frame animations (anim1/5/19/23); we use `anim1` as
 * the canonical representative. Both are registered as symbols and attached
 * from onSpellStart.
 *
 * Sound handling: sounds inside DefineSprite_8's frame scripts are captured
 * via a stored callback reference since SpellCallbacks is only available in
 * onSpellStart.
 *
 * signalHit fires at frame_22 (index 21) — the first "pic" impact sound,
 * matching the canonical hit timing.
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

const ANIM9_BOUNDS = {
  width: 85.3,
  height: 93,
  offsetX: -38.4,
  offsetY: -59.45,
};

const ANIM1_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

export class Spell2063 extends RuntimeSpell {
  readonly spellId = 2063;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSound?: (id: string) => void;
  private sprite8Sym!: SymbolDefinition;
  private sprite2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- DefineSprite_2 — short 18-frame sub-sprite --------------
    // Maps to the small directional animations (anim1, etc.).
    // AS DefineSprite_2/frame_16/DoAction.as: stop()
    this.sprite2Sym = {
      name: "sprite2",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — main 61-frame impact container ---------
    // Maps to anim9 (large 75-frame texture; we use 61 canonical frames).
    // AS DefineSprite_8/frame_1/DoAction.as:  SOMA.playSound("herbe")
    // AS DefineSprite_8/frame_22/DoAction.as: SOMA.playSound("pic")
    // AS DefineSprite_8/frame_37/DoAction.as: SOMA.playSound("pic")
    // AS DefineSprite_8/frame_61/DoAction.as: _parent.removeMovieClip(); stop()
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 61,
      frames: textures.getFrames("anim9").slice(0, 61),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // AS DefineSprite_8/frame_1/DoAction.as
            this.playSound?.("herbe");
          },
        ],
        [
          21,
          (_clip) => {
            // AS DefineSprite_8/frame_22/DoAction.as
            this.playSound?.("pic");
            // First impact sound — canonical hit timing for signalHit.
            this.runtime.signalHit();
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_8/frame_37/DoAction.as
            this.playSound?.("pic");
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_8/frame_61/DoAction.as
            // _parent.removeMovieClip(); stop()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite2Sym);
    this.registry.register(this.sprite8Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Store sound callback for use inside frame scripts.
    this.playSound = callbacks.playSound;

    // Attach the main impact sprite (DefineSprite_8 / anim9) at root.
    // The harness has already placed root at the target cell (TargetCell).
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);

    // Attach the short sub-sprite (DefineSprite_2 / anim1) at a higher
    // depth so it renders above the impact composite.
    this.root.attach(this.sprite2Sym, "sprite2", 2, context);
  }
}
