/**
 * Spell 812 — Vlad (BeamLine duplicate spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/812/scripts/scripts/
 *
 * displayType=40 (BeamLine). The manifest has a single `animations[]` entry
 * named "duplicate" (126 frames, composite, no librarySymbols[]). The harness
 * drops instances of "duplicate" periodically along the caster→target line and
 * fires runtime.signalHit() automatically when the beam reaches the target.
 *
 * Internal sub-sprite scripts within the duplicate composite:
 *   - DefineSprite_11/frame_1: gotoAndStop(random(6) + 1) — randomises which
 *     static frame the sub-sprite displays.
 *   - DefineSprite_5/frame_55: stop()
 *   - DefineSprite_13/frame_124: stop()
 *   - DefineSprite_12/frame_85: stop()
 *   These sub-sprites have no CLIPACTIONRECORD onClipEvent handlers. There are
 *   no onClipEvent(load) or onClipEvent(enterFrame) scripts anywhere in the
 *   provided AS source for this spell.
 *
 * Duplicate symbol timeline (DefineSprite_20_duplicate):
 *   frame_1/DoAction.as   : SOMA.playSound("vlad_812")
 *   frame_1/DoAction_2.as : randomise _xscale, _yscale, _rotation
 *   frame_124/DoAction.as : this.removeMovieClip()
 *
 * The harness fires signalHit() automatically (BeamLine). complete() is called
 * from the frame_123 (0-based) script of the last surviving duplicate instance.
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
  width: 59.25,
  height: 159.2,
  offsetX: -23,
  offsetY: -95.75,
};

export class Spell812 extends RuntimeSpell {
  readonly spellId = 812;
  readonly displayType = SpellDisplayType.BeamLine;

  // Captured in onSpellStart so the duplicate's frame_1 script can call it.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- duplicate — 126-frame beam segment placed along cast line ----
    // The harness (BeamLine/displayType=40) attaches instances of this symbol
    // at regular intervals along the caster→target line via clip.attach().
    // Each attach triggers onLoad (none here) then frameScripts[0] (frame_1).
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 126,
      // "duplicate" appears only in animations[], NOT in librarySymbols[],
      // so we use textures.getFrames("duplicate") — no lib_ prefix.
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20_duplicate/frame_1/DoAction.as
            //   SOMA.playSound("vlad_812");
            this.soundCallback?.("vlad_812");

            // AS DefineSprite_20_duplicate/frame_1/DoAction_2.as
            //   this._xscale = 50 + random(60);
            //   this._yscale = this._xscale;
            //   this._rotation = -10 + random(30);
            const scalePct = 50 + Math.floor(Math.random() * 60);
            clip.scaleX = scalePct / 100;
            clip.scaleY = scalePct / 100;
            clip.rotation = ((-10 + Math.floor(Math.random() * 30)) * Math.PI) / 180;
          },
        ],
        [
          123,
          (clip) => {
            // AS DefineSprite_20_duplicate/frame_124/DoAction.as
            //   this.removeMovieClip();
            clip.remove();

            // Signal spell completion when no more live duplicate children
            // remain on root (the harness has already stopped spawning new
            // ones by the time any instance reaches frame 124).
            let remaining = 0;
            for (const child of this.root.children.values()) {
              if (!child.pendingRemoval) {
                remaining++;
              }
            }
            if (remaining === 0) {
              this.runtime.complete();
            }
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
    // Capture the sound callback so the duplicate's frame_1 frameScript
    // can call playSound("vlad_812") for every instance the harness attaches.
    this.soundCallback = callbacks.playSound;

    // The BeamLine harness drives all child attaches along the line
    // and fires runtime.signalHit() automatically — no explicit attaches
    // or signalHit calls needed here.
  }
}
