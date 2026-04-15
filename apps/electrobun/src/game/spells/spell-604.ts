/**
 * Spell 604 - Dodge
 *
 * A dodge/evasion spell with a shoot animation and a duplicate effect.
 *
 * Components:
 * - shoot: Main animation at caster position, rotated toward target, 90 frames
 * - duplicate: Scale-adjusted overlay animation at caster position, stops at random frame
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'dodge_604'
 * - Frame 1 (shoot): _rotation = _parent.angle
 * - Frame 88 (shoot): removeMovieClip() - animation ends
 * - DefineSprite_26_duplicate frame 1: t = 10 * level + 50; scale = t%; gotoAndStop(random)
 * - DefineSprite_18 frame 79: stop()
 * - DefineSprite_24 frame 53: stop()
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 301.75,
  height: 135.95,
  offsetX: -101.9,
  offsetY: -60.45,
};

const DUPLICATE_MANIFEST: SpriteManifest = {
  width: 70.95,
  height: 116.9,
  offsetX: -41.1,
  offsetY: -70.65,
};

export class Spell604 extends BaseSpell {
  readonly spellId = 604;

  private shootAnim!: FrameAnimatedSprite;
  private duplicateAnim!: FrameAnimatedSprite;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Sound at frame 1 (0-indexed: frame 0)
    this.callbacks.playSound("dodge_604");

    // Shoot animation at caster position, rotated toward target
    // AS frame_88/DoAction: removeMovieClip() -> stop at frame index 87
    const shootTextures = textures.getFrames("shoot");
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;
    this.shootAnim.stopAt(87);
    this.container.addChild(this.shootAnim.sprite);

    // Duplicate animation at caster position
    // AS DefineSprite_26_duplicate frame_1:
    //   t = 10 * _parent.level + 50
    //   _xscale = t; _yscale = t
    //   gotoAndStop(random(_totalframes) + 1)
    const duplicateTextures = textures.getFrames("duplicate");
    const duplicateAnchor = calculateAnchor(DUPLICATE_MANIFEST);
    const t = 10 * level + 50;
    const asScale = t / 100;

    // random(_totalframes) + 1 is 1-indexed in AS; gotoAndStop -> 0-indexed stop frame
    const totalDuplicateFrames = duplicateTextures.length;
    const randomStopFrame = Math.floor(Math.random() * totalDuplicateFrames);

    this.duplicateAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: duplicateTextures,
        anchorX: duplicateAnchor.x,
        anchorY: duplicateAnchor.y,
        scale: init.scale * asScale,
      })
    );
    this.duplicateAnim.sprite.position.set(0, init.casterY);
    this.duplicateAnim.stopAt(randomStopFrame);
    this.container.addChild(this.duplicateAnim.sprite);

    // Signal hit when the shoot animation ends (frame 87)
    this.shootAnim.onFrame(87, () => this.signalHit());
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
