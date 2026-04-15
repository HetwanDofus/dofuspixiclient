/**
 * Spell 405 - Lakam
 *
 * A water droplet spell where a projectile shoots from caster to target,
 * trailing "goutte" (droplet) particles, with a hit effect at the target.
 *
 * Components:
 * - anim1: Single composite animation at target position
 *
 * The animation contains multiple sub-sprites (shoot projectile + impact droplets)
 * whose visibility is controlled by spell level:
 * - Level 1: Only base elements visible
 * - Level 2+: Additional droplets shown
 * - Level 3+: More droplets
 * - Level 4+: Even more
 * - Level 5+: Maximum droplets
 *
 * The shoot sprite (DefineSprite_11_shoot) scales based on level:
 *   t = 50 + 10 * level
 *
 * The goutte (droplet) particles (DefineSprite_18) have physics:
 *   v = 5 + 18 * Math.random() (x velocity)
 *   va = 1 + Math.random() * 3 (alpha decay per frame - NOTE: AS Math.random(3) is buggy, returns 0-1)
 *   t = 50 + 50 * Math.random() (initial scale)
 *   Each frame: _X += v; _alpha -= va; v /= 1.2
 *   Spawns up to 4 * level child "goutte" sprites (static, just placed)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_405'
 * - Frame 112 (DefineSprite_19): this.end() → signal hit (0-indexed: 111)
 * - Frame 151 (DefineSprite_19): removeMovieClip() → complete (0-indexed: 150)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const ANIM1_MANIFEST: SpriteManifest = {
  width: 117.9,
  height: 113.5,
  offsetX: -41.55,
  offsetY: -56.25,
};

export class Spell405 extends BaseSpell {
  readonly spellId = 405;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .stopAt(150)
      .onFrame(0, () => this.callbacks.playSound("lakam_405"))
      .onFrame(111, () => this.signalHit());

    this.mainAnim.addTo(this.container);
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
