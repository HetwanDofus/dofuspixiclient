import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 1214 - Static/Lightning Effect
 *
 * Multi-layered static electricity effect with randomized scaling and positioning.
 * Creates three static effects at different offsets from the target position.
 *
 * Components:
 * - staticR: Main static effect with random scaling/flipping, positioned at target and offsets
 *
 * Original AS timing:
 * - Frame 0: Play death/spell sounds
 * - Frame 2: Hit sound
 * - Frame 3-4: Impact sound
 * - Frame 4: Place first static at target
 * - Frame 10: Place second static with 27px offset
 * - Frame 13: End spell
 * - Frame 19: Place third static with 53px offset
 * - Frame 58: Random stop (98% chance)
 * - Frame 102+: Fade out begins (after 44 frame delay)
 */
export class Spell1214 extends BaseSpell {
  readonly spellId = 1214;

  private static1!: FrameAnimatedSprite;
  private static2!: FrameAnimatedSprite;
  private static3!: FrameAnimatedSprite;
  
  private fadeFrame = 0;
  private isFading = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const staticTextures = textures.getFrames('staticR');
    const staticManifest: SpriteManifest = {
      width: 337.79999999999995,
      height: 828,
      offsetX: -169.2,
      offsetY: -742.8
    };
    const staticAnchor = calculateAnchor(staticManifest);

    // First static at target position (frame 4)
    this.static1 = this.anims.add(new FrameAnimatedSprite({
      textures: staticTextures,
      fps: 60,
      anchorX: staticAnchor.x,
      anchorY: staticAnchor.y,
      startFrame: 0,
      loop: false
    }));
    
    // Apply random scale 80-99% and 50% horizontal flip
    const scale1 = (80 + Math.floor(Math.random() * 20)) / 100;
    this.static1.sprite.scale.set(scale1 * init.scale, scale1 * init.scale);
    if (Math.floor(Math.random() * 2) === 1) {
      this.static1.sprite.scale.x *= -1;
    }
    this.static1.sprite.position.set(init.targetX, init.targetY);
    this.static1.sprite.zIndex = 10;

    // Random frame jump for variation
    this.static1.onFrame(0, () => {
      const totalFrames = staticTextures.length;
      const randomFrame = 1 + Math.floor(Math.random() * (totalFrames - 1));
      this.static1.jumpToFrame(randomFrame);
    });

    // Random stop at frame 58 (98% chance)
    this.static1.onFrame(57, () => {
      if (Math.floor(Math.random() * 50) !== 0) {
        this.static1.stopAt(57);
      }
    });

    // Second static with 27px offset (frame 10)
    this.static2 = this.anims.add(new FrameAnimatedSprite({
      textures: staticTextures,
      fps: 60,
      anchorX: staticAnchor.x,
      anchorY: staticAnchor.y,
      startFrame: 0,
      loop: false
    }));
    
    const scale2 = (80 + Math.floor(Math.random() * 20)) / 100;
    this.static2.sprite.scale.set(scale2 * init.scale, scale2 * init.scale);
    if (Math.floor(Math.random() * 2) === 1) {
      this.static2.sprite.scale.x *= -1;
    }
    
    // Position with offset based on angle
    const d2 = 27;
    let dx2 = d2;
    let dy2 = d2 / 2;
    
    if (Math.abs(context.angle) > 90) {
      dx2 = -d2;
    }
    if (context.angle < 0) {
      dy2 = -d2 / 2;
      this.static2.sprite.zIndex = 5;
    } else {
      this.static2.sprite.zIndex = 15;
    }
    
    this.static2.sprite.position.set(init.targetX + dx2, init.targetY + dy2);
    this.static2.sprite.visible = false;

    // Random frame jump for variation
    this.static2.onFrame(0, () => {
      const totalFrames = staticTextures.length;
      const randomFrame = 1 + Math.floor(Math.random() * (totalFrames - 1));
      this.static2.jumpToFrame(randomFrame);
    });

