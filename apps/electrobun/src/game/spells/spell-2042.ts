/**
 * Spell 2042 — (Unknown name, likely a grass/nature impact spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2042/scripts/scripts/
 *
 * displayType=11 (TargetCell). There are no projectile motion symbols (no
 * `move`/`shoot`/`duplicate`), no caster-reference logic, no dual-anchored
 * WorldAbsolute pattern. The spell is a single impact at the target cell
 * driven entirely by DefineSprite_8's authored timeline.
 *
 * Canonical AS layout:
 *   - DefineSprite_8 — main spell timeline (61 frames):
 *       frame_1:  SOMA.playSound("herbe")
 *       frame_22: SOMA.playSound("pic")
 *       frame_37: SOMA.playSound("pic")
 *       frame_61: _parent.removeMovieClip(); stop()  → spell complete
 *   - DefineSprite_2 — secondary sub-sprite (16 frames):
 *       frame_16: stop()
 *
 * The manifest has no `librarySymbols[]` entries. All content is in the
 * `animations[]` list (anim1, anim5, anim9, anim19, anim23) — these are
 * the authored frame sequences for the two DefineSprites rendered onto the
 * timeline. No `attachMovie` calls are present in the AS, so no dynamic
 * library symbols need registering. The harness attaches the root symbol
 * directly; we register DefineSprite_8 (the outer container) as the primary
 * symbol and DefineSprite_2 as a nested symbol.
 *
 * Because there are no librarySymbols[] entries and no attachMovie calls,
 * the two DefineSprites are registered using the bare animation names from
 * animations[]. The longest-lived clip (DefineSprite_8, 61 frames) drives
 * signalHit (at frame_22, the first "pic" impact sound) and complete (at
 * frame_61).
 *
 * Main timeline: attach DefineSprite_8 at root from onSpellStart.
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

// Bounds for anim9 (the main 75-frame impact visual used by DefineSprite_8).
const ANIM9_BOUNDS = {
  width: 76.95,
  height: 96.1,
  offsetX: -39.6,
  offsetY: -61.15,
};

// Bounds for anim1 / anim5 / anim19 / anim23 (18-frame secondary visuals,
// all share the same bounds — these belong to DefineSprite_2 sub-clips).
const ANIM_SMALL_BOUNDS = {
  width: 25.6,
  height: 15.25,
  offsetX: -9.15,
  offsetY: -15.4,
};

export class Spell2042 extends RuntimeSpell {
  readonly spellId = 2042;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite8Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const anim9Anchor = calculateAnchor(ANIM9_BOUNDS);
    const animSmallAnchor = calculateAnchor(ANIM_SMALL_BOUNDS);

    // ---- DefineSprite_2 sub-sprite (anim1, 16-frame stop) --------
    // AS DefineSprite_2/frame_16/DoAction.as: stop()
    // This is a secondary visual sub-clip placed on DefineSprite_8's
    // timeline. We model it using the anim1 frames (18-frame sequence;
    // stop at frame 16 per canonical AS, index 15 zero-based).
    const sprite2Sym: SymbolDefinition = {
      name: "sprite2",
      totalFrames: 18,
      frames: textures.getFrames("anim1"),
      anchorX: animSmallAnchor.x,
      anchorY: animSmallAnchor.y,
      frameScripts: new Map([
        [
          15,
          (clip) => {
            // AS DefineSprite_2/frame_16/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- DefineSprite_8 — outer spell timeline (61 frames) -------
    // anim9 provides the main visual frames (75 exported, 61 canonical).
    // frame_1:  SOMA.playSound("herbe")
    // frame_22: SOMA.playSound("pic")   → also signalHit (first impact)
    // frame_37: SOMA.playSound("pic")
    // frame_61: _parent.removeMovieClip(); stop() → spell complete
    //
    // The manifest sounds[] array also lists these frame-triggered sounds:
    //   frame 0  → "herbe"
    //   frame 21 → "pic"
    //   frame 36 → "pic"
    // These match the 0-based equivalents of the canonical AS frame scripts.
    this.sprite8Sym = {
      name: "sprite8",
      totalFrames: 61,
      frames: textures.getFrames("anim9"),
      anchorX: anim9Anchor.x,
      anchorY: anim9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("herbe")
            // Sound is played from onSpellStart for the initial attach.
            // This handler exists for documentation parity; the sound is
            // already played in onSpellStart before the first tick.
          },
        ],
        [
          21,
          (_clip) => {
            // AS DefineSprite_8/frame_22/DoAction.as: SOMA.playSound("pic")
            // First impact sound — also the canonical hit signal.
            this.runtime.signalHit();
            this.soundCallback?.("pic");
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_8/frame_37/DoAction.as: SOMA.playSound("pic")
            this.soundCallback?.("pic");
          },
        ],
        [
          60,
          (clip) => {
            // AS DefineSprite_8/frame_61/DoAction.as:
            //   _parent.removeMovieClip(); stop()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite2Sym);
    this.registry.register(this.sprite8Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // Capture the sound callback for use in frame scripts.
    this.soundCallback = callbacks.playSound;

    // AS DefineSprite_8/frame_1/DoAction.as: SOMA.playSound("herbe")
    // The outer mc's main timeline places DefineSprite_8 at frame 1,
    // which fires its frame_1 script (the "herbe" sound). We replicate
    // that by playing it here and attaching the symbol.
    callbacks.playSound("herbe");

    // Attach the outer DefineSprite_8 clip at the root. It will drive
    // the full 61-frame timeline including sounds and completion.
    this.root.attach(this.sprite8Sym, "sprite8", 1, context);
  }
}
