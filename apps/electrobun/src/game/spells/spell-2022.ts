/**
 * Spell 2022 — Flamme (fire flame spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2022/scripts/scripts/
 *
 * displayType=10 (CasterCell). The canonical AS layout has a single
 * authored sprite (DefineSprite_29) that positions itself at
 * `_parent.cellFrom` (the caster cell) using `_X = _parent.cellFrom.x;
 * _Y = -20 + _parent.cellFrom.y; _rotation = _parent.angle;` in its
 * frame_1. There is no projectile, no target-cell anchor, no ballistic
 * arc — the entire animation is anchored at and oriented from the caster.
 * DefineSprite_29 wraps a `shoot` inner symbol (DefineSprite_16_shoot,
 * 84 frames) plus its own 67-frame outer timeline. The outer sprite's
 * frame_13 fires `this.end()` (signalHit), and frame_67 fires
 * `_parent.removeMovieClip()` (spell complete).
 *
 * Library symbols:
 *   - `shoot` (DefineSprite_16_shoot, 84 frames) — the visual fire-flame
 *     animation. frame_70 calls stop(). Placed on the main timeline as
 *     a child of DefineSprite_29.
 *
 * Outer sprite (DefineSprite_29, 67 frames):
 *   - frame_1 (DoAction.as): SOMA.playSound("flamme_2022").
 *   - frame_1 (DoAction_2.as): position self at cellFrom, rotate to angle.
 *   - frame_13: this.end() → signalHit.
 *   - frame_67: _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: frame_2 calls stop() — the outer sprite is placed on
 * frame_1 and the main timeline halts at frame_2.
 *
 * Since DefineSprite_29 is not attached via `attachMovie` but is placed
 * on the main timeline authored in the SWF, we model it as a registered
 * symbol and attach it explicitly from `onSpellStart` (mirroring frame_1
 * implicit placement), exactly as spell-909 does for sprite_22/sprite_41.
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
  width: 167.15,
  height: 112.65,
  offsetX: -34.3,
  offsetY: -62,
};

export class Spell2022 extends RuntimeSpell {
  readonly spellId = 2022;
  readonly displayType = SpellDisplayType.CasterCell;

  private sprite29Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot (DefineSprite_16_shoot) — 84-frame fire-flame visual --
    // AS: DefineSprite_16_shoot/frame_70/DoAction.as → stop()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          69,
          (clip) => {
            // AS: DefineSprite_16_shoot/frame_70/DoAction.as
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_29 — outer 67-frame container ---------------
    // Wraps the shoot symbol; positions itself at cellFrom + angle;
    // fires signalHit at frame 13 and spell completion at frame 67.
    this.sprite29Sym = {
      name: "sprite_29",
      totalFrames: 67,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_29/frame_1/DoAction_2.as
            // _X = _parent.cellFrom.x;
            // _Y = -20 + _parent.cellFrom.y;
            // _rotation = _parent.angle;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = -20 + cellFrom.y;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;

            // The shoot symbol is placed as a child of sprite_29 on
            // the authored main timeline of DefineSprite_29, so we
            // attach it here at frame_1 entry.
            clip.attach(shootSym, "shoot", 1, ctx);
          },
        ],
        [
          12,
          () => {
            // AS: DefineSprite_29/frame_13/DoAction.as → this.end()
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS: DefineSprite_29/frame_67/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(shootSym);
    this.registry.register(this.sprite29Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: DefineSprite_29/frame_1/DoAction.as → SOMA.playSound("flamme_2022")
    // The sound is authored inside DefineSprite_29's frame_1, but we
    // play it here at spell start (before the first tick) matching
    // canonical timing since the outer sprite is placed on frame_1.
    callbacks.playSound("flamme_2022");

    // Implicit frame_1 placement of DefineSprite_29 on the main timeline.
    // Main timeline frame_2 calls stop(); we attach sprite_29 so it
    // starts ticking from the next runtime frame.
    this.root.attach(this.sprite29Sym, "sprite29", 1, context);
  }
}
