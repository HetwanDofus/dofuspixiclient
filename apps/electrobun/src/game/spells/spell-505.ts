/**
 * Spell 505 — Maîtrise des Armes (or equivalent Feca/Sacrier shield-type spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/505/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no projectile, no caster reference,
 * no move/shoot/duplicate symbol. The single animation (anim1) plays at the
 * target cell. The DefineSprite_16 timeline is the only authored sprite:
 *   - frame_4/DoAction.as: positions self at _parent.cellFrom.x/y and calls
 *     this.end() (signalHit).
 *   - frame_121/DoAction.as: _parent.removeMovieClip() + stop() → spell complete.
 *
 * Main timeline frame_1/DoAction.as: SOMA.playSound("many_505").
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 * The single `anim1` animation entry provides all 123 pre-rendered composite
 * frames for DefineSprite_16.
 *
 * Signal map:
 *   - signalHit  at frame_4  (AS: this.end())   → frameScripts index 3
 *   - complete   at frame_121 (AS: _parent.removeMovieClip()) → frameScripts index 120
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

// Bounds from manifest animations[0]
const ANIM1_BOUNDS = {
  width: 518,
  height: 409.35,
  offsetX: -263.5,
  offsetY: -261.4,
};

export class Spell505 extends RuntimeSpell {
  readonly spellId = 505;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // DefineSprite_16 — the single authored timeline (123 frames).
    // Textures come from the bare "anim1" key (no lib_ prefix — this
    // symbol lives in animations[], not librarySymbols[]).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 123,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_16/frame_4/DoAction.as
            // _X = _parent.cellFrom.x;
            // _Y = _parent.cellFrom.y;
            // this.end();  ← signalHit
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
          120,
          (clip) => {
            // AS DefineSprite_16/frame_121/DoAction.as
            // _parent.removeMovieClip();
            // stop();
            clip.stop();
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
    // AS frame_1/DoAction.as: SOMA.playSound("many_505");
    callbacks.playSound("many_505");

    // Attach the DefineSprite_16 timeline at the root so it starts
    // ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
