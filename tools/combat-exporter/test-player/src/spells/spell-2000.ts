/**
 * Spell 2000 - Unknown
 *
 * A guided projectile spell that follows a multi-phase trajectory.
 *
 * Components:
 * - Projectile (sprite_13): Guided projectile with dynamic scaling and rotation
 *
 * Original AS timing:
 * - Frame 1: Play sound wab_2000a
 * - Frame 2: Stop main timeline, spawn projectile
 * - Frame 21: Projectile moves to 1/6 distance with random offset
 * - Frame 42: Projectile moves to target -100y
 * - Frame 63: Projectile moves to target +50y
 * - Frame 66: End animation (gotoAndStop(3))
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const PROJECTILE_MANIFEST: SpriteManifest = {
  width: 461.1,
  height: 305.4,
  offsetX: -231.6,
  offsetY: -173.1,
};

export class Spell2000 extends BaseSpell {
  readonly spellId = 2000;

  private projectileAnim!: FrameAnimatedSprite;
  private projectileContainer!: Container;
  
  // Movement state
  private px = 0;
  private py = 0;
  private t = 0;
  private vx = 0;
  private vy = 0;
  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play initial sound (frame 1)
    this.callbacks.playSound('wab_2000a');

    // Initialize positions from cells
    this.x1 = 0;
    this.y1 = 0;
    this.x2 = init.targetX;
    this.y2 = init.targetY;

    // Create projectile container
    this.projectileContainer = new Container();
    this.projectileContainer.position.set(this.x1, this.y1 - 70);
    this.px = this.x1;
    this.py = this.y1 - 120;
    this.container.addChild(this.projectileContainer);

    // Create projectile animation (sprite_13)
    const anchor = calculateAnchor(PROJECTILE_MANIFEST);
    this.projectileAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_13'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    
    // Set initial scale (boule._yscale = 200; boule._xscale = 50;)
    this.projectileAnim.sprite.scale.y = 2;
    this.projectileAnim.sprite.scale.x = 0.5;
    
    // Play projectile sound (DefineSprite_13 frame 1)
    this.projectileAnim.onFrame(0, () => {
      this.callbacks.playSound('wab_2000b');
      // Signal hit immediately (this.end())
      this.signalHit();
    });
    
    // Stop at frame 39 (AS frame 40)
    this.projectileAnim.stopAt(39);
    
    this.projectileContainer.addChild(this.projectileAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update animations
    this.anims.update(deltaTime);

    // Update projectile movement
    this.updateProjectileMovement();

    // Check if projectile animation is complete
    if (this.projectileAnim.isComplete()) {
      this.complete();
    }
  }

  private updateProjectileMovement(): void {
    // Increment frame counter
    this.t++;

    // Phase transitions (exact AS logic)
    if (this.t === 21) {
      this.px = this.x1 + (this.x2 - this.x1) / 6 + (-0.5 + Math.random()) * 100;
      this.py = this.y1 + (this.y2 - this.y1) / 6 + (-0.5 + Math.random()) * 50 - 50;
    }
    
    if (this.t === 42) {
      this.px = this.x2;
      this.py = this.y2 - 100;
    }
    
    if (this.t === 63) {
      this.px = this.x2;
      this.py = this.y2 + 50;
    }
    
    if (this.t === 66) {
      // AS: _parent.gotoAndStop(3) - end the animation
      this.complete();
      return;
    }

    // Calculate velocity (exact AS formulas)
    this.vx = (-(this.projectileContainer.position.x - this.px)) / 9;
    this.vy = (-(this.projectileContainer.position.y - this.py)) / 9;
    let v = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    
    // Rotation (AS: _rotation = Math.atan2(vy,vx) * 57.29746936176985)
    this.projectileContainer.rotation = Math.atan2(this.vy, this.vx);
    
    // Velocity cap
    if (v > 6) {
      v = 6;
    }
    
    // Dynamic scaling based on velocity (boule._xscale = 100 + 3 * v; boule._yscale = 100 - 3 * v)
    this.projectileAnim.sprite.scale.x = (100 + 3 * v) / 100;
    this.projectileAnim.sprite.scale.y = (100 - 3 * v) / 100;
    
    // Update position
    this.projectileContainer.position.x += this.vx;
    this.projectileContainer.position.y += this.vy;
  }
}