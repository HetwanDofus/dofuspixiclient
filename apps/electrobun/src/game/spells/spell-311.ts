/**
 * Spell 311 — (Iop/Feca lightning strike, "Foudre" family).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/311/scripts/scripts/
 *
 * displayType=11 (TargetCell). The sole authored timeline is sprite_21,
 * a 99-frame composite that positions itself at _parent.cellTo on frame_1,
 * signals hit at frame_70 (`this.end()`), and removes the parent at
 * frame_97 (`_parent.removeMovieClip()`). No library symbols are
 * registered (librarySymbols[] is empty in the manifest) — sprite_21 is
 * the only animation and lives in animations[]. Its children (PlaceObject2
 * clip-event holders DefineSprite_4 and DefineSprite_9) are baked into the
 * authored SVG frames; their clip-event scripts drive purely cosmetic alpha
 * flicker / rotation / xscale oscillation that is observable per-frame
 * but has no logical side-effects on the spell lifecycle.
 *
 * Because the manifest has no librarySymbols, we treat sprite_21 as a
 * top-level authored animation registered under its bare animation name
 * (no "lib_" prefix). The harness for TargetCell places root at
 * cellTo; sprite_21's frame_1 also sets _X/_Y = cellTo.x/y — in the
 * TargetCell model the container origin IS cellTo, so those assignments
 * are effectively no-ops (they produce 0,0 in container-local space),
 * but we port them faithfully.
 *
 * Library symbols: none.
 *
 * Authored sub-clip clip-events (baked into sprite_21's children):
 *   - DefineSprite_4 / PlaceObject2_2_1:
 *       onLoad:       i = 0
 *       onEnterFrame: _xscale = 100 * Math.sin(i += 0.1)
 *   - DefineSprite_9 / PlaceObject2_6_1:
 *       onEnterFrame: _alpha = 0 + random(120)
 *   - DefineSprite_9 / PlaceObject2_8_3:
 *       onEnterFrame: _alpha = random(100) + 90; this._rotation += 10
 *
 * These sub-clip effects are carried inside the per-frame SVG textures of
 * sprite_21 (the extractor bakes them into the composite frames). We do
 * not need to model them as separate SpellClip children — the SVG frames
 * already capture the visual result. The frame-script logic (frame_70
 * signalHit, frame_97 complete) is what we must port.
 *
 * Main timeline (frame_2/DoAction.as): stop(); — no sound, no attach.
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

const SPRITE_21_BOUNDS = {
  width: 85.5,
  height: 461.3,
  offsetX: -43.85,
  offsetY: -456.05,
};

export class Spell311 extends RuntimeSpell {
  readonly spellId = 311;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite21Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite21Anchor = calculateAnchor(SPRITE_21_BOUNDS);

    // sprite_21 — 99-frame composite lightning impact at target cell.
    // Sourced from animations[] (no librarySymbols entry), so textures
    // key is the bare animation name with no "lib_" prefix.
    this.sprite21Sym = {
      name: "sprite_21",
      totalFrames: 99,
      frames: textures.getFrames("sprite_21"),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_21/frame_1/DoAction.as:
            //   _X = _parent.cellTo.x;
            //   _Y = _parent.cellTo.y;
            // Container origin is already at cellTo (TargetCell anchor),
            // so these resolve to 0,0 in local space.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x - (root?.vars.cellTo as { x: number }).x;
              clip.y = cellTo.y - (root?.vars.cellTo as { y: number }).y;
            }
          },
        ],
        [
          69,
          () => {
            // AS DefineSprite_21/frame_70/DoAction.as:
            //   this.end();   ← canonical hit signal
            this.runtime.signalHit();
          },
        ],
        [
          96,
          (clip) => {
            // AS DefineSprite_21/frame_97/DoAction.as:
            //   _parent.removeMovieClip();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite21Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_2/DoAction.as: stop(); — no sound.
    // Attach sprite_21 so it starts ticking from the next runtime frame.
    this.root.attach(this.sprite21Sym, "sprite21", 1, context);
  }
}
