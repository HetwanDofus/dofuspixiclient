/**
 * Spell Animation System - TypeScript Interfaces
 *
 * Based on analysis of 282 Dofus 1.29 spell ActionScript files.
 * These interfaces define the contract between the combat system and spell animations.
 *
 * KEY INSIGHT: Spell animations are single-target. For AOE spells, the combat system
 * spawns multiple spell instances, one per target cell/entity.
 */

// ============================================================================
// CONTEXT - Data provided by the combat system
// ============================================================================

/**
 * Cell information - represents a cell on the battle map
 */
export interface CellInfo {
  /** Cell ID (0-559 for standard Dofus maps) */
  cellId: number;

  /**
   * Screen position of the cell CENTER in pixels
   * This is where sprites should be positioned to appear "on" the cell
   */
  x: number;
  y: number;

  /**
   * Ground level/altitude of the cell (0-2 typically)
   * Higher values = elevated terrain
   * Used to adjust Y position for hills/stairs
   */
  groundLevel: number;
}

/**
 * Elemental parameters - used by multi-element spells (only 3000, 3001, 3002)
 * Each flag indicates if that element variant should be shown
 */
export interface ElementParams {
  fire: boolean;
  water: boolean;
  earth: boolean;
  air: boolean;
}

/**
 * Fighter information - minimal data about caster/target
 */
export interface FighterInfo {
  /** Entity ID */
  id: number;

  /** Fighter name (for UI display) */
  name: string;

  /** Team (0 = defenders/red, 1 = challengers/blue) */
  team: number;

  /** Current HP (for health-based effects) */
  hp: number;
  maxHp: number;

  /** Whether this fighter is the player's character */
  isPlayer: boolean;
}

/**
 * Context provided to spell animations by the combat system
 *
 * Note: For AOE spells hitting multiple targets, a separate spell animation
 * instance is created for each target with its own context.
 */
export interface SpellContext {
  // ============================================================================
  // POSITION DATA (from AS: _parent.cellFrom, _parent.cellTo)
  // ============================================================================

  /**
   * Source/caster cell - where the spell originates
   * Screen position is where the caster is standing
   */
  cellFrom: CellInfo;

  /**
   * Target cell - where the spell hits
   * Screen position is where the impact should occur
   */
  cellTo: CellInfo;

  /**
   * Pre-calculated angle from caster to target in DEGREES
   * Range: 0-360 where 0=right, 90=down, 180=left, 270=up
   *
   * Used by AS as: _rotation = _parent.angle
   * For projectiles, effects pointing at target, etc.
   */
  angle: number;

  /**
   * Pre-calculated distance in PIXELS
   * sqrt((cellTo.x - cellFrom.x)² + (cellTo.y - cellFrom.y)²)
   *
   * Used for: projectile travel time, effect scaling by range
   */
  distance: number;

  // ============================================================================
  // SPELL DATA (from AS: _parent.level, _parent.params)
  // ============================================================================

  /**
   * Spell level (1-6)
   *
   * Affects many things in AS code:
   * - Particle count: nb = 10 + _parent.level * 3
   * - Effect size: t = 50 + 20 * _parent.level
   * - Duration: loops based on level
   */
  level: number;

  /**
   * Elemental parameters for multi-element spells
   * Only spells 3000, 3001, 3002 use this
   */
  params?: ElementParams;

  // ============================================================================
  // FIGHTER DATA
  // ============================================================================

  /** Information about the caster */
  caster: FighterInfo;

  /** Information about the target (if targeting a fighter) */
  target?: FighterInfo;

  /**
   * Direction the caster is facing
   * true = facing right (towards positive X)
   * false = facing left (towards negative X)
   *
   * Used to flip spell effects when caster faces different directions
   */
  casterFacingRight: boolean;

  // ============================================================================
  // TIMING DATA (from AS: _root._currentframe, _root.i)
  // ============================================================================

  /**
   * Current frame of the parent combat timeline
   * Used by some spells: f = _root._currentframe
   *
   * Allows spell to sync with overall combat animation
   */
  parentFrame: number;

