/**
 * Spell 611 - Dodge (Crâ)
 *
 * A dodge spell with a "move" projectile that travels and then transforms into
 * a "shoot" impact animation with particle emitters.
 *
 * Components:
 * - move (sprite): At target position, plays briefly then is replaced
 * - shoot (sprite): At target position, plays the impact animation
 *   - Contains particle emitters (DefineSprite_9) that scatter outward
 *   - At frame 109: starts fading out (_alpha -= 3 each frame)
 *   - At frame 142: stop()
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'dodge_601'
 * - Frame 1 (shoot): removeMovieClip() on move, particles initialized
 * - Frame 109 (shoot): Begin alpha fade (-3 per frame)
 * - Frame 142 (shoot): stop()
 *
 * The "move" animation (DefineSprite_14_move):
 * - Contains multiple sub-sprites (DefineSprite_13) that each move at v = 2*random()-3
 * - Has 6 sub-instances each at random start frames
 * - Frame 2: stores _rotation as roti, stop()
 *
 * The shoot animation particles (DefineSprite_9):
 * - Each particle: vrot = -25 + 50*random(), vrot2 = -0.3 + 0.6*random()
 * - Movement: x/y driven by cos/sin of roti, decelerated by dv
 * - Fade when c._y >= p
 *
 * Hit signal: frame 1 of shoot (when projectile arrives at target)
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 108.5,
  height: 43.5,
  offsetX: -66,
  offsetY: -27.25,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 161.15,
  height: 44.1,
  offsetX: -98.4,
  offsetY: -21.7,
};

export class Spell611 extends BaseSpell {
  readonly spellId = 611;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;
  private shootContainer!: Container;
  private currentAlpha = 1;
  private fadingOut = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play sound at frame 1 (index 0)
    this.callbacks.playSound('dodge_601');

    // Target position is where both animations play
    const tx = init.targetX;
    const ty = init.targetY;

    // Container for the shoot animation (so we can fade it out)
    this.shootContainer = new Container();
    this.shootContainer.position.set(tx, ty);
    this.container.addChild(this.shootContainer);

    // Shoot animation (DefineSprite_11_shoot) - 144 frames, stops at frame 142 (index 141)
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));

    // Frame 109 (index 108): start fading out
    this.shootAnim.onFrame(108, () => {
      this.fadingOut = true;
    });

    // Stop at frame 142 (index 141)
    this.shootAnim.stopAt(141);

    this.shootContainer.addChild(this.shootAnim.sprite);

    // Signal hit immediately when shoot starts (frame 1 = the impact moment)
    this.signalHit();

    // Move animation (DefineSprite_14_move) - 2 frames, shown briefly before shoot takes over
    // In the original AS, move is removed when shoot starts (frame 1 of shoot removes it)
    // Since shoot plays from frame 1 and immediately removes move, we just play move briefly
    // and then hide it. The move animation just shows for its duration (it stops at frame 2).
    const moveAnchor = calculateAnchor(MOVE_MANIFEST);
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      fps: 60,
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      scale: init.scale,
    }));

    // Move stops at frame 2 (index 1) per DefineSprite_14_move/frame_2/DoAction.as
    this.moveAnim.stopAt(1);

    // Move is removed when shoot starts (frame 1 of shoot = index 0)
    // Since shoot starts immediately, hide move right away
    this.moveAnim.sprite.visible = false;

    this.shootContainer.addChild(this.moveAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Handle alpha fade: from frame 109 onward, alpha decreases by 3 per frame
    // AS: _parent._alpha -= 3 each enterFrame
    if (this.fadingOut) {
      // 3/255 per frame at 60fps
      this.currentAlpha -= (3 / 255) * (deltaTime / (1000 / 60));
      if (this.currentAlpha < 0) {
        this.currentAlpha = 0;
      }
      this.shootContainer.alpha = this.currentAlpha;
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
