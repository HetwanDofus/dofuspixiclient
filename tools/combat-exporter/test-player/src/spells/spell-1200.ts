/**
 * Spell 1200 - Feca Shoot
 *
 * A shoot animation with a rotating projectile (move) and an explosion effect (shoot).
 *
 * Components:
 * - shoot (sprite): At caster position, plays explosion sound at frame 1, ends at frame 130
 * - move (sprite): Rotating projectile at caster position, stops at frame 25
 *
 * Original AS timing:
 * - Frame 1 (shoot): Play sound 'explosion'
 * - Frame 130 (shoot): removeMovieClip() - animation ends
 * - Frame 25 (move): stop()
 * - move enterFrame: _rotation += 50 (continuous rotation)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 116.95,
  height: 57.4,
  offsetX: -55.85,
  offsetY: -29.25,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 29.25,
  height: 58.25,
  offsetX: -14.35,
  offsetY: -52.95,
};

export class Spell1200 extends BaseSpell {
  readonly spellId = 1200;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;
  private moveRotation = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // shoot animation at caster position
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('explosion'));
    // Frame 130 (0-indexed: 129) -> removeMovieClip, but we stop at 131 (last frame index)
    // The shoot animation has 132 frames (0-131). Frame 130 in AS (1-indexed) = frame 129 (0-indexed)
    // removeMovieClip at frame 130 means we signal hit and complete there
    this.shootAnim.onFrame(129, () => this.signalHit());
    this.container.addChild(this.shootAnim.sprite);

    // move animation - rotating projectile at caster position
    const moveAnchor = calculateAnchor(MOVE_MANIFEST);
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      fps: 60,
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      scale: init.scale,
      stopFrame: 24,
    }));
    this.moveAnim.sprite.position.set(0, init.casterY);
    this.container.addChild(this.moveAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Replicate enterFrame rotation: _rotation += 50 per frame
    // deltaTime is in ms, at 60fps each frame is ~16.67ms
    const framesElapsed = deltaTime / (1000 / 60);
    this.moveRotation += 50 * framesElapsed;
    this.moveAnim.sprite.rotation = (this.moveRotation * Math.PI) / 180;

    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
