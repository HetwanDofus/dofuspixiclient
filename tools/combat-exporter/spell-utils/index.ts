/**
 * Spell Utilities - Common abstractions for Dofus spell animations
 *
 * This module provides reusable utilities for implementing spell animations:
 *
 * - FrameAnimatedSprite: Frame-based sprite animation with callbacks
 * - Sprite Configuration: Types and helpers for SWF-to-PixiJS sprite setup
 * - Particle System: AS-style physics particle system
 *
 * Usage:
 * ```typescript
 * import {
 *   FrameAnimatedSprite,
 *   createFrameAnimation,
 *   ASParticleSystem,
 *   ParticleGenerators,
 *   SPELL_CONSTANTS,
 *   calculatePosition,
 * } from '../spell-utils';
 * ```
 */

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
