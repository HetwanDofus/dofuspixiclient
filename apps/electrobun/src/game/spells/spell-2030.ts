/**
 * Spell 2030 - Crockette (variant)
 *
 * A projectile spell with a "shoot" animation at caster and a looping "move"
 * projectile that travels toward the target.
 *
 * Components:
 * - shoot (DefineSprite_15_shoot): At caster position, rotated toward target.
 *   Frame 4 resets rotation to 0. Ends at frame 106 (removeMovieClip).
 * - move (DefineSprite_12): Multiple instances of a looping projectile.
 *   Each starts at a random frame, with random alpha and scale.
 *   Stops at frame 97.
 * - DefineSprite_8: A sprite with 1-in-5 chance to show alternate frame.
 *   Stops at frame 34 or 60.
 * - DefineSprite_14: A long animation that stops at frame 295.
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'crockette_206'
 * - Frame 4 (shoot): _rotation = 0
 * - Frame 106 (shoot): removeMovieClip / stop -> animation ends
 * - Frame 1 (move): gotoAndPlay(random(30) + 1), random alpha/scale
 * - Frame 97 (move): stop()
 * - Frame 1 (DefineSprite_8): if random(5) != 1 gotoAndStop(60); else continues
 * - Frame 34 (DefineSprite_8): stop()
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

// Number of "move" projectile instances to spawn
const MOVE_INSTANCE_COUNT = 8;

export class Spell2030 extends BaseSpell {
  readonly spellId = 2030;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnims: FrameAnimatedSprite[] = [];

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Play sound at frame 1 (0-indexed: 0)
    this.callbacks.playSound("crockette_206");

    // ---- Shoot animation (DefineSprite_15_shoot) ----
    // Positioned at caster, rotated toward target
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

    // Frame 4 (AS) -> index 3: _rotation = 0
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = 0;
    });

    // Frame 106 (AS) -> index 105: removeMovieClip / stop
    this.shootAnim.stopAt(105);

    this.container.addChild(this.shootAnim.sprite);

    // ---- Move projectile instances (DefineSprite_12) ----
    // Each instance starts at a random frame with random alpha and scale
    const moveTextures = textures.getFrames("move");
    const moveAnchor = calculateAnchor(MOVE_MANIFEST);

    for (let i = 0; i < MOVE_INSTANCE_COUNT; i++) {
      // AS: gotoAndPlay(random(30) + 1) -> 0-indexed start frame: Math.floor(Math.random() * 30)
      const startFrame = Math.floor(Math.random() * 30);

      // AS: _alpha = 30 + random(50)
      const alpha = (30 + Math.floor(Math.random() * 50)) / 100;

      // AS: t = 30 + random(120); _xscale = t; _yscale = t / 2
      const t = 30 + Math.floor(Math.random() * 120);
      const scaleX = (t / 100) * init.scale;
      const scaleY = (t / 2 / 100) * init.scale;

      const anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: moveTextures,
          anchorX: moveAnchor.x,
          anchorY: moveAnchor.y,
          startFrame,
          loop: true,
        })
      );

      // Position along the path from caster to target with slight variation
      const progress = (i + 1) / (MOVE_INSTANCE_COUNT + 1);
      const px = init.targetX * progress;
      const py = init.casterY + (init.targetY - init.casterY) * progress;

      anim.sprite.position.set(px, py);
      anim.sprite.rotation = init.angleRad;
      anim.sprite.scale.set(scaleX, scaleY);
      anim.sprite.alpha = alpha;

      // AS frame 97 (0-indexed: 96): stop()
      anim.stopAt(96);

      // Signal hit when first move anim reaches stop frame
      if (i === 0) {
        anim.onFrame(96, () => {
          this.signalHit();
        });
      }

      this.container.addChild(anim.sprite);
      this.moveAnims.push(anim);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
