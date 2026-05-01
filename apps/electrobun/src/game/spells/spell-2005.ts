/**
 * Spell 2005 — Wrath of Iop (or similar impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2005/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single `shoot` symbol placed
 * at the target cell. There is no `move` symbol, no `attachMovie` from the
 * main timeline besides the harness-driven `shoot`, and no library symbols
 * with CLIPACTIONRECORD handlers. The outer main timeline just calls `stop()`
 * on frame_2 — no sound there (sounds are emitted from inside the shoot
 * symbol's own frame scripts).
 *
 * Library symbols:
 *   - shoot — 84-frame composite impact animation placed at _parent.cellTo.
 *       frame_1:  positions self at cellTo.
 *       frame_19: plays sound "wab_2005a".
 *       frame_40: plays sound "wab_2005b".
 *       frame_46: this.end() → signalHit (damage popup at target).
 *       frame_82: _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: frame_2/DoAction.as → stop(). No sounds on main timeline.
 *
 * The harness attaches `shoot` at the target for displayType=11; shoot's
 * frame_1 then repositions itself at _parent.cellTo (root.vars.cellTo).
 * signalHit is fired from frame_46 (this.end()); complete() from frame_82.
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

    // ---- shoot — 84-frame impact animation at target cell --------
    // The `shoot` animation is a composite with authored SVG frames.
    // It is placed by the harness at the target cell (displayType=11).
    // Its frame_1 script re-anchors it explicitly to _parent.cellTo.
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
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y;
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
          18,
          () => {
            // AS: DefineSprite_8_shoot/frame_19/DoAction.as
            //   SOMA.playSound("wab_2005a");
            this.soundCallback?.("wab_2005a");
          },
        ],
        [
          39,
          () => {
            // AS: DefineSprite_8_shoot/frame_40/DoAction.as
            //   SOMA.playSound("wab_2005b");
            this.soundCallback?.("wab_2005b");
          },
        ],
        [
          45,
          () => {
            // AS: DefineSprite_8_shoot/frame_46/DoAction.as
            //   this.end();
            // Signals hit (damage popup) at the target.
            this.runtime.signalHit();
          },
        ],
        [
          81,
          (clip) => {
            // AS: DefineSprite_8_shoot/frame_82/DoAction.as
            //   _parent.removeMovieClip();
            // Removes the outer mc and signals spell completion.
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
    // AS: frame_2/DoAction.as → stop()
    // No sounds on the main timeline. Capture callback for use inside
    // shoot's frame scripts (sounds at frame_19 and frame_40).
    this.soundCallback = callbacks.playSound;

    // The harness for displayType=11 (TargetCell) does NOT
    // auto-attach "shoot" — we must do so explicitly here so the
    // shoot symbol starts ticking and runs its own frame scripts.
    const shootSym = this.registry.resolve("shoot");
    if (shootSym) {
      this.root.attach(shootSym, "shoot", 1, context);
    }
  }
}
