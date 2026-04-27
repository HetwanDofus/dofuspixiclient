/**
 * Spell 509 — Maîtrise des Armes (Sacrieur / Osamodas, or similar).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/509/scripts/scripts/
 *
 * displayType=11 (TargetCell).
 *
 * Analysis:
 *   - manifest.json has NO `librarySymbols[]` — only a single `animations[]` entry
 *     named "anim1" (120 frames). There are no `attachMovie` calls anywhere in the
 *     AS scripts; DefineSprite_14 IS the anim1 timeline.
 *   - DefineSprite_14/frame_4: positions self at _parent.cellTo — confirms the root
 *     clip (anim1) is placed at the target cell. TargetCell (11) is the correct
 *     displayType; the harness anchors the container there, so frame_4's
 *     `_X = _parent.cellTo.x` / `_Y = _parent.cellTo.y` become a no-op in
 *     container-local coords (both resolve to 0,0 offset). We still port it
 *     faithfully.
 *   - frame_55: SOMA.playSound("many_509")
 *   - frame_61: this.end() → signalHit
 *   - frame_94: SOMA.playSound("many_load2")
 *   - frame_115: _parent.removeMovieClip() → runtime.complete()
 *
 * No `librarySymbols[]` in manifest → NEVER use "lib_" prefix for texture lookup.
 * Textures are loaded as `textures.getFrames("anim1")`.
 *
 * Library symbols: none (anim1 is the sole animation, driven as DefineSprite_14).
 *
 * Main timeline: implicitly places anim1 / DefineSprite_14 at depth 1; no explicit
 * SOMA.playSound on the outer frame_1 (sounds are inside DefineSprite_14).
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
  width: 181.3,
  height: 156.15,
  offsetX: -85.5,
  offsetY: -110.3,
};

export class Spell509 extends RuntimeSpell {
  readonly spellId = 509;
  readonly displayType = SpellDisplayType.TargetCell;

  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 (DefineSprite_14) — 120-frame impact animation ----
    // No librarySymbols entry → textures loaded as bare "anim1" (no lib_ prefix).
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 120,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          3,
          (clip) => {
            // AS DefineSprite_14/frame_4/DoAction.as:
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y;
            // For displayType=11 the container IS already anchored at cellTo,
            // so container-local (0,0) == cellTo. We resolve and apply the
            // world coords to keep parity with canonical AS (net effect: clip
            // stays at its current position).
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          54,
          (_clip) => {
            // AS DefineSprite_14/frame_55/DoAction.as:
            //   SOMA.playSound("many_509");
            // Sound stored on the clip definition; played via the captured
            // callback reference set in onSpellStart.
            this.soundCallback?.("many_509");
          },
        ],
        [
          60,
          (_clip) => {
            // AS DefineSprite_14/frame_61/DoAction.as:
            //   this.end();
            // "end()" is the canonical hit-signal call in Dofus 1.29 AS.
            this.runtime.signalHit();
          },
        ],
        [
          93,
          (_clip) => {
            // AS DefineSprite_14/frame_94/DoAction.as:
            //   SOMA.playSound("many_load2");
            this.soundCallback?.("many_load2");
          },
        ],
        [
          114,
          (clip) => {
            // AS DefineSprite_14/frame_115/DoAction.as:
            //   _parent.removeMovieClip();
            // anim1's _parent is the outer mc (root). Remove + complete.
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.anim1Sym);
  }

  // Capture playSound so frame scripts inside the symbol can invoke it.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture the sound callback for use inside frameScripts.
    this.soundCallback = callbacks.playSound;

    // Main timeline implicitly places DefineSprite_14 (anim1) at depth 1.
    // Attach it here so it starts ticking from the next runtime frame.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
