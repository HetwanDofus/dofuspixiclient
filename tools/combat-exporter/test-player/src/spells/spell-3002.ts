/**
 * Spell 3002 - Multi-element projectile spell
 *
 * A multi-element spell that spawns particles based on active elements
 * (fire, water, earth, air). The projectile (shoot animation) travels
 * from caster to target, spawning elemental particles along the way.
 *
 * Components:
 * - shoot animation: Projectile sprite that plays 20 frames then removes itself
 * - Elemental particles (part_f, part_w, part_e, part_a): Spawned based on
 *   which elements are active in context.params
 *
 * Original AS timing:
 * - DefineSprite_10_shoot/frame_20: removeMovieClip (projectile done)
 * - DefineSprite_11_move: Spawns particles every frame at projectile position
 * - Particle init (DefineSprite_29/13/24/36): Random rotation, scale, position offset
 * - Hit: signaled when shoot animation completes (frame 19, 0-indexed)
 *
 * Particle behavior:
 * - part_f (fire): DefineSprite_29 - 19 frames, random rotation/scale(20-50)/offset, spinning decay (vr *= 0.9)
 * - part_w (water): DefineSprite_13 - 11 frames, random rotation/scale(20-50)/offset, random start(0-4)
 * - part_e (earth): DefineSprite_24 - 14 frames, random rotation/scale(10-50)/offset, random start(0-4)
 * - part_a (air): DefineSprite_36 - 9 frames, random rotation/offset, random start(0-2)
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

// ============================================================================
// Manifests
// ============================================================================

const SHOOT_MANIFEST: SpriteManifest = {
  width: 29.75,
  height: 31.6,
  offsetX: -23.25,
  offsetY: -17.6,
};

const PART_F_MANIFEST: SpriteManifest = {
  width: 35.05,
  height: 32.2,
  offsetX: -4.5,
  offsetY: -22.6,
};

const PART_W_MANIFEST: SpriteManifest = {
  width: 25.5,
  height: 24.8,
  offsetX: -8.1,
  offsetY: -17.75,
};

const PART_E_MANIFEST: SpriteManifest = {
  width: 61.65,
  height: 60.5,
  offsetX: -16.2,
  offsetY: -25.85,
};

const PART_A_MANIFEST: SpriteManifest = {
  width: 32.2,
  height: 37.45,
  offsetX: -29,
  offsetY: -37.45,
};

// ============================================================================
// Particle instance types
// ============================================================================

interface ElementalParticle {
  anim: FrameAnimatedSprite;
  /** For fire particles: rotation velocity that decays */
  vr?: number;
}

// ============================================================================
// Spell 3002
// ============================================================================

export class Spell3002 extends BaseSpell {
  readonly spellId = 3002;

  private shootAnim!: FrameAnimatedSprite;

  // All elemental particle animations (managed manually, not via this.anims)
  private elementalParticles: ElementalParticle[] = [];
  private particleContainer!: Container;

  // Params from context
  private useFire = false;
  private useWater = false;
  private useEarth = false;
  private useAir = false;

  // Textures for particles
  private partFTextures: Texture[] = [];
  private partWTextures: Texture[] = [];
  private partETextures: Texture[] = [];
  private partATextures: Texture[] = [];

  // For move-phase particle spawning (every frame along path)
  private moveParticleCounter = 0;
  private shootComplete = false;

  // Projectile position tracking (interpolated across the shoot animation)
  private startX = 0;
  private startY = 0;
  private endX = 0;
  private endY = 0;
  private shootTotalFrames = 20;
  private shootCurrentProgress = 0; // 0..1

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Parse params
    const params = context?.params;
    this.useFire = params?.fire === true;
    this.useWater = params?.water === true;
    this.useEarth = params?.earth === true;
    this.useAir = params?.air === true;

    // Collect particle textures
    this.partFTextures = textures.getFrames('lib_part_f');
    this.partWTextures = textures.getFrames('lib_part_w');
    this.partETextures = textures.getFrames('lib_part_e');
    this.partATextures = textures.getFrames('lib_part_a');

    // Particle container sits behind the projectile
    this.particleContainer = new Container();
    this.container.addChild(this.particleContainer);

