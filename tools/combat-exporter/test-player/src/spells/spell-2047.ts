/**
 * Spell 2047 - Move/Shoot
 *
 * A projectile spell with a wobbling rotation effect.
 *
 * Components:
 * - shoot (sprite): At caster position, rotated toward target
 *   - Has a wobbling rotation animation driven by: _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1
 *   - Stops at frame 88 (AS frame 88 = index 87, but DoAction is at frame_88 which is index 87)
 *
 * Original AS timing:
 * - onClipEvent(load): a = 30; i = 0;
 * - onClipEvent(enterFrame): _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1;
 * - Frame 88 (DoAction): _parent.removeMovieClip(); stop();
 *   (AS frame 88 = 0-indexed frame 87 → animation completes at frame 87)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 223.6,
  height: 41.1,
  offsetX: 1.55,
  offsetY: -24.95,
};

export class Spell2047 extends BaseSpell {
  readonly spellId = 2047;

  private shootAnim!: FrameAnimatedSprite;

  // Wobble state (from onClipEvent(load))
  private wobbleA = 30;
  private wobbleI = 0;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Position at caster, rotated toward target
    this.shootAnim.sprite.position.set(0, init.casterY);

    // Initial rotation includes the angle toward target
    // The wobble will be applied as an offset each frame
    this.shootAnim.sprite.rotation = init.angleRad;

    // Signal hit when the shoot animation completes (frame 87, AS frame 88)
    this.shootAnim.onFrame(87, () => {
      this.signalHit();
    });

    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply wobble rotation each frame (from onClipEvent(enterFrame))
    // AS: _rotation = 90 + a * Math.cos(i += 0.6); a /= 1.1;
    // _rotation in Flash is in degrees relative to parent, but here we add it as an offset
    // The base rotation is the angle toward target (angleRad), and wobble adds a rotation offset
    this.wobbleI += 0.6;
    const wobbleDeg = 90 + this.wobbleA * Math.cos(this.wobbleI);
    this.wobbleA /= 1.1;

    // In Flash, _rotation replaces the rotation entirely (in degrees)
    // The parent of the shoot clip has the angle, so the shoot clip's own rotation = wobbleDeg
    // Convert to radians for PixiJS
    this.shootAnim.sprite.rotation = (wobbleDeg * Math.PI) / 180;

    // Check completion (frame 87 = AS frame 88 where stop() is called)
    if (this.shootAnim.isComplete() || this.shootAnim.getFrame() >= 87) {
      this.complete();
    }
  }
}
