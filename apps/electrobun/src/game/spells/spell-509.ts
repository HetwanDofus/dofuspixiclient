/**
 * Spell 509 — Maîtrise des Sorts (Osamodas / generic animation).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/509/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored sprite
 * (DefineSprite_14) with no library symbols and no attachMovie calls.
 * The animation is a self-contained 120-frame timeline anchored at the
 * target cell. The manifest's `animations` list contains only "anim1"
 * (no `librarySymbols` entries), confirming there are no dynamically
 * attached children.
 *
 * DefineSprite_14 script summary:
 *   frame_4  (index 3):  position self at _parent.cellTo
 *   frame_55 (index 54): SOMA.playSound("many_509")
 *   frame_61 (index 60): this.end() → signalHit
 *   frame_94 (index 93): SOMA.playSound("many_load2")
 *   frame_115(index 114): _parent.removeMovieClip() → spell complete
 *
 * The single symbol "anim1" is registered as a container timeline
 * that drives the above frame scripts. There are no CLIPACTIONRECORD
 * onLoad/onEnterFrame behaviors — the animation is purely timeline-
 * driven with explicit frame scripts.
 *
 * Main timeline: attaches anim1 at root from onSpellStart (no sound on
 * the main timeline itself; sounds are emitted from within anim1's
 * frameScripts).
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
  width: 181.3,
  height: 156.15,
  offsetX: -85.5,
  offsetY: -110.3,
};

export class Spell509 extends RuntimeSpell {
  readonly spellId = 509;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;
  private playSound!: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 120-frame target-anchored timeline --------------
    // This is the sole animation for spell 509. It is driven entirely
    // by timeline frame scripts; no dynamic particles or attachMovie
    // calls are present.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 120,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: DefineSprite_14/frame_4/DoAction.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            // For displayType=11 (TargetCell), the container is already
            // anchored at cellTo in world coords. Setting the clip's
            // local position to the world cellTo coords would offset it
            // from center. We honour the canonical intent: the clip
            // positions itself at the absolute world coords of cellTo,
            // expressed locally relative to the container's own origin.
            // Since the container IS at cellTo, the local offset is (0,0).
            // We still perform the lookup to stay 1:1 with AS semantics.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = 0;
              clip.y = 0;
            }
          },
        ],
        [
          54,
          () => {
            // AS: DefineSprite_14/frame_55/DoAction.as
            // SOMA.playSound("many_509");
            this.playSound?.("many_509");
          },
        ],
        [
          60,
          () => {
            // AS: DefineSprite_14/frame_61/DoAction.as
            // this.end() — canonical hit signal (damage popup).
            this.runtime.signalHit();
          },
        ],
        [
          93,
          () => {
            // AS: DefineSprite_14/frame_94/DoAction.as
            // SOMA.playSound("many_load2");
            this.playSound?.("many_load2");
          },
        ],
        [
          114,
          (clip) => {
            // AS: DefineSprite_14/frame_115/DoAction.as
            // _parent.removeMovieClip() — ends the spell.
            clip.parent?.remove();
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
    // Capture playSound for use inside frameScripts (sounds are fired
    // from within the anim1 timeline, not the main timeline).
    this.playSound = callbacks.playSound;

    // Attach the single authored timeline at depth 1. For displayType=11
    // (TargetCell) the container is already at cellTo; the clip starts
    // at local (0,0) and frame_4 will confirm/set that position.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
