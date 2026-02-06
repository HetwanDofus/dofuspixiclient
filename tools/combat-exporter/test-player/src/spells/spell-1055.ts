/**
 * Spell 1055 - Spike Burst
 *
 * Creates a burst of rising spires at both caster and target positions.
 *
 * Components:
 * - sprite_8: Main animation container at caster and target
 * - spire: 10 rising spikes with random properties spawned at frame 4
 *
 * Original AS timing:
 * - Frame 4: Spawn 10 spires with sound effect
 * - Frame 115: sprite_8 removes itself
 * - Frame 10 of sprite_9: Signal hit (this.end())
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const MAIN_MANIFEST: SpriteManifest = {
  width: 310.79999999999995,
  height: 1244.1,
  offsetX: -164.7,
  offsetY: -1094.6999999999998,
};

const SPIRE_MANIFEST: SpriteManifest = {
  width: 75.9,
  height: 142.8,
  offsetX: -36.3,
  offsetY: -71.4,
};

interface SpireInstance {
  sprite: FrameAnimatedSprite;
  v: number;
  va: number;
}

export class Spell1055 extends BaseSpell {
  readonly spellId = 1055;

  private mainAnimCaster!: FrameAnimatedSprite;
  private mainAnimTarget!: FrameAnimatedSprite;
  private spires: SpireInstance[] = [];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation at caster position
    this.mainAnimCaster = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      ...calculateAnchor(MAIN_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnimCaster.sprite.position.set(0, init.casterY);
    this.mainAnimCaster.sprite.rotation = init.angleRad;
    this.mainAnimCaster
      .onFrame(3, () => this.callbacks.playSound('vlad_804'))
      .onFrame(3, () => this.spawnSpires(textures, init, this.mainAnimCaster.sprite))
      .onFrame(9, () => this.signalHit());
    this.container.addChild(this.mainAnimCaster.sprite);

    // Main animation at target position
    if (init.targetX !== 0 || init.targetY !== init.casterY) {
      this.mainAnimTarget = this.anims.add(new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_8'),
        ...calculateAnchor(MAIN_MANIFEST),
        scale: init.scale,
      }));
      this.mainAnimTarget.sprite.position.set(init.targetX, init.targetY);
      this.mainAnimTarget.sprite.rotation = init.angleRad;
      this.mainAnimTarget.onFrame(3, () => this.spawnSpires(textures, init, this.mainAnimTarget.sprite));
      this.container.addChild(this.mainAnimTarget.sprite);
    }
  }

  private spawnSpires(textures: SpellTextureProvider, init: SpellInitContext, parent: Container): void {
    const spireFrames = textures.getFrames('lib_spire');
    if (!spireFrames || spireFrames.length === 0) {
      return;
    }

    for (let i = 1; i <= 10; i++) {
      const spireAnim = new FrameAnimatedSprite({
        textures: spireFrames,
        ...calculateAnchor(SPIRE_MANIFEST),
        scale: init.scale,
        startFrame: i % 2,
        stopFrame: i % 2,
      });

      const yOffset = -Math.floor(Math.random() * 50);
      spireAnim.sprite.position.set(parent.x, parent.y + yOffset);
      spireAnim.sprite.rotation = parent.rotation;
      
      spireAnim.sprite.alpha = 0.5 + Math.random() * 0.5;
      spireAnim.sprite.scale.y = 0.8 * init.scale;
      spireAnim.sprite.scale.x = (0.8 + Math.random() * 0.8) * init.scale;
      
      const va = 1 + Math.random() * 2.5;
      const v = 0.67 + Math.random() * 1.67;
      
      this.container.addChild(spireAnim.sprite);
      this.spires.push({ sprite: spireAnim, v, va });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update spires
    for (let i = this.spires.length - 1; i >= 0; i--) {
      const spire = this.spires[i];
      
      spire.sprite.sprite.scale.y += 0.02;
      spire.sprite.sprite.y -= spire.v;
      spire.v *= 0.97;
      
      spire.sprite.sprite.alpha -= spire.va / 100;
      
      if (spire.sprite.sprite.alpha <= 0) {
        spire.sprite.destroy();
        this.spires.splice(i, 1);
      }
    }

    if (this.anims.allComplete() && this.spires.length === 0) {
      this.complete();
    }
  }

  destroy(): void {
    for (const spire of this.spires) {
      spire.sprite.destroy();
    }
    this.spires = [];
    super.destroy();
  }
}