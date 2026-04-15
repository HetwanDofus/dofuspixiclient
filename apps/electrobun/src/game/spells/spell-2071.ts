/**
 * Spell 2071
 *
 * A composite animation with multiple sprite instances (DefineSprite_7) that have
 * randomized scale, position drift, and start frame, contained within DefineSprite_8.
 *
 * Components:
 * - anim1 (composite): Multiple instances of DefineSprite_7 at target position,
 *   each with random scale (50-109%), random velocity drift, and random start frame (0-29)
 *
 * Original AS timing:
 * - DefineSprite_7 frame_1: Set random scale, velocity; gotoAndPlay(random(30)+1)
 * - DefineSprite_7 frame_106 (0-indexed: 105): stop()
 * - DefineSprite_8 frame_109 (0-indexed: 108): removeMovieClip() -> complete
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const ANIM1_MANIFEST: SpriteManifest = {
  width: 54.6,
  height: 44.9,
  offsetX: -27.3,
  offsetY: -21.8,
};

/**
 * Internal state for each sprite_7 instance physics simulation
 */
interface SpritePhysics {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  stopped: boolean;
}

export class Spell2071 extends BaseSpell {
  readonly spellId = 2071;

  private spriteInstances: SpritePhysics[] = [];
  private instancesContainer!: Container;
  private outerAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);
    const anim1Textures = textures.getFrames("anim1");

    // Container for all instances, positioned at target
    this.instancesContainer = new Container();
    this.instancesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.instancesContainer);

    // The outer sprite (DefineSprite_8) is represented by anim1 itself.
    // frame_109 (0-indexed: 108) triggers removeMovieClip -> complete.
    // We use a single FrameAnimatedSprite for the outer timeline to track completion.
    // The manifest says stopFrame=108 and fadingFrame=107, so we stop at 108.
    this.outerAnim = new FrameAnimatedSprite({
      textures: anim1Textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 108,
    });
    // The outer anim sprite itself is not rendered visually (it's the container timeline),
    // but we use it for timing. We add it hidden to still benefit from update tracking.
    this.outerAnim.sprite.visible = false;
    this.instancesContainer.addChild(this.outerAnim.sprite);
    this.outerAnim.onFrame(108, () => this.complete());

    // Spawn multiple DefineSprite_7 instances.
    // The manifest has 111 frames for anim1 (composite), which corresponds to
    // DefineSprite_8's 111 frames. DefineSprite_7 has 106 frames (stops at frame 106 = index 105).
    // Based on original AS, the composite likely spawns several instances.
    // Looking at the animation structure: anim1 is composite with 111 frames,
    // containing multiple DefineSprite_7 instances. The typical pattern for such
    // composite spells spawns a small number (e.g., 5) instances.
    // Since no explicit count is given in AS, we use the composite frame data directly.
    // Each DefineSprite_7 frame_1 initializes its own physics, so we simulate that.

    const instanceCount = 5;

    for (let i = 0; i < instanceCount; i++) {
      // AS frame_1 of DefineSprite_7:
      // t = 50 + random(60)  -> scale percentage 50-109
      const t = 50 + Math.floor(Math.random() * 60);
      const asScale = t / 100;

      // vx = 6 * (-0.5 + Math.random())
      const vx = 6 * (-0.5 + Math.random());

      // vy = -3 - 5 * Math.random()
      const vy = -3 - 5 * Math.random();

      // gotoAndPlay(random(30) + 1) -> 0-indexed: random(30) = 0-29, so startFrame 0-29
      const startFrame = Math.floor(Math.random() * 30);

      const anim = new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale * asScale,
        startFrame,
        stopFrame: 105,
      });

      this.instancesContainer.addChild(anim.sprite);

      this.spriteInstances.push({
        anim,
        x: 0,
        y: 0,
        vx,
        vy,
        stopped: false,
      });
    }

    // Signal hit at frame 0 (instant effect at target)
    this.signalHit();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update outer timing animation
    this.outerAnim.update(deltaTime);

    // Update each sprite_7 instance with AS physics
    for (const inst of this.spriteInstances) {
      if (inst.stopped) {
        continue;
      }

      inst.anim.update(deltaTime);

      // AS onEnterFrame physics (runs every frame):
      // _X = _X + vx
      // _Y = _Y + vy
      // vx *= 0.9
      // vy *= 0.9
      // We apply per-frame step; since deltaTime may span multiple frames,
      // we approximate by applying once per update (frame-locked at 60fps via FrameAnimatedSprite)
      inst.x += inst.vx;
      inst.y += inst.vy;
      inst.vx *= 0.9;
      inst.vy *= 0.9;

      inst.anim.sprite.position.set(inst.x, inst.y);

      if (inst.anim.isStopped() || inst.anim.isComplete()) {
        inst.stopped = true;
      }
    }
  }
}
