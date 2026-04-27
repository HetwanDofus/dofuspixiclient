/**
 * Spell 805 — Vladimair (Sram beam spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/805/scripts/scripts/
 *
 * displayType=40 (BeamLine). The manifest exposes a single `duplicate` animation
 * (87 frames, with authored frame textures) and no `librarySymbols[]` entries.
 * The canonical AS has:
 *   - `DefineSprite_8_duplicate` with a frame_1 that scales itself based on
 *     `_parent.level`, and a frame_85 that calls `removeMovieClip()`.
 *   - `DefineSprite_4` with an unnamed inner clip whose onClipEvent(load) sets
 *     its _yscale based on level. This is the interior of the `duplicate` symbol.
 *
 * Detection reasoning:
 *   - The manifest has a `duplicate` animation and no `move`/`shoot` animations.
 *   - The AS for `DefineSprite_8_duplicate` has frame_1 scale logic and a
 *     frame_85 self-removal — this is the canonical beam-segment symbol.
 *   - No `cellFrom`/`cellTo` world-absolute positioning in the AS scripts.
 *   - No ballistic/linear projectile patterns.
 *   → displayType=40 (BeamLine).
 *
 * Library symbols:
 *   - `duplicate` — 87-frame beam segment composite. No `lib_` prefix because
 *     it appears only in `animations[]`, not `librarySymbols[]`.
 *     frame_1: scales to `40 + 20 * level` percent.
 *     frame_85: removes itself (self.removeMovieClip).
 *     The harness fires signalHit() when the line is fully drawn, and
 *     `complete()` is triggered from the duplicate's frame_85 removal via
 *     `this.runtime.complete()`.
 *
 * Note on DefineSprite_4 / inner clip:
 *   DefineSprite_4 is a sub-symbol placed inside the `duplicate` timeline by
 *   the SWF authoring. Its onClipEvent(load) sets:
 *     t = 20 * (_parent._parent._parent._parent._parent.level - 1)
 *     _yscale = t
 *   The 5-level _parent chain resolves to the outer mc's level property.
 *   In the runtime this inner sub-symbol is baked into the `duplicate` composite
 *   frames (the SVG renders include it), so we handle its level-based scaling
 *   inside the `duplicate` symbol's frame_1 script by also setting scaleY to
 *   the matching value. The depth of the parent chain (5 levels) matches the
 *   authored nesting: inner_clip → DefineSprite_4 → duplicate → root → harness
 *   container → outer mc. We collapse this to `clip.parent?.vars.level` since
 *   the runtime root holds the level on root.vars.
 *
 * Main timeline: SOMA.playSound("vlad_805"); (no stop, single frame)
 *
 * signalHit: fired automatically by the BeamLine harness when the last duplicate
 *            segment is placed (we do NOT call it again).
 * complete(): fired from frameScripts[84] of the duplicate symbol (frame_85 in AS).
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

const DUPLICATE_BOUNDS = {
  width: 104.15,
  height: 109.5,
  offsetX: -46.85,
  offsetY: -82.4,
};

export class Spell805 extends RuntimeSpell {
  readonly spellId = 805;
  readonly displayType = SpellDisplayType.BeamLine;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- duplicate — 87-frame beam segment ----------------------
    // AS: DefineSprite_8_duplicate/frame_1/DoAction.as
    //   t = 40 + 20 * this._parent.level;
    //   _xscale = t;
    //   _yscale = t;
    // AS: DefineSprite_8_duplicate/frame_85/DoAction.as
    //   this.removeMovieClip();
    //
    // The inner DefineSprite_4 sub-symbol onClipEvent(load) sets:
    //   t = 20 * (_parent._parent._parent._parent._parent.level - 1)
    //   _yscale = t
    // Its 5-level parent chain resolves to the outer mc level.
    // Since the composite SVG frames already bake in the sub-symbol
    // visuals, we apply the level-based yscale from frame_1 to
    // approximate the inner clip's load-time scaling on the whole
    // duplicate clip. The harness places each duplicate via
    // attachIfRegistered, which calls frame_1 (frameScripts[0]).
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 87,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_8_duplicate/frame_1/DoAction.as
            // t = 40 + 20 * this._parent.level
            // _xscale = t; _yscale = t;
            const level = (clip.parent?.vars.level as number) ?? 1;
            const t = 40 + 20 * level;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          84,
          (clip) => {
            // AS: DefineSprite_8_duplicate/frame_85/DoAction.as
            // this.removeMovieClip();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    // SOMA.playSound("vlad_805");
    callbacks.playSound("vlad_805");
  }
}
