/**
 * Example Spell Implementations
 *
 * Shows how to implement spells using the SpellAnimation interface.
 * These are based on the actual ActionScript code from the Dofus 1.29 client.
 */

import { Assets, Sprite, Texture } from 'pixi.js';
import {
  SpellAnimation,
  RegisterSpell,
  ParticleSpellMixin,
  ProjectileSpellMixin,
  SpellContext,
  SpellCallbacks,
} from './spell-interface';

// ============================================================================
// SPELL 1001 - Simple pre-rendered animation (no custom logic needed)
// ============================================================================
// This spell only uses stop() - handled by pre-rendered frames
// No TypeScript needed, just play the WebP sequence

// ============================================================================
// SPELL 102 - Complex particle effect with physics
// ============================================================================

/**
 * Original ActionScript (simplified):
 * ```
 * gotoAndPlay(random(5) + 17);
 * _alpha = random(80);
 * v = 5 * (-0.5 + Math.random());
 * vy = 3 * (-0.5 + Math.random());
 * t = 50 + 40 * (-0.5 + Math.random());
 * _xscale = t; _yscale = t;
 * onEnterFrame = function() {
 *   _X += v; _Y += vy;
 *   v *= 0.95; vy *= 0.95;
 * };
 * ```
 */
@RegisterSpell(102)
class Spell102 extends ParticleSpellMixin(SpellAnimation) {
  readonly spellId = 102;
  private particleTexture!: Texture;
  private spawnTimer = 0;
  private totalSpawned = 0;
  private maxParticles = 20;

  protected async onInit(): Promise<void> {
    // Load particle texture
    this.particleTexture = await Assets.load('/assets/spells/102/particle.webp');
    this.initParticles();
    this.playSound('arty_102');
  }

  protected onUpdate(deltaTime: number, elapsedTime: number): void {
    // Spawn particles over time
    this.spawnTimer += deltaTime;
    if (this.spawnTimer > 50 && this.totalSpawned < this.maxParticles) {
      this.spawnTimer = 0;
      this.spawnFireParticle();
      this.totalSpawned++;
    }

    // Update all particles
    this.updateParticles();

    // Complete when all particles are dead
    if (this.totalSpawned >= this.maxParticles && !this.hasLiveParticles()) {
      this.complete();
    }
  }

  private spawnFireParticle(): void {
    // Replicate AS2 random initialization
    const v = 5 * (-0.5 + Math.random());   // X velocity
    const vy = 3 * (-0.5 + Math.random());  // Y velocity
    const t = (50 + 40 * (-0.5 + Math.random())) / 100; // Scale (50-90%)
    const alpha = this.randomInt(80) / 100; // Alpha 0-80%

    this.spawnParticle(this.particleTexture, {
      x: this.random(-20, 20),
      y: this.random(-10, 10),
      vx: v,
      vy: vy,
      scale: t,
      alpha: alpha,
      friction: 0.95,
      alphaVelocity: -0.02,
      rotationVelocity: this.random(-0.1, 0.1),
    });
  }
}

// ============================================================================
// SPELL 201 - Projectile with impact
// ============================================================================

/**
 * Original ActionScript pattern:
 * - Frame 1-17: Projectile travels from cellFrom to cellTo
 * - Frame 18+: Impact animation at target
 * - Uses _rotation = angle for projectile direction
 */
@RegisterSpell(201)
class Spell201 extends ProjectileSpellMixin(SpellAnimation) {
  readonly spellId = 201;
  private projectileTexture!: Texture;
  private impactTexture!: Texture;
  private phase: 'projectile' | 'impact' = 'projectile';
  private impactFrame = 0;

  protected async onInit(): Promise<void> {
    // Load textures
    this.projectileTexture = await Assets.load('/assets/spells/201/projectile.webp');
    this.impactTexture = await Assets.load('/assets/spells/201/impact.webp');

    // Initialize projectile
    this.initProjectile(this.projectileTexture, {
      speed: 15,
      rotateToDirection: true,
    });
  }

  protected onUpdate(deltaTime: number, elapsedTime: number): void {
    if (this.phase === 'projectile') {
      const completed = this.updateProjectile();
      if (completed) {
        this.onProjectileHit();
      }
    } else {
      // Impact animation
      this.impactFrame++;
      if (this.impactFrame > 30) {
        this.complete();
      }
    }
  }

  private onProjectileHit(): void {
    this.phase = 'impact';
    this.destroyProjectile();
    this.signalHit();
    this.playSound('hit_defaut');

    // Create impact sprite at target
    const impact = new Sprite(this.impactTexture);
    impact.anchor.set(0.5);
    impact.position.set(
      this.context.cellTo.x - this.context.cellFrom.x,
      this.context.cellTo.y - this.context.cellFrom.y
    );
    this.container.addChild(impact);
  }
}

// ============================================================================
// SPELL 703 - Level-scaled effect
// ============================================================================

/**
 * Original ActionScript:
 * ```
 * t = 50 + 20 * _parent._parent.level;
 * _xscale = t; _yscale = t;
 * gotoAndPlay(2);
 * ```
 */
@RegisterSpell(703)
class Spell703 extends SpellAnimation {
  readonly spellId = 703;
  private effectSprite!: Sprite;

