/**
 * Spell 1109 — (Unknown name, class unknown).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1109/scripts/scripts/
 *
 * displayType=10 (CasterCell). The spell has a single symbol (DefineSprite_11)
 * that positions itself at `_parent.cellFrom` on frame_4, meaning it anchors
 * to the caster cell. No `move`/`shoot`/`duplicate` symbols — this is a
 * caster-anchored impact/aura animation. No `attachMovie` calls anywhere in
 * the AS; DefineSprite_11 is placed on the main timeline implicitly by the SWF.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Animations:
 *   - anim1 — 147-frame animation placed as DefineSprite_11 on the main timeline.
 *     frame_4 (index 3): positions self at _parent.cellFrom.x / _parent.cellFrom.y.
 *     frame_145 (index 144): _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: frame_1/DoAction.as → stop() (harness attaches anim1 via
 * onSpellStart; main timeline stops immediately).
 *
 * signalHit: fired at frame_4 (index 3) when the animation first snaps to
 * the caster cell — this is the canonical "impact" moment for a caster-cell
 * spell (no separate hit frame is authored; frame_4 is the first active frame).
 *
 * Note on texture key: `librarySymbols` is empty; `anim1` appears only in
 * `animations[]`, so textures are fetched as `textures.getFrames("anim1")`
 * (NO `lib_` prefix).
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
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 appears only in animations[], not librarySymbols[] — no lib_ prefix.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 147,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS: scripts/DefineSprite_11/frame_4/DoAction.as
            // _X = _parent.cellFrom.x;
            // _Y = _parent.cellFrom.y;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            // Canonical hit moment — spell snaps to caster cell.
            this.runtime.signalHit();
          },
        ],
        [
          144,
          (clip) => {
            // AS: scripts/DefineSprite_11/frame_145/DoAction.as
            // _parent.removeMovieClip();
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
    // AS: scripts/frame_1/DoAction.as → stop()
    // Main timeline stops immediately; anim1 (DefineSprite_11) is placed
    // implicitly on the main timeline in the SWF. We attach it here so it
    // starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
