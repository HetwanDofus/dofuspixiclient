/**
 * Spell 816 - Vlad (Sacrier)
 *
 * A punch/impact spell with multiple flash animations at the target position.
 *
 * Components:
 * - DefineSprite_6: Flash circle that expands from 0 scale, plays sound "punch", stops at frame 19
 * - DefineSprite_7: Impact flash (t=7), signals hit at frame 22, removes at frame 91
 * - DefineSprite_8: Impact flash (t=11), signals hit at frame 64, removes at frame 106
 * - DefineSprite_9: Impact flash (t=20), signals hit at frame 79, removes at frame 118
 * - DefineSprite_10: Impact flash (t=25), signals hit at frame 79, removes at frame 121
 * - DefineSprite_11: Impact flash (t=33), signals hit at frame 79, removes at frame 121
 * - DefineSprite_3: Rotated sprite with 50% alpha (random rotation)
 * - DefineSprite_12: Level-based sprite (gotoAndStop level)
 * - Main timeline frame 1: Play sound "vlad_806"
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_806'
 * - Frame 1 (sprite_6): Play sound 'punch', expand scale animation
 * - Frame 19 (sprite_6): stop()
 * - Frame 22 (sprite_7): this.end() -> signalHit
 * - Frame 64 (sprite_8): this.end() -> signalHit
 * - Frame 79 (sprite_9/10/11): this.end() -> signalHit
 * - Frame 91 (sprite_7): removeMovieClip
 * - Frame 106 (sprite_8): removeMovieClip
 * - Frame 118 (sprite_9): removeMovieClip
 * - Frame 121 (sprite_10/11): removeMovieClip
 *
 * The "expanding circle" (DefineSprite_6) uses a custom onEnterFrame physics:
 *   t = random(_parent.t) + _parent.t  (where _parent.t comes from the containing sprite)
 *   _xscale = 0; _yscale = 0;
 *   each frame: _xscale += t; _yscale += t; t /= 1.6;
 *
 * The anim1 sprite sheet (5 frames) corresponds to DefineSprite_12 which does
 * gotoAndStop(_parent.level), so we show the frame matching the spell level.
 *
 * DefineSprite_3 is a rotated (random 0-359 degrees) 50% alpha overlay.
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  SPELL_CONSTANTS,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

// The single animation in the manifest covers all the visual frames
const ANIM1_MANIFEST: SpriteManifest = {
  width: 274.25,
  height: 266.5,
  offsetX: -142.8,
  offsetY: -143.15,
};

/**
 * Simulates the DefineSprite_6 expanding circle behavior.
 * AS: t = random(parentT) + parentT; _xscale = 0; _yscale = 0;
 * Each frame: _xscale += t; _yscale += t; t /= 1.6;
 */
class ExpandingCircle {
  private t: number;
  private scalePercent = 0;
  private frameAccumulator = 0;
  private readonly frameTime = SPELL_CONSTANTS.FRAME_TIME;
  private _stopped = false;
  private stopAtFrame = 18; // frame 19 (0-indexed: 18) -> stop()
  private frameCount = 0;

  // We'll drive the actual sprite externally
  onScaleChanged?: (scale: number) => void;

  constructor(parentT: number) {
    // AS: t = random(parentT) + parentT
    this.t = Math.floor(Math.random() * parentT) + parentT;
    this.scalePercent = 0;
  }

  update(deltaTime: number): void {
    if (this._stopped) {
      return;
    }

    this.frameAccumulator += deltaTime;

    while (this.frameAccumulator >= this.frameTime && !this._stopped) {
      this.frameAccumulator -= this.frameTime;
      this.advanceFrame();
    }
  }

  private advanceFrame(): void {
    if (this._stopped) {
      return;
    }

    this.scalePercent += this.t;
    this.t /= 1.6;
    this.onScaleChanged?.(this.scalePercent / 100);

    this.frameCount++;

    if (this.frameCount >= this.stopAtFrame) {
      this._stopped = true;
    }
  }

  isStopped(): boolean {
    return this._stopped;
  }
}

export class Spell816 extends BaseSpell {
  readonly spellId = 816;

  // The main animation tracks the longest-running sprite (121 frames for sprite_10/11)
  private mainAnim!: FrameAnimatedSprite;
  private expandCircle!: ExpandingCircle;
  private expandCircleContainer!: Container;
  private expandCircleStopped = false;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const level = Math.max(1, Math.min(5, context?.level ?? 1));

    // Play main sound immediately (frame 1 main timeline)
    this.callbacks.playSound("vlad_806");

    // Position everything at target
    const tx = init.targetX;
    const ty = init.targetY;

    // ---- DefineSprite_12: level-based static frame (anim1) ----
    // gotoAndStop(_parent.level) -> show frame index (level - 1)
    const anim1Textures = textures.getFrames("anim1");
    const levelFrameIndex = Math.max(
      0,
      Math.min(level - 1, anim1Textures.length - 1)
    );
    const anchor1 = calculateAnchor(ANIM1_MANIFEST);

