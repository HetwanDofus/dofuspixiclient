/**
 * Spell 1014 - Licrou (Cra)
 *
 * Physical impact spell with debris/particle effects at the target.
 *
 * Components:
 * - Main impact animation (sprite_17): At target position, plays impact sequence
 * - Debris particles (sprite_11): Multiple randomly-rotated debris pieces
 *
 * Original AS timing:
 * - Frame 1: Position at target cell
 * - Frame 28: Play impact sound "licrounch_1014"
 * - Frame 88: Signal hit (this.end())
 * - Frame 106: Play secondary sound "jump"
 * - Frame 118: Cleanup and remove
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const IMPACT_MANIFEST: SpriteManifest = {
  width: 647.7,
  height: 515.0999999999999,
  offsetX: -129.3,
  offsetY: -478.5,
};

const DEBRIS_MANIFEST: SpriteManifest = {
  width: 450.29999999999995,
  height: 6,
  offsetX: 58.199999999999996,
  offsetY: -3,
};

export class Spell1014 extends BaseSpell {
  readonly spellId = 1014;

  private impactAnim!: FrameAnimatedSprite;
  private debrisAnims: FrameAnimatedSprite[] = [];

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);

    // Main impact animation at target position
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_17'),
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim
      .onFrame(27, () => this.callbacks.playSound('licrounch_1014'))
      .onFrame(87, () => this.signalHit())
      .onFrame(105, () => this.callbacks.playSound('jump'));
    this.container.addChild(this.impactAnim.sprite);

    // Create debris particles
    const debrisTextures = textures.getFrames('sprite_11');
    const debrisAnchor = calculateAnchor(DEBRIS_MANIFEST);

    // Create multiple debris pieces (similar to particle spawning)
    const debrisCount = 8;
    for (let i = 0; i < debrisCount; i++) {
      const debris = this.anims.add(new FrameAnimatedSprite({
        textures: debrisTextures,
        anchorX: debrisAnchor.x,
        anchorY: debrisAnchor.y,
        scale: init.scale,
      }));

      // Random rotation (AS: _rotation = random(360))
      debris.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

      // Random scale (AS: t = 50 + random(50) -> 50-100%)
      const randomScale = (50 + Math.floor(Math.random() * 50)) / 100;
      debris.sprite.scale.set(init.scale * randomScale);

      // Random start frame for debris variation
      // AS: gotoAndPlay(random(27) + 1) -> 0-indexed: 0-26
      const startFrame = Math.floor(Math.random() * 27);
      debris.gotoFrame(startFrame);

      // Position around target with some random offset
      const offsetRadius = 40;
      const angle = (i / debrisCount) * Math.PI * 2;
      const offsetX = Math.cos(angle) * offsetRadius * Math.random();
      const offsetY = Math.sin(angle) * offsetRadius * Math.random();
      debris.sprite.position.set(init.targetX + offsetX, init.targetY + offsetY);

      this.container.addChild(debris.sprite);
      this.debrisAnims.push(debris);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.impactAnim.isComplete()) {
      this.complete();
    }
  }
}