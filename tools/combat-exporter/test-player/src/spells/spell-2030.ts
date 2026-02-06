/**
 * Spell 2030 - Crockette
 *
 * A projectile spell with randomized smoke/cloud effects.
 *
 * Components:
 * - move: Main projectile animation
 * - DefineSprite_8: Random effect (1/5 chance to play, otherwise skip to end)
 * - DefineSprite_12: Randomized smoke/cloud with variable start, alpha, and scale
 * - DefineSprite_14: Long animation that stops at frame 295
 * - DefineSprite_15_shoot: Main spell container, removes at frame 106
 *
 * Original AS timing:
 * - Frame 1: Play sound "crockette_206"
 * - Frame 4 (shoot): Set rotation to 0
 * - Frame 106 (shoot): Remove and stop
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const MOVE_MANIFEST: SpriteManifest = {
  width: 93,
  height: 31.799999999999997,
  offsetX: -58.199999999999996,
  offsetY: -16.200000000000003,
};

export class Spell2030 extends BaseSpell {
  readonly spellId = 2030;

  private shootAnim!: FrameAnimatedSprite;
  private sprite8!: FrameAnimatedSprite;
  private sprite12!: FrameAnimatedSprite;
  private sprite14!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation (DefineSprite_15_shoot)
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: [], // Empty textures since this is just a container
      frameCount: 106,
    }));
    this.shootAnim
      .stopAt(105) // Frame 106 in AS (0-indexed: 105)
      .onFrame(3, () => { // Frame 4 in AS (0-indexed: 3)
        // AS: _rotation = 0
        this.container.rotation = 0;
      })
      .onFrame(105, () => { // Frame 106 in AS
        // AS: _parent.removeMovieClip()
        this.complete();
      });

    // DefineSprite_8 - Random effect
    this.sprite8 = this.anims.add(new FrameAnimatedSprite({
      textures: [], // Empty textures
      frameCount: 60,
    }));
    
    // AS: if(random(5) != 1) { gotoAndStop(60); }
    if (Math.floor(Math.random() * 5) !== 1) {
      this.sprite8.stopAt(59); // Frame 60 in AS (0-indexed: 59)
    } else {
      this.sprite8.stopAt(33); // Frame 34 in AS (0-indexed: 33)
    }

    // DefineSprite_12 - Randomized smoke/cloud
    this.sprite12 = this.anims.add(new FrameAnimatedSprite({
      textures: [], // Empty textures
      frameCount: 97,
      // AS: gotoAndPlay(random(30) + 1)
      startFrame: Math.floor(Math.random() * 30),
    }));
    this.sprite12.stopAt(96); // Frame 97 in AS (0-indexed: 96)
    
    // AS: _alpha = 30 + random(50)
    const alpha = 30 + Math.floor(Math.random() * 50);
    // AS: t = 30 + random(120)
    const t = 30 + Math.floor(Math.random() * 120);
    // AS: _xscale = t; _yscale = t / 2
    this.sprite12.sprite.alpha = alpha / 100;
    this.sprite12.sprite.scale.set(t / 100, t / 200);

    // DefineSprite_14 - Long animation
    this.sprite14 = this.anims.add(new FrameAnimatedSprite({
      textures: [], // Empty textures
      frameCount: 295,
    }));
    this.sprite14.stopAt(294); // Frame 295 in AS (0-indexed: 294)

    // Move animation - the actual visible sprite
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      ...calculateAnchor(MOVE_MANIFEST),
      scale: init.scale,
    }));
    this.moveAnim.sprite.position.set(init.targetX, init.targetY);
    this.moveAnim.sprite.rotation = init.angleRad;
    this.container.addChild(this.moveAnim.sprite);

    // Play sound on frame 1 (0-indexed: 0)
    this.callbacks.playSound('crockette_206');

    // Signal hit when the main animation completes
    this.shootAnim.onFrame(105, () => this.signalHit());
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when shoot animation finishes
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}