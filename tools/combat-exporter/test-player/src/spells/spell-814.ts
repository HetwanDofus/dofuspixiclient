/**
 * Spell 814 - Vlad
 *
 * A shoot animation that plays from the caster position, rotated toward the target.
 *
 * Components:
 * - shoot (sprite): At caster position, rotated toward target, plays 90 frames
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_805'
 * - Frame 1 (shoot): Set rotation to parent angle
 * - Frame 88 (shoot): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 509.1,
  height: 70.1,
  offsetX: -5,
  offsetY: -37.6,
};

export class Spell814 extends BaseSpell {
  readonly spellId = 814;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    this.shootAnim
      .onFrame(0, () => this.callbacks.playSound('vlad_805'))
      .onFrame(87, () => this.signalHit());

    this.container.addChild(this.shootAnim.sprite);
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
