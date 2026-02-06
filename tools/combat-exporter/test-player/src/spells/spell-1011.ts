import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 1011 - Pet/Summon spell
 *
 * Simple animation with randomized scale and rotation on DefineSprite_4.
 *
 * Components:
 * - anim1: Main composite animation (72 frames)
 *
 * Original AS timing:
 * - Frame 1: Play "pet" sound
 * - DefineSprite_4 frame 1: Random scale 100-200%, random rotation 0-360
 * - DefineSprite_4 frame 19: Stop
 * - DefineSprite_7 frame 46: Stop  
 * - DefineSprite_9 frame 64: Stop
 * - DefineSprite_10 frame 10: Signal hit (this.end())
 * - DefineSprite_10 frame 70: Stop and remove parent
 */
export class Spell1011 extends BaseSpell {
  readonly spellId = 1011;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation manifest
    const MAIN_MANIFEST: SpriteManifest = {
      offsetX: -619.8,
      offsetY: -339.6,
      width: 1234.2,
      height: 659.1,
    };

    // Create main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(MAIN_MANIFEST),
      scale: init.scale,
    }));

    // Position at caster
    this.container.position.set(0, init.casterY);

    // AS frame 1 - play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('pet'));

    // AS DefineSprite_10 frame 10 - signal hit
    this.mainAnim.onFrame(9, () => this.signalHit());

    // AS stops at frame 70 (DefineSprite_10), which corresponds to frame 69 in manifest
    this.mainAnim.stopAt(68);

    // Add to container
    this.container.addChild(this.mainAnim.sprite);

    // Start animation
    this.mainAnim.play();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}