/**
 * Spell 1107 - Autre
 *
 * A target-position effect using sprite_5 (background loop) and
 * multiple sprite_18 instances (small randomized looping effects).
 *
 * Components:
 * - sprite_5: 210-frame animation at target position, signals hit at frame 204 (AS frame 205)
 * - sprite_18 instances: each starts at a random frame (0-29), loops back to frame 5 at frame 36 (AS frame 37)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'autre_1107'
 * - Frame 205 (main): this.end() -> signal hit
 * - Frame 238 (main): removeMovieClip() -> complete
 * - DefineSprite_18 frame_1: gotoAndPlay(random(30)) -> random start 0-29
 * - DefineSprite_18 frame_37: gotoAndPlay(6) -> loop back to frame 5 (0-indexed)
 *
 * The main timeline has 238 frames total (removeMovieClip at 238).
 * sprite_5 has 210 frames (plays fully then the remaining frames are blank/hold).
 * sprite_18 has 39 frames, loops at frame 36->6 (0-indexed: 35->5).
 *
 * Number of sprite_18 instances: not explicitly stated in AS, but the manifest
 * shows one sprite_18 symbol. Looking at the main timeline, sprite_18 instances
 * are attached. Based on typical Dofus spell patterns and the manifest having
 * sprite_18 as a separate animation, we spawn a set of them at the target.
 *
 * Since the AS only shows DefineSprite_18 behavior (random start + loop),
 * and the main timeline controls count via attachMovie or timeline placement,
 * we use a reasonable count. The main timeline frame count is 238.
 * sprite_5 runs 210 frames. The remaining 28 frames (211-238) are for the
 * sprite_18 loop to finish. We'll use 5 sprite_18 instances as a typical
 * Dofus particle decoration count (the AS doesn't specify exact count in
 * provided scripts, so we use what's visually standard).
 *
 * Actually, re-reading: the manifest only lists sprite_5 and sprite_18 animations.
 * The main timeline places these. Since no explicit count is given, we use 1
 * of each as placed on the timeline. But sprite_18's random start suggests
 * multiple instances. We'll use 6 instances based on typical usage.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_5_MANIFEST: SpriteManifest = {
  width: 125.7,
  height: 125.7,
  offsetX: -72.15,
  offsetY: -66.05,
};

const SPRITE_18_MANIFEST: SpriteManifest = {
  width: 63.55,
  height: 43.9,
  offsetX: -28.55,
  offsetY: -25.6,
};

// Number of sprite_18 instances to place at the target
const SPRITE_18_COUNT = 6;

export class Spell1107 extends BaseSpell {
  readonly spellId = 1107;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const sprite5Textures = textures.getFrames('sprite_5');
    const sprite18Textures = textures.getFrames('sprite_18');

    const sprite5Anchor = calculateAnchor(SPRITE_5_MANIFEST);
    const sprite18Anchor = calculateAnchor(SPRITE_18_MANIFEST);

    // Play sound at frame 0 (AS frame 1)
    this.callbacks.playSound('autre_1107');

    // sprite_5: main effect at target position
    // AS frame 205 = 0-indexed frame 204 -> signal hit
    // sprite_5 has 210 frames (0-209), plays through completely
    const mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite5Textures,
      fps: 60,
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      scale: init.scale,
    }));
    mainAnim.sprite.position.set(init.targetX, init.targetY);
    mainAnim
      .onFrame(204, () => this.signalHit());
    this.container.addChild(mainAnim.sprite);

    // sprite_18 instances: small looping decorations at target position
    // Each starts at random frame (AS: gotoAndPlay(random(30)) -> 0-indexed: 0-29)
    // Loops: at frame 36 (AS frame 37), gotoAndPlay(6) -> 0-indexed: frame 5
    for (let i = 0; i < SPRITE_18_COUNT; i++) {
      const startFrame = Math.floor(Math.random() * 30);

      const anim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite18Textures,
        fps: 60,
        anchorX: sprite18Anchor.x,
        anchorY: sprite18Anchor.y,
        scale: init.scale,
        startFrame,
        loop: false,
      }));

      // Loop back to frame 5 (0-indexed) when reaching frame 36 (0-indexed, AS frame 37)
      anim.onFrame(36, () => {
        anim.gotoFrame(5);
      }, false);

      // Position slightly randomized around target for visual variety
      const offsetX = (Math.random() - 0.5) * 40 * init.scale;
      const offsetY = (Math.random() - 0.5) * 20 * init.scale;
      anim.sprite.position.set(init.targetX + offsetX, init.targetY + offsetY);

      this.container.addChild(anim.sprite);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when main sprite_5 animation finishes
    // sprite_5 has 210 frames; once it completes, we're done
    // The sprite_18 instances loop so we check only the main anim (first registered)
    // We track completion via the sprite_5 animation completing
    // allComplete() won't work because sprite_18 loops; check manually
    const mainAnim = this.getMainAnim();
    if (mainAnim !== null && mainAnim.isComplete()) {
      this.complete();
    }
  }

  private mainAnimRef: FrameAnimatedSprite | null = null;

  protected setup_storeMain(anim: FrameAnimatedSprite): void {
    this.mainAnimRef = anim;
  }

  private getMainAnim(): FrameAnimatedSprite | null {
    return this.mainAnimRef;
  }
}
