/**
 * Spell 1202 - Panda Molotov
 *
 * A fire spell with a "flam" animation at the target position and a "shoot"
 * animation that contains a rotating flame sprite.
 *
 * Components:
 * - shoot (sprite): At target position, plays through 72 frames, ends at frame 70
 * - flam (sprite): Inside shoot, plays 22 frames then stops (frame 21 = stop)
 *
 * Original AS timing:
 * - Frame 1 (shoot): Play sound 'panda_molotov', set _rotation = 0
 * - Frame 21 (flam): stop()
 * - Frame 70 (shoot): _parent.removeMovieClip() - animation ends
 *
 * DefineSprite_47/frame_1: Contains a flame instance (flam) that rotates each frame
 *   - onClipEvent(load): vr = 15 + random(70)
 *   - onClipEvent(enterFrame): _rotation += vr; vr *= 0.98
 *
 * DefineSprite_46/frame_1: Contains the rotating sprite, calls play() each enterFrame
 * (keeps the flam animation playing through the loop)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const FLAM_MANIFEST: SpriteManifest = {
  width: 146.35,
  height: 210.85,
  offsetX: -13.85,
  offsetY: -178.05,
};

const SHOOT_MANIFEST: SpriteManifest = {
  width: 174.15,
  height: 162.65,
  offsetX: -85.1,
  offsetY: -119.9,
};

export class Spell1202 extends BaseSpell {
  readonly spellId = 1202;

  // The rotating flame sprite's rotation velocity
  private flamVr = 0;

  private flamAnim!: FrameAnimatedSprite;
  private shootAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // vr = 15 + random(70) (AS random(70) -> 0..69)
    this.flamVr = 15 + Math.floor(Math.random() * 70);

    // flam animation - stops at frame 21 (AS frame 21 -> index 20, stop() means it stops after showing frame 21 = index 20)
    // AS: frame_21/DoAction: stop() -> stopAt index 20
    this.flamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('flam'),
      ...calculateAnchor(FLAM_MANIFEST),
      scale: init.scale,
      stopFrame: 20,
    }));

    // shoot animation - plays 72 frames, ends at frame 70 (index 69)
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));

    // Frame 1 of shoot: play sound (index 0)
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('panda_molotov');
    });

    // Signal hit when the shoot animation completes (frame 70 = removeMovieClip, index 69)
    this.shootAnim.onFrame(69, () => {
      this.signalHit();
    });

    // Position at target
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    this.shootAnim.sprite.rotation = 0;

    // The flam is visually part of shoot (child of shoot container)
    // Position flam relative to shoot's registration point
    this.flamAnim.sprite.position.set(0, 0);

    this.container.addChild(this.shootAnim.sprite);
    this.shootAnim.sprite.addChild(this.flamAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply rotation to the flam sprite each frame (AS onClipEvent enterFrame):
    // _rotation += vr; vr *= 0.98
    // We scale the effect by deltaTime relative to one frame (1000/60 ms)
    const frameFraction = deltaTime / (1000 / 60);
    this.flamAnim.sprite.rotation += (this.flamVr * Math.PI / 180) * frameFraction;
    this.flamVr *= Math.pow(0.98, frameFraction);

    // End when shoot animation completes (frame 70 triggers removeMovieClip)
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
