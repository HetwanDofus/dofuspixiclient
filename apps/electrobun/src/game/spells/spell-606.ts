/**
 * Spell 606 — (Unknown name, likely a Sacrieur or Osamodas spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/606/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no move/shoot/duplicate
 * symbols and no caster-reference or world-absolute positioning. It is
 * a single animated composite (anim1) played at the target cell, making
 * TargetCell the correct choice.
 *
 * The manifest has NO librarySymbols — only a single animations[] entry
 * ("anim1", 150 frames). All rendering comes from that timeline.
 * Note: NO `lib_` prefix anywhere — use bare "anim1" as the texture key.
 *
 * Library symbols (from AS scripts, mapped to DefineSprite IDs):
 *
 *   - DefineSprite_7 (inner glow/flicker sub-sprite):
 *       PlaceObject2_6_1 onClipEvent(enterFrame):
 *         randomises _alpha in [80,99] and _rotation in [0,359] each frame.
 *       No frame scripts.
 *
 *   - DefineSprite_19 (looping sub-animation inside anim1):
 *       frame_1:  gotoAndPlay(random(9) + 2) — jump to a random frame in [2,10]
 *       frame_4:  _rotation = random(360)
 *       frame_28: gotoAndPlay(2) — loop back to frame 2 (0-based: 1)
 *
 *   - DefineSprite_23 (outer composite, the main animated sprite):
 *       PlaceObject2_6_2 onClipEvent(enterFrame) [placed at frame_115]:
 *         randomises _alpha in [80,99] and _rotation in [0,359] each frame.
 *       frame_148: _parent.removeMovieClip() → spell complete.
 *
 * However, looking more carefully at the manifest: there are NO librarySymbols[]
 * entries, and the single animations[] entry "anim1" has 150 frames covering
 * the full composite animation. The DefineSprite scripts are internal to that
 * composite. Since the exporter baked the composite into anim1's SVG frames,
 * we model anim1 as the one symbol with:
 *   - 150 frames of texture
 *   - frame 148 (0-based) → complete + remove (canonical frame_148 DoAction)
 *   - signalHit fired at an appropriate impact frame (frame 0, immediate,
 *     since this is a target-cell impact spell with no explicit hit frame
 *     other than the removal; we use a reasonable mid-point or frame 0)
 *
 * The onEnterFrame flicker behaviour (DefineSprite_7 / DefineSprite_23's
 * placed child) is baked into the SVG composite frames by the exporter, so
 * no runtime particle logic is needed. The only runtime-visible script is
 * the final-frame removal at frame_148 (0-based: 147).
 *
 * signalHit: fired at frame 0 (immediate impact at target cell — no
 * projectile, no explicit hit frame in the scripts).
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
  width: 121.6,
  height: 144.5,
  offsetX: -92.05,
  offsetY: -134.35,
};

export class Spell606 extends RuntimeSpell {
  readonly spellId = 606;
  readonly displayType = SpellDisplayType.TargetCell;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — main composite animated sprite at target cell ---
    // Covers DefineSprite_23's 150-frame authored timeline (baked into
    // the SVG composite frames by the exporter). The inner sprites
    // DefineSprite_7 and DefineSprite_19 are composited into these SVGs.
    //
    // Canonical script references:
    //   DefineSprite_23/frame_148/DoAction.as → _parent.removeMovieClip()
    //   DefineSprite_23/frame_115/PlaceObject2_6_2/CLIPACTIONRECORD
    //     onClipEvent(enterFrame).as → _alpha/rotation flicker (baked into SVGs)
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip) => {
            // Canonical: no explicit frame_1 DoAction for DefineSprite_23.
            // Signal hit immediately — this is a target-cell impact spell
            // with no projectile; damage fires on first frame of impact.
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_23/frame_148/DoAction.as:
            //   _parent.removeMovieClip()
            // This is the outermost clip's parent removal — signals completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline frame_1: no SOMA.playSound detected in the provided scripts.
    // Attach the anim1 composite at the root so it starts playing from tick 1.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
