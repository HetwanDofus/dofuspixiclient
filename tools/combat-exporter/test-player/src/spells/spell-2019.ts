/**
 * Spell 2019 - Herbe
 *
 * A projectile spell with a shoot animation at caster position and a
 * moving projectile (move animation) that travels toward the target.
 *
 * Components:
 * - shoot (DefineSprite_15_shoot): At caster position, 108 frames total,
 *   rotation reset to 0 at frame 4, ends at frame 106
 * - move (DefineSprite_12): Projectile looping sprite, positioned at caster,
 *   travels toward target with random start frame, alpha, and scale
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'herbe'
 * - DefineSprite_15_shoot frame_4: _rotation = 0
 * - DefineSprite_15_shoot frame_106: _parent.removeMovieClip() / stop()
 * - DefineSprite_12 frame_1: gotoAndPlay(random(30) + 1), random alpha/scale
 * - DefineSprite_12 frame_97: stop()
 * - DefineSprite_8 frame_1: if(random(5) != 1) gotoAndStop(60)
 * - DefineSprite_8 frame_34: stop()
 * - DefineSprite_14 frame_295: stop()
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
  width: 63.6,
  height: 30.2,
  offsetX: -31.8,
  offsetY: -14.75,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

export class Spell2019 extends BaseSpell {
  readonly spellId = 2019;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;

  // Projectile movement state
  private projectileActive = false;
  private projectileX = 0;
  private projectileY = 0;
  private projectileVX = 0;
  private projectileVY = 0;
  private targetX2 = 0;
  private targetY2 = 0;
  private hitSignaledProjectile = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play sound at frame 1 (index 0)
    this.callbacks.playSound('herbe');

    // --- Shoot animation (DefineSprite_15_shoot) at caster position ---
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // frame_4 (AS 1-indexed) -> frame index 3: _rotation = 0
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = 0;
    });

    // frame_106 (AS 1-indexed) -> frame index 105: end
    this.shootAnim.stopAt(105);

    this.container.addChild(this.shootAnim.sprite);

    // --- Move animation (DefineSprite_12) - the projectile ---
    // AS frame_1: gotoAndPlay(random(30) + 1) -> 0-indexed: Math.floor(Math.random() * 30) + 0 => start at random(30) (0-29)
    // Actually: random(30) + 1 in AS means jump to frame random(30)+1 (1-indexed), so 0-indexed it's random(30)+0 = Math.floor(Math.random()*30)
    const startFrame = Math.floor(Math.random() * 30);

    // AS: _alpha = 30 + random(50) -> percentage (0-100)
    const alpha = (30 + Math.floor(Math.random() * 50)) / 100;

    // AS: t = 30 + random(120); _xscale = t; _yscale = t / 2
    const t = 30 + Math.floor(Math.random() * 120);
    const xScale = (t / 100) * init.scale;
    const yScale = (t / 2 / 100) * init.scale;

    const moveAnchor = calculateAnchor(MOVE_MANIFEST);
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      fps: 60,
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      startFrame,
      loop: true,
    }));

    // Stop at frame 96 (AS frame_97, 0-indexed = 96)
    this.moveAnim.stopAt(96);

    this.moveAnim.sprite.alpha = alpha;
    this.moveAnim.sprite.scale.set(xScale, yScale);
    this.moveAnim.sprite.rotation = init.angleRad;

    // Start projectile at caster position
    this.projectileX = 0;
    this.projectileY = init.casterY;
    this.moveAnim.sprite.position.set(this.projectileX, this.projectileY);

    // Target position
    this.targetX2 = init.targetX;
    this.targetY2 = init.targetY;

    // Calculate velocity: move toward target over ~30 frames at 60fps
    const dx = this.targetX2 - this.projectileX;
    const dy = this.targetY2 - this.projectileY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Speed based on distance - travel in about 20-40 frames
    const speed = dist > 0 ? Math.max(5, dist / 25) : 5;
    this.projectileVX = dist > 0 ? (dx / dist) * speed : 0;
    this.projectileVY = dist > 0 ? (dy / dist) * speed : 0;

    this.projectileActive = true;

    this.container.addChild(this.moveAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Move the projectile toward target
    if (this.projectileActive) {
      const framesElapsed = deltaTime / (1000 / 60);

      this.projectileX += this.projectileVX * framesElapsed;
      this.projectileY += this.projectileVY * framesElapsed;
      this.moveAnim.sprite.position.set(this.projectileX, this.projectileY);

      // Check if projectile reached target
      const dx = this.targetX2 - this.projectileX;
      const dy = this.targetY2 - this.projectileY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this.hitSignaledProjectile && dist < Math.max(Math.abs(this.projectileVX), Math.abs(this.projectileVY)) * 2 + 5) {
        this.hitSignaledProjectile = true;
        this.projectileActive = false;
        this.signalHit();
        this.moveAnim.sprite.visible = false;
      }
    }

    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      if (!this.projectileActive) {
        this.complete();
      }
    }
  }
}
