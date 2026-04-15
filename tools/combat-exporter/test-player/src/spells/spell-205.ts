/**
 * Spell 205 - Crockette (Iop)
 *
 * A critter projectile that travels from caster to target using physics simulation,
 * then plays an impact animation.
 *
 * Components:
 * - sprite_22: The crockette projectile that flies from cellFrom to cellTo
 *   - Stops at frame 0 (waiting), starts flying on enterFrame logic
 *   - At tps==90 (frame count), gotoAndPlay(4) -> start index 3, frott=0.4, acc=1
 *   - Frame 67 (0-indexed 66): play sound 'pose', snap to target (fin=1, _X=x2, _Y=y2)
 *   - Frame 70 (0-indexed 69): this.end() -> signalHit
 *   - Frame 121 (0-indexed 120): removeMovieClip -> complete
 * - sprite_18: Impact animation at target (15 frames, stops at frame 12)
 * - sprite_9: Small particle/body sprite (6 frames, looping) attached to projectile
 *
 * Original AS timing:
 * - Frame 1 (main): stop(), play sound 'crockette_205'
 * - Frame 1 (sprite_22): stop(), init physics, start onEnterFrame movement
 * - Frame 37 (sprite_22): acc = 0.25
 * - Frame 67 (sprite_22): play sound 'pose', fin=1, snap to target
 * - Frame 70 (sprite_22): this.end() - signal hit
 * - Frame 121 (sprite_22): removeMovieClip, stop - complete
 * - Frame 13 (sprite_18): stop()
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const PROJECTILE_MANIFEST: SpriteManifest = {
  width: 69.2,
  height: 175.9,
  offsetX: -33.3,
  offsetY: -172.3,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 67.8,
  height: 67.8,
  offsetX: -33.3,
  offsetY: -36.35,
};

const BODY_MANIFEST: SpriteManifest = {
  width: 29.1,
  height: 10.95,
  offsetX: -14.15,
  offsetY: -12.35,
};

export class Spell205 extends BaseSpell {
  readonly spellId = 205;

  // Projectile physics state
  private projX = 0;
  private projY = 0;
  private vx = 0;
  private vy = 0;
  private acc = 0.17;
  private readonly frott = 0.96;
  private frott2 = 0.96;
  private tps = 0;
  private fin = 0;
  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;
  private anglepos = 0;

  // Wobble animation state (PlaceObject2_15_2 onEnterFrame)
  private wobbleT = 0;
  private wobblePm = 0;
  private wobbleYm = 0;
  private wobbleAn = 0;
  private wobbleRotation = 0;

  // Impact wobble state (PlaceObject2_21_1)
  private impactWobbleI = 0;
  private impactWobbleAmp = 30;

  private projectileContainer!: Container;
  private projectileAnim!: FrameAnimatedSprite;
  private bodyAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  private physicsActive = false;
  private impactWobbleActive = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Positions are in world space (absolute), not relative to caster
    // The container is placed at cellFrom
    // sprite_22 uses absolute _X/_Y from cellFrom.x/y to cellTo.x/y
    // We'll work in local coordinates relative to cellFrom
    this.x1 = 0;
    this.y1 = 0;
    this.x2 = init.targetX;
    this.y2 = init.targetY - (-50); // targetY includes Y_OFFSET (-50), undo for physics
    // Actually: init.targetX = cellTo.x - cellFrom.x, init.targetY = (cellTo.y - cellFrom.y) + Y_OFFSET
    // The AS code uses raw cellFrom/cellTo screen coords
    // Let's use the raw difference: x2 = cellTo.x - cellFrom.x, y2 = cellTo.y - cellFrom.y
    this.x2 = context?.cellTo && context?.cellFrom
      ? context.cellTo.x - context.cellFrom.x
      : init.targetX;
    this.y2 = context?.cellTo && context?.cellFrom
      ? context.cellTo.y - context.cellFrom.y
      : init.targetY - (-50);

    // AS: vx = random(10) - 5; vy = random(10) - 5
    this.vx = Math.floor(Math.random() * 10) - 5;
    this.vy = Math.floor(Math.random() * 10) - 5;
    this.frott2 = 0.96;
    this.acc = 0.17;
    this.tps = 0;
    this.fin = 0;
    this.projX = this.x1;
    this.projY = this.y1;

    // Wobble init (PlaceObject2_15_2 onClipEvent load)
    this.wobbleT = 0;
    this.wobblePm = 0;
    this.wobbleYm = 0; // relative to parent Y, starts at 0
    this.wobbleAn = 0;
    this.wobbleRotation = 0;

    // Container for projectile (positioned at caster origin in local space)
    this.projectileContainer = new Container();
    this.projectileContainer.scale.set(init.scale);
    this.projectileContainer.position.set(this.projX, this.projY);
    this.container.addChild(this.projectileContainer);

    // Body sprite (sprite_9) - loops, attached to projectile
    this.bodyAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      ...calculateAnchor(BODY_MANIFEST),
      scale: 1,
      loop: true,
    }));
    this.projectileContainer.addChild(this.bodyAnim.sprite);

    // Projectile sprite (sprite_22) - the crockette
    this.projectileAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      ...calculateAnchor(PROJECTILE_MANIFEST),
      scale: 1,
    }));
    // Frame 37 (0-indexed 36): acc = 0.25
    this.projectileAnim.onFrame(36, () => {
      this.acc = 0.25;
    });
    // Frame 67 (0-indexed 66): play sound 'pose', fin=1, snap to target
    this.projectileAnim.onFrame(66, () => {
      this.callbacks.playSound('pose');
      this.fin = 1;
      this.projX = this.x2;
      this.projY = this.y2;
      this.projectileContainer.position.set(this.projX, this.projY);
      this.impactWobbleActive = true;
    });
    // Frame 70 (0-indexed 69): this.end() -> signalHit
    this.projectileAnim.onFrame(69, () => {
      this.signalHit();
    });
    // Frame 121 (0-indexed 120): removeMovieClip -> complete
    this.projectileAnim.onFrame(120, () => {
      this.complete();
    });
    this.projectileContainer.addChild(this.projectileAnim.sprite);

    // Impact animation (sprite_18) at target position, stops at frame 12
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_18'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.stopAt(12);
    // Position at target
    this.impactAnim.sprite.position.set(
      context?.cellTo && context?.cellFrom ? context.cellTo.x - context.cellFrom.x : init.targetX,
      context?.cellTo && context?.cellFrom ? context.cellTo.y - context.cellFrom.y : init.targetY - (-50),
    );
    this.container.addChild(this.impactAnim.sprite);

    // Play sound at frame 1 (main timeline, frame_2/DoAction.as -> frame 2 = 0-indexed 1)
    // Actually it's in scripts/frame_2/DoAction.as which is main timeline frame 2 (0-indexed 1)
    // We play it immediately on setup (frame 0 equivalent, first update)
    this.physicsActive = true;

    // Play crockette_205 sound immediately (main timeline frame 2 = first frame displayed)
    this.callbacks.playSound('crockette_205');

    // Start projectile at stopped state - AS says stop() at frame 1
    // We simulate it by not using stopAt, but controlling via physics
    // The projectile sprite plays from frame 0 normally
    // Actually: AS stops at frame 1 (index 0), then gotoAndPlay(4) at tps==90 (index 3)
    // So the sprite is stopped at frame 0 until tps reaches 90, then jumps to frame 3 and plays
    this.projectileAnim.pause();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (!this.physicsActive) {
      return;
    }

    // Physics simulation (onEnterFrame of sprite_22)
    if (this.fin !== 1) {
      // Horizontal acceleration toward x2
      if (this.projX < this.x2) {
        this.vx += this.acc;
      } else {
        this.vx -= this.acc;
      }
      this.vx *= this.frott2;
      this.projX += this.vx;

      // Vertical acceleration toward y2
      if (this.projY < this.y2) {
        this.vy += this.acc;
      } else {
        this.vy -= this.acc;
      }
      this.vy *= this.frott2;
      this.projY += this.vy;

      // Update angle
      this.anglepos = Math.atan2(this.projY - this.y2, this.projX - this.x2);

      // At tps==90: gotoAndPlay(4) -> index 3, frott=0.4, acc=1
      if (this.tps === 90) {
        this.projectileAnim.gotoFrame(3).play();
        this.frott2 = 0.4;
        this.acc = 1;
      }

      this.tps++;

      // Update container position
      this.projectileContainer.position.set(this.projX, this.projY);
    }

    // Wobble animation for body sprite (PlaceObject2_15_2 onClipEvent enterFrame)
    // an = 0.3 * Math.sin(t += 0.4) + _parent.anglepos + 3.1415
    // _Y = ym + 10 * Math.cos(pm += 0.1)
    // _rotation = 3.34 * Math.sin(t * 1.2)  (degrees in AS)
    this.wobbleT += 0.4;
    this.wobblePm += 0.1;
    this.wobbleAn = 0.3 * Math.sin(this.wobbleT) + this.anglepos + 3.1415;
    const wobbleY = this.wobbleYm + 10 * Math.cos(this.wobblePm);
    this.wobbleRotation = 3.34 * Math.sin(this.wobbleT * 1.2);

    this.bodyAnim.sprite.position.set(0, wobbleY);
    this.bodyAnim.sprite.rotation = (this.wobbleRotation * Math.PI) / 180;
    // _xscale logic from DefineSprite_14 (the body sub-sprite uses an angle for xscale/visibility)
    // The body sprite itself: _xscale = 100 * Math.sin(an), visible if xscale >= 0
    const xscaleFactor = Math.sin(this.wobbleAn);
    if (xscaleFactor < 0) {
      this.bodyAnim.sprite.visible = false;
    } else {
      this.bodyAnim.sprite.visible = true;
      this.bodyAnim.sprite.scale.set(xscaleFactor, 1);
    }

    // Impact wobble (PlaceObject2_21_1 onClipEvent enterFrame) - active after fin=1
    if (this.impactWobbleActive) {
      this.impactWobbleI += 3.1415;
      this.impactWobbleAmp *= 0.8;
      const impactRot = this.impactWobbleAmp * Math.cos(this.impactWobbleI);
      this.impactAnim.sprite.rotation = (impactRot * Math.PI) / 180;
    }
  }
}
