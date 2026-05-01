/**
 * Spell 2114 — (Impact/aura spell, likely Sacrieur or Osamodas class).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2114/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite animation
 * (anim1) anchored at the target cell. No projectile motion, no caster
 * reference. The outer timeline has frame_138 DoAction: this.removeMovieClip().
 *
 * AS structure:
 *   - DefineSprite_12 (100-frame container — rendered as anim1 composite):
 *       frame_1  (index 0): SOMA.playSound("fx_612.mp3")
 *       frame_76 (index 75): SOMA.playSound("fx_611.mp3")
 *       frame_100 (index 99): stop()
 *
 *   - DefineSprite_11 (55-frame inner shimmer, placed inside DefineSprite_12):
 *       frame_1 (index 0): gotoAndPlay(random(31) + 1) → random start frame 1-31
 *       frame_55 (index 54): stop()
 *
 *   - DefineSprite_9 (1-frame, kind: "clipEvent", directlyDynamic: true):
 *       Placed inside DefineSprite_12 at depth 1, frame 0.
 *       Contains two PlaceObject2 instances with CLIPACTIONRECORD handlers:
 *         PlaceObject2_4_2  (depth 2):  onClipEvent(enterFrame): _rotation += 2
 *         PlaceObject2_8_10 (depth 10): onClipEvent(enterFrame): _rotation -= 1.3
 *       The two sub-children share the same sprite9 base texture but rotate
 *       independently. We model them as two separate inner SymbolDefinitions
 *       (sprite9_inner_a, sprite9_inner_b) attached from sprite9's frameScripts.
 *
 * Signal strategy:
 *   - signalHit: at anim1 frame index 75 (canonical fx_611 sound = impact frame)
 *   - complete:  at anim1 frame index 99 (stopFrame per manifest, mirrors
 *                DefineSprite_12/frame_100 stop + outer frame_138 removeMovieClip)
 *
 * Library symbols:
 *   - sprite9 (name: "sprite9", characterId 9, directlyDynamic: true):
 *       The rotating glyph container. Its frameScripts[0] attaches two inner
 *       rotating clips (sprite9_inner_a at depth 2, sprite9_inner_b at depth 10).
 *       Each inner clip carries an onEnterFrame that increments/decrements rotation.
 *   - anim1: 102-frame composite. frameScripts handle sounds, signalHit, completion,
 *       and attaching the live sprite9 child at frame 0.
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

const SPRITE9_BOUNDS = {
  width: 65.35,
  height: 65.35,
  offsetX: -32.4,
  offsetY: -32.85,
};

const ANIM1_BOUNDS = {
  width: 251,
  height: 128.55,
  offsetX: -125.5,
  offsetY: -52,
};

export class Spell2114 extends RuntimeSpell {
  readonly spellId = 2114;
  readonly displayType = SpellDisplayType.TargetCell;

  // Capture playSound for use inside frameScripts callbacks.
  private _playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const sprite9Anchor = calculateAnchor(SPRITE9_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- sprite9_inner_a — depth-2 rotating instance inside sprite9 ----
    // AS: DefineSprite_9/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation + 2;
    const sprite9InnerASym: SymbolDefinition = {
      name: "sprite9_inner_a",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_4_2/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 2;  (AS degrees → radians)
        clip.rotation += (2 * Math.PI) / 180;
      },
    };

    // ---- sprite9_inner_b — depth-10 rotating instance inside sprite9 ---
    // AS: DefineSprite_9/frame_1/PlaceObject2_8_10/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //   _rotation = _rotation - 1.3;
    const sprite9InnerBSym: SymbolDefinition = {
      name: "sprite9_inner_b",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      onEnterFrame: (clip) => {
        // AS DefineSprite_9/frame_1/PlaceObject2_8_10/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation - 1.3;  (AS degrees → radians)
        clip.rotation -= (1.3 * Math.PI) / 180;
      },
    };

    // ---- sprite9 — rotating glyph container (directlyDynamic clipEvent) ---
    // characterId=9, 1 frame, placed at depth 1 of DefineSprite_12 frame 0.
    // Its own frame_1 script is implicit (no DoAction.as for sprite9 itself);
    // the dynamic behaviour lives entirely in the two PlaceObject2 children
    // with CLIPACTIONRECORD onClipEvent(enterFrame) handlers.
    // We attach both inner rotating clips from frameScripts[0].
    //
    // Canonical placement inside DefineSprite_12 (frame 0, depth 1):
    //   translateX=0.4, translateY=12.25, alphaMult=20/256 initially.
    // The sprite9 container's own position is set by the parent (anim1)
    // when it attaches sprite9. The inner sub-clips are placed at (0,0)
    // relative to sprite9's local origin per the canonical SWF.
    const sprite9Sym: SymbolDefinition = {
      name: "sprite9",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite9"),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_9/frame_1: PlaceObject2 places two children
            // at depth 2 (PlaceObject2_4_2) and depth 10 (PlaceObject2_8_10).
            // Each carries an onClipEvent(enterFrame) with independent rotation.
            clip.attach(sprite9InnerASym, "inner_a", 2, ctx);
            clip.attach(sprite9InnerBSym, "inner_b", 10, ctx);
          },
        ],
      ]),
    };

    // ---- anim1 — main 102-frame composite timeline ---------------
    // Mirrors DefineSprite_12 (100 authored frames, rendered as anim1_*.svg).
    //   frame_1  (index 0):  SOMA.playSound("fx_612.mp3") — in onSpellStart
    //   frame_76 (index 75): SOMA.playSound("fx_611.mp3") + signalHit
    //   frame_100 (index 99): stop() → completion
    //
    // At frame 0 (DefineSprite_12 frame_1), the SWF places sprite9 at
    // depth 1 with translateX=0.4, translateY=12.25, alphaMult=20/256.
    // The alphaMult ramps from 20→256 over frames 0-23 (authored tween,
    // baked into the anim1 composite SVGs) then fades back from frame 79
    // onward. We set the initial alpha and let the composite frames carry
    // the visual bake for the tween portion; the live sprite9 clips simply
    // rotate on top.
    const anim1Sym: SymbolDefinition = {
      name: "anim1",
      totalFrames: 102,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_12/frame_1/DoAction.as: SOMA.playSound("fx_612.mp3")
            // Sound played in onSpellStart. Here we attach the live sprite9
            // rotating glyph that the SWF places at depth 1 on frame_1 of
            // DefineSprite_12.
            // Canonical placement: translateX=0.4, translateY=12.25, alphaMult=20/256.
            const s9 = clip.attach(sprite9Sym, "sprite9", 1, ctx, {
              x: 0.4,
              y: 12.25,
            });
            s9.alpha = 20 / 256;
          },
        ],
        [
          75,
          () => {
            // AS DefineSprite_12/frame_76/DoAction.as: SOMA.playSound("fx_611.mp3")
            this._playSound?.("fx_611.mp3");
            // signalHit at the impact-sound frame (canonical damage marker).
            this.runtime.signalHit();
          },
        ],
        [
          99,
          (clip) => {
            // AS DefineSprite_12/frame_100/DoAction.as: stop()
            // AND outer frame_138/DoAction.as: this.removeMovieClip()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite9InnerASym);
    this.registry.register(sprite9InnerBSym);
    this.registry.register(sprite9Sym);
    this.registry.register(anim1Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS DefineSprite_12/frame_1/DoAction.as: SOMA.playSound("fx_612.mp3")
    callbacks.playSound("fx_612.mp3");

    // Capture for use inside frame-script callbacks (e.g. frame_76 fx_611).
    this._playSound = callbacks.playSound;

    // Attach the main anim1 composite as the single root child.
    // It renders the authored timeline and orchestrates the live sprite9
    // rotating glyph from its frameScripts.
    const anim1Sym = this.registry.resolve("anim1");
    if (anim1Sym) {
      this.root.attach(anim1Sym, "anim1", 1, context);
    }
  }
}
