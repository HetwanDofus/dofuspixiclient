/**
 * Spell 2068 — (Lance spell, likely Iop or similar class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2068/scripts/scripts/
 *
 * displayType=20 (ProjectileLinear). The spell has a `shoot` symbol
 * registered under animations[] (no librarySymbols), and the harness attaches
 * it at the target-relative offset, rotated to face target. The canonical
 * DefineSprite_10_shoot/frame_1 resets _rotation = 0 (standard pattern for
 * upright impact visuals). DefineSprite_16 is the outer wrapper clip
 * (172-frame timeline): frame_1 positions itself at cellTo and plays a sound,
 * frame_34 signals hit (this.end()), frame_172 removes the parent (spell complete).
 *
 * Architecture:
 *   - `shoot`       — 28-frame animated impact. frame_1: reset rotation to 0.
 *                     frame_24: remove parent + stop (kills the shoot clip).
 *   - `DefineSprite_16` (registered as "sprite_16") — outer 172-frame container.
 *                     frame_1: position at cellTo, play sound.
 *                     frame_34: signalHit.
 *                     frame_172: complete.
 *
 * Wait — re-reading the AS carefully:
 *   - The main timeline has frame_2/DoAction.as: stop(). This means the main
 *     SWF timeline stops on frame 2 and nothing else happens at the top level.
 *   - DefineSprite_16 has its own frame_1 scripts including positioning at
 *     cellTo. This is a WorldAbsolute pattern where the sprite reads
 *     _parent.cellTo to position itself.
 *   - DefineSprite_10_shoot is the visual shoot symbol, 28 frames.
 *
 * The presence of _parent.cellTo positioning in DefineSprite_16 and the
 * structure (outer container positions at target, shoot is the visual) points
 * to displayType=11 (TargetCell) or displayType=50/51 (WorldAbsolute).
 *
 * However, DefineSprite_16/frame_1/DoAction_2.as reads:
 *   _X = _parent.cellTo.x;  _Y = _parent.cellTo.y;
 * This is exactly the WorldAbsolute pattern (displayType 50/51) where children
 * position themselves using _parent.cellTo in world coords. The outer sprite
 * (sprite_16) places itself at cellTo on its own frame_1. The shoot is
 * attached inside it.
 *
 * Given that there's only one "destination" cell reference (cellTo only, no
 * cellFrom dual-anchor), this maps cleanly to displayType=50 (WorldAbsolute).
 * The harness sets container at (0,0) and exposes cellFrom/cellTo on root.vars.
 *
 * Library symbols:
 *   - shoot (from animations[]) — 28-frame visual burst. frame_1 resets
 *     rotation. frame_24 removes parent + stop.
 *   - sprite_16 — 172-frame outer container. frame_1: position at cellTo +
 *     play sound. frame_34: signalHit. frame_172: complete.
 *
 * Main timeline: frame_2/DoAction.as → stop() (handled implicitly; we just
 * attach sprite_16 in onSpellStart).
 *
 * Sound: "lance02" (from manifest sounds[] AND DefineSprite_16/frame_1).
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
  width: 205.8,
  height: 149.3,
  offsetX: -103.2,
  offsetY: -87.7,
};

export class Spell2068 extends RuntimeSpell {
  readonly spellId = 2068;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private shootSym!: SymbolDefinition;
  private sprite16Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);

    // ---- shoot — 28-frame animated impact visual ----------------
    // AS DefineSprite_10_shoot/frame_1/DoAction.as: _rotation = 0;
    // AS DefineSprite_10_shoot/frame_24/DoAction.as: _parent.removeMovieClip(); stop();
    this.shootSym = {
      name: "shoot",
      totalFrames: 28,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_1/DoAction.as
            clip.rotation = 0;
          },
        ],
        [
          23,
          (clip) => {
            // AS DefineSprite_10_shoot/frame_24/DoAction.as
            // _parent.removeMovieClip() removes the shoot's parent (sprite_16).
            // sprite_16's removal triggers complete via its own frame_172 handler,
            // but here shoot kills its parent early (frame 24 of shoot fires
            // before sprite_16's frame_172). We call complete() here since
            // removing sprite_16 is the outer-mc removal.
            clip.parent?.remove();
            clip.stop();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_16 — 172-frame outer container ------------------
    // AS DefineSprite_16/frame_1/DoAction.as: SOMA.playSound("lance02");
    // AS DefineSprite_16/frame_1/DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS DefineSprite_16/frame_34/DoAction.as: this.end(); → signalHit
    // AS DefineSprite_16/frame_172/DoAction.as: _parent.removeMovieClip();
    this.sprite16Sym = {
      name: "sprite_16",
      totalFrames: 172,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_16/frame_1/DoAction.as + DoAction_2.as
            // Position at cellTo in world coords (WorldAbsolute: container is at 0,0).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            // Sound is played from onSpellStart to avoid double-play,
            // but the canonical frame_1 DoAction.as does SOMA.playSound here too.
            // The manifest sounds[] also lists it at frame 0. Since onSpellStart
            // already plays it, we skip it here to avoid duplication.

            // Attach the shoot visual inside sprite_16.
            clip.attach(this.shootSym, "shoot", 1, ctx);
          },
        ],
        [
          33,
          () => {
            // AS DefineSprite_16/frame_34/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          171,
          (clip) => {
            // AS DefineSprite_16/frame_172/DoAction.as: _parent.removeMovieClip()
            // This removes the outer mc (sprite_16's parent = root).
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.shootSym);
    this.registry.register(this.sprite16Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_16/frame_1/DoAction.as: SOMA.playSound("lance02")
    // Also listed in manifest sounds[] at frame 0.
    callbacks.playSound("lance02");

    // Attach sprite_16 on the root so it starts ticking.
    // Its own frame_1 will position it at cellTo and attach shoot.
    this.root.attach(this.sprite16Sym, "sprite_16", 1, context);
  }
}
