/**
 * Spell 2000 - Wab (Sadida)
 *
 * A ball/projectile spell that travels from caster to target with a curved path.
 *
 * Components:
 * - Bouncing ball (PlaceObject2_3_1): Moves from caster to target in phases
 * - Impact sprite (sprite_13): Plays at target position when ball arrives
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'wab_2000a'
 * - Frame 1 (sprite_13): Play sound 'wab_2000b', set position to cellTo, call this.end()
 * - Frame 2 (main): stop() - waits for ball animation
 * - Ball load: Start at caster position (x1, y1-70), target px=(x1, y1-120)
 * - Ball t=21: Move toward 1/6 of path with randomness
 * - Ball t=42: Move to (x2, y2-100)
 * - Ball t=63: Move to (x2, y2+50)
 * - Ball t=66: gotoAndStop(3) -> triggers sprite_13 impact
 * - sprite_13 frame 40: stop(), removeMovieClip -> spell ends
 *
 * The ball uses spring-based movement: vx = -(X - px) / 9, vy = -(Y - py) / 9
 * Speed is capped at 6. The "boule" sub-sprite squishes based on speed.
 */

import { Container, Graphics } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const IMPACT_MANIFEST: SpriteManifest = {
  width: 76.85,
  height: 50.9,
  offsetX: -38.6,
  offsetY: -28.85,
};

export class Spell2000 extends BaseSpell {
  readonly spellId = 2000;

  private impactAnim!: FrameAnimatedSprite;
  private impactTriggered = false;
  private impactStarted = false;

  // Ball physics state (from onClipEvent(load))
  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;
  private px = 0;
  private py = 0;
  private ballX = 0;
  private ballY = 0;
  private t = 0;

  // Ball visual (simple circle as proxy for "boule")
  private ballContainer!: Container;
  private ballGraphic!: Graphics;
  private ballScaleX = 50;
  private ballScaleY = 200;

  // Accumulator for frame-stepping the ball at 60fps
  private frameAccum = 0;
  private readonly frameTime = 1000 / 60;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Compute world-space positions relative to the container (which is at cellFrom)
    // In the AS, _parent is the main timeline which has cellFrom and cellTo as screen coords.
    // Our container is positioned at cellFrom by the combat system.
    const cellFromX = context?.cellFrom?.x ?? 0;
    const cellFromY = context?.cellFrom?.y ?? 0;
    const cellToX = context?.cellTo?.x ?? 0;
    const cellToY = context?.cellTo?.y ?? 0;

    // Store in local coords (relative to cellFrom, since container is at cellFrom)
    this.x1 = 0;
    this.y1 = 0;
    this.x2 = cellToX - cellFromX;
    this.y2 = cellToY - cellFromY;

    // Ball initial position: _X = x1, _Y = y1 - 70 (in local coords)
    this.ballX = this.x1;
    this.ballY = this.y1 - 70;

    // Initial target position: px = x1, py = y1 - 120
    this.px = this.x1;
    this.py = this.y1 - 120;

    this.t = 0;

    // Create ball visual
    this.ballContainer = new Container();
    this.ballContainer.position.set(this.ballX * init.scale, this.ballY * init.scale);

    this.ballGraphic = new Graphics();
    this.drawBall(50, 200);
    this.ballContainer.addChild(this.ballGraphic);
    this.container.addChild(this.ballContainer);

    // Impact animation (sprite_13) at target position
    const impactTextures = textures.getFrames('sprite_13');
    const anchor = calculateAnchor(IMPACT_MANIFEST);

    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: impactTextures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(this.x2 * init.scale, this.y2 * init.scale);
    this.impactAnim.sprite.visible = false;

    // sprite_13 frame 1 (0-indexed: 0): play sound wab_2000b, signal hit
    this.impactAnim.onFrame(0, () => {
      this.callbacks.playSound('wab_2000b');
      this.signalHit();
    });

    // sprite_13 frame 40 (0-indexed: 39): stop -> spell ends
    this.impactAnim.stopAt(39);

    this.container.addChild(this.impactAnim.sprite);

    // Play main sound at frame 1 (immediately on setup)
    this.callbacks.playSound('wab_2000a');
  }

  private drawBall(scaleX: number, scaleY: number): void {
    this.ballScaleX = scaleX;
    this.ballScaleY = scaleY;

    this.ballGraphic.clear();
    // Draw a simple ellipse to represent the ball
    // scaleX/scaleY are percentages (100 = normal)
    const rx = (8 * scaleX) / 100;
    const ry = (8 * scaleY) / 100;
    this.ballGraphic.beginFill(0x44aa44, 1);
    this.ballGraphic.drawEllipse(0, 0, rx, ry);
    this.ballGraphic.endFill();
  }

  update(deltaTime: number, _elapsedTime?: number): void {
    if (this.done) {
      return;
    }

    // Step the ball physics at 60fps ticks
    if (!this.impactTriggered) {
      this.frameAccum += deltaTime;

      while (this.frameAccum >= this.frameTime && !this.impactTriggered) {
        this.frameAccum -= this.frameTime;
        this.stepBall();
      }
    }

    // Update impact animation once triggered
    if (this.impactStarted) {
      this.anims.update(deltaTime);

      if (this.impactAnim.isStopped() || this.impactAnim.isComplete()) {
        this.complete();
      }
    }
  }

  private stepBall(): void {
    // AS: if(t++ == 21)
    if (this.t === 21) {
      this.px = this.x1 + (this.x2 - this.x1) / 6 + (-0.5 + Math.random()) * 100;
      this.py = this.y1 + (this.y2 - this.y1) / 6 + (-0.5 + Math.random()) * 50 - 50;
    }

    if (this.t === 42) {
      this.px = this.x2;
      this.py = this.y2 - 100;
    }

    if (this.t === 63) {
      this.px = this.x2;
      this.py = this.y2 + 50;
    }

    if (this.t === 66) {
      // gotoAndStop(3) -> triggers sprite_13
      this.triggerImpact();
    }

    // Increment t AFTER checks (AS: t++ means post-increment, check is == 21 before increment)
    this.t++;

    if (this.impactTriggered) {
      return;
    }

    // Spring movement
    let vx = (-(this.ballX - this.px)) / 9;
    let vy = (-(this.ballY - this.py)) / 9;
    let v = Math.sqrt(vx * vx + vy * vy);

    const rotation = Math.atan2(vy, vx) * 57.29746936176985;

    if (v > 6) {
      v = 6;
    }

    const bScaleX = 100 + 3 * v;
    const bScaleY = 100 - 3 * v;

    this.ballX = this.ballX + vx;
    this.ballY = this.ballY + vy;

    // Update ball visual
    const scale = 1; // init.scale stored implicitly; we use raw coords * scale below
    this.ballContainer.position.set(this.ballX, this.ballY);
    this.ballContainer.rotation = rotation * (Math.PI / 180);
    this.drawBall(bScaleX, bScaleY);
  }

  private triggerImpact(): void {
    this.impactTriggered = true;
    this.impactStarted = true;

    // Hide ball
    this.ballContainer.visible = false;

    // Show impact animation
    this.impactAnim.sprite.visible = true;
  }

  destroy(): void {
    this.ballGraphic.destroy();
    this.ballContainer.destroy({ children: true });
    super.destroy();
  }
}
