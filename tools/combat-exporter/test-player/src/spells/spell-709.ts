/**
 * Spell 709 - Grina
 *
 * A spell with caster-side and target-side effects.
 *
 * Components:
 * - sprite_17: Caster effect at cellFrom position, plays through 183 frames
 * - sprite_16: Contains 3 looping sub-sprites (sprite_6 instances) that start
 *   at random frames, positioned at caster with sound at frame 49
 * - sprite_24: Target effect at cellTo position, signals hit at frame 79, ends at frame 172
 *
 * Original AS timing:
 * - Frame 2 (main): Play sound 'grina_709b', stop()
 * - sprite_17 frame 1: Set position to cellFrom
 * - sprite_17 frame 181: removeMovieClip()
 * - sprite_16 frame 49: Play sound 'grina_709'
 * - sprite_16 sub-sprites (sprite_6): gotoAndPlay(random(_totalframes + 1)) on load
 *   (each sprite_6 has _rotation = -random(180) on frame 1)
 * - sprite_24 frame 1: Set position to cellTo
 * - sprite_24 frame 73: Play sound 'vlad_804'
 * - sprite_24 frame 79: Signal hit (this.end())
 * - sprite_24 frame 172: removeMovieClip()
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_17_MANIFEST: SpriteManifest = {
  width: 249.35,
  height: 295.35,
  offsetX: -124.7,
  offsetY: -229.35,
};

const SPRITE_16_MANIFEST: SpriteManifest = {
  width: 249.35,
  height: 295.35,
  offsetX: -124.7,
  offsetY: -229.35,
};

const SPRITE_24_MANIFEST: SpriteManifest = {
  width: 96.45,
  height: 254.3,
  offsetX: -47.35,
  offsetY: -229.35,
};

const SPRITE_6_MANIFEST: SpriteManifest = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

export class Spell709 extends BaseSpell {
  readonly spellId = 709;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // sprite_17: Caster effect positioned at cellFrom
    // frame 1 in AS sets position (already done via init.casterY)
    // frame 181 (0-indexed: 180) removes it
    const sprite17Anchor = calculateAnchor(SPRITE_17_MANIFEST);
    const sprite17Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_17'),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      scale: init.scale,
    }));
    sprite17Anim.sprite.position.set(0, init.casterY);
    // frame 181 = 0-indexed 180: removeMovieClip - handled by natural completion at frame 183
    // The sprite plays to completion naturally (183 frames)
    this.container.addChild(sprite17Anim.sprite);

    // sprite_16: Caster overlay with 3 looping sprite_6 sub-instances
    // Positioned at caster, plays sound at frame 49 (0-indexed: 48)
    const sprite16Anchor = calculateAnchor(SPRITE_16_MANIFEST);
    const sprite16Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_16'),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      scale: init.scale,
    }));
    sprite16Anim.sprite.position.set(0, init.casterY);
    sprite16Anim.onFrame(48, () => this.callbacks.playSound('grina_709'));
    this.container.addChild(sprite16Anim.sprite);

    // sprite_6 sub-instances: 3 instances placed inside sprite_16 context
    // Each starts at random frame: gotoAndPlay(random(_totalframes + 1))
    // _totalframes = 15, so random(16) -> 0..15 (0-indexed: same range)
    // Each also has _rotation = -random(180) set on frame 1
    // We place them at the same position as sprite_16 (caster position)
    const sprite6Anchor = calculateAnchor(SPRITE_6_MANIFEST);
    const sprite6Textures = textures.getFrames('sprite_6');
    const totalFrames6 = sprite6Textures.length; // 15

    // 3 instances (PlaceObject2_6_5, PlaceObject2_6_9, PlaceObject2_6_13)
    for (let i = 0; i < 3; i++) {
      // AS: gotoAndPlay(random(_totalframes + 1)) -> random(totalFrames + 1) = random(16)
      // returns 0..15; 0-indexed startFrame
      const startFrame = Math.floor(Math.random() * (totalFrames6 + 1));
      const clampedStart = Math.min(startFrame, totalFrames6 - 1);

      // AS frame 1: _rotation = -random(180) -> -Math.floor(Math.random() * 180) degrees
      const rotationDeg = -Math.floor(Math.random() * 180);
      const rotationRad = (rotationDeg * Math.PI) / 180;

      const sprite6Anim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite6Textures,
        anchorX: sprite6Anchor.x,
        anchorY: sprite6Anchor.y,
        scale: init.scale,
        startFrame: clampedStart,
        loop: true,
      }));
      sprite6Anim.sprite.position.set(0, init.casterY);
      sprite6Anim.sprite.rotation = rotationRad;
      this.container.addChild(sprite6Anim.sprite);
    }

    // sprite_24: Target effect positioned at cellTo
    // frame 1 sets position (done via targetX/targetY)
    // frame 73 (0-indexed: 72): Play sound 'vlad_804'
    // frame 79 (0-indexed: 78): Signal hit
    // frame 172 (0-indexed: 171): removeMovieClip - stop here
    const sprite24Anchor = calculateAnchor(SPRITE_24_MANIFEST);
    const sprite24Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_24'),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      scale: init.scale,
    }));
    sprite24Anim.sprite.position.set(init.targetX, init.targetY);
    sprite24Anim
      .onFrame(72, () => this.callbacks.playSound('vlad_804'))
      .onFrame(78, () => this.signalHit())
      .stopAt(171);
    this.container.addChild(sprite24Anim.sprite);

    // Main timeline frame 2: play sound 'grina_709b'
    // frame 2 (0-indexed: 1) - trigger on first update via a one-shot callback
    // We use sprite17 as the timing vehicle for the main timeline sound
    sprite17Anim.onFrame(0, () => this.callbacks.playSound('grina_709b'));
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