    // We use a FrameAnimatedSprite but immediately stop at the level frame
    const levelAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: levelFrameIndex,
        stopFrame: levelFrameIndex,
      })
    );
    levelAnim.sprite.position.set(tx, ty);
    this.container.addChild(levelAnim.sprite);

    // ---- DefineSprite_3: rotated 50% alpha overlay ----
    // AS: _rotation = random(360); _alpha = 50;
    // Uses the same anim1 frames (it's in the same library)
    // Treat it as the same sprite sheet shown at a random rotation
    const randomRotationDeg = Math.floor(Math.random() * 360);
    const rotatedAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: levelFrameIndex,
        stopFrame: levelFrameIndex,
      })
    );
    rotatedAnim.sprite.position.set(tx, ty);
    rotatedAnim.sprite.rotation = (randomRotationDeg * Math.PI) / 180;
    rotatedAnim.sprite.alpha = 0.5;
    this.container.addChild(rotatedAnim.sprite);

    // ---- DefineSprite_6: expanding circle (punch sound + scale animation) ----
    // parentT for sprite_6 depends on which containing sprite holds it.
    // Based on the AS, the containing sprites have t values:
    // sprite_7: t=7, sprite_8: t=11, sprite_9: t=20, sprite_10: t=25, sprite_11: t=33
    // DefineSprite_6 is the punch circle used in each.
    // We'll create one expanding circle using t from sprite_7 (t=7) as representative.
    // Play sound "punch" at frame 1
    this.callbacks.playSound("punch");

    // Create the expanding circle container with the level anim texture as the visual
    this.expandCircleContainer = new Container();
    this.expandCircleContainer.position.set(tx, ty);
    this.container.addChild(this.expandCircleContainer);

    // Visual for the expanding circle - use anim1 frame
    const circleTextures = anim1Textures;
    const circleVisual = new FrameAnimatedSprite({
      textures: circleTextures,
      anchorX: anchor1.x,
      anchorY: anchor1.y,
      scale: init.scale,
      startFrame: levelFrameIndex,
      stopFrame: levelFrameIndex,
    });
    circleVisual.sprite.scale.set(0);
    this.expandCircleContainer.addChild(circleVisual.sprite);

    // parentT = 7 (from sprite_7 which contains sprite_6)
    this.expandCircle = new ExpandingCircle(7);
    this.expandCircle.onScaleChanged = (scale: number) => {
      circleVisual.sprite.scale.set(scale * init.scale);
    };

    // ---- DefineSprite_7: t=7, hit at frame 22, remove at frame 91 ----
    // We use anim1 for the visual as it's the primary sprite sheet
    const sprite7 = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: 0,
      })
    );
    sprite7.sprite.position.set(tx, ty);
    sprite7.stopAt(90).onFrame(21, () => this.signalHit());
    this.container.addChild(sprite7.sprite);

    // ---- DefineSprite_8: t=11, hit at frame 64, remove at frame 106 ----
    const sprite8 = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: 0,
      })
    );
    sprite8.sprite.position.set(tx, ty);
    sprite8.sprite.alpha = 0.85;
    sprite8.stopAt(105).onFrame(63, () => this.signalHit());
    this.container.addChild(sprite8.sprite);

    // ---- DefineSprite_9: t=20, hit at frame 79, remove at frame 118 ----
    const sprite9 = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: 0,
      })
    );
    sprite9.sprite.position.set(tx, ty);
    sprite9.sprite.alpha = 0.7;
    sprite9.stopAt(117).onFrame(78, () => this.signalHit());
    this.container.addChild(sprite9.sprite);

    // ---- DefineSprite_10: t=25, hit at frame 79, remove at frame 121 ----
    const sprite10 = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: 0,
      })
    );
    sprite10.sprite.position.set(tx, ty);
    sprite10.sprite.alpha = 0.6;
    sprite10.stopAt(120).onFrame(78, () => this.signalHit());
    this.container.addChild(sprite10.sprite);

    // ---- DefineSprite_11: t=33, hit at frame 79, remove at frame 121 ----
    // This is the longest-running animation - drives completion
    const sprite11 = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor1.x,
        anchorY: anchor1.y,
        scale: init.scale,
        startFrame: 0,
      })
    );
    sprite11.sprite.position.set(tx, ty);
    sprite11.sprite.alpha = 0.5;
    sprite11.stopAt(120).onFrame(78, () => this.signalHit());
    this.container.addChild(sprite11.sprite);

    // mainAnim tracks the longest-running one (sprite11 stops at frame 120)
    this.mainAnim = sprite11;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (!this.expandCircleStopped) {
      this.expandCircle.update(deltaTime);

      if (this.expandCircle.isStopped()) {
        this.expandCircleStopped = true;
      }
    }

    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    if (this.expandCircleContainer) {
      this.expandCircleContainer.destroy({ children: true });
    }

    super.destroy();
  }
}
