import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import { FrameAnimatedSprite, calculateAnchor, type SpriteManifest } from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 1105 - Mystique
 *
 * Complex magical effect with particle system and delayed hit timing.
 *
 * Components:
 * - sprite_2: Main spell animation (622 frames) centered on target
 * - sprite_4: Particle effect with randomized start frames
 *
 * Original AS timing:
 * - Frame 1: Play sound "autre_1105"
 * - Frame 205: Hit signal (end())
 * - Frame 238: Remove entire animation
 * - sprite_4 frame 1: Jump to random frame 3-272
 * - sprite_4 frame 640: Loop back to frame 315
 */
export class Spell1105 extends BaseSpell {
  readonly spellId = 1105;

  private mainAnim!: FrameAnimatedSprite;
  private particleAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main sprite manifest (approximate values)
    const mainManifest: SpriteManifest = { width: 1, height: 1, offsetX: 0, offsetY: 0 };
    const particleManifest: SpriteManifest = { width: 1, height: 1, offsetX: 0, offsetY: 0 };

    // Create main animation
    const mainAnchor = calculateAnchor(mainManifest);
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_2'),
        fps: 60,
        anchorX: mainAnchor.x,
        anchorY: mainAnchor.y,
        scale: init.scale,
      }),
    );

    // Create particle animation with randomized start frame
    // AS: gotoAndPlay(random(270) + 3) -> 0-indexed: random 2-271
    const randomStartFrame = Math.floor(Math.random() * 270) + 2;

    const particleAnchor = calculateAnchor(particleManifest);
    this.particleAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_4'),
        fps: 60,
        anchorX: particleAnchor.x,
        anchorY: particleAnchor.y,
        startFrame: randomStartFrame,
        scale: init.scale,
      }),
    );

    // Position both animations at target
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.particleAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame callbacks for main animation
    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('autre_1105'))
      .onFrame(204, () => this.signalHit())
      .stopAt(237); // Stop at frame 238 (0-indexed: 237)

    // Particle looping behavior
    // AS: frame 640 -> gotoAndPlay(315)
    // 0-indexed: when reaching frame 639, jump to frame 314
    this.particleAnim.onFrame(639, () => {
      this.particleAnim.gotoFrame(314);
    });

    // Add to container (particles behind main)
    this.container.addChild(this.particleAnim.sprite);
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Complete when main animation stops (frame 238)
    // Particle continues looping but we don't wait for it
    if (this.mainAnim.isStopped()) {
      this.complete();
    }
  }
}