/**
 * Spell 2070 - Multi-projectile homing spell
 *
 * Launches 4 energy projectiles that move erratically before homing in on targets.
 *
 * Components:
 * - sprite_3: Main animation container with 4 embedded projectiles
 *
 * Original AS timing:
 * - Frame 1: Initial stop
 * - Frame 25: Stop animation
 * - Frame 55: Start fade out (alpha -= 3 per frame)
 * - Frame 91: Stop and cleanup
 * - Projectile timings: 45, 55, 65, 75 frames before homing
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_MANIFEST: SpriteManifest = {
  width: 846.6,
  height: 846.6,
  offsetX: -453.3,
  offsetY: -425.7,
};

interface Projectile {
  x: number;
  y: number;
  angle: number;
  angle2: number;
  vr: number;
  v: number;
  v2: number;
  t: number;
  fin: number;
  vx: number;
  vy: number;
  homingDelay: number;
  baseVelocity: number;
  initialVrRange: number;
  targetFirst: boolean;
}

export class Spell2070 extends BaseSpell {
  readonly spellId = 2070;

  private mainAnim!: FrameAnimatedSprite;
  private projectiles: Projectile[] = [];
  private targetA = { x: 0, y: 0 };
  private targetB = { x: 0, y: 0 };
  private fadeStarted = false;
  private fadeAlpha = 100;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_3'),
      ...calculateAnchor(SPRITE_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(0, 0);
    this.mainAnim
      .stopAt(0)
      .onFrame(24, () => this.mainAnim.stopAt(24))
      .onFrame(54, () => {
        this.fadeStarted = true;
      })
      .onFrame(90, () => {
        this.mainAnim.stop();
      });
    this.container.addChild(this.mainAnim.sprite);

    // Set up targets
    this.targetA.x = init.targetX * 0.5;
    this.targetA.y = init.targetY * 0.5;
    this.targetB.x = init.targetX;
    this.targetB.y = init.targetY;

    // Initialize 4 projectiles with their specific parameters
    const cellFromX = 0;
    const cellFromY = init.casterY;

    // Projectile 1 (PlaceObject2_3_1)
    this.projectiles.push({
      x: cellFromX,
      y: cellFromY - 140,
      angle: -90,
      angle2: -90,
      vr: (-0.5 + Math.random()) * 20,
      v: 10,
      v2: 10,
      t: 0,
      fin: 0,
      vx: 0,
      vy: 0,
      homingDelay: 45,
      baseVelocity: 23,
      initialVrRange: 20,
      targetFirst: false,
    });

    // Projectile 2 (PlaceObject2_3_5)
    this.projectiles.push({
      x: cellFromX,
      y: cellFromY - 140,
      angle: -90,
      angle2: -90,
      vr: (-0.5 + Math.random()) * 30,
      v: 10,
      v2: 10,
      t: 0,
      fin: 0,
      vx: 0,
      vy: 0,
      homingDelay: 55,
      baseVelocity: 30,
      initialVrRange: 30,
      targetFirst: true,
    });

    // Projectile 3 (PlaceObject2_3_7)
    this.projectiles.push({
      x: cellFromX,
      y: cellFromY - 140,
      angle: -90,
      angle2: -90,
      vr: (-0.5 + Math.random()) * 30,
      v: 10,
      v2: 10,
      t: 0,
      fin: 0,
      vx: 0,
      vy: 0,
      homingDelay: 65,
      baseVelocity: 30,
      initialVrRange: 30,
      targetFirst: true,
    });

    // Projectile 4 (PlaceObject2_3_9)
    this.projectiles.push({
      x: cellFromX,
      y: cellFromY - 140,
      angle: -90,
      angle2: -90,
      vr: (-0.5 + Math.random()) * 30,
      v: 10,
      v2: 10,
      t: 0,
      fin: 0,
      vx: 0,
      vy: 0,
      homingDelay: 75,
      baseVelocity: 30,
      initialVrRange: 30,
      targetFirst: true,
    });

    // Start animation at frame 2
    this.mainAnim.gotoAndPlay(1);
  }

  private updateProjectile(proj: Projectile): void {
    if (proj.fin === 0) {
      // Random direction changes
      if (Math.floor(Math.random() * 9) === 0) {
        proj.vr = (-0.5 + Math.random()) * 40;
      }

      // Check if homing should start
      if (proj.t++ > proj.homingDelay) {
        const target = proj.targetFirst ? this.targetA : this.targetB;
        proj.angle = Math.atan2(target.y - proj.y, target.x - proj.x) * 180 / Math.PI;
        proj.vr = (-0.5 + Math.random()) * 15;
        
        // Special case for projectiles 2-4: set v = 1 after homing starts
        if (proj.targetFirst) {
          proj.v = 1;
        }
      }

      // Velocity calculations
      proj.v = proj.baseVelocity - Math.abs(proj.vr) * 0.5;
      proj.v2 -= (proj.v2 - proj.v) / 3;
      proj.v /= 2;
      proj.v2 /= 2;
      proj.angle += proj.vr;
      proj.angle2 -= (proj.angle2 - proj.angle) / 2;

      // Calculate movement
      proj.vx = proj.v2 * 2 * Math.cos(proj.angle2 * Math.PI / 180);
      proj.vy = proj.v2 * Math.sin(proj.angle2 * Math.PI / 180);
    }

    // Check for hit on target B
    if (Math.abs(this.targetB.y - proj.y) < 20 && Math.abs(this.targetB.x - proj.x) < 20 && proj.fin === 0) {
      proj.fin = 1;
      proj.vx = 0;
      proj.vy = 0;
      // Signal hit when first projectile hits
      if (!this.hitSignaled) {
        this.signalHit();
      }
    }

    if (proj.fin === 1) {
      proj.fin = 2;
      proj.vx = 0;
      proj.vy = 0;
    }

    // Update position
    proj.x += proj.vx;
    proj.y += proj.vy;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update projectiles
    for (const proj of this.projectiles) {
      this.updateProjectile(proj);
    }

    // Handle fade out
    if (this.fadeStarted) {
      this.fadeAlpha -= 3 * (deltaTime / 16.67);
      if (this.fadeAlpha < 0) {
        this.fadeAlpha = 0;
      }
      this.container.alpha = this.fadeAlpha / 100;
    }

    // Check completion
    if (this.mainAnim.currentFrame >= 90) {
      this.complete();
    }
  }
}