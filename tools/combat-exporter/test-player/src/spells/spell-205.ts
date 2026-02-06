/**
 * Spell 205 - Crockette
 *
 * A homing projectile spell with complex physics and rotation effects.
 * Projectile starts with random movement, accelerates toward target with increasing force.
 *
 * Components:
 * - Projectile (sprite_22): Main animated projectile with 3D rotation illusion
 * - Impact (sprite_18): Impact effect at target position
 * - Body parts (sprite_9, sprite_15): Rotating elements creating 3D effect
 *
 * Original AS timing:
 * - Frame 2: Play "crockette_205" sound
 * - Frame 37: Increase acceleration from 0.17 to 0.25
 * - Frame 67: Impact - snap to target, play "pose" sound
 * - Frame 70: Signal hit (this.end())
 * - Frame 121: Remove movieclip
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const PROJECTILE_MANIFEST: SpriteManifest = {
  width: 415.2,
  height: 1055.4,
  offsetX: -199.8,
  offsetY: -1033.8,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 406.8,
  height: 406.8,
  offsetX: -199.8,
  offsetY: -218.1,
};

const BODY_MANIFEST: SpriteManifest = {
  width: 174.6,
  height: 65.7,
  offsetX: -84.9,
  offsetY: -74.1,
};

export class Spell205 extends BaseSpell {
  readonly spellId = 205;

  private projectileAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private bodyContainer!: Container;
  
  // Physics state
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private acc = 0.17;
  private frott = 0.96;
  private anglepos = 0;
  private fin = 0;
  
  // Animation state
  private t = 0;
  private pm = 0;
  private ticks = 0;
  private wobbleAmp = 30;
  private wobbleI = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main projectile animation
    this.projectileAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      ...calculateAnchor(PROJECTILE_MANIFEST),
      scale: init.scale,
    }));
    
    // Create body container for rotating elements
    this.bodyContainer = new Container();
    this.projectileAnim.sprite.addChild(this.bodyContainer);
    
    // Add body sprite (sprite_15) with rotating parts
    const bodySprite = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_15'),
      ...calculateAnchor(BODY_MANIFEST),
      scale: 1,
      loop: true,
    });
    this.bodyContainer.addChild(bodySprite.sprite);
    
    // Position at caster
    this.px = 0;
    this.py = init.casterY;
    this.projectileAnim.sprite.position.set(this.px, this.py);
    
    // Random initial velocity
    this.vx = Math.floor(Math.random() * 10) - 5;
    this.vy = Math.floor(Math.random() * 10) - 5;
    
    // Calculate angle to target
    this.anglepos = Math.atan2(init.targetY - this.py, init.targetX - this.px);
    
    // Frame callbacks
    this.projectileAnim
      .onFrame(1, () => this.callbacks.playSound('crockette_205'))
      .onFrame(36, () => {
        this.acc = 0.25;
      })
      .onFrame(66, () => {
        this.callbacks.playSound('pose');
        this.fin = 1;
        this.px = init.targetX;
        this.py = init.targetY;
        this.projectileAnim.sprite.position.set(this.px, this.py);
      })
      .onFrame(69, () => {
        this.signalHit();
        this.setupWobble();
      })
      .onFrame(120, () => {
        this.complete();
      });
    
    this.container.addChild(this.projectileAnim.sprite);
    
    // Impact animation at target
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_18'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
      startFrame: 66,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim.stopAt(78);
    this.container.addChild(this.impactAnim.sprite);
  }

  private setupWobble(): void {
    this.wobbleAmp = 30;
    this.wobbleI = 0;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update physics before frame 67
    if (this.fin === 0) {
      this.updatePhysics();
      this.ticks++;
      
      // Check for phase transition at 90 ticks
      if (this.ticks === 90) {
        this.projectileAnim.gotoAndPlay(3);
        this.frott = 0.4;
        this.acc = 1.0;
      }
    }
    
    // Update rotation effects
    this.updateRotation();
    
    // Update wobble after impact
    if (this.projectileAnim.currentFrame >= 70) {
      this.updateWobble();
    }
  }

  private updatePhysics(): void {
    const targetX = this.container.position.x + (this.context?.cellTo?.x ?? 0) - (this.context?.cellFrom?.x ?? 0);
    const targetY = this.container.position.y + (this.context?.cellTo?.y ?? 0) - (this.context?.cellFrom?.y ?? 0);
    
    // Apply acceleration toward target
    if (this.px < targetX) {
      this.vx += this.acc;
    } else {
      this.vx -= this.acc;
    }
    
    if (this.py < targetY) {
      this.vy += this.acc;
    } else {
      this.vy -= this.acc;
    }
    
    // Apply friction
    this.vx *= this.frott;
    this.vy *= this.frott;
    
    // Update position
    this.px += this.vx;
    this.py += this.vy;
    
    // Update angle to target
    this.anglepos = Math.atan2(targetY - this.py, targetX - this.px);
    
    // Apply position
    this.projectileAnim.sprite.position.set(this.px, this.py);
  }

  private updateRotation(): void {
    // Oscillating movement
    this.t += 0.4;
    const an = 0.3 * Math.sin(this.t) + this.anglepos + Math.PI;
    
    // Vertical bobbing
    this.pm += 0.1;
    const ym = this.projectileAnim.sprite.y;
    this.projectileAnim.sprite.y = ym + 10 * Math.cos(this.pm);
    
    // Rotation wobble
    this.projectileAnim.sprite.rotation = 3.34 * Math.sin(this.t * 1.2);
    
    // Update body rotation for 3D effect
    if (this.bodyContainer) {
      this.bodyContainer.rotation = an - this.anglepos - Math.PI;
    }
  }

  private updateWobble(): void {
    if (this.wobbleAmp <= 0) {
      return;
    }
    
    this.wobbleI += Math.PI;
    this.projectileAnim.sprite.rotation = this.wobbleAmp * Math.cos(this.wobbleI);
    this.wobbleAmp *= 0.8;
    
    if (this.wobbleAmp < 0.1) {
      this.wobbleAmp = 0;
      this.projectileAnim.sprite.rotation = 0;
    }
  }
}