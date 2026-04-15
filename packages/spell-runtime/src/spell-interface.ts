/**
 * Spell Animation System - TypeScript Interfaces
 *
 * Based on analysis of 282 Dofus 1.29 spell ActionScript files.
 * These interfaces define the contract between the combat system and spell animations.
 *
 * KEY INSIGHT: Spell animations are single-target. For AOE spells, the combat system
 * spawns multiple spell instances, one per target cell/entity.
 */

import type { Container, Texture } from 'pixi.js';

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
  // ---- Position data (from AS: _parent.cellFrom, _parent.cellTo) ----

  /** Source/caster cell - where the spell originates */
  cellFrom: CellInfo;

  /** Target cell - where the spell hits */
  cellTo: CellInfo;

  /**
   * Pre-calculated angle from caster to target in DEGREES
   * Range: 0-360 where 0=right, 90=down, 180=left, 270=up
   *
   * Used by AS as: _rotation = _parent.angle
   */
  angle: number;

  /**
   * Pre-calculated distance in PIXELS
   * sqrt((cellTo.x - cellFrom.x)² + (cellTo.y - cellFrom.y)²)
   */
  distance: number;

  // ---- Spell data (from AS: _parent.level, _parent.params) ----

  /**
   * Spell level (1-6)
   *
   * Affects many things in AS code:
   * - Particle count: nb = 10 + _parent.level * 3
   * - Effect size: t = 50 + 20 * _parent.level
   * - Duration: loops based on level
   */
  level: number;

  /** Elemental parameters for multi-element spells (only 3000, 3001, 3002) */
  params?: ElementParams;

  // ---- Fighter data ----

  /** Information about the caster */
  caster: FighterInfo;

  /** Information about the target (if targeting a fighter) */
  target?: FighterInfo;

  /**
   * Direction the caster is facing
   * true = facing right (towards positive X)
   * false = facing left (towards negative X)
   */
  casterFacingRight: boolean;

  // ---- Timing data (from AS: _root._currentframe, _root.i) ----

  /** Current frame of the parent combat timeline */
  parentFrame: number;

  /** Global animation index - for staggered multi-hit effects */
  instanceIndex: number;

  // ---- Game state ----

  /** Whether critical hit occurred (for enhanced visuals) */
  isCritical: boolean;
}

// ============================================================================
// CALLBACKS - Functions provided by the combat system
// ============================================================================

/**
 * Callbacks provided to spell animations for interacting with the game
 */
export interface SpellCallbacks {
  /**
   * Play a sound effect
   * AS equivalent: SOMA.playSound("soundId")
   */
  playSound: (soundId: string) => void;

  /**
   * Signal that the spell animation has completed
   * Combat system waits for this before proceeding to next action
   */
  onComplete: () => void;

  /**
   * Signal that the spell hit the target
   * Combat system uses this to apply damage/effects, show damage numbers, etc.
   *
   * For projectiles: call when projectile reaches target
   * For instant spells: call when impact visual plays
   */
  onHit: () => void;

  /**
   * Signal a custom event during the animation
   * Used for spell-specific timing (multi-hit spells, phases, etc.)
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
  /** Get a texture for this spell */
  getTexture(name: string): Texture;

  /** Get all frame textures for an animated sprite */
  getFrames(prefix: string): Texture[];

  /** Check if a texture exists */
  hasTexture(name: string): boolean;
}

// ============================================================================
// SPELL ANIMATION - Core interface
// ============================================================================

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
  readonly spellId: number;
  readonly container: Container;

  init(
    context: SpellContext,
    callbacks: SpellCallbacks,
    textures: SpellTextureProvider,
  ): void;

  update(deltaTime: number, elapsedTime: number): void;
  isComplete(): boolean;
  destroy(): void;
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

  static register(spellId: number, SpellClass: SpellAnimationConstructor): void {
    this.spells.set(spellId, SpellClass);
  }

  static create(spellId: number): ISpellAnimation | undefined {
    const SpellClass = this.spells.get(spellId);
    if (!SpellClass) return undefined;
    return new SpellClass();
  }

  static has(spellId: number): boolean {
    return this.spells.has(spellId);
  }

  static getRegisteredSpells(): number[] {
    return Array.from(this.spells.keys());
  }
}

/**
 * Decorator to auto-register a spell animation
 * Usage: @RegisterSpell(102) class Spell102 extends BaseSpell { ... }
 */
export function RegisterSpell(spellId: number) {
  return function <T extends SpellAnimationConstructor>(SpellClass: T): T {
    SpellRegistry.register(spellId, SpellClass);
    return SpellClass;
  };
}
