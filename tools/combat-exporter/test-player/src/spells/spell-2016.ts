/**
 * Spell 2016 - Unknown
 *
 * A projectile spell with trail particles that moves and spawns circles.
 *
 * Components:
 * - shoot: Main animation (159 frames) with alpha fade after frame 130
 * - move: Projectile that spawns circle particles as it moves
 * - cercle: Trail particles with physics and alpha fade
 *
 * Original AS timing:
 * - Frame 1: Play sound "setag_305"
 * - Frame 130: Start alpha fade (alpha -= 10 per frame)
 * - Frame 157: Signal hit and remove
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 540.9000000000001,
  height: 377.1,
  offsetX: -150,
  offsetY: -364.5,
};

const CERCLE_MANIFEST: SpriteManifest = {
  width: 148.5,
  height: 62.699999999999996,
  offsetX: -66.9,
  offsetY: -57,
};

interface CircleParticle {
  sprite: Sprite;
  vx: number;
  vy: number;
  va: number;
  r: number;
}

export class Spell2016 extends BaseSpell {
  readonly spellId = 2016;

  private shootAnim!: FrameAnimatedSprite;
  private circles: CircleParticle[] = [];
  private circleTexture!: Texture;
  private circleCount = 33;
  private lastX = 0;
  private lastY = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Get circle texture for particles
    this.circleTexture = textures.getFrames('lib_cercle')[0] ?? Texture.EMPTY;

    // Main shoot animation
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim
      .onFrame(0, () => {
        this.callbacks.playSound('setag_305');
        // Initialize move tracking
        this.lastX = 0;
        this.lastY = init.casterY;
      })
      .onFrame(156, () => this.signalHit());
    
    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Handle alpha fade starting at frame 130
    if (this.shootAnim.getFrame() >= 129) {
      this.shootAnim.sprite.alpha -= 0.1;
      if (this.shootAnim.sprite.alpha < 0) {
        this.shootAnim.sprite.alpha = 0;
      }
    }

    // Spawn circle particles based on movement
    // In the AS, the "move" sprite tracks position changes and spawns circles
    // Since we don't have explicit movement data, we'll simulate spawning circles during the animation
    if (this.shootAnim.getFrame() > 0 && this.shootAnim.getFrame() < 130) {
      // Calculate velocity based on position change (simulated movement)
      const currentX = this.shootAnim.sprite.x;
      const currentY = this.shootAnim.sprite.y;
      const vx = currentX - this.lastX;
      const vy = currentY - this.lastY;

      // Only spawn if there's movement (in real spell, move sprite handles this)
      if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
        this.spawnCircle(currentX, currentY - 20, vx, vy);
      }

      this.lastX = currentX;
      this.lastY = currentY;
    }

    // Update circle particles
    for (let i = this.circles.length - 1; i >= 0; i--) {
      const circle = this.circles[i];
      
      // Apply alpha fade
      circle.sprite.alpha -= circle.va;
      
      // Remove if alpha < 10
      if (circle.sprite.alpha < 0.1) {
        circle.sprite.destroy();
        this.circles.splice(i, 1);
        continue;
      }

      // Update position with velocity
      circle.sprite.x += circle.vx;
      circle.sprite.y += circle.vy;

      // Apply decay
      circle.vx /= circle.r;
      circle.vy /= circle.r;
    }

    // Check completion
    if (this.shootAnim.getFrame() >= 156) {
      this.complete();
    }
  }

  private spawnCircle(x: number, y: number, vx: number, vy: number): void {
    // Create circle sprite (DefineSprite_18_cercle)
    const sprite = new Sprite(this.circleTexture);
    
    // Apply manifest anchor
    sprite.anchor.set(
      -CERCLE_MANIFEST.offsetX / CERCLE_MANIFEST.width,
      -CERCLE_MANIFEST.offsetY / CERCLE_MANIFEST.height
    );

    // From AS: va = 2 - random(1.5)
    const va = 2 - Math.random() * 1.5;
    
    // From AS: t = 60 + random(70)
    const t = 60 + Math.floor(Math.random() * 70);
    
    // From AS: _alpha = 70 + random(30)
    const alpha = 70 + Math.floor(Math.random() * 30);
    
    // From AS: r = 1.05 + 0.5 * Math.random()
    const r = 1.05 + 0.5 * Math.random();

    // From AS: vr = random(33) + 17
    const vr = Math.floor(Math.random() * 33) + 17;
    
    // From AS: _rotation = random(360)
    sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

    // Apply initial properties
    sprite.scale.set((t / 100) * (1 / 6), (t / 100) * (1 / 6));
    sprite.alpha = alpha / 100;
    sprite.position.set(x, y);

    // Add to container at index 0 (behind main animation)
    this.container.addChildAt(sprite, 0);

    // Store particle data
    this.circles.push({
      sprite,
      vx,
      vy,
      va: va / 100, // Convert to 0-1 range
      r,
    });

    this.circleCount++;
  }

  destroy(): void {
    // Clean up circles
    for (const circle of this.circles) {
      circle.sprite.destroy();
    }
    this.circles = [];
    
    super.destroy();
  }
}