  /**
   * Global animation index - for staggered multi-hit effects
   * Used by some spells: _X = 20 * Math.sin(_root.i)
   *
   * When multiple spell instances play, this differentiates them
   */
  instanceIndex: number;

  // ============================================================================
  // GAME STATE
  // ============================================================================

  /**
   * Whether critical hit occurred (for enhanced visuals)
   */
  isCritical: boolean;
}

// ============================================================================
// CALLBACKS - Functions provided by the combat system
// ============================================================================

/**
 * Callbacks provided to spell animations for interacting with the game
 *
 * These map to the AS functions like:
 * - SOMA.playSound("soundId")
 * - this.end()
 * - _parent.removeMovieClip()
 */
export interface SpellCallbacks {
  // ============================================================================
  // SOUND
  // ============================================================================

  /**
   * Play a sound effect
   * @param soundId - Sound identifier (e.g., "explosion", "arty_102", "jet_905")
   *
   * AS equivalent: SOMA.playSound("soundId")
   */
  playSound: (soundId: string) => void;

  // ============================================================================
  // LIFECYCLE EVENTS
  // ============================================================================

  /**
   * Signal that the spell animation has completed
   * Combat system waits for this before proceeding to next action
   *
   * AS equivalent: this.end() or reaching last frame
   */
  onComplete: () => void;

  /**
   * Signal that the spell hit the target
   * Combat system uses this to:
   * - Apply damage/effects
   * - Show damage numbers
   * - Play hit sound
   * - Trigger target flinch animation
   *
   * For projectiles: call when projectile reaches target
   * For instant spells: call immediately or when impact visual plays
   */
  onHit: () => void;

  // ============================================================================
  // CUSTOM EVENTS
  // ============================================================================

  /**
   * Signal a custom event during the animation
   * Used for spell-specific timing (multi-hit spells, phases, etc.)
   *
   * @param eventName - Event identifier
   * @param data - Optional event data
   *
   * Example events:
   * - 'phase2' - Spell entering second phase
   * - 'multiHit' - One of multiple hits in a combo
   * - 'summon' - Summoning entity appeared
   */
  onEvent: (eventName: string, data?: unknown) => void;
}

// ============================================================================
// TEXTURE PROVIDER - Access to spell textures
// ============================================================================

/**
 * Interface for loading spell textures
 * Provided to spells so they can load their assets
 */
export interface SpellTextureProvider {
  /**
   * Get a texture for this spell
   * Textures are pre-loaded by the combat system
   *
   * @param name - Texture name (e.g., "particle", "projectile", "impact")
   * @returns The texture, or a fallback if not found
   */
  getTexture(name: string): Texture;

  /**
   * Get all frame textures for an animated sprite
   *
   * @param prefix - Frame prefix (e.g., "explosion" for explosion_0, explosion_1, etc.)
   * @returns Array of textures in order
   */
  getFrames(prefix: string): Texture[];

  /**
   * Check if a texture exists
   */
  hasTexture(name: string): boolean;
}

// ============================================================================
// SPELL ANIMATION - Base class for all spell animations
// ============================================================================

import type { Container, Sprite, Texture } from 'pixi.js';

/**
 * Base interface for all spell animations
 *
 * Lifecycle:
 * 1. Combat system creates instance: new SpellXXX()
 * 2. Combat system calls init() with context, callbacks, textures
 * 3. Combat system calls update() every frame
 * 4. Spell calls callbacks.onHit() when projectile/effect hits target
 * 5. Spell calls callbacks.onComplete() when animation finished
 * 6. Combat system calls destroy() to cleanup
 */
export interface ISpellAnimation {
  /** Unique spell ID */
  readonly spellId: number;

  /** Root container for the animation - add to stage */
  readonly container: Container;

  /**
   * Initialize the animation
   * Called once when the spell is cast
   *
   * @param context - Combat context (positions, angle, level, etc.)
   * @param callbacks - Functions to call for sound, hit, complete
   * @param textures - Access to pre-loaded spell textures
   */
  init(
    context: SpellContext,
    callbacks: SpellCallbacks,
    textures: SpellTextureProvider
  ): void;

