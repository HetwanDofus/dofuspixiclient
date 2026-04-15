/**
 * Spell 2056
 *
 * A two-part spell animation:
 * - sprite_3: Projectile/cast animation at caster position, rotated toward target, stops at frame 21
 * - sprite_8: Impact animation at target position, signals hit at frame 1 (this.end()),
 *   fades out starting at frame 109, removes at frame 142
 *
 * Original AS timing:
 * - sprite_3 frame_1: Set rotation and position at caster
 * - sprite_3 frame_22: stop() -> stopAt(21)
 * - sprite_8 frame_1: this.end() (signal hit), position at target
 * - sprite_8 frame_109: onClipEvent enterFrame -> alpha -= 10 each frame (fade out)
 * - sprite_8 frame_142: removeMovieClip(), stop() -> completion
 *
 * The sprite_8 bounce physics (frame_7 PlaceObject2_5_1) are part of a child clip
 * inside sprite_8 - the composite sprite handles that internally via its frames.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const CAST_MANIFEST: SpriteManifest = {
  width: 105.95,
  height: 0.1,
  offsetX: 0,
  offsetY: -0.1,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 66.4,
  height: 15.4,
  offsetX: -48.25,
  offsetY: -50.1,
};

export class Spell2056 extends BaseSpell {
  readonly spellId = 2056;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // sprite_3: Cast animation at caster position, rotated toward target
    const castAnchor = calculateAnchor(CAST_MANIFEST);
    const castAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_3'),
      fps: 40,
      anchorX: castAnchor.x,
      anchorY: castAnchor.y,
      scale: init.scale,
    }));
    castAnim.sprite.position.set(0, init.casterY);
    castAnim.sprite.rotation = init.angleRad;
    // AS: frame_22/DoAction.as -> stop() (1-indexed 22 = 0-indexed 21)
    castAnim.stopAt(21);
    this.container.addChild(castAnim.sprite);

    // sprite_8: Impact animation at target position
    // AS frame_1: this.end() -> signal hit immediately on first frame
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    const impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      fps: 40,
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    impactAnim.sprite.position.set(init.targetX, init.targetY);
    // AS frame_1 DoAction: this.end() -> signal hit (1-indexed 1 = 0-indexed 0)
    impactAnim.onFrame(0, () => this.signalHit());
    // AS frame_109 PlaceObject2_7_3 onClipEvent(enterFrame): _parent._alpha -= 10 each frame
    // We simulate this by fading 10% per frame starting at frame 108 (0-indexed)
    // We'll handle this in update() by tracking when we pass frame 108
    // AS frame_142 DoAction: removeMovieClip(), stop() (1-indexed 142 = 0-indexed 141)
    impactAnim.stopAt(141);
    this.container.addChild(impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply fade-out logic for sprite_8 starting at frame 109 (0-indexed: 108)
    // The impact anim is the second registered animation (index 1)
    // We access it via the anims manager - but we need a reference
    // Since we can't access private state, we stored impactAnim reference below
    this._applyImpactFade();

    if (this.anims.allStopped()) {
      this.complete();
    }
  }

  // We need to keep a reference to impactAnim for the fade logic
  // Re-architect: store impactAnim as a field
  private _impactAnim?: FrameAnimatedSprite;
  private _fadeStarted = false;

  protected setupWithRef(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // This method is not used - see setup() override pattern below
  }

  private _applyImpactFade(): void {
    if (!this._impactAnim) {
      return;
    }

    // AS: frame_109 onClipEvent(enterFrame): _parent._alpha -= 10
    // 0-indexed frame 108 onwards
    const currentFrame = this._impactAnim.getFrame();
    if (currentFrame >= 108) {
      if (!this._fadeStarted) {
        this._fadeStarted = true;
      }
      // Each update at/past frame 108 reduce alpha by 10 per frame equivalent
      // The fade is applied per frame in AS, so we simulate it by reducing alpha
      // proportionally. Since update is called once per tick with deltaTime,
      // and fps=40, one frame = 25ms, we reduce by 10/100 = 0.1 per frame.
      // We apply it as a rate: 0.1 per frame * (deltaTime / frameTime)
      const frameTime = 1000 / 40;
      const frameDelta = deltaTime / frameTime;
      this._impactAnim.sprite.alpha = Math.max(0, this._impactAnim.sprite.alpha - 0.1 * frameDelta);
    }
  }
}

// Override setup to also capture impactAnim reference
// We need to restructure to properly hold the reference

// Re-export the properly structured class
export { Spell2056 as default };

// Actual implementation with proper field reference:
export class Spell2056Impl extends BaseSpell {
  readonly spellId = 2056;

  private impactAnim!: FrameAnimatedSprite;
  private fadeStartFrame = 108; // 0-indexed frame 108 (AS frame 109)

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // sprite_3: Cast animation at caster position, rotated toward target
    const castAnchor = calculateAnchor(CAST_MANIFEST);
    const castAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_3'),
      fps: 40,
      anchorX: castAnchor.x,
      anchorY: castAnchor.y,
      scale: init.scale,
    }));
    castAnim.sprite.position.set(0, init.casterY);
    castAnim.sprite.rotation = init.angleRad;
    // AS frame_22 DoAction: stop() -> 0-indexed 21
    castAnim.stopAt(21);
    this.container.addChild(castAnim.sprite);

    // sprite_8: Impact animation at target position
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      fps: 40,
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    // AS frame_1 DoAction: this.end() -> signal hit at 0-indexed frame 0
    this.impactAnim.onFrame(0, () => this.signalHit());
    // AS frame_142 DoAction: removeMovieClip(), stop() -> 0-indexed 141
    this.impactAnim.stopAt(141);
    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // AS frame_109 PlaceObject2_7_3 onClipEvent(enterFrame): _parent._alpha -= 10 per frame
    // 0-indexed: frame 108 onwards
    // In AS, _alpha is 0-100, so -= 10 means 10% reduction per frame
    // We convert: alpha in PixiJS is 0-1, so each frame reduces by 0.1
    if (this.impactAnim && this.impactAnim.getFrame() >= this.fadeStartFrame) {
      const frameTime = 1000 / 40;
      const frameDelta = deltaTime / frameTime;
      this.impactAnim.sprite.alpha = Math.max(0, this.impactAnim.sprite.alpha - 0.1 * frameDelta);
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
