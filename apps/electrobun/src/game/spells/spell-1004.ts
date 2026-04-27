/**
 * Spell 1004 — (Unknown spell, likely Feca or similar class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1004/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no library symbols, no
 * attachMovie calls, no projectile/ballistic/beam logic. The manifest
 * contains a single `animations[]` entry ("anim1") with 134 frames and
 * no `librarySymbols[]`. The canonical scripts are:
 *
 *   - DefineSprite_32/frame_59/DoAction.as  → this.end() → signalHit
 *   - DefineSprite_32/frame_133/DoAction.as → _parent.removeMovieClip(); stop() → complete
 *   - DefineSprite_30/frame_19/DoAction.as  → stop() (inner sub-sprite halts)
 *
 * DefineSprite_32 is the outer animated composite (134 frames total,
 * matching anim1). DefineSprite_30 is a sub-sprite that stops at frame 19.
 * Since there are no librarySymbols and no attachMovie calls, the main
 * authored timeline IS anim1, and we register it as the sole symbol
 * attached from onSpellStart at depth 1 on the root.
 *
 * Library symbols: none (librarySymbols[] is absent/empty).
 *
 * Main timeline: plays anim1 at target cell; frame 59 signals hit;
 * frame 133 removes parent and completes spell.
 *
 * Note on DefineSprite_30/frame_19 stop(): this sub-sprite is baked into
 * the composite anim1 frames — it has no independent runtime representation
 * in our model (no attachMovie). Its authored stop() is already encoded in
 * the per-frame SVG exports. No runtime action needed.
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
  width: 81.4,
  height: 71.4,
  offsetX: -49.4,
  offsetY: -106.7,
};

export class Spell1004 extends RuntimeSpell {
  readonly spellId = 1004;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — 134-frame composite impact animation at target cell ----
    // Corresponds to DefineSprite_32 in canonical SWF.
    // DefineSprite_32/frame_59/DoAction.as  → this.end() → signalHit
    // DefineSprite_32/frame_133/DoAction.as → _parent.removeMovieClip(); stop()
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 134,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          58,
          (_clip) => {
            // AS: DefineSprite_32/frame_59/DoAction.as → this.end()
            // Signals hit to the combat system (damage popup at target).
            this.runtime.signalHit();
          },
        ],
        [
          132,
          (clip) => {
            // AS: DefineSprite_32/frame_133/DoAction.as
            //   _parent.removeMovieClip();
            //   stop();
            // _parent here is the root mc; signal completion and stop.
            clip.stop();
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
    // Main timeline: attach anim1 at depth 1 on the root.
    // No SOMA.playSound in the canonical AS for this spell.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
