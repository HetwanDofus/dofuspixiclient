/**
 * Spell 2020 — Healing/Buff spell (likely Mot Revitalisant or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2020/scripts/scripts/
 *
 * displayType=11 (TargetCell). No projectile motion, no caster reference, no
 * `move`/`shoot`/`duplicate` symbols — purely an impact at the target cell.
 * The single `anim1` animation (246 frames, composite) is the main visual.
 *
 * The manifest has NO `librarySymbols[]` entries. All content lives in
 * `animations[]` under the name `anim1`. The four DefineSprite symbols
 * (3, 7, 8, 9) are internal composites baked into the `anim1` composite
 * frames — they have no separate library exports that AS `attachMovie` would
 * reference by name. The only two AS-level scripts that create top-level
 * structure are:
 *
 *   - DefineSprite_10/frame_1/DoAction.as   → SOMA.playSound("guerison")
 *   - DefineSprite_10/frame_244/DoAction.as → _parent.removeMovieClip(); stop()
 *   - frame_1/DoAction.as                   → SOMA.playSound("many_504")
 *
 * DefineSprite_10 is the outer wrapper for the `anim1` content (246 frames).
 * Its frame_244 (AS) = index 243 (0-based) fires _parent.removeMovieClip()
 * which is the spell-completion signal. The manifest `stopFrame: 243`
 * corroborates this (0-based index 243 = AS frame 244).
 *
 * Symbols baked into anim1 composite (not registered separately since they
 * are not stand-alone attachMovie targets in the authored AS):
 *   - DefineSprite_3 — rising particle (onLoad: vy seed; onEnterFrame: alpha flicker + rise)
 *   - DefineSprite_7 — rotating element (onLoad: vr seed; onEnterFrame: spin)
 *   - DefineSprite_8 — scale-oscillating element (onLoad: copy parent props; onEnterFrame: xscale sin)
 *   - DefineSprite_9 — main sprite with lemniscate path (onLoad: p/i/v2/v seeds; onEnterFrame: orbit + alpha)
 *
 * signalHit: fired at the frame_1 entry of DefineSprite_10 (the "guerison"
 * sound fires simultaneously, indicating the hit moment is at the very start
 * of the impact composite). Since displayType != 30/31, we must call
 * this.runtime.signalHit() ourselves — we do so in onSpellStart because the
 * impact is instantaneous (no projectile travel).
 *
 * Main timeline: frame_1/DoAction.as → SOMA.playSound("many_504")
 * DefineSprite_10 (anim1 wrapper): frame_1 → playSound("guerison"); frame_244 → complete()
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
  width: 46,
  height: 16,
  offsetX: -24.4,
  offsetY: -9.25,
};

export class Spell2020 extends RuntimeSpell {
  readonly spellId = 2020;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // anim1 — the main 246-frame composite visual (DefineSprite_10 wrapper).
    // AS DefineSprite_10/frame_1/DoAction.as:  SOMA.playSound("guerison")
    // AS DefineSprite_10/frame_244/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // Note: `frames` uses the bare "anim1" key (no lib_ prefix) because this
    // symbol appears only in animations[], not librarySymbols[].
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 246,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("guerison")
            // Sound is triggered in onSpellStart via the saved callback instead,
            // because frameScripts don't have direct access to SpellCallbacks.
            // The signalHit is also dispatched from onSpellStart at this same moment.
          },
        ],
        [
          243,
          (clip) => {
            // AS DefineSprite_10/frame_244/DoAction.as:
            //   _parent.removeMovieClip();
            //   stop();
            // This is the outer clip — its removal signals spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS frame_1/DoAction.as: SOMA.playSound("many_504")
    callbacks.playSound("many_504");

    // AS DefineSprite_10/frame_1/DoAction.as: SOMA.playSound("guerison")
    // The "guerison" sound fires at the very first frame of the anim1 clip,
    // which is also the impact moment.
    callbacks.playSound("guerison");

    // Signal hit at the impact moment (frame 1 of the composite = spell lands).
    // displayType=11 (TargetCell), not 30/31, so we must call this ourselves.
    this.runtime.signalHit();

    // Attach anim1 at root — mirrors the implicit main-timeline placement of
    // DefineSprite_10 content on the authored SWF main timeline.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
