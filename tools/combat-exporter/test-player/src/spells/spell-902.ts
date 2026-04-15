/**
 * Spell 902 - Venin de Bouftou (Bouftou's Venom)
 *
 * A projectile spell where a "shoot" sprite travels from caster to target,
 * spawning smoke (fumee) particles as a trail, then explodes into more smoke particles.
 *
 * Components:
 * - shoot (DefineSprite_7_shoot): Projectile at caster, moves toward target
 * - move (DefineSprite_8_move): The moving projectile that spawns trail smoke
 * - explosion (DefineSprite_6): Impact explosion that spawns 7 smoke particles
 * - fumee particles (lib_fumee): Smoke puffs spawned during travel and on impact
 *
 * Original AS timing:
 * - DefineSprite_8_move: onEnterFrame spawns fumee particles as trail every frame
 * - DefineSprite_8_move frame_1: uses nf=1 (1 fumee per frame), moves along trajectory
 * - DefineSprite_6 frame_1: spawns 7 fumee particles radially
 * - DefineSprite_6 frame_64: removeMovieClip() -> animation ends
 * - DefineSprite_13_fumee frame_49: removeMovieClip() -> particle done
 *
 * The projectile interpolates from caster to target, spawning trail smoke,
 * then the impact effect spawns radial smoke.
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  SPELL_CONSTANTS,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const FUMEE_MANIFEST: SpriteManifest = {
  width: 28.7,
  height: 28.7,
  offsetX: -14.35,
  offsetY: -14.35,
};

export class Spell902 extends BaseSpell {
  readonly spellId = 902;

  // Particle systems
  private trailParticles!: ASParticleSystem;
  private impactParticles!: ASParticleSystem;

  // Projectile state
  private projectileX = 0;
  private projectileY = 0;
  private targetX = 0;
  private targetY = 0;
  private casterY = 0;

  // Travel state
  private travelTime = 0;
  private travelDuration = 0; // ms to travel
  private hasExploded = false;
  private explosionTimer = 0;
  // explosion lasts 63 frames (frame 1 to 64 -> 63 frames at 60fps)
  private readonly EXPLOSION_DURATION = (63 / 60) * 1000;

  // Particle tracking for completion
  private impactSpawnDone = false;

  // Projectile scale (level-based)
  private projectileScale = 1;

  // The "shoot" sprite (the visible projectile)
  private shootAnim!: FrameAnimatedSprite;
  private shootContainer!: Container;

  // Wiggle state for shoot sprite (mimics DefineSprite_7_shoot PlaceObject2_6_1 load)
  // But since shoot is just scale-based, we track the wiggle for the move object
  private wiggle_a = 20;
  private wiggle_i = 0;
  private wiggle_a2 = 15;
  private wiggle_i2 = 0;

  // Trail container positioned at current projectile pos
  private trailContainer!: Container;
  private impactContainer!: Container;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));

    this.casterY = init.casterY;
    this.targetX = init.targetX;
    this.targetY = init.targetY;

    this.projectileX = 0;
    this.projectileY = init.casterY;

    // AS: t = 50 + 20 * level (for shoot sprite scale, as percentage)
    const shootScalePercent = 50 + 20 * level;
    this.projectileScale = (shootScalePercent / 100) * init.scale;

    // AS: t = 10 + 3 * level (for move object scale, as percentage)
    // This controls the "move" wobbling projectile size
    const moveScalePercent = 10 + 3 * level;
    const moveScale = (moveScalePercent / 100) * init.scale;

    // Travel duration: approximated from projectile behavior
    // The projectile moves along a path, we estimate based on typical spell timing
    // Looking at the AS: it moves frame-by-frame. The shoot sprite moves from source to target.
    // No explicit duration in AS - it seems to be driven by the main timeline.
    // Based on context, we'll use a fixed travel time of ~30 frames (500ms at 60fps)
    this.travelDuration = (30 / 60) * 1000;

    const fumeeTextures = textures.getFrames('lib_fumee');
    const anchor = calculateAnchor(FUMEE_MANIFEST);

    // Trail particles container (follows projectile)
    this.trailContainer = new Container();
    this.trailContainer.position.set(0, 0);
    this.container.addChild(this.trailContainer);

    // Trail particle system
    this.trailParticles = new ASParticleSystem(fumeeTextures[0] ?? Texture.EMPTY);
    this.trailParticles.container.position.set(0, 0);
    this.trailContainer.addChild(this.trailParticles.container);

    // Impact particles container (at target)
    this.impactContainer = new Container();
    this.impactContainer.position.set(this.targetX, this.targetY);
    this.container.addChild(this.impactContainer);

    // Impact particle system
    this.impactParticles = new ASParticleSystem(fumeeTextures[0] ?? Texture.EMPTY);
    this.impactParticles.container.position.set(0, 0);
    this.impactContainer.addChild(this.impactParticles.container);

    // Shoot sprite container at caster position
    this.shootContainer = new Container();
    this.shootContainer.position.set(0, init.casterY);
    this.container.addChild(this.shootContainer);

    // Shoot animation (the visible projectile)
    // Use fumee frames as the projectile visual (or first frame as static sprite)
    // Actually looking at the AS, DefineSprite_7_shoot contains a sprite that wobbles
    // We use fumee frames for the projectile appearance
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: fumeeTextures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: this.projectileScale,
      loop: true,
    }));
    this.shootAnim.sprite.rotation = init.angleRad;
    this.shootContainer.addChild(this.shootAnim.sprite);

    // Move wiggle: a=20, i increments by 1 each frame
    this.wiggle_a = 20;
    this.wiggle_i = 0;

    // Unused but present in AS for shoot: a=15, i increments by PI each frame
    this.wiggle_a2 = 15;
    this.wiggle_i2 = 0;

    // Store move scale for trail offset calculation
    void moveScale; // used conceptually for trail spread
  }

  /**
   * Spawn trail smoke at current projectile position
   * AS (DefineSprite_8_move frame_1 DoAction):
   *   _loc3_._x = this._x + 15 * (Math.random() - 0.5);
   *   _loc3_._y = this._y + 15 * (Math.random() - 0.5);
   * Fumee onLoad: t = 50*random+50, scale=t, rotation=random(360)
   *              vx /= 1 + 3*random, vy /= 3
   * Fumee onEnterFrame: _X += vx; _Y += vy; vx /= 3; vy /= 3
   * Fumee dies at frame 49 (0-indexed: 48)
   */
  private spawnTrailSmoke(): void {
    // Position is current projectile position + small random offset
    const x = this.projectileX + 15 * (Math.random() - 0.5);
    const y = this.projectileY + 15 * (Math.random() - 0.5);

    // AS: t = 50 * Math.random() + 50
    const t = 50 * Math.random() + 50;
    const scale = t / 100;

    // AS: vx = 0 (trail particles inherit 0 vx/vy since they're spawned without explicit vx/vy)
    // In the move script, the fumee is attachMovied without setting vx/vy,
    // so vx and vy are undefined/0, then divided:
    // AS fumee load: vx /= 1 + 3*random -> 0/(anything) = 0
    //                vy /= 3 -> 0/3 = 0
    // So trail particles are stationary (just fade out at position)
    const vx = 0;
    const vy = 0;

    const rotation = Math.floor(Math.random() * 360);

    // Create a manual particle for trail smoke
    // We simulate fumee behavior: stationary, plays 49 frames then dies
    this.spawnFumeeParticle(this.trailParticles, x, y, vx, vy, scale, rotation);
  }

  /**
   * Spawn explosion smoke (DefineSprite_6 frame_1 DoAction):
   *   7 particles with random vx/vy = 180 * (random - 0.5)
   *   Each fumee: vx /= 1 + 3*random, vy /= 3
   *               then onEnterFrame: vx /= 3, vy /= 3 each frame
   */
  private spawnExplosionSmoke(): void {
    for (let p = 0; p < 7; p++) {
      // AS: vx = 180 * (Math.random() - 0.5)
      // AS: vy = 180 * (Math.random() - 0.5)
      const rawVx = 180 * (Math.random() - 0.5);
      const rawVy = 180 * (Math.random() - 0.5);

      // AS fumee onLoad: vx /= 1 + 3 * Math.random()
      const vx = rawVx / (1 + 3 * Math.random());
      // AS fumee onLoad: vy /= 3
      const vy = rawVy / 3;

      // AS: t = 50 * Math.random() + 50
      const t = 50 * Math.random() + 50;
      const scale = t / 100;

      // AS: _rotation = random(360)
      const rotation = Math.floor(Math.random() * 360);

      this.spawnFumeeParticle(this.impactParticles, 0, 0, vx, vy, scale, rotation);
    }
  }

  /**
   * Spawn a fumee particle on a particle system.
   * AS fumee onEnterFrame: _X += vx; _Y += vy; vx /= 3; vy /= 3
   * Particle lives for 49 frames (0-indexed frames 0-48, dies at frame 49)
   */
  private spawnFumeeParticle(
    system: ASParticleSystem,
    x: number,
    y: number,
    vx: number,
    vy: number,
    scale: number,
    rotationDeg: number
  ): void {
    // We model the fumee physics with ASParticleSystem:
    // vx /= 3 per frame = vx *= (1/3) per frame -> accX = 1/3
    // vy /= 3 per frame -> accY = 1/3
    // t = scale * 100 (percentage), no scale change (vt=0)
    // It dies at frame 49 (0-indexed 48), which is ~800ms at 60fps
    // We simulate death by having alpha fade out over that time
    // Actually fumee dies via removeMovieClip at frame 49, no alpha change
    // We'll use alphaVelocity to fade over 49 frames: -1/49 per frame
    system.spawn({
      x,
      y,
      vx,
      vy,
      accX: 1 / 3,
      accY: 1 / 3,
      t: scale * 100,
      vt: 0,
      rotation: rotationDeg,
      alpha: 1,
      // Fade out over 49 frames so it dies naturally
      alphaVelocity: -1 / 49,
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    if (!this.hasExploded) {
      // Move projectile from caster to target
      this.travelTime += deltaTime;
      const progress = Math.min(this.travelTime / this.travelDuration, 1);

      // Interpolate position
      this.projectileX = this.targetX * progress;
      this.projectileY = this.casterY + (this.targetY - this.casterY) * progress;

      // Update shoot container position
      this.shootContainer.position.set(this.projectileX, this.projectileY);

      // Wobble rotation: AS move onEnterFrame: _rotation = 90 + a * cos(i += 1); a /= 1.3
      this.wiggle_i += 1;
      const wobbleRotation = 90 + this.wiggle_a * Math.cos(this.wiggle_i);
      this.wiggle_a /= 1.3;
      this.shootAnim.sprite.rotation = (wobbleRotation * Math.PI) / 180;

      // Spawn trail smoke (nf=1 per frame)
      this.spawnTrailSmoke();

      // Update trail particles physics (per-frame in AS)
      this.trailParticles.update();

      // Update shoot animation
      this.anims.update(deltaTime);

      // Check if reached target
      if (progress >= 1) {
        this.hasExploded = true;
        this.explosionTimer = 0;
        this.impactSpawnDone = false;

        // Hide shoot sprite
        this.shootContainer.visible = false;

        // Signal hit
        this.signalHit();

        // Spawn explosion smoke (DefineSprite_6 frame_1: 7 particles)
        this.spawnExplosionSmoke();
        this.impactSpawnDone = true;
      }
    } else {
      // Explosion phase
      this.explosionTimer += deltaTime;

      // Update trail particles (still fading)
      this.trailParticles.update();

      // Update impact particles
      this.impactParticles.update();

      // DefineSprite_6 frame_64 (63 frames after frame 1) -> removeMovieClip
      // explosion ends after EXPLOSION_DURATION
      const explosionDone = this.explosionTimer >= this.EXPLOSION_DURATION;

      if (explosionDone && !this.trailParticles.hasAliveParticles() && !this.impactParticles.hasAliveParticles()) {
        this.complete();
      } else if (explosionDone && this.impactSpawnDone) {
        // Once explosion time is up, just wait for particles
        if (!this.trailParticles.hasAliveParticles() && !this.impactParticles.hasAliveParticles()) {
          this.complete();
        }
      }
    }
  }

  destroy(): void {
    this.trailParticles.destroy();
    this.impactParticles.destroy();
    super.destroy();
  }
}
