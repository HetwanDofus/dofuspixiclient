/**
 * Spell 2010 — Carapace (shield-type self-buff).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2010/scripts/scripts/
 *
 * displayType=10 (CasterCell). This spell has no projectile, no target-cell
 * impact, and no dual-anchor pattern. The single animation plays on the
 * caster. The AS has no attachMovie calls, no cellTo references, and no
 * projectile symbols — a pure caster-anchored self-buff.
 *
 * Canonical AS layout:
 *   - librarySymbols: empty — no library symbols, no attachMovie.
 *   - animations: one entry `anim1` (129 frames, composite).
 *   - DefineSprite_6/frame_1/DoAction.as:   SOMA.playSound("shield_cara")
 *   - DefineSprite_6/frame_127/DoAction.as: _parent.removeMovieClip()
 *   - DefineSprite_4/frame_67/DoAction.as:  stop()
 *
 * DefineSprite_6 is the outer animated sprite (129 frames). Its frame_1
 * plays the sound; its frame_127 removes itself and signals completion.
 * DefineSprite_4 is an inner composite whose stop() at frame_67 is already
 * baked into the exported anim1 SVG frames — no explicit child attach needed.
 *
 * Since librarySymbols is empty, anim1 is registered under its bare name
 * (no lib_ prefix). textures.getFrames("anim1") is used — NOT "lib_anim1".
 *
 * signalHit is fired at frame_1 (self-buff onset, canonical for shields).
 * complete() is fired at frame_127 matching _parent.removeMovieClip().
 *
 * Main timeline: onSpellStart plays the sound and attaches anim1 to root.
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell2010 extends RuntimeSpell {
  readonly spellId = 2010;
  readonly displayType = SpellDisplayType.CasterCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main shield animation, 129 frames ---------------
    // No library symbols exist; anim1 is the sole animations[] entry.
    // Registered under bare name — no lib_ prefix.
    //
    // frameScripts[0] → DefineSprite_6/frame_1/DoAction.as
    // frameScripts[126] → DefineSprite_6/frame_127/DoAction.as
    //
    // DefineSprite_4/frame_67/DoAction.as (stop() on inner sub-sprite)
    // is already baked into the composite SVG frames; no child attach needed.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_6/frame_1/DoAction.as:
            //   SOMA.playSound("shield_cara");
            // Sound is handled in onSpellStart (callback available there).
            // Signal hit at animation onset — canonical for self-buff spells.
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip, _ctx) => {
            // AS DefineSprite_6/frame_127/DoAction.as:
            //   _parent.removeMovieClip();
            clip.remove();
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
    // AS DefineSprite_6/frame_1/DoAction.as: SOMA.playSound("shield_cara")
    callbacks.playSound("shield_cara");

    // Attach anim1 to root — mirrors the implicit main-timeline placement
    // of DefineSprite_6 on the SWF main timeline frame_1.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
