/**
 * Spell 2012 - Unknown Projectile Spell
 *
 * A projectile spell with initial smoke burst and continuous trail particles.
 *
 * Components:
 * - shoot: Main projectile animation at caster position
 * - fumee2: Initial burst smoke particles (7 particles)
 * - fumee: Trail smoke particles (5 per frame while moving)
 *
 * Original AS timing:
 * - Frame 1: Spawn 7 initial smoke particles
 * - Frame 1-73: Continuous trail particle spawning
 * - Frame 73: Spell ends
 */

import { Texture, Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 796.8,
  height: 532.5,
  offsetX: -464.4,
  offsetY: -451.2,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 79.5,
  height: 49.5,
  offsetX: -50.7,
  offsetY: -43.8,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 12,
  height: 12.3,
  offsetX: -1.8,
  offsetY: -3.3,
};

export class Spell2012 extends BaseSpell {
  readonly spellId = 2012;

  private shootAnim!: FrameAnimatedSprite;
  private fumee2Particles!: ASParticleSystem;
  private fumeeParticles!: ASParticleSystem;
  private moveContainer!: Container;
  private rotatingElement!: Container;
  private randomRotationElement!: Container;
  private rotationSpeed = 0;
  private previousX = 0;
  private previousY = 0;
  private particleCounter = 5;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = 0;
    this.container.addChild(this.shootAnim.sprite);

    // Movement container (DefineSprite_6_move)
    this.moveContainer = new Container();
    this.container.addChild(this.moveContainer);

    // Rotating element with fixed speed (75 degrees per frame)
    this.rotatingElement = new Container();
    this.moveContainer.addChild(this.rotatingElement);

    // Random rotation element (DefineSprite_7)
    this.randomRotationElement = new Container();
    this.rotationSpeed = -200 + Math.floor(Math.random() * 400);
    this.moveContainer.addChild(this.randomRotationElement);

    // Initial smoke particles (fumee2)
    const fumee2Texture = textures.getFrames('lib_fumee2')[0] ?? Texture.EMPTY;
    this.fumee2Particles = new ASParticleSystem(fumee2Texture);
    this.container.addChild(this.fumee2Particles.container);

    // Trail smoke particles (fumee)
    const fumeeTexture = textures.getFrames('lib_fumee')[0] ?? Texture.EMPTY;
    this.fumeeParticles = new ASParticleSystem(fumeeTexture);
    this.container.addChild(this.fumeeParticles.container);

    // Store initial position
    this.previousX = 0;
    this.previousY = init.casterY;

    // Spawn initial burst particles
    this.spawnInitialBurst(init);
  }

  private spawnInitialBurst(init: SpellInitContext): void {
    for (let counter = 0; counter < 7; counter++) {
      this.fumee2Particles.spawn({
        x: 0,
        y: init.casterY - 30,
        vx: 5 * (Math.random() - 0.5),
        vy: -7 * Math.random(),
        accY: 0.5,
        t: 49,
      });
    }
  }

  private spawnTrailParticles(): void {
    const currentX = this.shootAnim.sprite.position.x;
    const currentY = this.shootAnim.sprite.position.y;
    
    const deltaX = currentX - this.previousX;
    const deltaY = currentY - this.previousY;

    for (let i = 0; i < 5; i++) {
      const vxDivider = 3 + 3 * Math.random();
      const vyDivider = 3 + Math.floor(Math.random() * 3);
      
      this.fumeeParticles.spawn({
        x: currentX,
        y: currentY,
        vx: (deltaX + 6.67 * (Math.random() - 0.5)) / vxDivider,
        vy: (deltaY + 6.67 * (Math.random() - 0.5)) / vyDivider,
        t: 46,
      });
      this.particleCounter++;
    }

    this.previousX = currentX;
    this.previousY = currentY;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update rotating elements
    const frameProgress = deltaTime / (1000 / 60);
    this.rotatingElement.rotation += (75 * Math.PI / 180) * frameProgress;
    this.randomRotationElement.rotation += (this.rotationSpeed * Math.PI / 180) * frameProgress;
    
    // Spawn trail particles if moving
    if (this.shootAnim.currentFrame > 0 && this.shootAnim.currentFrame < 72) {
      this.spawnTrailParticles();
    }
    
    // Update particle systems
    this.fumee2Particles.update();
    this.fumeeParticles.update();

    // Check completion at frame 73
    if (this.shootAnim.currentFrame >= 72) {
      this.complete();
    }
  }

  destroy(): void {
    this.fumee2Particles.destroy();
    this.fumeeParticles.destroy();
    super.destroy();
  }
}