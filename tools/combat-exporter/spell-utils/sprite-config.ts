/**
 * Sprite Configuration Types
 *
 * Provides a clean way to define sprite dimensions, offsets, and positioning
 * based on data extracted from SWF manifests.
 *
 * In ActionScript/Flash, sprites have a registration point (origin) that can be
 * anywhere within the sprite bounds. The offset values represent the distance
 * from the top-left corner to the registration point.
 */

import { Sprite, Texture } from 'pixi.js';

/**
 * Configuration for a sprite's dimensions and registration point
 * Values are typically extracted from SWF manifest data
 */
export interface SpriteManifest {
  /** Total width of the sprite in pixels */
  width: number;
  /** Total height of the sprite in pixels */
  height: number;
  /**
   * X offset of registration point from top-left
   * Negative = origin is inside sprite (typical)
   * Example: -391.2 means origin is 391.2px from left edge
   */
  offsetX: number;
  /**
   * Y offset of registration point from top-left
   * Negative = origin is inside sprite (typical)
   * Example: -107.7 means origin is 107.7px from top edge
   */
  offsetY: number;
}

/**
 * Calculate PixiJS anchor values from SWF offset data
 *
 * In Flash, offsets tell us where the origin is relative to top-left.
 * In PixiJS, anchor is a 0-1 value representing position within bounds.
 *
 * anchor = -offset / dimension
 */
export function calculateAnchor(manifest: SpriteManifest): { x: number; y: number } {
  return {
    x: -manifest.offsetX / manifest.width,
    y: -manifest.offsetY / manifest.height,
  };
}

/**
 * Apply manifest configuration to a sprite
 */
export function applyManifest(sprite: Sprite, manifest: SpriteManifest, scale = 1): void {
  const anchor = calculateAnchor(manifest);
  sprite.anchor.set(anchor.x, anchor.y);
  sprite.scale.set(scale);
}

/**
 * Create a configured sprite from texture and manifest
 */
export function createSprite(
  texture: Texture,
  manifest: SpriteManifest,
  scale = 1
): Sprite {
  const sprite = new Sprite(texture);
  applyManifest(sprite, manifest, scale);
  return sprite;
}

/**
 * Standard positioning constants used across many spells
 */
export const SPELL_CONSTANTS = {
  /** Standard Y offset for chest-level positioning (above cell center where feet are) */
  Y_OFFSET: -50,
  /** Standard extraction scale (6x supersampling from SWF rasterization) */
  EXTRACTION_SCALE: 6,
  /** Standard FPS for spell animations */
  FPS: 60,
  /** Frame time in milliseconds at 60 FPS */
  FRAME_TIME: 1000 / 60,
} as const;

/**
 * Position types for spell effects
 */
export type SpellPositionType = 'caster' | 'target' | 'midpoint';

/**
 * Configuration for positioning a spell element
 */
export interface SpellElementPosition {
  /** Where this element should be positioned */
  type: SpellPositionType;
  /** Additional X offset from base position */
  offsetX?: number;
  /** Additional Y offset from base position (Y_OFFSET is applied automatically for caster/target) */
  offsetY?: number;
  /** Whether to apply rotation based on angle to target */
  applyRotation?: boolean;
}

/**
 * Calculate screen position for a spell element
 */
export function calculatePosition(
  position: SpellElementPosition,
  context: {
    cellFrom: { x: number; y: number };
    cellTo: { x: number; y: number };
    angle: number;
  }
): { x: number; y: number; rotation: number } {
  const yOffset = SPELL_CONSTANTS.Y_OFFSET;
  let x: number;
  let y: number;

  switch (position.type) {
    case 'caster':
      // Container is at cellFrom, so caster is at origin
      x = 0;
      y = yOffset;
      break;
    case 'target':
      // Target is relative to caster (cellFrom)
      x = context.cellTo.x - context.cellFrom.x;
      y = context.cellTo.y - context.cellFrom.y + yOffset;
      break;
    case 'midpoint':
      // Midpoint between caster and target
      x = (context.cellTo.x - context.cellFrom.x) / 2;
      y = (context.cellTo.y - context.cellFrom.y) / 2 + yOffset;
      break;
  }

  // Apply additional offsets
  x += position.offsetX ?? 0;
  y += position.offsetY ?? 0;

  // Calculate rotation if needed
  const rotation = position.applyRotation ? (context.angle * Math.PI) / 180 : 0;

  return { x, y, rotation };
}

/**
 * Full configuration for a spell animation element (beam, impact, etc.)
 */
export interface SpellElementConfig {
  /** Sprite manifest for dimensions/anchor */
  manifest: SpriteManifest;
  /** Texture frame prefix for loading */
  texturePrefix: string;
  /** Position configuration */
  position: SpellElementPosition;
  /** Scale factor (1 = use extraction scale, < 1 = smaller) */
  scale?: number;
  /** Frame to stop at (undefined = play through) */
  stopFrame?: number;
  /** Total frame count (for completion check) */
  totalFrames?: number;
  /** Frame callbacks: { frame: callback } */
  frameCallbacks?: Record<number, string>;
}

/**
 * Flash/SWF transform matrix
 * Represents a 2D affine transform as used in Flash/SWF files
 *
 * Matrix layout:
 * | scaleX      rotateSkew0 |
 * | rotateSkew1 scaleY      |
 */
export interface FlashTransform {
  scaleX: number;
  scaleY: number;
  rotateSkew0: number;
  rotateSkew1: number;
  translateX: number;
  translateY: number;
}

/**
 * Decomposed transform values for PixiJS
 */
export interface DecomposedTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Decompose a Flash transform matrix into PixiJS-compatible values
 *
 * Flash uses a 2x2 matrix + translation:
 * | a  b |  where a=scaleX, b=rotateSkew0
 * | c  d |        c=rotateSkew1, d=scaleY
 *
 * This extracts rotation, scaleX, and scaleY from the matrix.
 */
export function decomposeFlashTransform(t: FlashTransform): DecomposedTransform {
  const a = t.scaleX;
  const b = t.rotateSkew0;
  const c = t.rotateSkew1;
  const d = t.scaleY;

  // Extract rotation from the matrix
  const rotation = Math.atan2(b, a);

  // Extract scale values
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);

  // Check determinant for reflection (negative scale)
  const det = a * d - b * c;
  const finalScaleY = det < 0 ? -scaleY : scaleY;

  return {
    x: t.translateX,
    y: t.translateY,
    rotation,
    scaleX,
    scaleY: finalScaleY,
  };
}

/**
 * Apply a Flash transform to a PixiJS sprite
 */
export function applyFlashTransform(sprite: Sprite, transform: FlashTransform): void {
  const decomposed = decomposeFlashTransform(transform);
  sprite.position.set(decomposed.x, decomposed.y);
  sprite.rotation = decomposed.rotation;
  sprite.scale.set(decomposed.scaleX, decomposed.scaleY);
}
