import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import { FrameAnimatedSprite, calculateAnchor, type SpriteManifest } from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 1050 - Blood Fountain (Sacrieur)
 *
 * A blood-based spell that creates a fountain of blood drops at the caster position.
 *
 * Components:
 * - sprite_7: Main 78-frame animation
 * - sprite_4/sprite_5 (goutte): Blood drop animations (19 instances)
 *
 * Original AS timing:
 * - Frame 1: Spawn 19 blood drops, play sound "sacrieur_1050"
 * - Frame 43: Signal hit (this.end())
 * - Frame 49: Play sound "sacrieur_1050b"
 * - Frame 76: Animation ends
 */
export class Spell1050 extends BaseSpell {
  readonly spellId = 1050;

  private mainAnim!: FrameAnimatedSprite;
  private bloodDrops: BloodDrop[] = [];
  private bloodDropContainer!: Container;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation (sprite_7)
    const mainSprite: SpriteManifest = { width: 1, height: 1, offsetX: 0, offsetY: 0 };
    const anchor = calculateAnchor(mainSprite);
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_7'),
        scale: init.scale,
        anchorX: anchor.x,
        anchorY: anchor.y,
      })
    );
    
    this.mainAnim.sprite.position.set(0, init.casterY);
    
    // Set up frame events
    this.mainAnim
      .onFrame(0, () => {
        this.callbacks.playSound('sacrieur_1050');
        this.spawnBloodDrops(textures, init);
      })
      .onFrame(42, () => this.signalHit())
      .onFrame(48, () => this.callbacks.playSound('sacrieur_1050b'))
      .stopAt(75);
    
    this.container.addChild(this.mainAnim.sprite);
    
    // Container for blood drops (behind main animation)
    this.bloodDropContainer = new Container();
    this.bloodDropContainer.position.set(0, init.casterY);
    this.container.addChildAt(this.bloodDropContainer, 0);
  }

  private spawnBloodDrops(textures: SpellTextureProvider, init: SpellInitContext): void {
    const dropSprite: SpriteManifest = { width: 1, height: 1, offsetX: 0, offsetY: 0 };
    const dropTextures = textures.getFrames('sprite_4');

    // AS: c = 1; while(c < 20) { ... c++; }
    for (let i = 0; i < 19; i++) {
      const drop = new BloodDrop(dropTextures, init.scale, dropSprite);
      this.bloodDrops.push(drop);
      this.bloodDropContainer.addChild(drop.container);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update blood drops
    for (const drop of this.bloodDrops) {
      drop.update(deltaTime);
    }

    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    // Clean up blood drops
    for (const drop of this.bloodDrops) {
      drop.destroy();
    }
    this.bloodDrops.length = 0;
    
    super.destroy();
  }
}

class BloodDrop {
  container: Container;
  private sprite: FrameAnimatedSprite;
  private innerContainer: Container;
  private vx: number;
  private vy: number;
  private f: number;
  private readonly g = 0.67;
  private hasLanded = false;

  constructor(textures: Texture[], scale: number, spriteData: any) {
    this.container = new Container();
    this.innerContainer = new Container();
    this.container.addChild(this.innerContainer);
    
    // AS: vx = 7.5 * (-0.5 + random())
    this.vx = 7.5 * (-0.5 + Math.random());
    // AS: vy = 3.75 * (-0.5 + random())
    this.vy = 3.75 * (-0.5 + Math.random());
    // AS: f = -11 - 1.67 * random()
    this.f = -11 - 1.67 * Math.random();
    
    // Create the sprite
    this.sprite = new FrameAnimatedSprite({
      textures,
      scale,
      ...calculateAnchor(spriteData),
    });
    
    // AS: _alpha = 50 + random(50)
    this.sprite.sprite.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
    
    // AS: t = 50 + random(60); _xscale = _yscale = t
    const t = (50 + Math.floor(Math.random() * 60)) / 100;
    this.sprite.sprite.scale.set(t * scale);
    
    // Add sprite to inner container (for physics simulation)
    this.innerContainer.addChild(this.sprite.sprite);
    
    // AS: inner._y = -1
    this.innerContainer.y = -1;
  }

  update(deltaTime: number): void {
    if (!this.hasLanded) {
      // AS: _x += vx; _y += vy
      this.container.x += this.vx;
      this.container.y += this.vy;
      
      // AS: if(inner._y < 0)
      if (this.innerContainer.y < 0) {
        // AS: f += g; inner._y += f
        this.f += this.g;
        this.innerContainer.y += this.f;
      } else if (!this.hasLanded) {
        // AS: inner._y >= 0, blood hit the ground
        this.hasLanded = true;
        // AS: vx = vy = 0
        this.vx = 0;
        this.vy = 0;
        // AS: inner._y = 0
        this.innerContainer.y = 0;
        // AS: gotoAndPlay(2)
        this.sprite.play();
      }
    }
    
    this.sprite.update(deltaTime);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}