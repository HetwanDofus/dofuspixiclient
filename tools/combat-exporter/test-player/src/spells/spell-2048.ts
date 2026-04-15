/**
 * Spell 2048 - Pic (Picaro/Rogue)
 *
 * A projectile spell with a wobbling rotation effect as it travels.
 *
 * Components:
 * - shoot (DefineSprite_8_shoot): The projectile animation at caster position,
 *   rotated toward target. Contains a child movie clip (DefineSprite_9_move)
 *   with a wobbling rotation effect.
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_9_move): Play sound 'pic'
 * - Frame 1 (move clip load): a = 30, i = 0
 * - Each frame (move clip enterFrame): _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1
 * - Frame 91 (DefineSprite_8_shoot): removeMovieClip() - animation ends
 * - Frame 64 (DefineSprite_7): stop()
 *
 * The wobble effect: rotation oscillates with decaying amplitude.
 * The projectile moves from caster to target over the animation duration.
 * Hit is signaled when the projectile reaches the target (frame 91 = end).
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 12.85,
  height: 31.6,
  offsetX: -12.45,
  offsetY: -17.6,
};

export class Spell2048 extends BaseSpell {
  readonly spellId = 2048;

  private shootAnim!: FrameAnimatedSprite;
  private wobbleContainer!: Container;
  private wobbleA = 30;
  private wobbleI = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    // Container for the wobbling projectile, positioned at caster
    this.wobbleContainer = new Container();
    this.wobbleContainer.position.set(0, init.casterY);
    this.wobbleContainer.rotation = init.angleRad;
    this.container.addChild(this.wobbleContainer);

    // The shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 50,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Frame 0 (AS frame 1): play sound
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('pic'));

    // Frame 90 (AS frame 91): removeMovieClip - signal hit and complete
    this.shootAnim.onFrame(90, () => {
      this.signalHit();
    });

    this.wobbleContainer.addChild(this.shootAnim.sprite);

    // Initialize wobble state (AS onClipEvent load: a = 30; i = 0)
    this.wobbleA = 30;
    this.wobbleI = 0;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply wobble rotation per frame (AS onClipEvent enterFrame):
    // _rotation = 90 + a * Math.cos(i += 0.6);
    // a /= 1.1;
    // The wobble is applied to the inner sprite relative to the container's base rotation
    // We simulate per-frame updates using deltaTime converted to frame steps at 50fps
    const frameTime = 1000 / 50;
    const steps = Math.floor(deltaTime / frameTime);
    for (let s = 0; s < steps; s++) {
      this.wobbleI += 0.6;
      const wobbleRotation = 90 + this.wobbleA * Math.cos(this.wobbleI);
      this.wobbleA /= 1.1;
      // Apply wobble offset rotation to the sprite (in addition to container's base angle)
      this.shootAnim.sprite.rotation = (wobbleRotation * Math.PI) / 180;
    }

    if (this.shootAnim.isComplete()) {
      this.signalHit();
      this.complete();
    }
  }
}
