/**
 * Spell Runtime - Shared types and utilities for Dofus spell animations
 */

// Core interfaces and types
export type {
  CellInfo,
  ElementParams,
  FighterInfo,
  SpellContext,
  SpellCallbacks,
  SpellTextureProvider,
  ISpellAnimation,
} from './spell-interface';
export { SpellRegistry, RegisterSpell } from './spell-interface';

// Frame animation
export {
  FrameAnimatedSprite,
  createFrameAnimation,
  type FrameAnimatedSpriteConfig,
  type FrameCallback,
} from './frame-animated-sprite';

// Sprite configuration
export {
  calculateAnchor,
  applyManifest,
  createSprite,
  calculatePosition,
  decomposeFlashTransform,
  applyFlashTransform,
  SPELL_CONSTANTS,
  type SpriteManifest,
  type SpellPositionType,
  type SpellElementPosition,
  type SpellElementConfig,
  type FlashTransform,
  type DecomposedTransform,
} from './sprite-config';

// Particle system
export {
  ASParticleSystem,
  type ASParticle,
  type ASParticleConfig,
} from './particle-system';

// Base class for spell implementations
export { BaseSpell, AnimationManager, type SpellInitContext } from './base-spell';
