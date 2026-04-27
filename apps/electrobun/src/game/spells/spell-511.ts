/**
 * Spell 511 — Ronce (Feca thorn aura / self-buff).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/511/scripts/scripts/
 *
 * displayType=10 (CasterCell). This spell has no projectile, no target-cell
 * impact, and no caster→target motion. The single animation (anim1) plays
 * at the caster. The manifest has no librarySymbols[] — `anim1` lives only
 * in animations[]. All rendering is driven by the anim1 timeline directly.
 *
 * Canonical AS layout:
 *   - DefineSprite_9 (anim1, 150 frames):
 *       frame_1:  SOMA.playSound("ronce")
 *       frame_4:  SOMA.playSound("ronce")
 *       frame_7:  SOMA.playSound("ronce")
 *       frame_148: stop(); removeMovieClip(_parent)  → spell complete
 *
 *   - DefineSprite_8 (the actual animated sprite placed inside sprite_9,
 *     referenced as PlaceObject2_7_1 at depth 1 of sprite_9/frame_1):
 *       onClipEvent(load):
 *         gotoAndPlay(random(45));
 *         _alpha = 150;   → AS 150 clamped by Flash to 100, so alpha=1.0
 *       onClipEvent(enterFrame):
 *         _alpha = _alpha - 1.3;   → gentle fade per frame
 *
 * Because the manifest has no librarySymbols[], the texture key for the
 * main animated sprite is plain "anim1" (no lib_ prefix). DefineSprite_8
 * is embedded inside sprite_9 and shares the same frames; we register it
 * as a symbol "anim1_inner" but its textures come from the same "anim1"
 * atlas since it IS the visual content of anim1. The outer container
 * (sprite_9) has no authored visual — it just drives sounds and lifetime.
 *
 * Sounds are played at frames 1, 4, 7 (canonical AS). We capture the
 * callbacks reference in onSpellStart and fire them from frameScripts.
 *
 * signalHit is called at frame_1 of the outer sprite (immediate impact on
 * the caster-side aura appearing), consistent with CasterCell self-buffs.
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
  width: 56.4,
  height: 130.25,
  offsetX: -30.7,
  offsetY: -83.3,
};

export class Spell511 extends RuntimeSpell {
  readonly spellId = 511;
  readonly displayType = SpellDisplayType.CasterCell;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- anim1_inner — the actual animated visual (DefineSprite_8) ------
    // Placed at depth 1 inside DefineSprite_9/frame_1. Contains the thorn
    // aura animation. Its clipEvents randomise start frame and fade alpha.
    //
    // AS: DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(load).as
    // AS: DefineSprite_8/frame_1/PlaceObject2_7_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    const anim1InnerSym: SymbolDefinition = {
      name: "anim1_inner",
      totalFrames: 150,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      onLoad: (clip) => {
        // AS onClipEvent(load): gotoAndPlay(random(45)); _alpha = 150;
        // Flash clamps _alpha to [0,100], so 150 → 1.0 in TS.
        clip.gotoAndPlay(Math.floor(Math.random() * 45));
        clip.alpha = 1.0;
      },
      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame): _alpha = _alpha - 1.3;
        // Convert: AS 0-100 → TS 0-1; delta 1.3 → 1.3/100
        clip.alpha = clip.alpha - 1.3 / 100;
      },
    };

    // ---- anim1 — outer container / timeline driver (DefineSprite_9) -----
    // 150-frame container. No authored visual content itself — carries
    // sound scripts and the lifetime-end removal. Attaches anim1_inner
    // at frame_1 (the PlaceObject2_7_1 implicit placement in canonical AS).
    //
    // AS: DefineSprite_9/frame_1/DoAction.as  → SOMA.playSound("ronce")
    // AS: DefineSprite_9/frame_4/DoAction.as  → SOMA.playSound("ronce")
    // AS: DefineSprite_9/frame_7/DoAction.as  → SOMA.playSound("ronce")
    // AS: DefineSprite_9/frame_148/DoAction.as → stop(); removeMovieClip(_parent)
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 150,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9/frame_1/DoAction.as: SOMA.playSound("ronce")
            // Also: implicit PlaceObject2_7_1 places anim1_inner at depth 1.
            this.soundCallback?.("ronce");
            if (!clip.children.has("anim1_inner")) {
              clip.attach(anim1InnerSym, "anim1_inner", 1, ctx);
            }
            // Signal hit immediately — caster-side aura has appeared.
            this.runtime.signalHit();
          },
        ],
        [
          3,
          (_clip) => {
            // AS DefineSprite_9/frame_4/DoAction.as: SOMA.playSound("ronce")
            this.soundCallback?.("ronce");
          },
        ],
        [
          6,
          (_clip) => {
            // AS DefineSprite_9/frame_7/DoAction.as: SOMA.playSound("ronce")
            this.soundCallback?.("ronce");
          },
        ],
        [
          147,
          (clip) => {
            // AS DefineSprite_9/frame_148/DoAction.as: stop(); removeMovieClip(_parent)
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(anim1InnerSym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture callbacks so frameScripts can play sounds.
    this.soundCallback = callbacks.playSound;

    // Main timeline frame_1: attach the outer anim1 container at the root.
    // In canonical AS the outer SWF places DefineSprite_9 (anim1) on the
    // main timeline implicitly — we attach it explicitly here.
    this.root.attach(
      this.registry.resolve("anim1")!,
      "anim1",
      1,
      context,
    );
  }
}