    // Shoot animation
    const shootTextures = textures.getFrames('shoot');
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: shootTextures,
      fps: 20,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));

    // Position at caster, rotated toward target
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // When shoot completes (frame 19 = AS frame 20), signal hit and mark done
    this.shootAnim.onFrame(19, () => {
      this.shootComplete = true;
      this.signalHit();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Track start/end positions for particle spawning along path
    this.startX = 0;
    this.startY = init.casterY;
    this.endX = init.targetX;
    this.endY = init.targetY;
    this.shootTotalFrames = 20;

    // Spawn initial shoot particles (DefineSprite_10_shoot load phase)
    // AS: n = 14 - 3*fire - 3*water - 3*earth - 3*air
    const nbre = (this.useFire ? 1 : 0) + (this.useWater ? 1 : 0) +
                 (this.useEarth ? 1 : 0) + (this.useAir ? 1 : 0);
    if (nbre > 0) {
      const n = 14 - 3 * (this.useFire ? 1 : 0) - 3 * (this.useWater ? 1 : 0) -
                3 * (this.useEarth ? 1 : 0) - 3 * (this.useAir ? 1 : 0);
      const spawnX = 0;
      const spawnY = init.casterY;
      this.spawnShootParticles(n, spawnX, spawnY);
    }
  }

  /**
   * Spawn particles at the shoot animation position (load phase).
   * Matches DefineSprite_10_shoot/frame_1/PlaceObject2_1_1 onClipEvent(load).
   */
  private spawnShootParticles(n: number, spawnX: number, spawnY: number): void {
    if (this.useFire) {
      for (let i = 0; i < n; i++) {
        this.spawnFireParticle(spawnX, spawnY);
      }
    }
    if (this.useWater) {
      for (let i = 0; i < n; i++) {
        this.spawnWaterParticle(spawnX, spawnY);
      }
    }
    if (this.useEarth) {
      for (let i = 0; i < n; i++) {
        this.spawnEarthParticle(spawnX, spawnY);
      }
    }
    if (this.useAir) {
      for (let i = 0; i < n; i++) {
        this.spawnAirParticle(spawnX, spawnY);
      }
    }
  }

  /**
   * Spawn per-frame move particles.
   * Matches DefineSprite_11_move/frame_1/PlaceObject2_1_1 onClipEvent(enterFrame).
   */
  private spawnMoveParticles(spawnX: number, spawnY: number): void {
    const nbre = (this.useFire ? 1 : 0) + (this.useWater ? 1 : 0) +
                 (this.useEarth ? 1 : 0) + (this.useAir ? 1 : 0);

    let n: number;
    if (nbre === 1) {
      n = 3;
    } else if (nbre === 2) {
      n = 2;
    } else if (nbre === 3) {
      n = 1;
    } else if (nbre === 4) {
      n = 1;
    } else {
      n = 0;
    }

    if (n === 0) {
      return;
    }

    if (this.useFire) {
      for (let i = 0; i < n; i++) {
        this.spawnFireParticle(spawnX, spawnY);
      }
    }
    if (this.useWater) {
      for (let i = 0; i < n; i++) {
        this.spawnWaterParticle(spawnX, spawnY);
      }
    }
    if (this.useEarth) {
      for (let i = 0; i < n; i++) {
        this.spawnEarthParticle(spawnX, spawnY);
      }
    }
    if (this.useAir) {
      for (let i = 0; i < n; i++) {
        this.spawnAirParticle(spawnX, spawnY);
      }
    }
  }

  /**
   * Fire particle - DefineSprite_29
   * 19 frames, stops at frame 18 (AS frame 19)
   * Random rotation, scale 20-50, position offset ±10, spinning (vr *= 0.9)
   * Random start: random(3) + 1 -> 0-indexed: random(3) + 0 = 0..2
   */
  private spawnFireParticle(spawnX: number, spawnY: number): void {
    if (this.partFTextures.length === 0) {
      return;
    }

    const rotation = Math.floor(Math.random() * 360);
    const t = 20 + 30 * Math.random();
    const offsetX = 20 * (Math.random() - 0.5);
    const offsetY = 20 * (Math.random() - 0.5);
    // AS: gotoAndPlay(random(3) + 1) -> 0-indexed: random(3) = 0..2
    const startFrame = Math.floor(Math.random() * 3);
    const vr = Math.floor(Math.random() * 10);

    const anchor = calculateAnchor(PART_F_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.partFTextures,
      fps: 20,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: 1 / SPELL_CONSTANTS.EXTRACTION_SCALE,
      startFrame,
    });

    anim.sprite.rotation = (rotation * Math.PI) / 180;
    anim.sprite.scale.set((t / 100) / SPELL_CONSTANTS.EXTRACTION_SCALE);
    anim.sprite.position.set(spawnX + offsetX, spawnY + offsetY);
    // AS: stops at frame 19 (0-indexed: 18)
    anim.stopAt(18);

    this.particleContainer.addChild(anim.sprite);

    const particle: ElementalParticle = { anim, vr };
    this.elementalParticles.push(particle);
  }

  /**
   * Water particle - DefineSprite_13
   * 11 frames, stops at frame 10 (AS frame 11)
   * Random rotation, scale 20-50, position offset ±10
   * Random start: random(5) + 1 -> 0-indexed: 0..4
   */
  private spawnWaterParticle(spawnX: number, spawnY: number): void {
    if (this.partWTextures.length === 0) {
      return;
    }

    const rotation = Math.floor(Math.random() * 360);
    const offsetX = 20 * (Math.random() - 0.5);
    const offsetY = 20 * (Math.random() - 0.5);
    const t = 20 + 30 * Math.random();
    // AS: gotoAndPlay(random(5) + 1) -> 0-indexed: 0..4
    const startFrame = Math.floor(Math.random() * 5);

    const anchor = calculateAnchor(PART_W_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.partWTextures,
      fps: 20,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: 1 / SPELL_CONSTANTS.EXTRACTION_SCALE,
      startFrame,
    });

    anim.sprite.rotation = (rotation * Math.PI) / 180;
    anim.sprite.scale.set((t / 100) / SPELL_CONSTANTS.EXTRACTION_SCALE);
    anim.sprite.position.set(spawnX + offsetX, spawnY + offsetY);
    // AS: stops at frame 11 (0-indexed: 10)
    anim.stopAt(10);

    this.particleContainer.addChild(anim.sprite);

    this.elementalParticles.push({ anim });
  }

  /**
   * Earth particle - DefineSprite_24
   * 14 frames, stops at frame 13 (AS frame 14)
   * Random rotation, scale 10-50, position offset ±10
   * Random start: random(5) + 1 -> 0-indexed: 0..4
   */
  private spawnEarthParticle(spawnX: number, spawnY: number): void {
    if (this.partETextures.length === 0) {
      return;
    }

    const rotation = Math.floor(Math.random() * 360);
    const offsetX = 20 * (Math.random() - 0.5);
    const offsetY = 20 * (Math.random() - 0.5);
    const t = 10 + 40 * Math.random();
    // AS: gotoAndPlay(random(5) + 1) -> 0-indexed: 0..4
    const startFrame = Math.floor(Math.random() * 5);

    const anchor = calculateAnchor(PART_E_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.partETextures,
      fps: 20,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: 1 / SPELL_CONSTANTS.EXTRACTION_SCALE,
      startFrame,
    });

    anim.sprite.rotation = (rotation * Math.PI) / 180;
    anim.sprite.scale.set((t / 100) / SPELL_CONSTANTS.EXTRACTION_SCALE);
    anim.sprite.position.set(spawnX + offsetX, spawnY + offsetY);
    // AS: stops at frame 14 (0-indexed: 13)
    anim.stopAt(13);

    this.particleContainer.addChild(anim.sprite);

    this.elementalParticles.push({ anim });
  }

  /**
   * Air particle - DefineSprite_36
   * 9 frames, stops at frame 8 (AS frame 9)
   * Random rotation, position offset ±10
   * Random start: random(3) + 1 -> 0-indexed: 0..2
   */
  private spawnAirParticle(spawnX: number, spawnY: number): void {
    if (this.partATextures.length === 0) {
      return;
    }

    const rotation = Math.floor(Math.random() * 360);
    const offsetX = 20 * (Math.random() - 0.5);
    const offsetY = 20 * (Math.random() - 0.5);
    // AS: gotoAndPlay(random(3) + 1) -> 0-indexed: 0..2
    const startFrame = Math.floor(Math.random() * 3);

    const anchor = calculateAnchor(PART_A_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.partATextures,
      fps: 20,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: 1 / SPELL_CONSTANTS.EXTRACTION_SCALE,
      startFrame,
    });

    anim.sprite.rotation = (rotation * Math.PI) / 180;
    anim.sprite.position.set(spawnX + offsetX, spawnY + offsetY);
    // AS: stops at frame 9 (0-indexed: 8)
    anim.stopAt(8);

    this.particleContainer.addChild(anim.sprite);

    this.elementalParticles.push({ anim });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Track shoot animation progress for particle spawning position
    const prevFrame = this.shootAnim.getFrame();

    // Update shoot animation via anims manager
    this.anims.update(deltaTime);

    const currentFrame = this.shootAnim.getFrame();

    // Spawn move particles each frame the projectile advances
    if (!this.shootComplete && currentFrame !== prevFrame) {
      const progress = this.shootTotalFrames > 1
        ? currentFrame / (this.shootTotalFrames - 1)
        : 1;
      const px = this.startX + (this.endX - this.startX) * progress;
      const py = this.startY + (this.endY - this.startY) * progress;
      this.spawnMoveParticles(px, py);
    }

    // Update elemental particles and apply fire rotation decay
    for (const p of this.elementalParticles) {
      p.anim.update(deltaTime);

      // Fire particles have spinning rotation: _rotation += (vr *= 0.9)
      if (p.vr !== undefined) {
        p.vr *= 0.9;
        p.anim.sprite.rotation += (p.vr * Math.PI) / 180;
      }
    }

    // Remove dead particles from container
    this.elementalParticles = this.elementalParticles.filter(p => {
      if (p.anim.isComplete() || p.anim.isStopped()) {
        p.anim.sprite.parent?.removeChild(p.anim.sprite);
        p.anim.destroy();
        return false;
      }
      return true;
    });

    // Complete when shoot is done AND all particles have finished
    if (this.shootComplete && this.elementalParticles.length === 0) {
      this.complete();
    }
  }

  destroy(): void {
    // Destroy remaining elemental particles
    for (const p of this.elementalParticles) {
      p.anim.destroy();
    }
    this.elementalParticles = [];

    super.destroy();
  }
}
