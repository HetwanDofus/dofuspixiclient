import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

// Sprite manifests from the manifest.json
const SPRITE_17_MANIFEST: SpriteManifest = {
  width: 345,
  height: 372.9,
  offsetX: -168,
  offsetY: -330.9,
};

const SPRITE_18_MANIFEST: SpriteManifest = {
  width: 1017,
  height: 626.4,
  offsetX: -513.3,
  offsetY: -355.8,
};

/**
 * Spell 1012 - Nature/Plant Effect
 *
 * Two-sprite nature spell with random visual variation and target positioning.
 *
 * Components:
 * - sprite_17: Primary animation with random start frame and sound
 * - sprite_18: Secondary effect positioned at target cell
 *
 * Original AS timing:
 * - Frame 1: sprite_17 random start (2-61), sprite_18 positions at target
 * - Frame 64: Play "herbe" sound
 * - Frame 67: Signal hit via this.end()
 * - Frame 184: Cleanup sprite_18
 * - Frame 196: sprite_17 stops
 */
export class Spell1012 extends BaseSpell {
  readonly spellId = 1012;

  private primaryAnim!: FrameAnimatedSprite;
  private secondaryAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const primaryAnchor = calculateAnchor(SPRITE_17_MANIFEST);
    const secondaryAnchor = calculateAnchor(SPRITE_18_MANIFEST);

    // Create primary animation (sprite_17)
    this.primaryAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_17'),
      anchorX: primaryAnchor.x,
      anchorY: primaryAnchor.y,
      scale: init.scale,
      // AS: gotoAndPlay(random(60) + 2) - random frame between 2-61 (0-indexed: 1-60)
      startFrame: Math.floor(Math.random() * 60) + 1,
    }));

    // Position at caster
    this.primaryAnim.sprite.position.set(0, init.casterY);

    // Stop at frame 196 (0-indexed: 195)
    this.primaryAnim.stopAt(195);

    // Play sound at frame 64 (0-indexed: 63)
    this.primaryAnim.onFrame(63, () => this.callbacks.playSound('herbe'));

    // Create secondary animation (sprite_18)
    this.secondaryAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_18'),
      anchorX: secondaryAnchor.x,
      anchorY: secondaryAnchor.y,
      scale: init.scale,
    }));

    // Position at target cell (AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y)
    this.secondaryAnim.sprite.position.set(init.targetX, init.targetY);

    // Signal hit at frame 67 (0-indexed: 66) via this.end()
    this.secondaryAnim.onFrame(66, () => this.signalHit());

    // Stop at frame 184 (0-indexed: 183)
    this.secondaryAnim.stopAt(183);

    // Add both animations to container
    this.container.addChild(this.primaryAnim.sprite, this.secondaryAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Check if both animations are complete
    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}