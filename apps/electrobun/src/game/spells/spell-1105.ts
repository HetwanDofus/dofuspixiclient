/**
 * Spell 1105 - Autre
 *
 * Two-component spell animation:
 * - sprite_2: Main effect at target position, signals hit at frame 204, ends at frame 237
 * - sprite_4: Background looping element at target position, starts at random frame
 *   (random(270) + 3 → 0-indexed: random frame in [2..271]), loops from frame 314
 *   when it reaches frame 639
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'autre_1105'
 * - Frame 205 (main): this.end() → signal hit
 * - Frame 238 (main): removeMovieClip() → complete
 * - DefineSprite_4 frame 1: gotoAndPlay(random(270) + 3) → start at random frame [2..271]
 * - DefineSprite_4 frame 640: gotoAndPlay(315) → loop back to frame 314 (0-indexed)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_2_MANIFEST: SpriteManifest = {
  width: 143,
  height: 143,
  offsetX: -80.8,
  offsetY: -74.7,
};

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 48.6,
  height: 48.6,
  offsetX: -24.3,
  offsetY: -24.3,
};

export class Spell1105 extends BaseSpell {
  readonly spellId = 1105;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const sprite4Textures = textures.getFrames("sprite_4");

    // sprite_4: background looping element at target position
    // AS: gotoAndPlay(random(270) + 3) → 1-indexed frame 3..272 → 0-indexed 2..271
    const sprite4StartFrame = Math.floor(Math.random() * 270) + 2;
    const anchor4 = calculateAnchor(SPRITE_4_MANIFEST);

    const bgAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: sprite4Textures,
        anchorX: anchor4.x,
        anchorY: anchor4.y,
        scale: init.scale,
        startFrame: sprite4StartFrame,
        loop: false,
      })
    );
    bgAnim.sprite.position.set(init.targetX, init.targetY);

    // AS: frame 640 → gotoAndPlay(315) means loop back to frame 314 (0-indexed)
    // We implement this by stopping at frame 638 (0-indexed for AS frame 639)
    // and re-playing from frame 314. We'll handle the loop manually via onFrame.
    // Actually AS frame 640 = index 639, gotoAndPlay(315) = index 314
    bgAnim.onFrame(639, () => {
      bgAnim.gotoFrame(314);
      bgAnim.play();
    });

    this.container.addChild(bgAnim.sprite);

    // sprite_2: main effect at target position
    const sprite2Textures = textures.getFrames("sprite_2");
    const anchor2 = calculateAnchor(SPRITE_2_MANIFEST);

    const mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: sprite2Textures,
        anchorX: anchor2.x,
        anchorY: anchor2.y,
        scale: init.scale,
        stopFrame: 237,
      })
    );
    mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (AS) = frame 0 (0-indexed): play sound
    mainAnim.onFrame(0, () => this.callbacks.playSound("autre_1105"));

    // Frame 205 (AS) = frame 204 (0-indexed): signal hit
    mainAnim.onFrame(204, () => this.signalHit());

    this.container.addChild(mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when main animation (sprite_2) reaches its stop frame (237, 0-indexed)
    // sprite_2 is the second registered animation (index 1)
    // We complete when it is stopped (reached stopFrame 237)
    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