    // Random stop at frame 58 (98% chance)
    this.static2.onFrame(57, () => {
      if (Math.floor(Math.random() * 50) !== 0) {
        this.static2.stopAt(57);
      }
    });

    // Third static with 53px offset (frame 19)
    this.static3 = this.anims.add(new FrameAnimatedSprite({
      textures: staticTextures,
      fps: 60,
      anchorX: staticAnchor.x,
      anchorY: staticAnchor.y,
      startFrame: 0,
      loop: false
    }));
    
    const scale3 = (80 + Math.floor(Math.random() * 20)) / 100;
    this.static3.sprite.scale.set(scale3 * init.scale, scale3 * init.scale);
    if (Math.floor(Math.random() * 2) === 1) {
      this.static3.sprite.scale.x *= -1;
    }
    
    // Position with offset based on angle
    const d3 = 53;
    let dx3 = d3;
    let dy3 = d3 / 2;
    
    if (Math.abs(context.angle) > 90) {
      dx3 = -d3;
    }
    if (context.angle < 0) {
      dy3 = -d3 / 2;
      this.static3.sprite.zIndex = 5;
    } else {
      this.static3.sprite.zIndex = 15;
    }
    
    this.static3.sprite.position.set(init.targetX + dx3, init.targetY + dy3);
    this.static3.sprite.visible = false;

    // Random frame jump for variation
    this.static3.onFrame(0, () => {
      const totalFrames = staticTextures.length;
      const randomFrame = 1 + Math.floor(Math.random() * (totalFrames - 1));
      this.static3.jumpToFrame(randomFrame);
    });

    // Random stop at frame 58 (98% chance)
    this.static3.onFrame(57, () => {
      if (Math.floor(Math.random() * 50) !== 0) {
        this.static3.stopAt(57);
      }
    });

    // Sound effects
    this.static1.onFrame(0, () => {
      this.callbacks.playSound('pandit_spell');
      this.callbacks.playSound('death_fall');
      this.callbacks.playSound('pandit_death');
    });
    
    this.static1.onFrame(1, () => this.callbacks.playSound('hit_defaut'));
    this.static1.onFrame(2, () => this.callbacks.playSound('impact_lourd'));
    this.static1.onFrame(3, () => this.callbacks.playSound('impact_lourd'));
    
    this.static1.onFrame(4, () => this.callbacks.playSound('pandit_attak'));
    this.static1.onFrame(5, () => {
      this.callbacks.playSound('pandit_attak');
      this.callbacks.playSound('ouginac_epee');
    });
    
    this.static1.onFrame(6, () => {
      this.callbacks.playSound('pandit_fire');
      this.callbacks.playSound('pandit_attak');
    });
    
    this.static1.onFrame(7, () => this.callbacks.playSound('ouginac_epee'));

    // Show second static at frame 10
    this.static1.onFrame(9, () => {
      this.static2.sprite.visible = true;
      // Signal hit when GAC.applyEnd would be called
      this.signalHit();
    });
    
    // End spell at frame 13
    this.static1.onFrame(12, () => {
      // This is when the original AS calls this.end()
    });

    // Show third static at frame 19
    this.static1.onFrame(18, () => {
      this.static3.sprite.visible = true;
    });
    
    // Add all sprites to container
    this.container.addChild(this.static1.sprite);
    this.container.addChild(this.static2.sprite);
    this.container.addChild(this.static3.sprite);
    
    // Sort children by zIndex
    this.container.sortChildren();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Handle fade effect (starts at frame 102 = frame 58 + 44 frame delay)
    if (this.static1.getFrame() >= 57 && !this.isFading) {
      this.fadeFrame++;
      if (this.fadeFrame > 44) {
        this.isFading = true;
      }
    }

    if (this.isFading) {
      // Decrease alpha by 3.34% per frame
      this.container.alpha -= 0.0334;
      if (this.container.alpha <= 0) {
        this.container.alpha = 0;
      }
    }

    // Check if all animations complete (frame 172 equivalent)
    if (this.static1.getFrame() >= 57 && this.container.alpha <= 0) {
      this.complete();
    }
  }
}