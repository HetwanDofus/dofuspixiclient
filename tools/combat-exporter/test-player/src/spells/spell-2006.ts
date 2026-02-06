/**
 * Spell 2006 - Unknown Name
 *
 * A complex spell with multiple animated components at the target position.
 *
 * Components:
 * - sprite_16: Secondary effect animation with random start frame
 * - sprite_23: Rotating elements with random initial rotations
 * - sprite_26: Main spell animation (183 frames) positioned at target
 *
 * Original AS timing:
 * - Frame 1: Play sound "grina_709", position at target
 * - Frame 25: Play sound "wab_2006"
 * - Frame 34: Signal end (this.end())
 * - Frame 97: Remove movieclip
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_16_MANIFEST: SpriteManifest = {
  width: 207,
  height: 80.4,
  offsetX: -4.199999999999999,
  offsetY: -80.4,
};

const SPRITE_23_MANIFEST: SpriteManifest = {
  width: 339.9,
  height: 16.799999999999997,
  offsetX: 108,
  offsetY: -16.5,
};

const SPRITE_26_MANIFEST: SpriteManifest = {
  width: 972,
  height: 2131.8,
  offsetX: -485.70000000000005,
  offsetY: -1839.3000000000002,
};

export class Spell2006 extends BaseSpell {
  readonly spellId = 2006;

  private mainAnim!: FrameAnimatedSprite;
  private secondaryAnim!: FrameAnimatedSprite;
  private rotatingElements: FrameAnimatedSprite[] = [];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play initial sound
    this.callbacks.playSound('grina_709');

    // Main spell animation (sprite_26) at target position
    const sprite26Anchor = calculateAnchor(SPRITE_26_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_26'),
      anchorX: sprite26Anchor.x,
      anchorY: sprite26Anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.mainAnim
      .onFrame(24, () => this.callbacks.playSound('wab_2006'))
      .onFrame(33, () => this.signalHit());
    this.container.addChild(this.mainAnim.sprite);

    // Secondary animation (sprite_16) with random start frame
    const sprite16Frames = textures.getFrames('sprite_16');
    if (sprite16Frames.length > 0) {
      const sprite16Anchor = calculateAnchor(SPRITE_16_MANIFEST);
      this.secondaryAnim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite16Frames,
        anchorX: sprite16Anchor.x,
        anchorY: sprite16Anchor.y,
        scale: init.scale,
        startFrame: Math.floor(Math.random() * 30) + 1, // AS: random(30) + 2, TS: 0-indexed
      }));
      this.secondaryAnim.sprite.position.set(init.targetX, init.targetY);
      this.container.addChild(this.secondaryAnim.sprite);
    }

    // Rotating elements (sprite_23) with random initial rotations
    const sprite23Frames = textures.getFrames('sprite_23');
    if (sprite23Frames.length > 0) {
      const sprite23Anchor = calculateAnchor(SPRITE_23_MANIFEST);
      // Create multiple instances as suggested by the AS files
      for (let i = 0; i < 3; i++) {
        const rotatingElement = this.anims.add(new FrameAnimatedSprite({
          textures: sprite23Frames,
          anchorX: sprite23Anchor.x,
          anchorY: sprite23Anchor.y,
          scale: init.scale,
        }));

        // Random initial rotation between -180 and 0 degrees
        const initialRotation = (Math.floor(Math.random() * 181) - 180) * Math.PI / 180;
        rotatingElement.sprite.rotation = initialRotation;
        rotatingElement.sprite.position.set(init.targetX, init.targetY);

        this.rotatingElements.push(rotatingElement);
        this.container.addChild(rotatingElement.sprite);
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Apply continuous rotation to sprite_18 elements (1.67 degrees per frame at 60fps)
    const rotationPerSecond = (1.67 * Math.PI / 180) * 60;
    const rotationDelta = rotationPerSecond * (deltaTime / 1000);
    
    for (const element of this.rotatingElements) {
      element.sprite.rotation += rotationDelta;
    }

    // Check for completion at frame 97
    if (this.mainAnim.getFrame() >= 96) {
      this.complete();
    }
  }
}