/**
 * Spell 710 - Grina (Roublard)
 *
 * A spinning projectile spell with three looping blade sprites at the caster position,
 * followed by an impact animation at the target.
 *
 * Components:
 * - sprite_23 (DefineSprite_23): Main animation at caster position (225 frames)
 *   - Contains 3 sprite_6 instances (spinning blades), each starting at random frames
 *   - Also contains a spinning inner element (DefineSprite_17) with rotation decay
 * - sprite_24 (DefineSprite_24): Impact animation at caster position (165 frames)
 *
 * Original AS timing (sprite_23):
 * - Frame 1: Play sound 'grina_709b'
 * - Frame 49: Play sound 'grina_709'
 * - Frame 58: this.end() -> signalHit
 * - Frame 64: Play sound 'grina_710'
 *
 * sprite_24 timing:
 * - Frame 163: removeMovieClip() -> complete
 *
 * sprite_6 instances: each starts at random(_totalframes + 1) = random(16) -> 0..15
 * sprite_6 frame_1: _rotation = -random(180) -> random initial rotation
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

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

export class Spell710 extends BaseSpell {
  readonly spellId = 710;

  private mainAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const sprite23Textures = textures.getFrames("sprite_23");
    const sprite24Textures = textures.getFrames("sprite_24");
    const sprite6Textures = textures.getFrames("sprite_6");

    const anchor23 = calculateAnchor(SPRITE_23_MANIFEST);
    const anchor24 = calculateAnchor(SPRITE_24_MANIFEST);
    const anchor6 = calculateAnchor(SPRITE_6_MANIFEST);

    // Main animation (sprite_23) at caster position
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: sprite23Textures,
        anchorX: anchor23.x,
        anchorY: anchor23.y,
        scale: init.scale,
      })
    );
    this.mainAnim.sprite.position.set(0, init.casterY);
    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound("grina_709b"))
      .onFrame(48, () => this.callbacks.playSound("grina_709"))
      .onFrame(57, () => this.signalHit())
      .onFrame(63, () => this.callbacks.playSound("grina_710"));
    this.container.addChild(this.mainAnim.sprite);

    // Impact animation (sprite_24) at caster position
    // AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y; (placed at frame_1, caster pos)
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: sprite24Textures,
        anchorX: anchor24.x,
        anchorY: anchor24.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(0, init.casterY);
    // Frame 163 (0-indexed: 162): removeMovieClip -> complete
    this.impactAnim.stopAt(162);
    this.container.addChild(this.impactAnim.sprite);

    // Three sprite_6 instances inside the main animation container
    // AS: PlaceObject2_6_9, PlaceObject2_6_5, PlaceObject2_6_13
    // Each: gotoAndPlay(random(_totalframes + 1)) -> random(16) = 0..15
    // Each also: _rotation = -random(180) at frame_1
    // We simulate these as child sprites on top of the caster position
    // They are part of DefineSprite_23 internally, but we add them as separate
    // overlays at the same position as the main anim.
    for (let i = 0; i < 3; i++) {
      // random(_totalframes + 1): _totalframes = 15, so random(16) = 0..15
      const startFrame = Math.floor(Math.random() * 16);
      // _rotation = -random(180): random(180) = 0..179
      const rotation = -Math.floor(Math.random() * 180);

      const blade = this.anims.add(
        new FrameAnimatedSprite({
          textures: sprite6Textures,
          anchorX: anchor6.x,
          anchorY: anchor6.y,
          scale: init.scale,
          startFrame,
          loop: true,
        })
      );
      blade.sprite.position.set(0, init.casterY);
      blade.sprite.rotation = (rotation * Math.PI) / 180;
      this.container.addChild(blade.sprite);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when the impact animation reaches its stop frame (frame 162)
    if (this.impactAnim.isStopped() || this.impactAnim.isComplete()) {
      this.complete();
    }
  }
}
