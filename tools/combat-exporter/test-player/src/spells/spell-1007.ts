/**
 * Spell 1007 - Nature/Plant Growth
 *
 * A nature spell with growing plant animation and randomized behavior.
 *
 * Components:
 * - sprite_8: Main plant animation at target position with random skip behavior
 *
 * Original AS timing:
 * - Frame 1: 1 in 5 chance to skip to frame 20
 * - Frame 1: Play sound "herbe"
 * - Frame 58: Play sound "herbe" 
 * - Frame 121: Play sound "herbe"
 * - Frame 178: Signal hit (this.end())
 * - Frame 184: Play sound "herbe"
 * - Frame 295: Complete
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_8_MANIFEST: SpriteManifest = {
  width: 140.39999999999998,
  height: 142.2,
  offsetX: -70.5,
  offsetY: -70.5,
};

export class Spell1007 extends BaseSpell {
  readonly spellId = 1007;

  private plantAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const plantFrames = textures.getFrames('sprite_8');
    
    const anchor = calculateAnchor(SPRITE_8_MANIFEST);

    // Main plant animation at target position
    this.plantAnim = this.anims.add(new FrameAnimatedSprite({
      textures: plantFrames,
      fps: 60,
      loop: false,
      stopFrame: 294, // Stops at frame 295 (0-indexed)
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Apply position
    this.plantAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1: Random behavior - 1 in 5 chance to skip to frame 20
    if (Math.floor(Math.random() * 5) !== 0) {
      this.plantAnim.gotoFrame(19); // AS frame 20 is 0-indexed 19
    }
    
    // Sound events (AS frames converted to 0-indexed)
    this.plantAnim
      .onFrame(0, () => this.callbacks.playSound('herbe'))
      .onFrame(57, () => this.callbacks.playSound('herbe'))
      .onFrame(120, () => this.callbacks.playSound('herbe'))
      .onFrame(177, () => this.signalHit())
      .onFrame(183, () => this.callbacks.playSound('herbe'));
    
    this.container.addChild(this.plantAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}