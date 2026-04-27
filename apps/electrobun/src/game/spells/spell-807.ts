/**
 * Spell 807 — Vlad (unknown class, target-cell impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/807/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single authored animation
 * ("anim1") with no library symbols, no projectile motion, no caster
 * reference, and no `move`/`shoot`/`duplicate` containers. The main
 * timeline just plays the sound. The single sprite (DefineSprite_5,
 * mapped to "anim1") is anchored at the target cell.
 *
 * Canonical AS layout:
 *   - frame_1/DoAction.as: SOMA.playSound("vlad_807")
 *   - DefineSprite_5/frame_10/DoAction.as:
 *       this._x = this._parent.cellFrom.x
 *       this._y = this._parent.cellFrom.y
 *       (repositions the sprite to the caster cell at frame 10)
 *   - DefineSprite_5/frame_43/DoAction.as:
 *       this.end() → signalHit (damage popup at target)
 *       _X = _parent.cellTo.x
 *       _Y = _parent.cellTo.y
 *       (snaps sprite back to target cell and triggers hit)
 *   - DefineSprite_5/frame_67/DoAction.as:
 *       stop() → end of animation; spell complete
 *
 * Library symbols: none (anim1 is the sole animation, listed in
 * animations[] only — no librarySymbols[] entries). Textures are
 * accessed with the bare "anim1" key (no lib_ prefix).
 *
 * Main timeline: onSpellStart plays "vlad_807".
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
  width: 261.2,
  height: 494,
  offsetX: -130.25,
  offsetY: -450.1,
};

export class Spell807 extends RuntimeSpell {
  readonly spellId = 807;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main impact animation (69 frames) ---------------
    // Maps to DefineSprite_5 in the canonical SWF.
    // No lib_ prefix: "anim1" appears only in animations[], not librarySymbols[].
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 69,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          9,
          (clip) => {
            // AS: DefineSprite_5/frame_10/DoAction.as
            // this._x = this._parent.cellFrom.x;
            // this._y = this._parent.cellFrom.y;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          42,
          (clip) => {
            // AS: DefineSprite_5/frame_43/DoAction.as
            // this.end() → signalHit
            // _X = _parent.cellTo.x
            // _Y = _parent.cellTo.y
            this.runtime.signalHit();
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
          66,
          (clip) => {
            // AS: DefineSprite_5/frame_67/DoAction.as
            // stop()
            clip.stop();
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
    // AS: frame_1/DoAction.as — SOMA.playSound("vlad_807");
    callbacks.playSound("vlad_807");

    // Attach the main animation clip at the root (target cell).
    // displayType=11: the container is already positioned at cellTo by
    // the harness; anim1 starts at (0,0) relative to that anchor.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
