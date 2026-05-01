/**
 * Spell 2022 — Flamme (fire flame spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2022/scripts/scripts/
 *
 * displayType=10 (CasterCell). The canonical AS for DefineSprite_29 (the
 * outer sprite) positions itself at `_parent.cellFrom` (caster cell) and
 * rotates by `_parent.angle` — this is the classic CasterCell pattern.
 *
 * Canonical AS layout:
 *   - DefineSprite_29 — outer 67-frame container. No authored textures
 *     (container-only). On frame_1: plays sound "flamme_2022", positions
 *     self at cellFrom, rotates to angle. On frame_13: this.end()
 *     (signalHit). On frame_67: _parent.removeMovieClip() (spell complete).
 *     Internally places DefineSprite_16_shoot (the "shoot" animation) as a
 *     child.
 *
 *   - DefineSprite_16_shoot ("shoot") — 84-frame authored animation. Frame
 *     70: stop(). This is the visual flame burst displayed at the caster's
 *     position rotated toward the target.
 *
 * Main timeline (frame_2/DoAction.as): stop(). Nothing else — the spell
 * simply stops and lets DefineSprite_29 drive itself.
 *
 * The outer sprite (DefineSprite_29) is attached by the harness (since
 * displayType=10 drops the root at the caster cell). We attach it manually
 * from onSpellStart to mirror the implicit main-timeline placement.
 *
 * Library symbols:
 *   - shoot — 84-frame visual animation. frame_70: stop().
 *   - sprite_29 — 67-frame outer container. frame_1: sound + position.
 *     frame_13: signalHit. frame_67: removeMovieClip + complete.
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
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 84-frame visual flame animation ----------------
    // AS DefineSprite_16_shoot/frame_70/DoAction.as: stop()
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
            // AS DefineSprite_16_shoot/frame_70/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_29 — 67-frame outer container -------------------
    // frame_1 (DoAction.as): SOMA.playSound("flamme_2022")
    // frame_1 (DoAction_2.as): _X = _parent.cellFrom.x;
    //                          _Y = -20 + _parent.cellFrom.y;
    //                          _rotation = _parent.angle;
    // frame_13 (DoAction.as): this.end()
    // frame_67 (DoAction.as): _parent.removeMovieClip()
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
            // AS DefineSprite_29/frame_1/DoAction.as: SOMA.playSound("flamme_2022")
            // (sound is played in onSpellStart since callbacks are only available there)

            // AS DefineSprite_29/frame_1/DoAction_2.as:
            //   _X = _parent.cellFrom.x;
            //   _Y = -20 + _parent.cellFrom.y;
            //   _rotation = _parent.angle;
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

            // Attach the shoot animation as a child of sprite_29
            clip.attach(shootSym, "shoot", 1, ctx);
          },
        ],
        [
          12,
          () => {
            // AS DefineSprite_29/frame_13/DoAction.as: this.end()
            this.runtime.signalHit();
          },
        ],
        [
          66,
          (clip) => {
            // AS DefineSprite_29/frame_67/DoAction.as: _parent.removeMovieClip()
            clip.parent?.remove();
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
    context: SpellContext
  ): void {
    // AS DefineSprite_29/frame_1/DoAction.as: SOMA.playSound("flamme_2022")
    // Played here since this is where callbacks are available.
    callbacks.playSound("flamme_2022");

    // Attach sprite_29 onto the root so it starts ticking.
    // This mirrors the implicit main-timeline placement of DefineSprite_29.
    this.root.attach(this.sprite29Sym, "sprite_29", 1, context);
  }
}
