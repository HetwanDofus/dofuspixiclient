/**
 * Spell 2001 - Unknown
 *
 * A directional beam spell that creates a visual connection from caster to target,
 * followed by an impact explosion.
 *
 * Components:
 * - sprite_8: Simple animation (48 frames) at caster position
 * - sprite_10: Main beam/projectile that stretches from caster to target
 * - sprite_19: Impact animation at target position
 *
 * Original AS timing:
 * - Frame 1: Play wab_explo sound
 * - Frame 7: Play vol sound and signal hit (in sprite_19)
 * - Frame 33: Impact animation ends
 * - Frame 46: sprite_8 stops
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_8_MANIFEST: SpriteManifest = {
  width: 1344.9,
  height: 371.4,
  offsetX: 0,
  offsetY: -183,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 1339.5,
  height: 369.9,
  offsetX: -2.4,
  offsetY: -180.6,
};

const SPRITE_19_MANIFEST: SpriteManifest = {
  width: 714.9,
  height: 383.4,
  offsetX: -148.2,
  offsetY: -198.9,
};

export class Spell2001 extends BaseSpell {
  readonly spellId = 2001;

  private sprite8!: FrameAnimatedSprite;
  private sprite10!: FrameAnimatedSprite;
  private sprite19!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // sprite_8 - Simple animation at caster position
    this.sprite8 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      ...calculateAnchor(SPRITE_8_MANIFEST),
      scale: init.scale,
    }));
    this.sprite8.sprite.position.set(0, init.casterY);
    this.sprite8.stopAt(45);
    this.container.addChild(this.sprite8.sprite);

    // sprite_10 - Main beam/projectile from caster to target
    this.sprite10 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
    }));
    this.sprite10.sprite.position.set(0, init.casterY);
    this.sprite10.sprite.rotation = init.angleRad;
    
    // Scale width based on distance (AS: _width = _parent.longueur)
    const dx = init.targetX;
    const dy = init.targetY - init.casterY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    this.sprite10.sprite.scale.x *= distance / SPRITE_10_MANIFEST.width;
    
    this.sprite10.onFrame(0, () => this.callbacks.playSound('wab_explo'));
    this.container.addChild(this.sprite10.sprite);

    // sprite_19 - Impact animation at target position
    this.sprite19 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_19'),
      ...calculateAnchor(SPRITE_19_MANIFEST),
      scale: init.scale,
    }));
    this.sprite19.sprite.position.set(init.targetX, init.targetY);
    this.sprite19.sprite.rotation = init.angleRad;
    this.sprite19
      .stopAt(32)
      .onFrame(6, () => {
        this.callbacks.playSound('vol');
        this.signalHit();
      });
    this.container.addChild(this.sprite19.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when sprite_19 is done (it's the last to finish)
    if (this.sprite19.isComplete()) {
      this.complete();
    }
  }
}