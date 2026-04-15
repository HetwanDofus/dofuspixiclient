/**
 * Spell 1003 - Licrounch (Osamodas)
 *
 * A composite spell animation with two overlapping animations (anim1 and anim29).
 * Each animation has a flicker/fade-in effect on an inner sprite (DefineSprite_6)
 * that randomly becomes visible, and fades out starting at frame 133.
 *
 * Components:
 * - anim1: Main composite animation at target position, stops at frame 168
 * - anim29: Secondary composite animation at target position, stops at frame 168
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'licrounch_1003'
 * - Frame 1 (DefineSprite_8): Play sound 'licrounch_1003'
 * - Frame 133 (DefineSprite_8): Signal hit (this.end()), begin alpha fade (-5 per frame)
 * - Frame 169 (DefineSprite_8): removeMovieClip() / stop() - animation ends
 *
 * Note: DefineSprite_5 uses gotoAndPlay(random(5)) for random start offset.
 * The composite animations (anim1, anim29) already bake this composite behavior.
 * The fade starting at frame 133 is replicated by fading the sprites' alpha
 * from frame 132 onward at -5 per frame (AS: _parent._alpha -= 5).
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const ANIM_MANIFEST: SpriteManifest = {
  width: 131.55,
  height: 59.25,
  offsetX: -37.75,
  offsetY: -36.45,
};

export class Spell1003 extends BaseSpell {
  readonly spellId = 1003;

  private anim1!: FrameAnimatedSprite;
  private anim29!: FrameAnimatedSprite;
  private anim1Fading = false;
  private anim29Fading = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM_MANIFEST);

    // anim1 - main composite animation at target position
    this.anim1 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.anim1.sprite.position.set(init.targetX, init.targetY);
    this.anim1
      .stopAt(168)
      .onFrame(0, () => this.callbacks.playSound("licrounch_1003"))
      .onFrame(132, () => {
        this.signalHit();
        this.anim1Fading = true;
      });
    this.container.addChild(this.anim1.sprite);

    // anim29 - secondary composite animation at target position
    this.anim29 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim29"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.anim29.sprite.position.set(init.targetX, init.targetY);
    this.anim29.stopAt(168).onFrame(132, () => {
      this.anim29Fading = true;
    });
    this.container.addChild(this.anim29.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply fade: AS frame_133 onClipEvent(enterFrame): _parent._alpha -= 5
    // Each frame subtracts 5 from alpha (0-100 scale). In PixiJS alpha is 0-1.
    // deltaTime is in ms, frame time is ~16.67ms at 60fps
    // We approximate per-frame as per-update using deltaTime ratio
    const frameRatio = deltaTime / (1000 / 60);
    if (this.anim1Fading) {
      this.anim1.sprite.alpha = Math.max(
        0,
        this.anim1.sprite.alpha - 0.05 * frameRatio
      );
    }
    if (this.anim29Fading) {
      this.anim29.sprite.alpha = Math.max(
        0,
        this.anim29.sprite.alpha - 0.05 * frameRatio
      );
    }

    // Complete when both animations have stopped (at frame 168)
    // and alpha has faded out (or close to 0)
    if (this.anims.allStopped()) {
      // After stopping at frame 168, check if fade is done
      if (this.anim1.sprite.alpha <= 0 && this.anim29.sprite.alpha <= 0) {
        this.complete();
      } else if (!this.anim1Fading && !this.anim29Fading) {
        // Stopped but no fading initiated - complete anyway
        this.complete();
      }
    }
  }
}
