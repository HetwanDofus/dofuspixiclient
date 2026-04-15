/**
 * Spell 806 - Vlad (Sacrieur)
 *
 * An impact spell with multiple animated ring/flash effects at the target position.
 * Each effect has a different initial scale velocity (t) and signals hit at different frames.
 *
 * Components:
 * - anim1 (DefineSprite_3): Background layer with random rotation and 50% alpha
 * - DefineSprite_6: Impact flash - grows from 0 scale using exponential decay
 *   - Frame 1: Play sound 'punch', initialize scale growth
 *   - Frame 19: stop()
 * - DefineSprite_7: Ring effect, t=7, hit at frame 22, remove at frame 91
 * - DefineSprite_8: Ring effect, t=11, hit at frame 64, remove at frame 106
 * - DefineSprite_9: Ring effect, t=20, hit at frame 79, remove at frame 118
 * - DefineSprite_10: Ring effect, t=25, hit at frame 79, remove at frame 121
 * - DefineSprite_11: Ring effect, t=33, hit at frame 79, remove at frame 121
 *
 * Main timeline:
 * - Frame 1: Play sound 'vlad_806'
 *
 * DefineSprite_12: Selects frame based on level (gotoAndStop(_parent.level))
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_806'
 * - Frame 1 (DefineSprite_6): Play sound 'punch', start scale growth animation
 * - Frame 1 (DefineSprite_3): Random rotation, 50% alpha
 * - Frame 19 (DefineSprite_6): stop()
 * - Frame 22 (DefineSprite_7): this.end() -> signalHit
 * - Frame 64 (DefineSprite_8): this.end() -> signalHit
 * - Frame 79 (DefineSprite_9,10,11): this.end() -> signalHit
 * - Frame 91 (DefineSprite_7): removeMovieClip + stop
 * - Frame 106 (DefineSprite_8): removeMovieClip + stop
 * - Frame 118 (DefineSprite_9): removeMovieClip + stop
 * - Frame 121 (DefineSprite_10,11): removeMovieClip + stop
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
  width: 238.25,
  height: 242.35,
  offsetX: -84.65,
  offsetY: -144.45,
};

/**
 * Simulates the DefineSprite_6 scale growth behavior:
 * - Starts at _xscale = 0, _yscale = 0
 * - Each frame: scale += t; t /= 1.6
 * - where t = random(_parent.t) + _parent.t (parentT passed in)
 *
 * We compute the scale value at each frame and apply it.
 */
function _computeSprite6ScalesAtFrames(
  parentT: number,
  frameCount: number
): number[] {
  // t = random(parentT) + parentT => random(parentT) in [0, parentT-1]
  // We pick a fixed value by simulating: we store scale progression per frame
  // Since this is a simulation, we precompute scales using the AS formula
  // The actual t is randomized at runtime, so we replicate using Math.random()
  const t_init = Math.floor(Math.random() * parentT) + parentT;
  const scales: number[] = [];
  let scaleVal = 0;
  let t = t_init;
  for (let i = 0; i < frameCount; i++) {
    scaleVal += t;
    t /= 1.6;
    scales.push(scaleVal / 100); // convert from AS _xscale (percentage) to PixiJS scale
  }
  return scales;
}

export class Spell806 extends BaseSpell {
  readonly spellId = 806;

  // We need a separate container for the target-positioned effects
  private targetContainer!: Container;

  // Scale animation state for DefineSprite_6
  private sprite6ScaleX = 0;
  private sprite6ScaleY = 0;
  private sprite6T = 0;
  private sprite6Stopped = false;
  private sprite6Frame = 0;
  private sprite6Anim!: FrameAnimatedSprite;

  // Ring animations
  private sprite7Anim!: FrameAnimatedSprite;
  private sprite8Anim!: FrameAnimatedSprite;
  private sprite9Anim!: FrameAnimatedSprite;
  private sprite10Anim!: FrameAnimatedSprite;
  private sprite11Anim!: FrameAnimatedSprite;

  // Frame time tracking for sprite6 scale animation (runs every frame at 60fps)
  private sprite6FrameAccum = 0;
  private readonly FRAME_TIME = 1000 / 60;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Play main sound at frame 1
    this.callbacks.playSound("vlad_806");

