/**
 * Spell 313 - Fléau de Béhémoth (Sram)
 *
 * An explosion spell with two components:
 * - sprite_3: A small flickering/wobbling sprite at the target (stops at frame 33)
 * - sprite_14: Main explosion animation at target position (174 frames, signals hit at frame 72, ends at frame 171)
 *
 * sprite_14 contains two internal sprites (PlaceObject2_3_1 and PlaceObject2_3_3) that wobble
 * with decaying amplitude rotation. These are baked into the composite animation frames.
 *
 * Original AS timing:
 * - Frame 1 (sprite_14/DoAction): Position at cellTo
 * - Frame 70 (sprite_14): Play sound 'explosion'
 * - Frame 73 (sprite_14): Signal hit (this.end())
 * - Frame 172 (sprite_14): removeMovieClip() - animation ends
 * - Frame 34 (sprite_3): stop()
 *
 * DefineSprite_12 (PlaceObject2_11_1) is an internal child of sprite_14 with
 * flying debris physics - baked into the composite frames.
 *
 * DefineSprite_7 (PlaceObject2_6_1) is an internal particle child - baked into frames.
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_3_MANIFEST: SpriteManifest = {
  width: 19,
  height: 63.5,
  offsetX: -9.95,
  offsetY: -120.15,
};

const SPRITE_14_MANIFEST: SpriteManifest = {
  width: 182.45,
  height: 213.45,
  offsetX: -79,
  offsetY: -197,
};

export class Spell313 extends BaseSpell {
  readonly spellId = 313;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // sprite_14: Main explosion at target position
    const sprite14Anchor = calculateAnchor(SPRITE_14_MANIFEST);
    const sprite14 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_14"),
        anchorX: sprite14Anchor.x,
        anchorY: sprite14Anchor.y,
        scale: init.scale,
      })
    );
    sprite14.sprite.position.set(init.targetX, init.targetY);
    sprite14
      .onFrame(69, () => this.callbacks.playSound("explosion"))
      .onFrame(72, () => this.signalHit());
    this.container.addChild(sprite14.sprite);

    // sprite_3: Small wobbling sprite at target position, stops at frame 33
    const sprite3Anchor = calculateAnchor(SPRITE_3_MANIFEST);
    const sprite3 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_3"),
        anchorX: sprite3Anchor.x,
        anchorY: sprite3Anchor.y,
        scale: init.scale,
      })
    );
    sprite3.sprite.position.set(init.targetX, init.targetY);
    sprite3.stopAt(33);
    this.container.addChild(sprite3.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
