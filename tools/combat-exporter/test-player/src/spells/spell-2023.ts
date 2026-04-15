/**
 * Spell 2023 - Explo Death
 *
 * An explosion effect with rotating "shoot" sprites containing animated inner elements.
 * The main container fades out after frame 45, and the animation ends at frame 100.
 *
 * Structure (from AS):
 * - DefineSprite_18_shoot (the "shoot" sprite, 114 frames):
 *   - frame_1: _rotation = 0
 *   - frame_100: _parent.removeMovieClip() + stop() → signals completion
 *
 * - DefineSprite_24 (outer container with 10 instances of DefineSprite_23):
 *   - Each PlaceObject2_23_X has _rotation = random(360) on load
 *
 * - DefineSprite_23 (contains one DefineSprite_22):
 *   - PlaceObject2_22_1 load: v = 3.3 + random(40)
 *   - PlaceObject2_22_1 enterFrame: _X += (v *= 0.8)
 *
 * - DefineSprite_21 (contains DefineSprite_20, the inner sprite):
 *   - load: _alpha = 50 + random(50), ta = 30 + random(70), _xscale = _yscale = ta,
 *           vr = 3.36 * (-0.5 + Math.random()), _parent.vr = 100 * (-0.5 + Math.random()), i = 0
 *   - enterFrame: _xscale = 100 * Math.sin(i += vr *= 0.9); _parent._rotation += _parent.vr *= 0.9
 *
 * Main timeline:
 * - frame_1: SOMA.playSound("explo_death")
 * - PlaceObject2_24_1 load: t = 0
 * - PlaceObject2_24_1 enterFrame: if (t++ > 45) { _alpha -= 3.3; }
 *
 * The shoot sprite has 114 frames; the animation removes itself at frame 100 (0-indexed: 99).
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
  width: 184.9,
  height: 110.4,
  offsetX: -92.4,
  offsetY: -54.85,
};

/**
 * Represents the innermost sprite (DefineSprite_21 / PlaceObject2_20_1).
 * Animates _xscale via sine wave and rotates its parent each frame.
 */
interface InnerSprite {
  anim: FrameAnimatedSprite;
  /** Outer container (DefineSprite_23 instance) that this inner sprite rotates */
  parentContainer: Container;
  alpha: number;
  ta: number;
  vr: number;
  parentVr: number;
  i: number;
}

/**
 * Represents one "arm" (DefineSprite_23), which moves outward via velocity.
 */
interface ArmSprite {
  inner: InnerSprite;
  container: Container;
  v: number;
  localX: number;
}

export class Spell2023 extends BaseSpell {
  readonly spellId = 2023;

  private shootAnim!: FrameAnimatedSprite;
  private outerContainer!: Container;

  /** t counter for the fade-out logic on the outer container */
  private t = 0;

