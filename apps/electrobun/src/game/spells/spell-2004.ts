/**
 * Spell 2004 — (Unknown, likely a Cra/Sacrier spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2004/scripts/scripts/
 *
 * displayType=11 (TargetCell). The only authored symbol is `shoot` — a
 * 66-frame composite animation that positions itself at `_parent.cellTo`
 * (frame_1/DoAction_2.as), plays a sound on frame_1 and frame_22, signals
 * hit on frame_28 (`this.end()`), and removes the outer mc on frame_64
 * (`_parent.removeMovieClip()`). There are no library symbols, no `move`
 * container, no projectile arc — the single `shoot` animation IS the spell.
 * Because there is no projectile motion and the hit fires at a specific frame
 * of the impact animation, this is a straightforward TargetCell spell.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Animations:
 *   - shoot (66 frames, composite) — impact animation at target cell.
 *       frame_1  : play "dodge_607c" sound; position self at cellTo.
 *       frame_22 : play "jet_903" sound.
 *       frame_28 : this.end() → signalHit.
 *       frame_64 : _parent.removeMovieClip() → spell complete.
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * The harness attaches `shoot` automatically for TargetCell (the shoot
 * symbol is detected by the harness for displayType 11 — but since this
 * spell's `shoot` is a full animation rather than a container, we attach
 * it in onSpellStart and handle all frame scripts there).
 *
 * NOTE: Because displayType=11 is TargetCell, the harness does NOT drive
 * projectile motion and does NOT call signalHit automatically. We must call
 * this.runtime.signalHit() from the canonical frame_28 script.
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

const SHOOT_BOUNDS = {
  width: 204.8,
  height: 382.95,
  offsetX: -102.35,
  offsetY: -321.45,
};

export class Spell2004 extends RuntimeSpell {
  readonly spellId = 2004;
  readonly displayType = SpellDisplayType.TargetCell;

  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 66-frame impact animation at target cell --------
    // No library symbols in this spell; `shoot` is a full composite
    // animation (animations[] entry) registered as a SymbolDefinition
    // so it can be attached to the root in onSpellStart.
    this.shootSym = {
      name: "shoot",
      totalFrames: 66,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_20_shoot/frame_1/DoAction.as
            // SOMA.playSound("dodge_607c");
            // Sound is played via captured callback — see onSpellStart.

            // AS: DefineSprite_20_shoot/frame_1/DoAction_2.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y;
            // Position self at the target cell in world coords.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          21,
          () => {
            // AS: DefineSprite_20_shoot/frame_22/DoAction.as
            // SOMA.playSound("jet_903");
            this.soundCallback?.("jet_903");
          },
        ],
        [
          27,
          () => {
            // AS: DefineSprite_20_shoot/frame_28/DoAction.as
            // this.end() → damage popup / hit signal at target.
            this.runtime.signalHit();
          },
        ],
        [
          63,
          (clip) => {
            // AS: DefineSprite_20_shoot/frame_64/DoAction.as
            // _parent.removeMovieClip() → spell animation complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts can fire sounds later.
    this.soundCallback = callbacks.playSound;

    // AS: DefineSprite_20_shoot/frame_1/DoAction.as
    // The first sound fires on frame_1 of the shoot clip — play it now
    // as the clip is being attached (frame_1 script runs at attach time).
    callbacks.playSound("dodge_607c");

    // Main timeline frame_2/DoAction.as: stop() — the harness has already
    // finished; we just attach the shoot animation to the root.
    // For displayType=11 (TargetCell), the root is anchored at the target
    // cell. The shoot clip's frame_1 further positions itself at cellTo
    // explicitly (AS DoAction_2.as), which results in the same position.
    this.root.attach(this.shootSym, "shoot", 1, context);
  }
}
