/**
 * Spell 1109 — (Unknown spell name).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1109/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no projectile motion, no caster
 * reference, and no library symbols with attachMovie calls. It is a single
 * authored animation (anim1, 147 frames) placed at the target cell. The only
 * AS scripts are:
 *
 *   - frame_1/DoAction.as: stop() — main timeline halts; the single
 *     DefineSprite_11 child is implicitly placed and drives itself.
 *   - DefineSprite_11/frame_4/DoAction.as: positions self at cellFrom
 *     (_X = _parent.cellFrom.x; _Y = _parent.cellFrom.y). This indicates
 *     the animation sprite repositions itself to the CASTER cell at frame 4,
 *     but the container is anchored at the target cell (displayType=11).
 *   - DefineSprite_11/frame_145/DoAction.as: _parent.removeMovieClip() —
 *     signals spell completion at frame 145 (0-based: 144).
 *
 * The manifest has no librarySymbols[], so the single `anim1` animation entry
 * is the only sprite. It is registered as the "anim1" symbol using the bare
 * name (no lib_ prefix) with textures.getFrames("anim1").
 *
 * Library symbols: none (librarySymbols[] is absent from the manifest).
 *
 * Main timeline: stop() on frame_1. The anim1 sprite is implicitly placed on
 * the main timeline; we attach it in onSpellStart.
 *
 * signalHit: fired at frame_4 of DefineSprite_11 (frame 4 = index 3 in the
 * original AS, but since frame_4 is when the sprite "arrives" at cellFrom,
 * we treat this as the hit moment). Actually the canonical hit moment for
 * TargetCell spells without an explicit hit signal is typically early in the
 * animation. Frame 4 (index 3, 0-based) is the first meaningful action frame
 * after startup, so we signal hit there.
 *
 * complete: fired at frame 145 (0-based index 144) via _parent.removeMovieClip().
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
  width: 122,
  height: 40.55,
  offsetX: -72.9,
  offsetY: -29.65,
};

export class Spell1109 extends RuntimeSpell {
  readonly spellId = 1109;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main animation sprite (DefineSprite_11, 147 frames) ----
    // Canonical scripts:
    //   DefineSprite_11/frame_4/DoAction.as  → position self at cellFrom
    //   DefineSprite_11/frame_145/DoAction.as → _parent.removeMovieClip()
    //
    // No librarySymbols[] in manifest, so textures come from bare "anim1"
    // (no lib_ prefix). Bounds from animations[0].
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 147,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS DefineSprite_11/frame_4/DoAction.as
          // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
          // Frame 4 in AS (1-based) → index 3 (0-based).
          // Reposition sprite to caster cell. Also signal hit here as the
          // first meaningful action frame (canonical impact moment).
          3,
          (clip) => {
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            this.runtime.signalHit();
          },
        ],
        [
          // AS DefineSprite_11/frame_145/DoAction.as
          // _parent.removeMovieClip();
          // Frame 145 in AS (1-based) → index 144 (0-based).
          144,
          (clip) => {
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: stop()
    // The main timeline stops. The anim1 sprite is implicitly placed on the
    // main timeline in the canonical SWF; we attach it here so it starts
    // ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
