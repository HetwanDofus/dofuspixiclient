/**
 * Spell 2106
 *
 * A projectile spell with a wobbling rotation effect during travel,
 * then an impact animation at the target.
 *
 * Components:
 * - shoot (DefineSprite_9_shoot): Main animation at caster, rotated toward target
 *   - Contains DefineSprite_8 (impact) which stops at frame 64
 *   - Contains DefineSprite_10_move (projectile) with wobble rotation:
 *     _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1
 *
 * Original AS timing:
 * - DefineSprite_10_move: wobble rotation per frame (a=30, i+=0.6, a/=1.1)
 * - DefineSprite_8: wobble rotation per frame (a=10, i+=PI, a/=1.5), stop at frame 64
 * - DefineSprite_9_shoot frame 91: removeMovieClip (animation ends)
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
  width: 37.25,
  height: 33.35,
  offsetX: -30.75,
  offsetY: -17.6,
};

export class Spell2106 extends BaseSpell {
  readonly spellId = 2106;

  // Wobble state for DefineSprite_10_move
  private moveA = 30;
  private moveI = 0;

  // Wobble state for DefineSprite_8
  private impactA = 10;
  private impactI = 0;

  // Separate container for the wobbling projectile sprite
  private moveContainer!: Container;
  // Separate container for the impact sprite
  private impactContainer!: Container;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    // Main shoot animation at caster position, rotated toward target
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Frame 91 (0-indexed: 90) -> removeMovieClip = complete
    this.shootAnim.onFrame(90, () => this.signalHit());

    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;
    this.container.addChild(this.shootAnim.sprite);

    // Wobble containers - positioned at caster, rotated with shoot
    this.moveContainer = new Container();
    this.moveContainer.position.set(0, init.casterY);
    this.moveContainer.rotation = init.angleRad;
    this.container.addChild(this.moveContainer);

    this.impactContainer = new Container();
    this.impactContainer.position.set(0, init.casterY);
    this.impactContainer.rotation = init.angleRad;
    this.container.addChild(this.impactContainer);

    // Reset wobble state
    this.moveA = 30;
    this.moveI = 0;
    this.impactA = 10;
    this.impactI = 0;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update DefineSprite_10_move wobble rotation each frame
    // AS: _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1;
    this.moveI += 0.6;
    this.moveContainer.rotation = ((90 + this.moveA * Math.cos(this.moveI)) * Math.PI) / 180;
    this.moveA /= 1.1;

    // Update DefineSprite_8 wobble rotation each frame (until frame 64)
    // AS: _rotation = 90 + a * Math.cos(i += 3.1415); a /= 1.5;
    if (!this.shootAnim.isComplete()) {
      this.impactI += 3.1415;
      this.impactContainer.rotation = ((90 + this.impactA * Math.cos(this.impactI)) * Math.PI) / 180;
      this.impactA /= 1.5;
    }

    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
