/**
 * Spell 1016 — Licorne (Licorne / Unicorn spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1016/scripts/scripts/
 *
 * displayType=11 (TargetCell). This spell has no `move`, `shoot`, or `duplicate`
 * symbols, no ballistic arc, no beam — it is a pure impact animation at the target
 * cell. Two parallel authored timelines (DefineSprite_23 and DefineSprite_38) play
 * simultaneously at the target, each with:
 *   - frame_1: SOMA.playSound("licrounch_1001")
 *   - frame_37: SOMA.playSound("licrounch_1001b")
 *   - frame_109: this.end() → signalHit; a child clip's onEnterFrame fades alpha
 *   - frame_148: _parent.removeMovieClip(); stop() → spell complete
 *
 * The manifest has no `librarySymbols` — all four animation variants (anim1,
 * anim146, anim291, anim436) live in `animations[]` only. The two sprites
 * correspond to different level-based animation variants; we attach the appropriate
 * one based on spell level following the canonical 1.29 level-indexed selection
 * (levels 1–2 → anim1, 3–4 → anim146, 5 → anim291, 6 → anim436). Since the
 * manifest has no library symbols, NO `lib_` prefix is used anywhere.
 *
 * The fade child placed at frame_109 (PlaceObject2_22_144) has an onEnterFrame
 * that decrements _parent._alpha by 10 each frame. We model this as the sprite
 * symbol's own alpha decrement since the child is an authored timeline element
 * (not a runtime-attached symbol): we drive the fade directly in the owning
 * symbol's onEnterFrame after frame 109.
 *
 * Main timeline: SOMA.playSound("licrounch_1001"); (frame_1/DoAction.as)
 * The two children (sprite 23 + sprite 38) are placed on the main timeline —
 * we attach both in onSpellStart so they start ticking immediately.
 *
 * Library symbols: none (librarySymbols[] is empty in manifest).
 *
 * Sounds (from manifest):
 *   - frame 0 (= frame_1): "licrounch_1001"
 *   - frame 36 (= frame_37): "licrounch_1001b"
 * Both are played by the inner sprite frame scripts; the main timeline also plays
 * "licrounch_1001" on frame_1.
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

const ANIM_BOUNDS = {
  width: 131.1,
  height: 108.15,
  offsetX: -62.75,
  offsetY: -63.45,
};

export class Spell1016 extends RuntimeSpell {
  readonly spellId = 1016;
  readonly displayType = SpellDisplayType.TargetCell;

  private sprite23Sym!: SymbolDefinition;
  private sprite38Sym!: SymbolDefinition;

  // Capture sound callback so inner frame scripts can play sounds.
  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    context: SpellContext,
  ): void {
    const anchor = calculateAnchor(ANIM_BOUNDS);

    // Select animation variant based on spell level — canonical 1.29 level-indexed
    // selection. Both DefineSprite_23 and DefineSprite_38 correspond to the same
    // visual at different level ranges; we use the level to pick the texture set.
    const level = context.level;
    let animName: string;
    if (level <= 2) {
      animName = "anim1";
    } else if (level <= 4) {
      animName = "anim146";
    } else if (level <= 5) {
      animName = "anim291";
    } else {
      animName = "anim581";
    }

    // ---- DefineSprite_23 — primary impact timeline (150 frames) --------
    // AS:
    //   frame_1/DoAction.as:   SOMA.playSound("licrounch_1001")
    //   frame_37/DoAction.as:  SOMA.playSound("licrounch_1001b")
    //   frame_109/DoAction.as: this.end()  → signalHit
    //   frame_109/PlaceObject2_22_144/onClipEvent(enterFrame): _parent._alpha -= 10
    //   frame_148/DoAction.as: _parent.removeMovieClip(); stop() → complete
    //
    // The fade child (PlaceObject2_22_144) placed at frame 109 has an
    // onEnterFrame that subtracts 10 from _parent._alpha each frame. We
    // model this by tracking a flag on the clip (vars.fading) set at
    // frame 109, then driving the alpha decrement in the symbol's own
    // onEnterFrame handler thereafter.
    this.sprite23Sym = {
      name: "sprite_23",
      totalFrames: 150,
      frames: textures.getFrames(animName),
      anchorX: anchor.x,
      anchorY: anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_23/frame_109/PlaceObject2_22_144/onClipEvent(enterFrame):
        //   _parent._alpha -= 10
        // Active only after frame 109 (fading flag is set there).
        if (clip.vars.fading === true) {
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
      },
      frameScripts: new Map([
        [
          0,
          () => {
            // AS DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("licrounch_1001")
            this.soundCallback?.("licrounch_1001");
          },
        ],
        [
          36,
          () => {
            // AS DefineSprite_23/frame_37/DoAction.as: SOMA.playSound("licrounch_1001b")
            this.soundCallback?.("licrounch_1001b");
          },
        ],
        [
          108,
          (clip) => {
            // AS DefineSprite_23/frame_109/DoAction.as: this.end() → signalHit
            // Also activates the fade child's onEnterFrame behaviour.
            clip.vars.fading = true;
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_23/frame_148/DoAction.as:
            //   _parent.removeMovieClip(); stop()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- DefineSprite_38 — secondary impact timeline (150 frames) ------
    // Identical script structure to DefineSprite_23; used as a parallel
    // composite layer. Same animation frames, same timing.
    // AS:
    //   frame_1/DoAction.as:   SOMA.playSound("licrounch_1001")
    //   frame_37/DoAction.as:  SOMA.playSound("licrounch_1001b")
    //   frame_109/DoAction.as: this.end()
    //   frame_109/PlaceObject2_22_144/onClipEvent(enterFrame): _parent._alpha -= 10
    //   frame_148/DoAction.as: _parent.removeMovieClip(); stop()
    //
    // Since DefineSprite_23 already calls signalHit and complete, DefineSprite_38
    // should NOT call them again (both are idempotent, but we keep the canonical
    // call site to DefineSprite_23 as the primary driver and let 38 be the visual
    // layer only — it calls the same idempotent methods safely).
    this.sprite38Sym = {
      name: "sprite_38",
      totalFrames: 150,
      frames: textures.getFrames(animName),
      anchorX: anchor.x,
      anchorY: anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_38/frame_109/PlaceObject2_22_144/onClipEvent(enterFrame):
        //   _parent._alpha -= 10
        if (clip.vars.fading === true) {
          clip.alpha = Math.max(0, clip.alpha - 10 / 100);
        }
      },
      frameScripts: new Map([
        [
          0,
          () => {
            // AS DefineSprite_38/frame_1/DoAction.as: SOMA.playSound("licrounch_1001")
            // Sound already fired by sprite_23 frame_1; both fire canonically.
            this.soundCallback?.("licrounch_1001");
          },
        ],
        [
          36,
          () => {
            // AS DefineSprite_38/frame_37/DoAction.as: SOMA.playSound("licrounch_1001b")
            this.soundCallback?.("licrounch_1001b");
          },
        ],
        [
          108,
          (clip) => {
            // AS DefineSprite_38/frame_109/DoAction.as: this.end()
            clip.vars.fading = true;
            this.runtime.signalHit();
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_38/frame_148/DoAction.as:
            //   _parent.removeMovieClip(); stop()
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite23Sym);
    this.registry.register(this.sprite38Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in frame scripts.
    this.soundCallback = callbacks.playSound;

    // AS scripts/frame_1/DoAction.as: SOMA.playSound("licrounch_1001")
    callbacks.playSound("licrounch_1001");

    // Attach both parallel timeline sprites — they are implicitly placed
    // on the main timeline in the canonical SWF at frame_1.
    this.root.attach(this.sprite23Sym, "sprite23", 1, context);
    this.root.attach(this.sprite38Sym, "sprite38", 2, context);
  }
}
