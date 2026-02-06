/**
 * Spell 202 - Crockette
 *
 * A spell that creates multiple particle effects: stars, stones, and gold particles.
 *
 * Components:
 * - etoiles: Main star animation with particle physics
 *
 * Original AS timing:
 * - Frame 1: Sound plays ("crockette_202")
 * - Frame 97: Hit signal (this.end())
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ETOILES_MANIFEST: SpriteManifest = {
  width: 392.7,
  height: 392.4,
  offsetX: -193.8,
  offsetY: -250.2,
};

export class Spell202 extends BaseSpell {
  readonly spellId = 202;

  private etoilesAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ETOILES_MANIFEST);

    // Main stars animation
    this.etoilesAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('etoiles'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    
    // Position at caster
    this.etoilesAnim.sprite.position.set(0, init.casterY);
    
    // Set up frame callbacks
    this.etoilesAnim
      .onFrame(0, () => this.callbacks.playSound('crockette_202'))
      .onFrame(96, () => this.signalHit());
    
    this.container.addChild(this.etoilesAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Check completion after hit signal
    if (this.etoilesAnim.getFrame() >= 96) {
      this.complete();
    }
  }
}