    // Target container - all effects at target position
    this.targetContainer = new Container();
    this.targetContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.targetContainer);

    // DefineSprite_3 (anim1): background with random rotation and 50% alpha
    // Uses anim1 frames (5 frames), level-based frame selection (gotoAndStop(level))
    // But DefineSprite_12 does gotoAndStop(_parent.level), so we pick frame = level-1
    const anim1Textures = textures.getFrames("anim1");
    const anim1Anchor = calculateAnchor(ANIM1_MANIFEST);
    const frameIndex = Math.min(level - 1, anim1Textures.length - 1);
    const bgAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
        startFrame: frameIndex,
      })
    );
    bgAnim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
    bgAnim.sprite.alpha = 0.5;
    // Stop immediately (gotoAndStop shows single frame)
    bgAnim.stopAt(frameIndex);
    this.targetContainer.addChild(bgAnim.sprite);

    // DefineSprite_6: Impact flash, grows from 0 using exponential decay
    // t = random(_parent.t) + _parent.t, where _parent.t depends on which sprite contains it
    // Looking at the AS: DefineSprite_6 is placed inside other sprites or main timeline
    // The manifest shows anim1 frames. DefineSprite_6 uses 'punch' sound and its own scale logic
    // _parent.t for DefineSprite_6 - based on context, we'll use a base t of the anim1 sprite
    // Since DefineSprite_6/frame_1 says _parent.t, and _parent would be one of the ring sprites,
    // the t values are defined in those ring sprites (7, 11, 20, 25, 33).
    // For simplicity: DefineSprite_6 is likely embedded in one ring sprite or main timeline.
    // Given structure, DefineSprite_6 appears to be its own top-level effect.
    // We'll treat it as having parentT from main timeline context.
    // Since the main timeline doesn't define 't', and DefineSprite_6 references _parent.t,
    // it's likely placed inside one of the ring sprites. We'll use t=7 (smallest) as default.
    // Actually, given the sound 'punch' is in DefineSprite_6 and listed in manifest sounds at frame 0,
    // we handle it as a standalone effect at target.
    // We'll use the anim1 frames for the flash effect (same textures as the main sprite),
    // with scale animation starting from 0.
    const parentT6 = 7; // _parent.t for DefineSprite_6 - using DefineSprite_7's t value
    this.sprite6T = Math.floor(Math.random() * parentT6) + parentT6;
    this.sprite6ScaleX = 0;
    this.sprite6ScaleY = 0;

    this.sprite6Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
        stopFrame: 18, // frame 19 in AS = index 18
      })
    );
    this.sprite6Anim.sprite.scale.set(0, 0); // starts at 0
    this.targetContainer.addChild(this.sprite6Anim.sprite);

    // Play punch sound at frame 1 of DefineSprite_6
    this.callbacks.playSound("punch");

    // DefineSprite_7: Ring effect, t=7, hit at frame 22, remove at frame 91
    this.sprite7Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
      })
    );
    this.sprite7Anim
      .stopAt(90) // frame 91 = index 90
      .onFrame(21, () => {
        // frame 22 = index 21
        this.signalHit();
      });
    this.targetContainer.addChild(this.sprite7Anim.sprite);

    // DefineSprite_8: Ring effect, t=11, hit at frame 64, remove at frame 106
    this.sprite8Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
      })
    );
    this.sprite8Anim
      .stopAt(105) // frame 106 = index 105
      .onFrame(63, () => {
        // frame 64 = index 63
        // end() for sprite8
      });
    this.targetContainer.addChild(this.sprite8Anim.sprite);

    // DefineSprite_9: Ring effect, t=20, hit at frame 79, remove at frame 118
    this.sprite9Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
      })
    );
    this.sprite9Anim
      .stopAt(117) // frame 118 = index 117
      .onFrame(78, () => {
        // frame 79 = index 78
        // end() for sprite9
      });
    this.targetContainer.addChild(this.sprite9Anim.sprite);

    // DefineSprite_10: Ring effect, t=25, hit at frame 79, remove at frame 121
    this.sprite10Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
      })
    );
    this.sprite10Anim
      .stopAt(120) // frame 121 = index 120
      .onFrame(78, () => {
        // frame 79 = index 78
        // end() for sprite10
      });
    this.targetContainer.addChild(this.sprite10Anim.sprite);

    // DefineSprite_11: Ring effect, t=33, hit at frame 79, remove at frame 121
    this.sprite11Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anim1Anchor.x,
        anchorY: anim1Anchor.y,
        scale: init.scale,
      })
    );
    this.sprite11Anim
      .stopAt(120) // frame 121 = index 120
      .onFrame(78, () => {
        // frame 79 = index 78
        // end() for sprite11
      });
    this.targetContainer.addChild(this.sprite11Anim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update sprite6 scale animation (onEnterFrame each game frame)
    if (!this.sprite6Stopped) {
      this.sprite6FrameAccum += deltaTime;
      while (
        this.sprite6FrameAccum >= this.FRAME_TIME &&
        !this.sprite6Stopped
      ) {
        this.sprite6FrameAccum -= this.FRAME_TIME;
        this.sprite6ScaleX += this.sprite6T;
        this.sprite6ScaleY += this.sprite6T;
        this.sprite6T /= 1.6;
        this.sprite6Frame++;

        // Apply scale to sprite6 (convert from AS _xscale percentage to PixiJS scale)
        const baseScale = 1; // init.scale already applied via constructor
        this.sprite6Anim.sprite.scale.set(
          (this.sprite6ScaleX / 100) * baseScale,
          (this.sprite6ScaleY / 100) * baseScale
        );

        if (this.sprite6Frame >= 18) {
          // stopped at frame 19 (index 18)
          this.sprite6Stopped = true;
        }
      }
    }

    // Update all registered animations
    this.anims.update(deltaTime);

    // Check completion - all animations must be stopped/complete
    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