  /**
   * Update the animation each frame
   * Called by combat system's ticker
   *
   * @param deltaTime - Time since last frame in milliseconds
   * @param elapsedTime - Total time since animation started in milliseconds
   */
  update(deltaTime: number, elapsedTime: number): void;

  /**
   * Check if the animation has completed
   * Combat system polls this to know when to cleanup
   */
  isComplete(): boolean;

  /**
   * Clean up resources
   * Called by combat system after isComplete() returns true
   */
  destroy(): void;
}

/**
 * Abstract base class for spell animations
 * Provides common functionality for all spells
 *
 * Example implementation:
 * ```typescript
 * @RegisterSpell(102)
 * class Spell102 extends SpellAnimation {
 *   readonly spellId = 102;
 *
 *   protected onInit(): void {
 *     this.playSound('arty_102');
 *     // Setup sprites using this.textures.getTexture('particle')
 *   }
 *
 *   protected onUpdate(deltaTime: number, elapsedTime: number): void {
 *     // Update animation
 *     if (elapsedTime > 2000) {
 *       this.signalHit();
 *       this.complete();
 *     }
 *   }
 * }
 * ```
 */
export abstract class SpellAnimation implements ISpellAnimation {
  abstract readonly spellId: number;

  readonly container: Container;
  protected context!: SpellContext;
  protected callbacks!: SpellCallbacks;
  protected textures!: SpellTextureProvider;
  protected completed = false;
  protected elapsedTime = 0;

  constructor() {
    // Note: In actual implementation, use: this.container = new Container();
    this.container = null as unknown as Container;
  }

  init(
    context: SpellContext,
    callbacks: SpellCallbacks,
    textures: SpellTextureProvider
  ): void {
    this.context = context;
    this.callbacks = callbacks;
    this.textures = textures;
    this.completed = false;
    this.elapsedTime = 0;

    // Position container at spell origin (usually caster position)
    this.container.position.set(context.cellFrom.x, context.cellFrom.y);

    // Flip container if caster is facing left
    if (!context.casterFacingRight) {
      this.container.scale.x = -1;
    }

    // Call subclass initialization
    this.onInit();
  }

  /**
   * Override in subclass to perform spell-specific initialization
   * Called after context, callbacks, and textures are set
   */
  protected abstract onInit(): void;

  update(deltaTime: number, elapsedTime: number): void {
    this.elapsedTime = elapsedTime;

    if (!this.completed) {
      this.onUpdate(deltaTime, elapsedTime);
    }
  }

  /**
   * Override in subclass to perform spell-specific updates
   */
  protected abstract onUpdate(deltaTime: number, elapsedTime: number): void;

  isComplete(): boolean {
    return this.completed;
  }

  /**
   * Call this when the animation should end
   */
  protected complete(): void {
    this.completed = true;
    this.callbacks.onComplete();
  }

  /**
   * Play a sound effect
   */
  protected playSound(soundId: string): void {
    this.callbacks.playSound(soundId);
  }

