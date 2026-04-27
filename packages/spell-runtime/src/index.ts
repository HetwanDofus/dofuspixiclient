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
  SpellAnimationInfo,
  ISpellAnimation,
  SpellDisplayTypeValue,
} from './spell-interface';
export {
  SpellRegistry,
  RegisterSpell,
  SpellDisplayType,
} from './spell-interface';

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

// Clip-based composition runtime (M1 — replaces hand-rolled
// Container+Sprite tracking inside individual spell modules; the
// canonical AS clip tree is modeled as SpellClip + SymbolRegistry +
// SpellRuntime ticking at the canonical Flash 30 fps baseline).
export {
  configureHarness,
  FLASH_FPS,
  type HarnessSetup,
  resolveAnchor,
  RuntimeSpell,
  SpellClip,
  type SpellClipInit,
  SpellRuntime,
  type SpellRuntimeInit,
  SymbolRegistry,
  type ClipEventHandler,
  type FrameScript,
  type SpellRootData,
  type SymbolDefinition,
} from './clip/index.ts';
