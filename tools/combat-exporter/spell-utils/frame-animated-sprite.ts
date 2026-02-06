/**
 * FrameAnimatedSprite - Utility for frame-based sprite animation
 *
 * Handles the common pattern of advancing through texture frames at a fixed FPS,
 * with support for:
 * - Frame callbacks (trigger actions at specific frames)
 * - Stop frames (pause at a specific frame)
 * - Loop support
 * - Frame-accurate timing
 *
 * Based on ActionScript MovieClip behavior from Dofus 1.29 spells.
 */

import { Sprite, Texture, Container } from 'pixi.js';

export interface FrameCallback {
  frame: number;
  callback: () => void;
  once: boolean;
  triggered: boolean;
}

export interface FrameAnimatedSpriteConfig {
  /** Textures for each frame */
  textures: Texture[];
  /** Frames per second (default: 60) */
  fps?: number;
  /** Frame to stop at (undefined = play through) */
  stopFrame?: number;
  /** Whether to loop (default: false) */
  loop?: boolean;
  /** Starting frame (default: 0) */
  startFrame?: number;
  /** Anchor point X (default: 0.5) */
  anchorX?: number;
  /** Anchor point Y (default: 0.5) */
  anchorY?: number;
  /** Scale factor (default: 1) */
  scale?: number;
}

export class FrameAnimatedSprite {
  readonly sprite: Sprite;
  readonly textures: Texture[];

  private readonly fps: number;
  private readonly frameTime: number;
  private readonly loop: boolean;
  private stopFrame?: number;

  private currentFrame: number;
  private frameAccumulator = 0;
  private callbacks: FrameCallback[] = [];
  private stopped = false;
  private completed = false;

  private onCompleteCallback?: () => void;
  private onStopCallback?: () => void;

  constructor(config: FrameAnimatedSpriteConfig) {
    this.textures = config.textures;
    this.fps = config.fps ?? 60;
    this.frameTime = 1000 / this.fps;
    this.loop = config.loop ?? false;
    this.stopFrame = config.stopFrame;
    this.currentFrame = config.startFrame ?? 0;

    // Create sprite
    const initialTexture = this.textures[this.currentFrame] ?? Texture.EMPTY;
    
    this.sprite = new Sprite(initialTexture);
    this.sprite.anchor.set(config.anchorX ?? 0.5, config.anchorY ?? 0.5);

    if (config.scale !== undefined) {
      this.sprite.scale.set(config.scale);
    }
  }

  /**
   * Register a callback for when a specific frame is reached
   * @param frame Frame number (0-indexed)
   * @param callback Function to call
   * @param once If true, only trigger once (default: true)
   */
  onFrame(frame: number, callback: () => void, once = true): this {
    this.callbacks.push({ frame, callback, once, triggered: false });
    return this;
  }

  /**
   * Set the frame to stop at
   */
  stopAt(frame: number): this {
    this.stopFrame = frame;
    return this;
  }

  /**
   * Set callback for when animation completes (reaches last frame or stop frame)
   */
  onComplete(callback: () => void): this {
    this.onCompleteCallback = callback;
    return this;
  }

  /**
   * Set callback for when animation stops at stopFrame
   */
  onStop(callback: () => void): this {
    this.onStopCallback = callback;
    return this;
  }

  /**
   * Update the animation
   * @param deltaTime Time elapsed since last update in milliseconds
   * @returns true if animation is still playing, false if completed/stopped
   */
  update(deltaTime: number): boolean {
    if (this.completed) return false;
    if (this.stopped) return true; // Stopped but not completed

    this.frameAccumulator += deltaTime;

    while (this.frameAccumulator >= this.frameTime && !this.stopped) {
      this.advanceFrame();
      this.frameAccumulator -= this.frameTime;
    }

    return !this.completed;
  }

  private advanceFrame(): void {
    // Check callbacks for current frame before advancing
    this.triggerCallbacks(this.currentFrame);

    // Check if we should stop at this frame
    if (this.stopFrame !== undefined && this.currentFrame >= this.stopFrame) {
      this.currentFrame = this.stopFrame;
      this.stopped = true;
      this.updateTexture();
      this.onStopCallback?.();
      return;
    }

    // Advance to next frame
    this.currentFrame++;

    // Check if we've reached the end
    if (this.currentFrame >= this.textures.length) {
      if (!this.loop) {
        this.currentFrame = this.textures.length - 1;
        this.completed = true;
        this.updateTexture();
        this.onCompleteCallback?.();

        return;
      }

      this.currentFrame = 0;
      this.resetCallbacks();
    }

    this.updateTexture();

    // Check callbacks for new frame
    this.triggerCallbacks(this.currentFrame);
  }

  private triggerCallbacks(frame: number): void {
    for (const cb of this.callbacks) {
      if (cb.frame === frame && !cb.triggered) {
        cb.callback();

        if (cb.once) {
          cb.triggered = true;
        }
      }
    }
  }

  private resetCallbacks(): void {
    for (const cb of this.callbacks) {
      if (!cb.once) {
        cb.triggered = false;
      }
    }
  }

  private updateTexture(): void {
    const frameIndex = Math.min(this.currentFrame, this.textures.length - 1);

    if (this.textures[frameIndex]) {
      this.sprite.texture = this.textures[frameIndex];
    }
  }

  /**
   * Get current frame number
   */
  getFrame(): number {
    return this.currentFrame;
  }

  /**
   * Jump to a specific frame
   */
  gotoFrame(frame: number): this {
    this.currentFrame = Math.max(0, Math.min(frame, this.textures.length - 1));

    this.updateTexture();

    return this;
  }

  /**
   * Resume playback after being stopped
   */
  play(): this {
    this.stopped = false;

    return this;
  }

  /**
   * Pause playback
   */
  pause(): this {
    this.stopped = true;

    return this;
  }

  /**
   * Reset animation to beginning
   */
  reset(): this {
    this.currentFrame = 0;
    this.frameAccumulator = 0;
    this.stopped = false;
    this.completed = false;
    
    this.resetCallbacks();

    for (const cb of this.callbacks) {
      cb.triggered = false;
    }
    
    this.updateTexture();
    
    return this;
  }

  /**
   * Check if animation has completed
   */
  isComplete(): boolean {
    return this.completed;
  }

  /**
   * Check if animation is stopped (but not necessarily complete)
   */
  isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Get total frame count
   */
  get totalFrames(): number {
    return this.textures.length;
  }

  /**
   * Add sprite to a container
   */
  addTo(container: Container): this {
    container.addChild(this.sprite);

    return this;
  }

  /**
   * Destroy the sprite
   */
  destroy(): void {
    this.sprite.destroy();
  }
}

/**
 * Factory function for creating FrameAnimatedSprite with fluent API
 */
export function createFrameAnimation(
  textures: Texture[],
  config: Omit<FrameAnimatedSpriteConfig, 'textures'> = {}
): FrameAnimatedSprite {
  return new FrameAnimatedSprite({ textures, ...config });
}