  /** The 10 arm instances (DefineSprite_23 instances inside DefineSprite_24) */
  private arms: ArmSprite[] = [];

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const shootTextures = textures.getFrames('shoot');
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    // Main shoot animation (DefineSprite_18_shoot)
    // frame_1: _rotation = 0 (already default)
    // frame_100 (0-indexed: 99): stop and signal completion
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      }),
    );

    // Play sound at frame 0 (AS frame_1 DoAction)
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('explo_death'));

    // At frame 99 (AS frame_100): stop and complete
    this.shootAnim.stopAt(99);
    this.shootAnim.onFrame(99, () => {
      this.signalHit();
      this.complete();
    });

    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    this.shootAnim.sprite.rotation = 0;
    this.container.addChild(this.shootAnim.sprite);

    // Outer container (PlaceObject2_24_1) at target position
    // PlaceObject2_24_1 load: t = 0 (handled via this.t)
    // PlaceObject2_24_1 enterFrame: if (t++ > 45) { _alpha -= 3.3; }
    this.outerContainer = new Container();
    this.outerContainer.position.set(init.targetX, init.targetY);
    this.outerContainer.alpha = 1;
    this.container.addChild(this.outerContainer);

    // There are 10 instances of DefineSprite_23 (PlaceObject2_23_1 through _19, odd numbers)
    // Each has _rotation = random(360) on load
    // Each contains a DefineSprite_22 (the inner shoot sprite) with:
    //   load: v = 3.3 + random(40)
    //   enterFrame: _X += (v *= 0.8)
    // And the inner DefineSprite_21 (PlaceObject2_20_1) with its own animation

    for (let armIndex = 0; armIndex < 10; armIndex++) {
      // DefineSprite_23 arm container
      const armContainer = new Container();
      // _rotation = random(360)
      armContainer.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      this.outerContainer.addChild(armContainer);

      // DefineSprite_22 inner container (DefineSprite_21 lives inside this)
      // v = 3.3 + random(40)
      const v = 3.3 + Math.floor(Math.random() * 40);
      const innerShootContainer = new Container();
      armContainer.addChild(innerShootContainer);

      // DefineSprite_21 (PlaceObject2_20_1) inner sprite using shoot frames
      // load:
      //   _alpha = 50 + random(50)
      //   ta = 30 + random(70)
      //   _xscale = _yscale = ta
      //   vr = 3.36 * (-0.5 + Math.random())
      //   _parent.vr = 100 * (-0.5 + Math.random())
      //   i = 0
      const innerAlpha = (50 + Math.floor(Math.random() * 50)) / 100;
      const ta = 30 + Math.floor(Math.random() * 70);
      const innerVr = 3.36 * (-0.5 + Math.random());
      const parentVr = 100 * (-0.5 + Math.random());

      const innerAnim = this.anims.add(
        new FrameAnimatedSprite({
          textures: shootTextures,
          anchorX: anchor.x,
          anchorY: anchor.y,
          scale: (ta / 100) * init.scale,
          loop: true,
        }),
      );

      innerAnim.sprite.alpha = innerAlpha;
      innerAnim.sprite.scale.set((ta / 100) * init.scale);
      innerAnim.sprite.position.set(0, 0);
      innerShootContainer.addChild(innerAnim.sprite);

      const arm: ArmSprite = {
        inner: {
          anim: innerAnim,
          parentContainer: innerShootContainer,
          alpha: innerAlpha,
          ta,
          vr: innerVr,
          parentVr,
          i: 0,
        },
        container: armContainer,
        v,
        localX: 0,
      };

      this.arms.push(arm);
    }

    this.t = 0;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main shoot animation
    this.anims.update(deltaTime);

    // Update PlaceObject2_24_1 enterFrame: if (t++ > 45) { _alpha -= 3.3; }
    // We run this once per frame (deltaTime ~16.67ms at 60fps, but we treat it as per-frame)
    // Since deltaTime is in ms, convert to frames
    const frameDelta = deltaTime / (1000 / 60);

    // For frame-accurate t counting, accumulate
    this.t += frameDelta;
    if (this.t > 45) {
      // _alpha decreases by 3.3 per frame
      const newAlpha = this.outerContainer.alpha - (3.3 / 100) * frameDelta;
      this.outerContainer.alpha = Math.max(0, newAlpha);
    }

    // Update each arm
    for (const arm of this.arms) {
      // DefineSprite_23 enterFrame: _X += (v *= 0.8) per frame
      // Apply per frame step
      arm.v *= Math.pow(0.8, frameDelta);
      arm.localX += arm.v * frameDelta;
      arm.container.position.x = arm.localX;

      // DefineSprite_21 enterFrame:
      //   _xscale = 100 * Math.sin(i += vr *= 0.9)
      //   _parent._rotation += _parent.vr *= 0.9
      const inner = arm.inner;
      inner.vr *= Math.pow(0.9, frameDelta);
      inner.i += inner.vr * frameDelta;
      const newXScale = 100 * Math.sin(inner.i);
      // _xscale in AS is a percentage, so scale = newXScale / 100 * init.scale
      inner.anim.sprite.scale.x = (newXScale / 100) * (1 / 1); // init.scale is 1
      // Keep y scale as ta/100
      inner.anim.sprite.scale.y = inner.ta / 100;

      // _parent._rotation += _parent.vr *= 0.9
      inner.parentVr *= Math.pow(0.9, frameDelta);
      inner.parentContainer.rotation += (inner.parentVr * frameDelta * Math.PI) / 180;
    }

    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.signalHit();
      this.complete();
    }
  }
}