  /**
   * Signal that the spell hit the target
   * Call this when projectile reaches target or impact occurs
   */
  protected signalHit(): void {
    this.callbacks.onHit();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  // ============================================================================
  // UTILITY METHODS - Common operations used by many spells
  // ============================================================================

  /**
   * Get a random number between min and max
   */
  protected random(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  /**
   * Get a random integer between 0 and max (exclusive)
   * Equivalent to AS2: random(max)
   */
  protected randomInt(max: number): number {
    return Math.floor(Math.random() * max);
  }

  /**
   * Convert degrees to radians
   */
  protected degToRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Convert radians to degrees
   */
  protected radToDeg(radians: number): number {
    return radians * (180 / Math.PI);
  }

  /**
   * Calculate angle from source to target in radians
   */
  protected angleToTarget(): number {
    return Math.atan2(
      this.context.cellTo.y - this.context.cellFrom.y,
      this.context.cellTo.x - this.context.cellFrom.x
    );
  }

  /**
   * Linear interpolation
   */
  protected lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  }

  /**
   * Clamp a value between min and max
   */
  protected clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

// ============================================================================
// PARTICLE SYSTEM - For spells that spawn multiple particles
// ============================================================================

/**
 * Configuration for a particle
 */
export interface ParticleConfig {
  /** Initial X position relative to spawn point */
  x: number;
  /** Initial Y position relative to spawn point */
  y: number;
  /** X velocity (pixels per frame at 60fps) */
  vx: number;
  /** Y velocity (pixels per frame at 60fps) */
  vy: number;
  /** Initial scale (1.0 = 100%) */
  scale: number;
  /** Initial rotation in radians */
  rotation: number;
  /** Initial alpha (0.0 - 1.0) */
  alpha: number;
  /** Velocity friction (multiplied each frame, e.g., 0.95) */
  friction?: number;
  /** Rotation velocity (radians per frame) */
  rotationVelocity?: number;
  /** Scale change per frame */
  scaleVelocity?: number;
  /** Alpha change per frame */
  alphaVelocity?: number;
  /** Gravity (added to vy each frame) */
  gravity?: number;
  /** Lifetime in frames (-1 = infinite until alpha <= 0) */
  lifetime?: number;
}

/**
 * Active particle instance
 */
export interface Particle extends ParticleConfig {
  sprite: Sprite;
  age: number;
  alive: boolean;
}

/**
 * Mixin for spells that use particle systems
 * Usage: class MySpell extends ParticleSpellMixin(SpellAnimation) { ... }
 */
export function ParticleSpellMixin<T extends new (...args: any[]) => SpellAnimation>(Base: T) {
  return class extends Base {
    protected particles: Particle[] = [];
    protected particleContainer: Container = new Container();

    protected initParticles(): void {
      this.container.addChild(this.particleContainer);
    }

    protected spawnParticle(texture: Texture, config: Partial<ParticleConfig> = {}): Particle {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);

      const particle: Particle = {
        sprite,
        x: config.x ?? 0,
        y: config.y ?? 0,
        vx: config.vx ?? 0,
        vy: config.vy ?? 0,
        scale: config.scale ?? 1,
        rotation: config.rotation ?? 0,
        alpha: config.alpha ?? 1,
        friction: config.friction ?? 1,
        rotationVelocity: config.rotationVelocity ?? 0,
        scaleVelocity: config.scaleVelocity ?? 0,
        alphaVelocity: config.alphaVelocity ?? 0,
        gravity: config.gravity ?? 0,
        lifetime: config.lifetime ?? -1,
        age: 0,
        alive: true,
      };

      sprite.position.set(particle.x, particle.y);
      sprite.scale.set(particle.scale);
      sprite.rotation = particle.rotation;
      sprite.alpha = particle.alpha;

      this.particleContainer.addChild(sprite);
      this.particles.push(particle);

      return particle;
    }

    protected updateParticles(): void {
      for (const p of this.particles) {
        if (!p.alive) continue;

        p.age++;

        // Apply physics
        p.vx *= p.friction!;
        p.vy *= p.friction!;
        p.vy += p.gravity!;
        p.x += p.vx;
        p.y += p.vy;

        // Apply changes
        p.rotation += p.rotationVelocity!;
        p.scale += p.scaleVelocity!;
        p.alpha += p.alphaVelocity!;

        // Update sprite
        p.sprite.position.set(p.x, p.y);
        p.sprite.scale.set(p.scale);
        p.sprite.rotation = p.rotation;
        p.sprite.alpha = p.alpha;

        // Check death conditions
        if (p.lifetime !== -1 && p.age >= p.lifetime) {
          p.alive = false;
        }
        if (p.alpha <= 0 || p.scale <= 0) {
          p.alive = false;
        }

        if (!p.alive) {
          p.sprite.visible = false;
        }
      }
    }

    protected hasLiveParticles(): boolean {
      return this.particles.some(p => p.alive);
    }

    protected clearParticles(): void {
      for (const p of this.particles) {
        p.sprite.destroy();
      }
      this.particles = [];
    }
  };
}

// ============================================================================
// PROJECTILE SYSTEM - For spells with projectiles
// ============================================================================

/**
 * Configuration for projectile behavior
 */
export interface ProjectileConfig {
  /** Projectile speed in pixels per frame */
  speed: number;
  /** Whether to rotate sprite to face direction of travel */
  rotateToDirection: boolean;
  /** Arc height for parabolic projectiles (0 = straight line) */
  arcHeight?: number;
  /** Whether projectile homes in on target */
  homing?: boolean;
  /** Homing turn rate (radians per frame) */
  homingRate?: number;
}

/**
 * Mixin for spells with projectiles
 */
export function ProjectileSpellMixin<T extends new (...args: any[]) => SpellAnimation>(Base: T) {
  return class extends Base {
    protected projectile?: Sprite;
    protected projectileProgress = 0;
    protected projectileConfig: ProjectileConfig = {
      speed: 10,
      rotateToDirection: true,
      arcHeight: 0,
    };

    protected initProjectile(texture: Texture, config: Partial<ProjectileConfig> = {}): void {
      this.projectileConfig = { ...this.projectileConfig, ...config };

      this.projectile = new Sprite(texture);
      this.projectile.anchor.set(0.5);
      this.projectile.position.set(0, 0); // Starts at cellFrom

      if (this.projectileConfig.rotateToDirection) {
        this.projectile.rotation = this.angleToTarget();
      }

      this.container.addChild(this.projectile);
      this.projectileProgress = 0;
    }

    protected updateProjectile(): boolean {
      if (!this.projectile) return true;

      const { cellFrom, cellTo, distance } = this.context;
      const { speed, arcHeight } = this.projectileConfig;

      // Calculate progress (0 to 1)
      const progressPerFrame = speed / distance;
      this.projectileProgress += progressPerFrame;

      if (this.projectileProgress >= 1) {
        // Projectile reached target
        this.projectile.position.set(
          cellTo.x - cellFrom.x,
          cellTo.y - cellFrom.y
        );
        return true; // Completed
      }

      // Linear interpolation for position
      const t = this.projectileProgress;
      let x = this.lerp(0, cellTo.x - cellFrom.x, t);
      let y = this.lerp(0, cellTo.y - cellFrom.y, t);

      // Add arc if configured
      if (arcHeight && arcHeight > 0) {
        // Parabolic arc: highest at t=0.5
        const arcOffset = Math.sin(t * Math.PI) * arcHeight;
        y -= arcOffset;
      }

      this.projectile.position.set(x, y);

      return false; // Not completed
    }

    protected destroyProjectile(): void {
      if (this.projectile) {
        this.projectile.destroy();
        this.projectile = undefined;
      }
    }
  };
}

// ============================================================================
// SPELL REGISTRY - Factory for creating spell animations
// ============================================================================

type SpellAnimationConstructor = new () => ISpellAnimation;

/**
 * Registry for spell animations
 * Maps spell IDs to their animation classes
 */
export class SpellRegistry {
  private static spells: Map<number, SpellAnimationConstructor> = new Map();

  /**
   * Register a spell animation class
   */
  static register(spellId: number, SpellClass: SpellAnimationConstructor): void {
    this.spells.set(spellId, SpellClass);
  }

  /**
   * Create a spell animation instance
   * @returns The spell animation, or undefined if not registered
   */
  static create(spellId: number): ISpellAnimation | undefined {
    const SpellClass = this.spells.get(spellId);
    if (!SpellClass) return undefined;
    return new SpellClass();
  }

  /**
   * Check if a spell is registered
   */
  static has(spellId: number): boolean {
    return this.spells.has(spellId);
  }

  /**
   * Get all registered spell IDs
   */
  static getRegisteredSpells(): number[] {
    return Array.from(this.spells.keys());
  }
}

// ============================================================================
// DECORATOR - For auto-registration
// ============================================================================

/**
 * Decorator to auto-register a spell animation
 * Usage: @RegisterSpell(102) class Spell102 extends SpellAnimation { ... }
 */
export function RegisterSpell(spellId: number) {
  return function <T extends SpellAnimationConstructor>(SpellClass: T): T {
    SpellRegistry.register(spellId, SpellClass);
    return SpellClass;
  };
}
