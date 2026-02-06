/**
 * Base class for spell animations providing common functionality.
 */

import { Container } from 'pixi.js';
import type { ISpellAnimation, SpellCallbacks, SpellContext, SpellTextureProvider } from '../../../spell-interface';
import { FrameAnimatedSprite, SPELL_CONSTANTS } from '../../../spell-utils';

export interface SpellInitContext {
  scale: number;
  angleRad: number;
  casterY: number;
  targetX: number;
  targetY: number;
}

/**
 * Manages multiple FrameAnimatedSprite instances with batch operations.
 */
export class AnimationManager {
  private animations: FrameAnimatedSprite[] = [];

  add(anim: FrameAnimatedSprite): FrameAnimatedSprite {
    this.animations.push(anim);
    return anim;
  }

  update(deltaTime: number): void {
    for (const anim of this.animations) {
      anim.update(deltaTime);
    }
  }

  allComplete(): boolean {
    return this.animations.every(anim => anim.isComplete());
  }

  allStopped(): boolean {
    return this.animations.every(anim => anim.isStopped() || anim.isComplete());
  }

  destroy(): void {
    for (const anim of this.animations) {
      anim.destroy();
    }
    this.animations = [];
  }
}

export abstract class BaseSpell implements ISpellAnimation {
  abstract readonly spellId: number;

  readonly container = new Container();

  protected callbacks!: SpellCallbacks;
  protected done = false;
  protected hitSignaled = false;
  protected anims = new AnimationManager();

  init(context: SpellContext, callbacks: SpellCallbacks, textures: SpellTextureProvider): void {
    this.callbacks = callbacks;

    const initContext: SpellInitContext = {
      scale: 1 / SPELL_CONSTANTS.EXTRACTION_SCALE,
      angleRad: ((context?.angle ?? 0) * Math.PI) / 180,
      casterY: SPELL_CONSTANTS.Y_OFFSET,
      targetX: 0,
      targetY: SPELL_CONSTANTS.Y_OFFSET,
    };

    if (context?.cellFrom && context?.cellTo) {
      initContext.targetX = context.cellTo.x - context.cellFrom.x;
      initContext.targetY = (context.cellTo.y - context.cellFrom.y) + SPELL_CONSTANTS.Y_OFFSET;
    }

    this.setup(context, textures, initContext);
  }

  protected abstract setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void;

  abstract update(deltaTime: number): void;

  isComplete(): boolean {
    return this.done;
  }

  /**
   * Signal hit to the combat system. Only fires once per spell.
   */
  protected signalHit(): void {
    if (this.hitSignaled) {
      return;
    }

    this.hitSignaled = true;
    this.callbacks.onHit();
  }

  /**
   * Mark spell as complete. Only fires once per spell.
   */
  protected complete(): void {
    if (this.done) {
      return;
    }

    this.done = true;
    this.callbacks.onComplete();
  }

  destroy(): void {
    this.anims.destroy();
    this.container.destroy({ children: true });
  }
}
