/**
 * Spell 1013 - Licorne (Eniripsa)
 *
 * A healing/damage spell with multiple sprite instances at the target position.
 *
 * Components:
 * - sprite_25: Main composite animation at target cell position (123 frames, ends at 121)
 *   Contains 5 sprite_24 instances with randomized start frames and positions
 * - sprite_24 instances (119, 121, 123, 125, 127): Looping 24-frame animations
 *   placed at random offsets, each starting at a random frame
 * - sprite_16: Used within the composite (24 frames, stops at frame 22)
 *
 * Original AS timing:
 * - Frame 1 (sprite_25): Position at cellTo, initialize child sprites with random start frames
 * - Frame 4 (sprite_25): Play sound 'licrounch_1013'
 * - Frame 82 (sprite_25): Signal hit (this.end())
 * - Frame 121 (sprite_25): removeMovieClip() - animation ends
 *
 * Child sprite_24 instances on load:
 * - Instance 119: gotoAndPlay(random(14) + 1) -> startFrame 0-13
 * - Instance 121: gotoAndPlay(random(7) + 1)  -> startFrame 0-6
 * - Instance 123: gotoAndPlay(random(7) + 1)  -> startFrame 0-6
 * - Instance 125: gotoAndPlay(random(7) + 1)  -> startFrame 0-6
 * - Instance 127: gotoAndPlay(random(21) + 1) -> startFrame 0-20
 *
 * sprite_24 frame 22 action: _rotation = random(360)
 * sprite_24 frame 1 action: random position offset
 *   _X = 100 * (Math.random() - 0.5)
 *   _Y = -100 + 100 * (Math.random() - 0.5)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_25_MANIFEST: SpriteManifest = {
  width: 139.8,
  height: 124.65,
  offsetX: -66.1,
  offsetY: -212.75,
};

const SPRITE_24_MANIFEST: SpriteManifest = {
  width: 52.9,
  height: 51.75,
  offsetX: -30.55,
  offsetY: -23.4,
};

// Random start frame ranges for each sprite_24 instance (AS: random(N) = 0..N-1, then +1 for 1-indexed, convert to 0-indexed)
const INSTANCE_RANGES = [14, 7, 7, 7, 21];

export class Spell1013 extends BaseSpell {
  readonly spellId = 1013;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const sprite25Textures = textures.getFrames("sprite_25");
    const sprite24Textures = textures.getFrames("sprite_24");

    const anchor25 = calculateAnchor(SPRITE_25_MANIFEST);
    const anchor24 = calculateAnchor(SPRITE_24_MANIFEST);

    // Main composite animation (sprite_25) at target position
    const mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: sprite25Textures,
        anchorX: anchor25.x,
        anchorY: anchor25.y,
        scale: init.scale,
      })
    );
    mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 4 (0-indexed: 3) - play sound
    mainAnim.onFrame(3, () => this.callbacks.playSound("licrounch_1013"));

    // Frame 82 (0-indexed: 81) - signal hit
    mainAnim.onFrame(81, () => this.signalHit());

    this.container.addChild(mainAnim.sprite);

    // Spawn 5 sprite_24 child instances with randomized start frames and positions
    // These are placed relative to the target position
    for (let i = 0; i < 5; i++) {
      const range = INSTANCE_RANGES[i];

      // AS: gotoAndPlay(random(N) + 1) -> 1-indexed frame
      // 0-indexed: Math.floor(Math.random() * N) + 1 - 1 = Math.floor(Math.random() * N)
      const startFrame = Math.floor(Math.random() * range);

      // AS frame_1/DoAction: _X = 100*(Math.random()-0.5); _Y = -100+100*(Math.random()-0.5)
      const offsetX = 100 * (Math.random() - 0.5);
      const offsetY = -100 + 100 * (Math.random() - 0.5);

      const childAnim = this.anims.add(
        new FrameAnimatedSprite({
          textures: sprite24Textures,
          anchorX: anchor24.x,
          anchorY: anchor24.y,
          scale: init.scale,
          loop: true,
          startFrame,
        })
      );

      childAnim.sprite.position.set(
        init.targetX + offsetX * init.scale,
        init.targetY + offsetY * init.scale
      );

      // AS frame_22/DoAction: _rotation = random(360)
      // This fires each time the animation loops through frame 22 (0-indexed: 21)
      childAnim.onFrame(
        21,
        () => {
          childAnim.sprite.rotation =
            (Math.floor(Math.random() * 360) * Math.PI) / 180;
        },
        false
      );

      this.container.addChild(childAnim.sprite);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // The main animation (sprite_25) is the first registered animation
    // Spell ends when it completes (frame 121 = index 120, after which it's done)
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
