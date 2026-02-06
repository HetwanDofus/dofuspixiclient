/**
 * Spell 208 - Projectile Spell
 *
 * A projectile spell that travels while leaving smoke trail and spawning debris.
 *
 * Components:
 * - shoot: Main projectile animation at caster position, rotated toward target
 * - fumee: Smoke particles spawned along movement path
 * - plumes: Feathers spawned immediately at cast
 * - pierres: Stone debris spawned based on level (level * 3 stones)
 *
 * Original AS timing:
 * - Frame 1: Spawn plumes, start spawning pierres
 * - Continuous: Create fumee along movement path
 * - Frame 97: Animation complete
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 612,
  height: 612,
  offsetX: -318,
  offsetY: -562.2,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 120.89999999999999,
  height: 106.80000000000001,
  offsetX: -64.19999999999999,
  offsetY: -52.800000000000004,
};

const PLUMES_MANIFEST: SpriteManifest = {
  width: 130.5,
  height: 39.900000000000006,
  offsetX: -84,
  offsetY: -206.70000000000002,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 96.89999999999999,
  height: 123,
  offsetX: -48.900000000000006,
  offsetY: -51.599999999999994,
};

interface PlumeParticle {
  sprite: Sprite;
  vx: number;
  vy: number;
  vr: number;
  vch: number;
  amp: number;
  a: number;
  counter: number;
  duration: number;
}

interface PierreParticle {
  sprite: Sprite;
  vx: number;
  vy: number;
  vr: number;
  ang: number;
  m: number;
  counter: number;
  duration: number;
}

interface MovementTracker {
  xi: number;
  yi: number;
  counter: number;
}

export class Spell208 extends BaseSpell {
  readonly spellId = 208;

  private shootAnim!: FrameAnimatedSprite;
  private shootContainer!: Container;
  private moveContainer!: Container;
  
  private plumes: PlumeParticle[] = [];
  private pierres: PierreParticle[] = [];
  private fumeeAnims: FrameAnimatedSprite[] = [];
  
  private movement!: MovementTracker;
  private pierresCreated = 0;
  private maxPierres = 0;
  private level = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.maxPierres = this.level * 3;
    
    // Main shoot container with rotation
    this.shootContainer = new Container();
    this.shootContainer.rotation = -init.angleRad; // AS: _rotation = -_parent.angle
    this.container.addChild(this.shootContainer);
    
    // Inner container that scales
    const innerContainer = new Container();
    innerContainer.scale.set(0.6); // AS: _xscale = _yscale = 60
    this.shootContainer.addChild(innerContainer);
    
    // Movement tracking container
    this.moveContainer = new Container();
    this.movement = { xi: 0, yi: 0, counter: 0 };
    innerContainer.addChild(this.moveContainer);
    
    // Shoot animation
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    innerContainer.addChild(this.shootAnim.sprite);
    
    // Create plumes immediately
    this.createPlumes(textures.getFrames('lib_plumes')[0] ?? Texture.EMPTY, init.scale);
    
    // Pierre texture for later use
    this.pierreTexture = textures.getFrames('lib_pierres')[0] ?? Texture.EMPTY;
    this.pierreScale = init.scale;
    
    // Fumee texture for movement trail
    this.fumeeTextures = textures.getFrames('lib_fumee');
    this.fumeeScale = init.scale;
  }
  
  private pierreTexture!: Texture;
  private pierreScale!: number;
  private fumeeTextures!: Texture[];
  private fumeeScale!: number;

  private createPlumes(texture: Texture, scale: number): void {
    for (let i = 0; i < 10; i++) {
      const sprite = new Sprite(texture);
      const anchor = calculateAnchor(PLUMES_MANIFEST);
      sprite.anchor.set(anchor.x, anchor.y);
      
      const scaleValue = 0.4 + 0.6 * Math.random();
      sprite.scale.set(scaleValue * scale);
      
      const plume: PlumeParticle = {
        sprite,
        vx: 40 * (Math.random() - 0.5),
        vy: -5 - 15 * Math.random(),
        vr: Math.random() / 20,
        vch: 0.2 + 0.3 * Math.random(),
        amp: 10 + 20 * Math.random(),
        a: 0,
        counter: 0,
        duration: 40 + Math.floor(Math.random() * 30)
      };
      
      this.plumes.push(plume);
      this.moveContainer.addChild(sprite);
    }
  }

  private createPierres(): void {
    const toCreate = Math.min(2, this.maxPierres - this.pierresCreated);
    
    for (let i = 0; i < toCreate; i++) {
      const sprite = new Sprite(this.pierreTexture);
      const anchor = calculateAnchor(PIERRES_MANIFEST);
      sprite.anchor.set(anchor.x, anchor.y);
      
      const scaleValue = 0.6 + 0.4 * Math.random();
      sprite.scale.set(scaleValue * this.pierreScale);
      
      const pierre: PierreParticle = {
        sprite,
        vx: 15 * (Math.random() - 0.5),
        vy: 15 * (Math.random() - 0.5),
        vr: 60 * (-0.5 + Math.random()),
        ang: 6.28 * Math.random(),
        m: 0,
        counter: 0,
        duration: 30 + Math.floor(Math.random() * 30)
      };
      
      this.pierres.push(pierre);
      this.moveContainer.addChild(sprite);
      this.pierresCreated++;
    }
  }

  private createFumee(dx: number, dy: number): void {
    const fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);
    const fumee = new FrameAnimatedSprite({
      textures: this.fumeeTextures,
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      scale: this.fumeeScale,
    });

    fumee.sprite.rotation = 6.28 * Math.random();
    fumee.sprite.position.set(
      this.movement.xi + dx,
      this.movement.yi + dy
    );

    fumee.onFrame(7, () => {
      fumee.gotoFrame(Math.floor(Math.random() * 20));
    });
    
    fumee.onFrame(35, () => {
      const index = this.fumeeAnims.indexOf(fumee);
      if (index !== -1) {
        this.fumeeAnims.splice(index, 1);
      }
      fumee.sprite.parent?.removeChild(fumee.sprite);
      fumee.destroy();
    });
    
    this.fumeeAnims.push(fumee);
    this.anims.add(fumee);
    this.moveContainer.addChild(fumee.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update movement and create particles
    if (this.shootAnim.getFrame() < 96) {
      this.updateMovement();
      this.updatePlumes();
      this.updatePierres();
    }
    
    // Check completion
    if (this.shootAnim.getFrame() >= 96) {
      this.complete();
    }
  }

  private updateMovement(): void {
    this.movement.counter++;
    
    // Create pierres in first frames
    if (this.pierresCreated < this.maxPierres && this.movement.counter % 1 === 0) {
      this.createPierres();
    }
    
    // Update movement tracking
    const oldXi = this.movement.xi;
    const oldYi = this.movement.yi;
    
    // Oscillating movement
    const oscillation = Math.sin(this.movement.counter * 0.1) * 5;
    this.moveContainer.scale.set(
      0.8 + 0.2 * Math.sin(this.movement.counter * 0.15),
      0.8 + 0.2 * Math.sin(this.movement.counter * 0.15)
    );
    
    // Update position (simulating movement)
    this.movement.xi += 5;
    this.movement.yi += oscillation * 0.5;
    
    // Create fumee along path
    if (this.movement.counter % 3 === 0) {
      const dx = (this.movement.xi - oldXi) + 10 * (Math.random() - 0.5);
      const dy = (this.movement.yi - oldYi) + 10 * (Math.random() - 0.5);
      this.createFumee(dx, dy);
    }
  }

  private updatePlumes(): void {
    for (let i = this.plumes.length - 1; i >= 0; i--) {
      const plume = this.plumes[i];
      plume.counter++;
      
      if (plume.sprite.position.y < 0) {
        plume.vy += plume.vch;
        plume.vx *= 0.9;
        plume.vy *= 0.9;
        
        plume.sprite.position.x += plume.vx;
        plume.sprite.position.y += plume.vy;
        
        plume.a += plume.vr;
        plume.sprite.rotation = plume.amp * Math.cos(plume.a);
      }
      
      if (plume.counter >= plume.duration) {
        plume.sprite.alpha -= 0.1;
        
        if (plume.sprite.alpha <= 0.1) {
          plume.sprite.parent?.removeChild(plume.sprite);
          plume.sprite.destroy();
          this.plumes.splice(i, 1);
        }
      }
    }
  }

  private updatePierres(): void {
    for (let i = this.pierres.length - 1; i >= 0; i--) {
      const pierre = this.pierres[i];
      pierre.counter++;
      
      pierre.sprite.rotation += pierre.vr * Math.PI / 180;
      
      if (pierre.counter < pierre.duration) {
        pierre.vx /= 1.2;
        pierre.vy /= 1.2;
      } else {
        pierre.vx *= 1.2;
        pierre.vy *= 1.2;
        pierre.m = 1.2;
        
        const dx = pierre.sprite.position.x;
        const dy = pierre.sprite.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 0) {
          pierre.vx = (dx / dist) * pierre.m * 10;
          pierre.vy = (dy / dist) * pierre.m * 10;
        }
      }
      
      pierre.sprite.position.x += pierre.vx;
      pierre.sprite.position.y += pierre.vy;
      
      if (pierre.counter >= pierre.duration + 10) {
        pierre.sprite.alpha -= 0.1;
        
        if (pierre.sprite.alpha <= 0.1) {
          pierre.sprite.parent?.removeChild(pierre.sprite);
          pierre.sprite.destroy();
          this.pierres.splice(i, 1);
        }
      }
    }
  }

  destroy(): void {
    // Clean up plumes
    for (const plume of this.plumes) {
      plume.sprite.destroy();
    }
    this.plumes = [];
    
    // Clean up pierres
    for (const pierre of this.pierres) {
      pierre.sprite.destroy();
    }
    this.pierres = [];
    
    // Clean up fumee
    for (const fumee of this.fumeeAnims) {
      fumee.destroy();
    }
    this.fumeeAnims = [];
    
    super.destroy();
  }
}