/**
 * Base class for spell animations providing common functionality.
 */

import { Container } from 'pixi.js';
import type { ISpellAnimation, SpellCallbacks, SpellContext, SpellTextureProvider } from './spell-interface';
import { FrameAnimatedSprite } from './frame-animated-sprite';
import { SPELL_CONSTANTS } from './sprite-config';

export interface SpellInitContext {
  scale: number;
  angleRad: number;
  /**
   * Caster position relative to the spell container's origin (which the
   * runtime has anchored according to displayType). For displayType=10/12
   * this is (0, Y_OFFSET); for 11 (target anchor) this is the negative
   * delta from target → caster.
   */
  casterX: number;
  casterY: number;
  /**
   * Target position relative to the spell container's origin. Mirror of
   * casterX/Y. Spells that anchored at target (displayType=11) see this
   * as (0, Y_OFFSET).
   */
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
    // "Complete" for spell-lifecycle purposes means the anim has finished
    // advancing — either it played past the last frame (`completed=true`)
    // OR it reached its `stopAt()` frame and is now frozen (`stopped=true`).
    // FrameAnimatedSprite mirrors AS2 `stop()` which holds the MovieClip
    // on its last frame without setting `completed`; without this guard,
    // every spell using `.stopAt(N)` hangs forever (BaseSpell never fires
    // complete(), the visual sticks, and the player CAST pose stays).
    return this.animations.every(anim => anim.isComplete() || anim.isStopped());
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
  /**
   * Tracks (spellId, symbolName) pairs we've already warned about, so a
   * spell that asks for a missing texture every frame logs once instead
   * of flooding the console.
   */
  private static readonly missingSymbolsLogged = new Set<string>();
  protected anims = new AnimationManager();

  init(context: SpellContext, callbacks: SpellCallbacks, textures: SpellTextureProvider): void {
    this.callbacks = callbacks;

    // Coords are RELATIVE TO THE CONTAINER ORIGIN. The runtime has
    // already positioned the container at context.anchor (caster cell,
    // target cell, or world origin depending on displayType), so each
    // axis is `world - anchor`.
    const anchorX = context?.anchor?.x ?? context?.cellFrom?.x ?? 0;
    const anchorY = context?.anchor?.y ?? context?.cellFrom?.y ?? 0;

    const casterWorldX = context?.cellFrom?.x ?? anchorX;
    const casterWorldY = context?.cellFrom?.y ?? anchorY;
    const targetWorldX = context?.cellTo?.x ?? anchorX;
    const targetWorldY = context?.cellTo?.y ?? anchorY;

    const initContext: SpellInitContext = {
      scale: 1 / SPELL_CONSTANTS.EXTRACTION_SCALE,
      angleRad: ((context?.angle ?? 0) * Math.PI) / 180,
      casterX: casterWorldX - anchorX,
      casterY: (casterWorldY - anchorY) + SPELL_CONSTANTS.Y_OFFSET,
      targetX: targetWorldX - anchorX,
      targetY: (targetWorldY - anchorY) + SPELL_CONSTANTS.Y_OFFSET,
    };

    this.setup(context, textures, initContext);
  }

  protected abstract setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void;

  /**
   * Runtime calls this every frame. The base contract is
   * `update(deltaTime, elapsedTime)` — subclasses that ignore the
   * second arg are fine (TS / JS accept extra params).
   */
  abstract update(deltaTime: number, elapsedTime?: number): void;

  isComplete(): boolean {
    return this.done || this.anims.allComplete();
  }

  /**
   * Look up a texture array by symbol name and warn once if it's empty.
   * Generated spells should call this instead of `textures.getFrames(...)`
   * directly so a stale .dofasset symbol doesn't silently render
   * nothing — at least the diagnostic surfaces.
   */
  protected getFramesOrWarn(
    textures: SpellTextureProvider,
    name: string
  ): ReturnType<SpellTextureProvider['getFrames']> {
    const frames = textures.getFrames(name);
    if (frames.length === 0) {
      const key = `${this.spellId}:${name}`;
      if (!BaseSpell.missingSymbolsLogged.has(key)) {
        BaseSpell.missingSymbolsLogged.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[spell ${this.spellId}] missing symbol "${name}" — getFrames() returned [] (re-compile spell asset?)`
        );
      }
    }
    return frames;
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
