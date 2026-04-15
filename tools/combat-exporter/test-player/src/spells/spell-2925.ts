/**
 * Spell 2925 - Grina (Ecaflip)
 *
 * A spinning dice/wheel effect at the caster position.
 *
 * Components:
 * - sprite_23: Main animation at caster position (225 frames)
 *   - Contains 3 sprite_6 sub-animations that start at random frames
 *   - Contains a rotating inner element (DefineSprite_17) with spinning decay
 * - sprite_24: Secondary animation at caster position (165 frames)
 *
 * Original AS timing:
 * - DefineSprite_23/frame_1: Play sound 'grina_709b'
 * - DefineSprite_23/frame_49: Play sound 'grina_709'
 * - DefineSprite_23/frame_58: this.end() -> signal hit
 * - DefineSprite_23/frame_64: Play sound 'grina_710'
 * - DefineSprite_24/frame_163: removeMovieClip() -> complete
 *
 * sprite_6 instances: Each starts at random(_totalframes + 1) = random(16) (0-15)
 * sprite_6/frame_1: _rotation = -random(180) (0 to -179 degrees)
 *
 * Main timeline:
 * - frame_2: stop() (only 1 frame in main timeline, stops immediately)
 *
 * Both sprite_23 and sprite_24 are positioned at cellFrom (caster position).
 * sprite_24 starts at frame 1 and ends at frame 163 (removeMovieClip).
 * sprite_23 signals hit at frame 58, plays sounds at frames 1, 49, 64.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_23_MANIFEST: SpriteManifest = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

const SPRITE_24_MANIFEST: SpriteManifest = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

const SPRITE_6_MANIFEST: SpriteManifest = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

export class Spell2925 extends BaseSpell {
  readonly spellId = 2925;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const casterX = context?.cellFrom ? context.cellFrom.x - (context?.cellFrom?.x ?? 0) : 0;
    const casterY = context?.cellFrom ? 0 : 0;

    // Use 0 for x since container is positioned at cellFrom,
    // and Y_OFFSET for vertical alignment
    const posX = 0;
    const posY = init.casterY;

    // --- sprite_23 (main anim, 225 frames) ---
    const anchor23 = calculateAnchor(SPRITE_23_MANIFEST);
    const anim23 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_23'),
      anchorX: anchor23.x,
      anchorY: anchor23.y,
      scale: init.scale,
    }));
    anim23.sprite.position.set(posX, posY);

    // frame_1 (0-indexed: 0): play sound 'grina_709b'
    anim23.onFrame(0, () => this.callbacks.playSound('grina_709b'));
    // frame_49 (0-indexed: 48): play sound 'grina_709'
    anim23.onFrame(48, () => this.callbacks.playSound('grina_709'));
    // frame_58 (0-indexed: 57): this.end() -> signal hit
    anim23.onFrame(57, () => this.signalHit());
    // frame_64 (0-indexed: 63): play sound 'grina_710'
    anim23.onFrame(63, () => this.callbacks.playSound('grina_710'));

    this.container.addChild(anim23.sprite);

    // --- sprite_6 instances (3 sub-sprites within sprite_23, each with random start) ---
    // DefineSprite_23 places 3 sprite_6 instances (PlaceObject2_6_5, PlaceObject2_6_9, PlaceObject2_6_13)
    // Each does: gotoAndPlay(random(_totalframes + 1)) on load
    // sprite_6 has 15 frames, so random(16) = 0..15
    // Each sprite_6/frame_1: _rotation = -random(180) = 0..-179 degrees
    const sprite6Textures = textures.getFrames('sprite_6');
    const anchor6 = calculateAnchor(SPRITE_6_MANIFEST);

    for (let i = 0; i < 3; i++) {
      // AS: random(_totalframes + 1) where _totalframes = 15, so random(16) = 0..15
      const startFrame = Math.floor(Math.random() * 16);
      // AS: _rotation = -random(180) = -(0..179) degrees
      const rotationDeg = -(Math.floor(Math.random() * 180));
      const rotationRad = (rotationDeg * Math.PI) / 180;

      const anim6 = this.anims.add(new FrameAnimatedSprite({
        textures: sprite6Textures,
        anchorX: anchor6.x,
        anchorY: anchor6.y,
        scale: init.scale,
        startFrame,
        loop: true,
      }));
      anim6.sprite.position.set(posX, posY);
      anim6.sprite.rotation = rotationRad;

      this.container.addChild(anim6.sprite);
    }

    // --- sprite_24 (secondary anim, 165 frames) ---
    const anchor24 = calculateAnchor(SPRITE_24_MANIFEST);
    const anim24 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_24'),
      anchorX: anchor24.x,
      anchorY: anchor24.y,
      scale: init.scale,
    }));
    anim24.sprite.position.set(posX, posY);

    // frame_163 (0-indexed: 162): removeMovieClip() -> animation ends
    anim24.stopAt(162);

    this.container.addChild(anim24.sprite);
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
