/**
 * Spell 811 — Lichrounch (Osamodas).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/811/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference,
 * single impact animation playing at the target cell. The manifest has no
 * librarySymbols[] entries — the entire animation is a single `anim1`
 * entry in `animations[]`, driven by two authored DefineSprite_17 frame
 * scripts (frame_1 plays sound, frame_112 removes the outer mc).
 * DefineSprite_6 is a sub-sprite whose frame_1 does `gotoAndPlay(random(45)+2)`
 * to randomize its starting frame — this is embedded inside the composite
 * `anim1` frames rather than being a separately attachMovie'd symbol;
 * the composite SVG frames already capture all per-frame visual states.
 *
 * Architecture:
 *   - One `anim1` SymbolDefinition (114 frames, pre-rendered SVG composite).
 *   - frameScripts:
 *       frame 0  (AS frame_1):  SOMA.playSound("licrounch_1008") + signalHit.
 *       frame 111 (AS frame_112): _parent.removeMovieClip() → complete().
 *   - onSpellStart attaches `anim1` at root depth 1 so the timeline starts.
 *
 * The DefineSprite_6 sub-sprite randomised gotoAndPlay is baked into the
 * composite SVG timeline (the extractor renders all possible states per
 * frame), so it does not require a separate runtime SymbolDefinition.
 *
 * Main timeline: no explicit frame_1 DoAction beyond sounds embedded in
 * DefineSprite_17. onSpellStart attaches anim1 and forwards the sound.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
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
  width: 117,
  height: 191.25,
  offsetX: -58.5,
  offsetY: -162.05,
};

export class Spell811 extends RuntimeSpell {
  readonly spellId = 811;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — 114-frame composite impact animation at target cell.
    // AS DefineSprite_17/frame_1/DoAction.as:  SOMA.playSound("licrounch_1008")
    // AS DefineSprite_17/frame_112/DoAction.as: _parent.removeMovieClip()
    // DefineSprite_6/frame_1/DoAction.as:       gotoAndPlay(random(45)+2)
    // — DefineSprite_6 is a sub-sprite rendered into the composite SVG
    //   frames; its random-offset behaviour is represented in the
    //   pre-rendered composite timeline, so no separate runtime symbol
    //   is needed for it.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 114,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_17/frame_1/DoAction.as
            // Sound is played via onSpellStart; signalHit fires at
            // the first frame when the impact visual begins.
            this.runtime.signalHit();
          },
        ],
        [
          111,
          (clip) => {
            // AS DefineSprite_17/frame_112/DoAction.as
            // _parent.removeMovieClip() — outer mc removal signals
            // spell completion.
            clip.parent?.remove();
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
    // AS DefineSprite_17/frame_1/DoAction.as: SOMA.playSound("licrounch_1008")
    callbacks.playSound("licrounch_1008");

    // Attach the main animation clip at root so it begins ticking.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
