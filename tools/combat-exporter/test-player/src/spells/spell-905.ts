/**
 * Spell 905 - Fulminant (Sram)
 *
 * A projectile spell with smoke trail particles.
 *
 * Components:
 * - shoot (sprite_25): Main projectile animation at caster, moves toward target
 * - fumee2 particles: Spawned at frame 1 (3 particles) and frame 40 (9 particles) of shoot
 * - fumee particles: Spawned every frame by the moving projectile (nf = level * 0.5 per frame)
 *
 * Original AS timing:
 * - Frame 1 (shoot): Spawn 3 fumee2 particles at projectile position
 * - Frame 37 (shoot): Play sound 'jet_905'
 * - Frame 40 (shoot): Spawn 9 fumee2 particles
 * - Frame 94 (shoot): removeMovieClip() - animation ends
 *
 * Hit signal: At frame 37 (when the jet sound plays, the shot is arriving)
 * Actually looking at the AS, there's no explicit end() call. The shoot anim
 * plays to frame 94 and removes itself. We signal hit at frame 37 (sound plays).
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 192.35,
  height: 158.45,
  offsetX: -87.85,
  offsetY: -114.75,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 13.75,
  height: 19.75,
  offsetX: -7.85,
  offsetY: -15.6,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 10.05,
  height: 11.75,
  offsetX: -4.15,
  offsetY: -5,
};

export class Spell905 extends BaseSpell {
  readonly spellId = 905;

  private shootAnim!: FrameAnimatedSprite;
  private fumee2Particles!: ASParticleSystem;
  private fumeeParticles!: ASParticleSystem;
  private particlesContainer!: Container;

  private level = 1;

  // Track previous position of projectile for smoke trail
  private prevX = 0;
  private prevY = 0;

  // Projectile current position (interpolated from caster to target)
  private projX = 0;
  private projY = 0;

  // Counters (AS uses c as a running particle counter)
  private fumee2Count = 0;
  private fumeeCount = 0;

  // nf for fumee trail = level * 0.5
  private nfFumee = 0;

  // Frame accumulator for tracking which frame the shoot anim is on
  private shootFrameForTrail = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.nfFumee = this.level * 0.5;

    // The shoot animation plays at the caster and implicitly moves toward target
    // In AS, the shoot sprite is placed at caster position and the movement is
    // baked into the animation frames. We position it at caster.
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Sound at frame 37 (0-indexed: 36)
    this.shootAnim.onFrame(36, () => {
      this.callbacks.playSound('jet_905');
      this.signalHit();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Particle systems
    const fumee2Anchor = calculateAnchor(FUMEE2_MANIFEST);
    const fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);

    const fumee2Textures = textures.getFrames('lib_fumee2');
    const fumeeTextures = textures.getFrames('lib_fumee');

    this.particlesContainer = new Container();
    this.particlesContainer.position.set(0, init.casterY);
    this.container.addChildAt(this.particlesContainer, 0);

    this.fumee2Particles = new ASParticleSystem(fumee2Textures[0]);
    this.fumee2Particles.container.position.set(0, 0);
    this.particlesContainer.addChild(this.fumee2Particles.container);

    this.fumeeParticles = new ASParticleSystem(fumeeTextures[0]);
    this.fumeeParticles.container.position.set(0, 0);
    this.particlesContainer.addChild(this.fumeeParticles.container);

    // Store fumee2 anchor for particle creation
    this._fumee2AnchorX = fumee2Anchor.x;
    this._fumee2AnchorY = fumee2Anchor.y;
    this._fumeeAnchorX = fumeeAnchor.x;
    this._fumeeAnchorY = fumeeAnchor.y;

    // Initialize projectile position (caster is at 0,0 in local space)
    this.projX = 0;
    this.projY = 0;
    this.prevX = 0;
    this.prevY = 0;

    // Spawn initial 3 fumee2 particles at frame 1 (0-indexed: 0)
    // AS frame_1: while(p < 3) attachMovie("fumee2", ...)
    // f._x = this._x; f._y = this._y - 30;
    // f.vx = this._x - xi + 20*(random-0.5)  (xi=this._x at start, so vx ~ 20*(random-0.5))
    // f.vy = this._y - yi + 20*(random-0.5)  (yi=this._y at start, so vy ~ 20*(random-0.5))
    this.shootAnim.onFrame(0, () => {
      this.spawnFumee2Initial(3, this.projX, this.projY);
    });

    // Spawn 9 fumee2 particles at frame 40 (0-indexed: 39)
    this.shootAnim.onFrame(39, () => {
      this.spawnFumee2Burst(9, this.projX, this.projY);
    });
  }

  // Anchor values stored for particle positioning (fumee2 is a FrameAnimatedSprite so we use ASParticleSystem which uses its own anchor)
  private _fumee2AnchorX = 0;
  private _fumee2AnchorY = 0;
  private _fumeeAnchorX = 0;
  private _fumeeAnchorY = 0;

  private spawnFumee2Initial(count: number, startX: number, startY: number): void {
    // AS frame_1: xi = this._x, yi = this._y before loop
    // Inside loop: f.vx = this._x - xi + 20*(random-0.5)
    // Since xi = this._x (set before loop) and this._x doesn't change in loop body before updating xi,
    // the first particle gets vx = 0 + 20*(r-0.5), then xi = this._x again, etc.
    // Actually xi is updated each iteration: c++; xi = this._x; yi = this._y;
    // But this._x doesn't change, so all particles get vx ~ 20*(random-0.5), vy ~ 20*(random-0.5)
    let xi = startX;
    let yi = startY;

    for (let p = 0; p < count; p++) {
      const vxRaw = startX - xi + 20 * (Math.random() - 0.5);
      const vyRaw = startY - yi + 20 * (Math.random() - 0.5);

      // fumee2 frame_1: vx *= 2; vy *= 2
      const vxFinal = vxRaw * 2;
      const vyFinal = vyRaw * 2;

      // fumee2 frame_1: t = 20*random+80; scale = t/100
      const t = 20 * Math.random() + 80;
      const scale = t / 100;

      // fumee2 frame_1: gotoAndPlay(random(45)) -> startFrame = floor(random*45)
      const startFrame = Math.floor(Math.random() * 45);

      this.spawnFumee2Particle(
        startX,
        startY - 30,
        vxFinal,
        vyFinal,
        scale,
        startFrame,
      );

      xi = startX;
      yi = startY;
      this.fumee2Count++;
    }
  }

  private spawnFumee2Burst(count: number, startX: number, startY: number): void {
    // AS frame_40: xi = this._x, yi = this._y before loop
    // Same logic: vx = this._x - xi + 20*(r-0.5), but xi resets to this._x each iter
    let xi = startX;
    let yi = startY;

    for (let p = 0; p < count; p++) {
      const vxRaw = startX - xi + 20 * (Math.random() - 0.5);
      const vyRaw = startY - yi + 20 * (Math.random() - 0.5);

      // fumee2 frame_1: vx *= 2; vy *= 2
      const vxFinal = vxRaw * 2;
      const vyFinal = vyRaw * 2;

      const t = 20 * Math.random() + 80;
      const scale = t / 100;
      const startFrame = Math.floor(Math.random() * 45);

      this.spawnFumee2Particle(
        startX,
        startY - 30,
        vxFinal,
        vyFinal,
        scale,
        startFrame,
      );

      xi = startX;
      yi = startY;
      this.fumee2Count++;
    }
  }

  private spawnFumee2Particle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    scale: number,
    _startFrame: number,
  ): void {
    // fumee2 onEnterFrame: _X += vx; _Y += vy; vx /= 1.3; vy /= 1.3
    // Dies at frame 49 (0-indexed: 48), removeMovieClip at frame_49
    // We model this with ASParticleSystem: accX = 1/1.3, accY = 1/1.3
    // vtDecay=0 since fumee2 doesn't change scale over time (just moves and fades)
    // fumee2 has 51 frames and dies at frame 49; we simulate lifetime via scale staying constant
    // Actually fumee2 just plays its animation and removeMovieClip at frame 49
    // We'll use a large t value and no vt so it stays alive; we'll track lifetime separately
    // Since ASParticleSystem kills when t < 0, we set t=100 and no vt to keep it alive
    // But fumee2 removes at frame 49 (0-indexed 48) of its 51-frame animation
    // We approximate: lifetime = 49 frames at 60fps
    // Use vt = -100/49 to make it die after ~49 frames, vtDecay=0
    const vtPerFrame = -100 / 49;

    this.fumee2Particles.spawn({
      x,
      y,
      vx,
      vy,
      accX: 1 / 1.3,
      accY: 1 / 1.3,
      t: 100 * scale,
      vt: vtPerFrame * scale,
      vtDecay: 0,
      vr: 0,
      vrDecay: 1,
    });
  }

  private spawnFumeeTrailParticles(px: number, py: number): void {
    // AS DefineSprite_29_move onEnterFrame: spawn nf fumee particles each frame
    // nf = level * 0.5
    // f._x = this._x; f._y = this._y;
    // f.vx = this._x - xi + 20*(random-0.5)  [xi = prev position]
    // f.vy = this._y - yi + 20*(random-0.5)
    // fumee frame_1: t = 50*random+50; gotoAndPlay(random(30)); _xscale=t; _yscale=t;
    //   vx /= 3 + 3*random; vy /= 9 + random(3);
    // fumee onEnterFrame: _X += vx; _Y += vy; vx /= 1.067; vy /= 1.067
    // fumee dies at frame 46 (0-indexed 45)

    const nf = Math.floor(this.nfFumee);
    // For fractional nf, spawn randomly: e.g. nf=0.5 -> 50% chance of 1 particle
    const extraChance = this.nfFumee - nf;
    const count = nf + (Math.random() < extraChance ? 1 : 0);

    for (let i = 0; i < count; i++) {
      const vxBase = px - this.prevX + 20 * (Math.random() - 0.5);
      const vyBase = py - this.prevY + 20 * (Math.random() - 0.5);

      // fumee frame_1 modifies vx/vy:
      const vxFinal = vxBase / (3 + 3 * Math.random());
      const vyFinal = vyBase / (9 + Math.floor(Math.random() * 3));

      // fumee frame_1: t = 50*random+50
      const t = 50 * Math.random() + 50;
      const scale = t / 100;

      // fumee dies at frame 46 (removeMovieClip at frame_46, 0-indexed 45)
      const lifetime = 46;
      const vtPerFrame = -100 / lifetime;

      this.fumeeParticles.spawn({
        x: px,
        y: py,
        vx: vxFinal,
        vy: vyFinal,
        accX: 1 / 1.067,
        accY: 1 / 1.067,
        t: 100 * scale,
        vt: vtPerFrame * scale,
        vtDecay: 0,
        vr: 0,
        vrDecay: 1,
      });

      this.fumeeCount++;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update projectile position based on current frame
    const currentFrame = this.shootAnim.getFrame();
    const totalFrames = 94; // shoot plays until frame 94 (0-indexed 93), then removeMovieClip at frame 94 (0-indexed 93)
    const progress = Math.min(currentFrame / totalFrames, 1);

    // Update previous position before updating current
    this.prevX = this.projX;
    this.prevY = this.projY;

    // Interpolate projectile position from (0, 0) to (targetX, targetY - casterY)
    // In the original AS, the projectile is part of the shoot animation which moves
    // The shoot sprite has baked movement. We approximate by lerping.
    const targetRelX = this.getTargetRelX();
    const targetRelY = this.getTargetRelY();
    this.projX = targetRelX * progress;
    this.projY = targetRelY * progress;

    // Spawn fumee trail particles each frame (from the move component)
    if (currentFrame > 0) {
      this.spawnFumeeTrailParticles(this.projX, this.projY);
    }

    // Update animations
    this.anims.update(deltaTime);

    // Update particles (one physics step per update)
    this.fumee2Particles.update();
    this.fumeeParticles.update();

    // Spell is complete when shoot animation completes and no particles remain
    if (this.shootAnim.isComplete() &&
        !this.fumee2Particles.hasAliveParticles() &&
        !this.fumeeParticles.hasAliveParticles()) {
      this.complete();
    }
  }

  private _targetRelX = 0;
  private _targetRelY = 0;
  private _initDone = false;

  private getTargetRelX(): number {
    return this._targetRelX;
  }

  private getTargetRelY(): number {
    return this._targetRelY;
  }

  protected setup2(init: SpellInitContext): void {
    this._targetRelX = init.targetX;
    this._targetRelY = init.targetY - init.casterY;
    this._initDone = true;
  }

  destroy(): void {
    this.fumee2Particles.destroy();
    this.fumeeParticles.destroy();
    super.destroy();
  }
}