  protected async onInit(): Promise<void> {
    const texture = await Assets.load('/assets/spells/703/effect.webp');
    this.effectSprite = new Sprite(texture);
    this.effectSprite.anchor.set(0.5);

    // Scale based on spell level (level 1-6)
    // AS2: t = 50 + 20 * level → t = 70, 90, 110, 130, 150, 170 for levels 1-6
    const t = (50 + 20 * this.context.level) / 100;
    this.effectSprite.scale.set(t);

    this.container.addChild(this.effectSprite);
    this.playSound('grina_703');
  }

  protected onUpdate(deltaTime: number, elapsedTime: number): void {
    // Simple animation - fade out over 1 second
    this.effectSprite.alpha = 1 - (elapsedTime / 1000);

    if (elapsedTime > 1000) {
      this.complete();
    }
  }
}

// ============================================================================
// SPELL 2107 - Uses _root._currentframe for sync
// ============================================================================

/**
 * Original ActionScript:
 * ```
 * f = _root._currentframe;
 * t = 50 + 40 * (-0.5 + Math.random());
 * _yscale = t + f * 5;
 * _xscale = t + f * 5;
 * gotoAndPlay(57);
 * ```
 */
@RegisterSpell(2107)
class Spell2107 extends SpellAnimation {
  readonly spellId = 2107;
  private effectSprite!: Sprite;
  private baseScale!: number;
  private frameOffset!: number;

  protected async onInit(): Promise<void> {
    const texture = await Assets.load('/assets/spells/2107/effect.webp');
    this.effectSprite = new Sprite(texture);
    this.effectSprite.anchor.set(0.5);

    // Random base scale
    this.baseScale = (50 + 40 * (-0.5 + Math.random())) / 100;

    // Use parent frame for offset (context.parentFrame)
    this.frameOffset = this.context.parentFrame * 0.05;

    const scale = this.baseScale + this.frameOffset;
    this.effectSprite.scale.set(scale);

    this.container.addChild(this.effectSprite);
  }

  protected onUpdate(deltaTime: number, elapsedTime: number): void {
    // Animation lasting ~2 seconds
    const progress = elapsedTime / 2000;

    if (progress >= 1) {
      this.complete();
      return;
    }

    // Scale grows slightly based on elapsed frames
    const frameCount = Math.floor(elapsedTime / 16.67); // ~60fps
    const scale = this.baseScale + (frameCount * 0.005);
    this.effectSprite.scale.set(scale);

    // Fade out in last 500ms
    if (elapsedTime > 1500) {
      this.effectSprite.alpha = 1 - ((elapsedTime - 1500) / 500);
    }
  }
}

// ============================================================================
// SPELL WITH ELEMENTS - Uses params.fire/water/earth/air
// ============================================================================

/**
 * Example multi-element spell that changes visuals based on element
 */
// @RegisterSpell(XXXX)
class MultiElementSpell extends SpellAnimation {
  readonly spellId = 9999; // Example

  protected async onInit(): Promise<void> {
    const { params } = this.context;

    // Load different textures based on active elements
    if (params.fire) {
      await this.loadElementEffect('fire', 0xff4400);
    }
    if (params.water) {
      await this.loadElementEffect('water', 0x0088ff);
    }
    if (params.earth) {
      await this.loadElementEffect('earth', 0x885500);
    }
    if (params.air) {
      await this.loadElementEffect('air', 0x88ff88);
    }
  }

  private async loadElementEffect(element: string, tint: number): Promise<void> {
    const texture = await Assets.load(`/assets/spells/elements/${element}.webp`);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.tint = tint;
    this.container.addChild(sprite);
  }

  protected onUpdate(deltaTime: number, elapsedTime: number): void {
    if (elapsedTime > 2000) {
      this.complete();
    }
  }
}

// ============================================================================
// PRE-RENDERED SPELL - For spells that use pre-rendered WebP frames
// ============================================================================

/**
 * Generic pre-rendered spell animation
 * Plays a sequence of WebP frames
 */
export class PreRenderedSpell extends SpellAnimation {
  readonly spellId: number;
  private frames: Texture[] = [];
  private currentFrame = 0;
  private frameDuration: number; // ms per frame
  private sprite!: Sprite;
  private stopFrame?: number;

  constructor(
    spellId: number,
    fps: number = 60,
    stopFrame?: number
  ) {
    super();
    this.spellId = spellId;
    this.frameDuration = 1000 / fps;
    this.stopFrame = stopFrame;
  }

  protected async onInit(): Promise<void> {
    // Load manifest to get frame count
    const manifest = await fetch(`/assets/spells/${this.spellId}/manifest.json`).then(r => r.json());
    const frameCount = manifest.animations[0].frameCount;

    // Load all frames
    for (let i = 0; i < frameCount; i++) {
      const texture = await Assets.load(`/assets/spells/${this.spellId}/frame_${i}.webp`);
      this.frames.push(texture);
    }

    // Create sprite with first frame
    this.sprite = new Sprite(this.frames[0]);
    this.sprite.anchor.set(0.5);
    this.container.addChild(this.sprite);
  }

  protected onUpdate(deltaTime: number, elapsedTime: number): void {
    // Calculate current frame based on elapsed time
    const targetFrame = Math.floor(elapsedTime / this.frameDuration);

    // Check for stop frame
    if (this.stopFrame !== undefined && targetFrame >= this.stopFrame) {
      this.currentFrame = this.stopFrame;
    } else if (targetFrame >= this.frames.length) {
      // Animation complete
      this.complete();
      return;
    } else {
      this.currentFrame = targetFrame;
    }

    // Update sprite texture
    this.sprite.texture = this.frames[this.currentFrame];
  }
}
