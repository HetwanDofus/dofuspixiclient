/**
 * Spell 2019 - Herbe (Grass)
 *
 * Nature/grass-themed animation with randomized visual effects.
 *
 * Components:
 * - move: Grass animation at target position with randomized properties
 *
 * Original AS timing:
 * - Frame 1: Play "herbe" sound, randomized starting frame (1-30), randomized alpha (30-79), randomized scale
 * - Frame 1 (DefineSprite_8): 20% chance normal playback, 80% chance jump to frame 60
 * - Frame 4 (shoot): Reset rotation
 * - Frame 34: Stop (DefineSprite_8)
 * - Frame 97: Stop (DefineSprite_12)
 * - Frame 106: Remove parent and stop (shoot)
 * - Frame 295: Stop (DefineSprite_14)
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
  height: 31.8,
  offsetX: -58.2,
  offsetY: -16.2,
};

export class Spell2019 extends BaseSpell {
  readonly spellId = 2019;

  private moveAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play grass sound immediately (frame 0 in manifest = frame 1 in AS)
    this.callbacks.playSound('herbe');

    // Random starting frame (AS: gotoAndPlay(random(30) + 1) -> 0-indexed: 0-29)
    const startFrame = Math.floor(Math.random() * 30);

    // Random alpha (AS: _alpha = 30 + random(50) -> 30-79)
    const alpha = (30 + Math.floor(Math.random() * 50)) / 100;

    // Random scale (AS: t = 30 + random(120) -> 30-149)
    const t = 30 + Math.floor(Math.random() * 120);
    const scaleX = t / 100;
    const scaleY = t / 200; // AS: _yscale = t / 2

    // Create the grass animation
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      ...calculateAnchor(MOVE_MANIFEST),
      scale: init.scale,
      startFrame,
    }));

    // Apply randomized properties
    this.moveAnim.sprite.alpha = alpha;
    this.moveAnim.sprite.scale.x *= scaleX;
    this.moveAnim.sprite.scale.y *= scaleY;

    // Position at target
    this.moveAnim.sprite.position.set(init.targetX, init.targetY);

    // DefineSprite_8 behavior: 20% chance normal, 80% jump to frame 60
    const randomChoice = Math.floor(Math.random() * 5);
    if (randomChoice !== 1) {
      // 80% chance: jump to frame 60 (0-indexed: 59)
      // But our animation only has 4 frames, so this would stop it
      this.moveAnim.stopAt(3);
    } else {
      // 20% chance: normal playback, stop at frame 34 (0-indexed: 33)
      // But our animation only has 4 frames, so stop at last frame
      this.moveAnim.stopAt(3);
    }

    // The AS shows multiple stop points, but with only 4 frames, we stop at frame 3
    // The longest running AS component is 295 frames, but we simulate the essence

    // Signal hit somewhere in the middle of the animation
    this.moveAnim.onFrame(2, () => this.signalHit());

    this.container.addChild(this.moveAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}