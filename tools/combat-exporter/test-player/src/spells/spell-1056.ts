/**
 * Spell 1056 - Wabbit
 *
 * Multi-phase wabbit spell with death animations and random flickering effects.
 *
 * Components:
 * - sprite_19: Initial animation (stops at frame 13)
 * - sprite_21/22: Static animations at frame 13
 * - sprite_27/30: Main effect with sound at frame 8, end at frame 9
 * - sprite_34/35: Flickering animations with random alpha
 * - sprite_43/55: Secondary effects (stop at frame 8)
 * - sprite_48/51: Hit effects with sound at frame 3
 * - sprite_56/57: Static animations at frame 13
 * - sprite_61/67: Death animations with sound at frame 1
 *
 * Original AS timing:
 * - Frame 1: Set apparition = 1
 * - Frame 3: Hit sound (sprite_48/51)
 * - Frame 8: Wabbit sound (sprite_27/30)
 * - Frame 9: End signal (sprite_27/30)
 * - Frame 15/23: Set apparition = 0
 * - Frame 31/37: Apply "Appear" animation if apparition == 1
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_19_MANIFEST: SpriteManifest = {
  width: 139.8,
  height: 213,
  offsetX: -68.69999999999999,
  offsetY: -109.80000000000001,
};

const SPRITE_21_MANIFEST: SpriteManifest = {
  width: 201,
  height: 287.4,
  offsetX: -105.60000000000001,
  offsetY: -251.70000000000002,
};

const SPRITE_22_MANIFEST: SpriteManifest = {
  width: 201,
  height: 269.4,
  offsetX: -90,
  offsetY: -232.5,
};

const SPRITE_27_MANIFEST: SpriteManifest = {
  width: 275.4,
  height: 308.1,
  offsetX: -169.5,
  offsetY: -266.4,
};

const SPRITE_30_MANIFEST: SpriteManifest = {
  width: 290.1,
  height: 297.6,
  offsetX: -116.10000000000001,
  offsetY: -263.1,
};

const SPRITE_34_MANIFEST: SpriteManifest = {
  width: 248.10000000000002,
  height: 803.6999999999999,
  offsetX: -140.10000000000002,
  offsetY: -707.7,
};

const SPRITE_35_MANIFEST: SpriteManifest = {
  width: 240.60000000000002,
  height: 754.8,
  offsetX: -99.89999999999999,
  offsetY: -711,
};

const SPRITE_43_MANIFEST: SpriteManifest = {
  width: 313.20000000000005,
  height: 201.29999999999998,
  offsetX: -155.10000000000002,
  offsetY: -102.89999999999999,
};

const SPRITE_48_MANIFEST: SpriteManifest = {
  width: 426.29999999999995,
  height: 454.5,
  offsetX: -313.5,
  offsetY: -428.70000000000005,
};

const SPRITE_51_MANIFEST: SpriteManifest = {
  width: 512.7,
  height: 453.29999999999995,
  offsetX: -388.5,
  offsetY: -428.70000000000005,
};

const SPRITE_55_MANIFEST: SpriteManifest = {
  width: 345.6,
  height: 240.60000000000002,
  offsetX: -171.3,
  offsetY: -122.10000000000001,
};

const SPRITE_56_MANIFEST: SpriteManifest = {
  width: 435.29999999999995,
  height: 388.5,
  offsetX: -338.1,
  offsetY: -351.6,
};

const SPRITE_57_MANIFEST: SpriteManifest = {
  width: 429.29999999999995,
  height: 387.29999999999995,
  offsetX: -338.1,
  offsetY: -351.6,
};

const SPRITE_61_MANIFEST: SpriteManifest = {
  width: 402.90000000000003,
  height: 500.40000000000003,
  offsetX: -203.39999999999998,
  offsetY: -419.70000000000005,
};

const SPRITE_67_MANIFEST: SpriteManifest = {
  width: 228.89999999999998,
  height: 522.3,
  offsetX: -114.60000000000001,
  offsetY: -414.59999999999997,
};

export class Spell1056 extends BaseSpell {
  readonly spellId = 1056;

  private sprite19!: FrameAnimatedSprite;
  private sprite21!: FrameAnimatedSprite;
  private sprite22!: FrameAnimatedSprite;
  private sprite27!: FrameAnimatedSprite;
  private sprite30!: FrameAnimatedSprite;
  private sprite34!: FrameAnimatedSprite;
  private sprite35!: FrameAnimatedSprite;
  private sprite43!: FrameAnimatedSprite;
  private sprite48!: FrameAnimatedSprite;
  private sprite51!: FrameAnimatedSprite;
  private sprite55!: FrameAnimatedSprite;
  private sprite56!: FrameAnimatedSprite;
  private sprite57!: FrameAnimatedSprite;
  private sprite61!: FrameAnimatedSprite;
  private sprite67!: FrameAnimatedSprite;

  private apparition = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main timeline sounds
    this.callbacks.playSound('death');
    
    // Schedule hit sound at frame 2 (0-indexed)
    setTimeout(() => {
      if (!this.done) {
        this.callbacks.playSound('hit_defaut');
      }
    }, (2 / 25) * 1000);
    
    // Schedule wabbit sound at frame 7 (0-indexed)
    setTimeout(() => {
      if (!this.done) {
        this.callbacks.playSound('cc_wabbit');
      }
    }, (7 / 25) * 1000);

    // sprite_19: Initial animation (stops at frame 13)
    const sprite19Anchor = calculateAnchor(SPRITE_19_MANIFEST);
    this.sprite19 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_19'),
      anchorX: sprite19Anchor.x,
      anchorY: sprite19Anchor.y,
      scale: init.scale,
    }));
    this.sprite19.sprite.position.set(0, init.casterY);
    this.sprite19.stopAt(12); // AS frame 14 = TS frame 13 = stopAt(12)
    this.container.addChild(this.sprite19.sprite);

    // sprite_21: Static at frame 13
    const sprite21Anchor = calculateAnchor(SPRITE_21_MANIFEST);
    this.sprite21 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_21'),
      anchorX: sprite21Anchor.x,
      anchorY: sprite21Anchor.y,
      scale: init.scale,
    }));
    this.sprite21.sprite.position.set(0, init.casterY);
    this.sprite21.stopAt(12); // AS frame 13
    this.container.addChild(this.sprite21.sprite);

    // sprite_22: Static at frame 13
    const sprite22Anchor = calculateAnchor(SPRITE_22_MANIFEST);
    this.sprite22 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      scale: init.scale,
    }));
    this.sprite22.sprite.position.set(0, init.casterY);
    this.sprite22.stopAt(12); // AS frame 13
    this.container.addChild(this.sprite22.sprite);

    // sprite_27: Main effect with sound and end
    const sprite27Anchor = calculateAnchor(SPRITE_27_MANIFEST);
    this.sprite27 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_27'),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,
      scale: init.scale,
    }));
    this.sprite27.sprite.position.set(0, init.casterY);
    this.sprite27
      .onFrame(7, () => this.callbacks.playSound('cc_wabbit')) // AS frame 8
      .onFrame(8, () => this.signalHit()) // AS frame 9 - end
      .stopAt(26); // AS frame 27
    this.container.addChild(this.sprite27.sprite);

    // sprite_30: Alternative main effect
    const sprite30Anchor = calculateAnchor(SPRITE_30_MANIFEST);
    this.sprite30 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_30'),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      scale: init.scale,
    }));
    this.sprite30.sprite.position.set(0, init.casterY);
    this.sprite30
      .onFrame(7, () => this.callbacks.playSound('cc_wabbit')) // AS frame 8
      .onFrame(8, () => this.signalHit()) // AS frame 9 - end
      .stopAt(22); // AS frame 23
    this.container.addChild(this.sprite30.sprite);

    // sprite_34: Flickering animation (random alpha)
    const sprite34Anchor = calculateAnchor(SPRITE_34_MANIFEST);
    this.sprite34 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_34'),
      anchorX: sprite34Anchor.x,
      anchorY: sprite34Anchor.y,
      scale: init.scale,
    }));
    this.sprite34.sprite.position.set(0, init.casterY);
    this.sprite34
      .onFrame(8, () => {
        // Start flickering effect at frame 9
        this.sprite34.sprite.alpha = Math.floor(Math.random() * 100) / 100;
      })
      .stopAt(28); // AS frame 29
    this.container.addChild(this.sprite34.sprite);

    // sprite_35: Another flickering animation
    const sprite35Anchor = calculateAnchor(SPRITE_35_MANIFEST);
    this.sprite35 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_35'),
      anchorX: sprite35Anchor.x,
      anchorY: sprite35Anchor.y,
      scale: init.scale,
    }));
    this.sprite35.sprite.position.set(0, init.casterY);
    this.sprite35
      .onFrame(8, () => {
        // Start flickering effect at frame 9
        this.sprite35.sprite.alpha = Math.floor(Math.random() * 100) / 100;
      })
      .stopAt(29); // AS frame 30
    this.container.addChild(this.sprite35.sprite);

    // sprite_43: Secondary effect
    const sprite43Anchor = calculateAnchor(SPRITE_43_MANIFEST);
    this.sprite43 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_43'),
      anchorX: sprite43Anchor.x,
      anchorY: sprite43Anchor.y,
      scale: init.scale,
    }));
    this.sprite43.sprite.position.set(0, init.casterY);
    this.sprite43.stopAt(7); // AS frame 9 with fadingFrame 8
    this.container.addChild(this.sprite43.sprite);

    // sprite_48: Hit effect (right)
    const sprite48Anchor = calculateAnchor(SPRITE_48_MANIFEST);
    this.sprite48 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_48'),
      anchorX: sprite48Anchor.x,
      anchorY: sprite48Anchor.y,
      scale: init.scale,
    }));
    this.sprite48.sprite.position.set(init.targetX, init.targetY);
    this.sprite48
      .onFrame(2, () => this.callbacks.playSound('hit_defaut')) // AS frame 3
      .stopAt(11); // AS frame 12
    this.container.addChild(this.sprite48.sprite);

    // sprite_51: Hit effect (left)
    const sprite51Anchor = calculateAnchor(SPRITE_51_MANIFEST);
    this.sprite51 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_51'),
      anchorX: sprite51Anchor.x,
      anchorY: sprite51Anchor.y,
      scale: init.scale,
    }));
    this.sprite51.sprite.position.set(init.targetX, init.targetY);
    this.sprite51
      .onFrame(2, () => this.callbacks.playSound('hit_defaut')) // AS frame 3
      .stopAt(11); // AS frame 12
    this.container.addChild(this.sprite51.sprite);

    // sprite_55: Secondary effect
    const sprite55Anchor = calculateAnchor(SPRITE_55_MANIFEST);
    this.sprite55 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_55'),
      anchorX: sprite55Anchor.x,
      anchorY: sprite55Anchor.y,
      scale: init.scale,
    }));
    this.sprite55.sprite.position.set(0, init.casterY);
    this.sprite55.stopAt(7); // AS frame 9 with fadingFrame 8
    this.container.addChild(this.sprite55.sprite);

    // sprite_56: Static at frame 13
    const sprite56Anchor = calculateAnchor(SPRITE_56_MANIFEST);
    this.sprite56 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_56'),
      anchorX: sprite56Anchor.x,
      anchorY: sprite56Anchor.y,
      scale: init.scale,
    }));
    this.sprite56.sprite.position.set(0, init.casterY);
    this.sprite56.stopAt(12); // AS frame 13
    this.container.addChild(this.sprite56.sprite);

    // sprite_57: Static at frame 13
    const sprite57Anchor = calculateAnchor(SPRITE_57_MANIFEST);
    this.sprite57 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_57'),
      anchorX: sprite57Anchor.x,
      anchorY: sprite57Anchor.y,
      scale: init.scale,
    }));
    this.sprite57.sprite.position.set(0, init.casterY);
    this.sprite57.stopAt(12); // AS frame 13
    this.container.addChild(this.sprite57.sprite);

    // sprite_61: Death animation
    const sprite61Anchor = calculateAnchor(SPRITE_61_MANIFEST);
    this.sprite61 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_61'),
      anchorX: sprite61Anchor.x,
      anchorY: sprite61Anchor.y,
      scale: init.scale,
    }));
    this.sprite61.sprite.position.set(init.targetX, init.targetY);
    this.sprite61
      .onFrame(0, () => this.callbacks.playSound('death')) // AS frame 1
      .stopAt(7); // AS frame 9 with fadingFrame 8
    this.container.addChild(this.sprite61.sprite);

    // sprite_67: Death animation
    const sprite67Anchor = calculateAnchor(SPRITE_67_MANIFEST);
    this.sprite67 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_67'),
      anchorX: sprite67Anchor.x,
      anchorY: sprite67Anchor.y,
      scale: init.scale,
    }));
    this.sprite67.sprite.position.set(init.targetX, init.targetY);
    this.sprite67
      .onFrame(0, () => this.callbacks.playSound('death')) // AS frame 1
      .stopAt(8); // AS frame 10 with fadingFrame 9
    this.container.addChild(this.sprite67.sprite);

    // Set apparition to 0 at frames 15 and 23
    setTimeout(() => {
      this.apparition = 0;
    }, (14 / 25) * 1000); // Frame 15 (0-indexed = 14)

    setTimeout(() => {
      this.apparition = 0;
    }, (22 / 25) * 1000); // Frame 23 (0-indexed = 22)
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply flickering effect on sprites 34 and 35
    if (this.sprite34.getFrame() >= 8 && !this.sprite34.isStopped()) {
      this.sprite34.sprite.alpha = Math.floor(Math.random() * 100) / 100;
    }
    if (this.sprite35.getFrame() >= 8 && !this.sprite35.isStopped()) {
      this.sprite35.sprite.alpha = Math.floor(Math.random() * 100) / 100;
    }

    // Check completion when all animations are done
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}