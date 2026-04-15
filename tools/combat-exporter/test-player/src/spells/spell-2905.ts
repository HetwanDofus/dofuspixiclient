/**
 * Spell 2905 - Tofu Fire
 *
 * A fireworks-style spell animation using a single composite "shoot" animation.
 *
 * Components:
 * - shoot: Main animation (97 frames) at target position
 *
 * Original AS timing:
 * - Frame 1 (shoot): Play sound 'tofu_fire'
 * - Frame 20 (shoot): Play sound 'explo_fireworks'
 * - Frame 58 (shoot): Play sound 'explo_fireworks', signal hit
 * - Frame 97 (shoot): Animation ends
 *
 * Note: The manifest provides pre-composited frames for the shoot animation,
 * which includes all particle effects (plumes, feux) baked in. The sounds
 * are triggered at frames matching the manifest's sounds array (0-indexed: 0, 19, 57).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2905 extends BaseSpell {
  readonly spellId = 2905;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 20,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 in AS (0-indexed: 0): play sound 'tofu_fire'
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('tofu_fire'));

    // Frame 20 in AS (0-indexed: 19): play sound 'explo_fireworks'
    this.shootAnim.onFrame(19, () => this.callbacks.playSound('explo_fireworks'));

    // Frame 58 in AS (0-indexed: 57): play sound 'explo_fireworks' + signal hit
    this.shootAnim.onFrame(57, () => {
      this.callbacks.playSound('explo_fireworks');
      this.signalHit();
    });

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
