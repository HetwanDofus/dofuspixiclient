/**
 * Spell 711 — Grina (Sram/Xelor grinding wheel effect).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/711/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is a single composite animation
 * anchored at the target cell with no projectile motion, no caster reference,
 * and no library symbols that are dynamically attached via attachMovie at
 * runtime by per-spell code. All authored content lives inside the single
 * `anim1` timeline (129 frames, stored in animations[]).
 *
 * AS layout analysis:
 *   - scripts/frame_1/DoAction.as: empty — no main-timeline actions.
 *   - DefineSprite_28: a sub-sprite with frame_1 setting random rotation
 *     (-random(180) degrees) and frame_37 calling stop(). This is an
 *     authored sub-symbol inside the composite anim1 texture atlas — its
 *     behaviour is baked into the exported SVG frames by the extractor.
 *   - DefineSprite_29: places 10 instances of DefineSprite_28 (depths
 *     23,27,31,35,39,43,47,51,55,59), each with onClipEvent(load) that
 *     calls gotoAndPlay(random(10)) to stagger their playheads. Also
 *     baked into the composite frames.
 *   - DefineSprite_5: a sub-sprite whose placed child (depth 1) has
 *     onClipEvent(enterFrame) setting _alpha = random(25) + 25 (flicker).
 *     Baked into composite frames.
 *   - DefineSprite_23: places DefineSprite_5 (depth 1) with onLoad seeding
 *     v=150, and onEnterFrame doing _rotation += (v *= 0.94575) — a spinning
 *     decay. Baked into composite frames.
 *   - DefineSprite_30: the outermost authored container. 127 frames:
 *       frame_4/DoAction.as: SOMA.playSound("grina_711")
 *       frame_127/DoAction.as: _parent.removeMovieClip(); stop();
 *     This is the top-level symbol whose timeline drives the spell.
 *     Its 129-frame composite is exposed as anim1 in animations[].
 *
 * Because all authored sub-symbols (DefineSprite_28, _29, _5, _23) are
 * composite children whose visuals are pre-baked into the anim1 SVG frames
 * by the extractor, we do NOT need to register them as runtime library
 * symbols — no attachMovie calls originate from per-spell script code
 * (the librarySymbols[] array in the manifest is empty). We register a
 * single "anim1" symbol whose frameScripts handle the sound (frame 4→
 * index 3) and completion (frame 127 → index 126).
 *
 * signalHit is fired at frame_4 (index 3) when the sound plays and the
 * grinder visually contacts the target — canonical impact moment.
 *
 * Main timeline: empty (scripts/frame_1/DoAction.as is empty).
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
  width: 343,
  height: 181.5,
  offsetX: -172.75,
  offsetY: -90.55,
};

export class Spell711 extends RuntimeSpell {
  readonly spellId = 711;
  readonly displayType = SpellDisplayType.TargetCell;

  private playSpellSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1 — composite top-level timeline (DefineSprite_30) ----
    // 129 frames. The extractor bakes all authored sub-symbols (spinning
    // rings, alpha-flickering glows) into per-frame SVG composites.
    // frameScripts port DefineSprite_30's canonical frame actions:
    //   frame_4/DoAction.as  → SOMA.playSound("grina_711") + signalHit
    //   frame_127/DoAction.as → _parent.removeMovieClip(); stop();
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 129,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_30/frame_4/DoAction.as → SOMA.playSound("grina_711")
          // frame_4 (1-based) → index 3 (0-based)
          3,
          (_clip) => {
            this.playSpellSound?.("grina_711");
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_30/frame_127/DoAction.as → _parent.removeMovieClip(); stop();
          // frame_127 (1-based) → index 126 (0-based)
          126,
          (clip) => {
            clip.stop();
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
    // Capture sound callback so frame scripts can play the sound at
    // the canonical frame_4 moment (DefineSprite_30/frame_4/DoAction.as).
    this.playSpellSound = callbacks.playSound;

    // Main timeline frame_1/DoAction.as is empty — no sound here.
    // Attach the anim1 composite at root so it starts ticking from
    // the next runtime frame.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
