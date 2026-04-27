/**
 * Spell 2005 — Wabbit Spell (displayType=11 TargetCell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2005/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no `move` symbol, no ballistic arc,
 * no caster-side content, and no `_parent.cellFrom` reference. The single
 * `shoot` symbol positions itself at `_parent.cellTo` on frame_1, plays
 * through 84 frames, and removes the outer mc on frame_82. This is a
 * canonical single-impact-at-target spell.
 *
 * The manifest has NO `librarySymbols[]` entries — `shoot` appears only in
 * `animations[]`. Therefore textures are fetched with the bare key `"shoot"`
 * (NO `lib_` prefix).
 *
 * Library symbols:
 *   - shoot (84-frame composite):
 *       frame_1  : position self at _parent.cellTo (world coords → container-local delta).
 *       frame_19 : SOMA.playSound("wab_2005a").
 *       frame_40 : SOMA.playSound("wab_2005b").
 *       frame_46 : this.end() → signalHit (damage popup).
 *       frame_82 : _parent.removeMovieClip() → spell complete.
 *
 * Main timeline (frame_2/DoAction.as): stop().
 * The harness (TargetCell) places the container at cellTo in world coords.
 * shoot's frame_1 then does `_X = _parent.cellTo.x; _Y = _parent.cellTo.y`
 * which in AS sets the clip's world position. Inside our container (whose
 * origin IS cellTo), that means we offset by (cellTo.x - anchor.x,
 * cellTo.y - anchor.y). Since anchor == cellTo for TargetCell, the net
 * offset is (0, 0) — shoot stays at the container origin.
 *
 * Sounds are played from frameScripts; we capture the callbacks reference
 * in onSpellStart so they are accessible inside symbol frame scripts.
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
  width: 177.7,
  height: 353.65,
  offsetX: -89.05,
  offsetY: -300.45,
};

export class Spell2005 extends RuntimeSpell {
  readonly spellId = 2005;
  readonly displayType = SpellDisplayType.TargetCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // shoot — 84-frame impact animation placed at cellTo.
    // No `lib_` prefix: shoot is in animations[] only, not librarySymbols[].
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_1/DoAction.as
            // _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
            // Container origin is already at cellTo (TargetCell anchor),
            // so the net container-local offset is (0, 0).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const anchor = root?.vars.anchor as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              const anchorX = anchor?.x ?? cellTo.x;
              const anchorY = anchor?.y ?? cellTo.y;
              clip.x = cellTo.x - anchorX;
              clip.y = cellTo.y - anchorY;
            }
          },
        ],
        [
          18,
          () => {
            // AS: DefineSprite_8_shoot/frame_19/DoAction.as
            // SOMA.playSound("wab_2005a");
            this.soundCallback?.("wab_2005a");
          },
        ],
        [
          39,
          () => {
            // AS: DefineSprite_8_shoot/frame_40/DoAction.as
            // SOMA.playSound("wab_2005b");
            this.soundCallback?.("wab_2005b");
          },
        ],
        [
          45,
          () => {
            // AS: DefineSprite_8_shoot/frame_46/DoAction.as
            // this.end() → signal hit (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_82/DoAction.as
            // _parent.removeMovieClip() → spell complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts can fire sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_2/DoAction.as: stop().
    // The harness has already set up the container at cellTo.
    // Attach shoot at the root so it starts playing from frame_1.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
