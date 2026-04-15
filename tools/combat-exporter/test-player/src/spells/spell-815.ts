/**
 * Spell 815 - Vlad (Sacrieur)
 *
 * An impact spell with multiple sprite layers, each with a growing scale effect.
 *
 * Components:
 * - DefineSprite_12: Level-based frame selector (gotoAndStop(level)) - selects which sub-sprite runs
 * - DefineSprite_6: Impact sprite at target, plays sound "punch", grows with t-decay scaling, stops at frame 19
 * - DefineSprite_7 (t=7): Impact variant, signals hit at frame 22, removes at frame 91
 * - DefineSprite_8 (t=11): Impact variant, signals hit at frame 64, removes at frame 106
 * - DefineSprite_9 (t=20): Impact variant, signals hit at frame 79, removes at frame 118
 * - DefineSprite_10 (t=25): Impact variant, signals hit at frame 79, removes at frame 121
 * - DefineSprite_11 (t=33): Impact variant, signals hit at frame 79, removes at frame 121
 * - DefineSprite_3: Random rotation/alpha decorative sprite at target
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_806'
 * - Frame 1 (DefineSprite_6): Play sound 'punch', start growing scale effect with t decay
 * - Frame 19 (DefineSprite_6): stop()
 * - Frame 22 (DefineSprite_7): this.end() - signal hit
 * - Frame 64 (DefineSprite_8): this.end() - signal hit
 * - Frame 79 (DefineSprite_9/10/11): this.end() - signal hit
 * - Frame 91 (DefineSprite_7): removeMovieClip / stop
 * - Frame 106 (DefineSprite_8): removeMovieClip / stop
 * - Frame 118 (DefineSprite_9): removeMovieClip / stop
 * - Frame 121 (DefineSprite_10/11): removeMovieClip / stop
 *
 * DefineSprite_12 picks which sprite to show based on level (1-6 maps to one of the variants).
 * Since level maps to the sprite directly, we implement the level-appropriate one.
 *
 * Level mapping (gotoAndStop(level)):
 *   level 1 -> DefineSprite_6 (t=random(t)+t growing, stops frame 19, hit immediate)
 *   level 2 -> DefineSprite_7 (t=7, hit frame 22, ends frame 91)
 *   level 3 -> DefineSprite_8 (t=11, hit frame 64, ends frame 106)
 *   level 4 -> DefineSprite_9 (t=20, hit frame 79, ends frame 118)
 *   level 5 -> DefineSprite_10 (t=25, hit frame 79, ends frame 121)
 *   level 6 -> DefineSprite_11 (t=33, hit frame 79, ends frame 121)
 *
 * The manifest only has "anim1" (5 frames composite) - this is used for the growing impact sprite.
 * DefineSprite_3 uses random rotation and 50% alpha.
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

// anim1: the main impact animation (5 frames)
const ANIM1_MANIFEST: SpriteManifest = {
  width: 238.25,
  height: 242.35,
  offsetX: -84.65,
  offsetY: -144.45,
};

/**
 * Per-level configuration derived from ActionScript:
 *
 * DefineSprite_6: t = random(parent.t) + parent.t  (growing scale, stops frame 19, hit = frame 1 effectively since it's immediate)
 * DefineSprite_7: t = 7, hit = frame 22, end = frame 91
 * DefineSprite_8: t = 11, hit = frame 64, end = frame 106
 * DefineSprite_9: t = 20, hit = frame 79, end = frame 118
 * DefineSprite_10: t = 25, hit = frame 79, end = frame 121
 * DefineSprite_11: t = 33, hit = frame 79, end = frame 121
 */
interface LevelConfig {
  tValue: number;
  hitFrame: number;
  stopFrame: number;
  isScaleGrow: boolean; // DefineSprite_6 uses the growing scale mechanic
}

const LEVEL_CONFIGS: LevelConfig[] = [
  { tValue: 0,  hitFrame: 0,  stopFrame: 18, isScaleGrow: true  }, // level 1 -> DefineSprite_6
  { tValue: 7,  hitFrame: 21, stopFrame: 90, isScaleGrow: false }, // level 2 -> DefineSprite_7
  { tValue: 11, hitFrame: 63, stopFrame: 105, isScaleGrow: false }, // level 3 -> DefineSprite_8
  { tValue: 20, hitFrame: 78, stopFrame: 117, isScaleGrow: false }, // level 4 -> DefineSprite_9
  { tValue: 25, hitFrame: 78, stopFrame: 120, isScaleGrow: false }, // level 5 -> DefineSprite_10
  { tValue: 33, hitFrame: 78, stopFrame: 120, isScaleGrow: false }, // level 6 -> DefineSprite_11
];

export class Spell815 extends BaseSpell {
  readonly spellId = 815;

  // For the growing scale sprite (level 1 / DefineSprite_6)
  private scaleGrowActive = false;
  private scaleGrowT = 0;
  private scaleGrowAnim: FrameAnimatedSprite | null = null;
  private scaleGrowElapsed = 0;
  private readonly FRAME_TIME = 1000 / 60;

  // For the decorative sprite (DefineSprite_3)
  private decorAnim: FrameAnimatedSprite | null = null;

  // The main impact animation
  private mainAnim!: FrameAnimatedSprite;

  // Impact container at target position
  private impactContainer!: Container;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));
    const config = LEVEL_CONFIGS[level - 1];

    // Play vlad_806 at frame 1 (main timeline)
    this.callbacks.playSound('vlad_806');

    // Impact container positioned at target
    this.impactContainer = new Container();
    this.impactContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.impactContainer);

    // DefineSprite_3: decorative element with random rotation and 50% alpha
    // Uses anim1 as its texture (single frame reference)
    const decorTextures = textures.getFrames('anim1');
    const decorAnchor = calculateAnchor(ANIM1_MANIFEST);
    const decor = this.anims.add(new FrameAnimatedSprite({
      textures: decorTextures,
      anchorX: decorAnchor.x,
      anchorY: decorAnchor.y,
      scale: init.scale,
      stopFrame: config.stopFrame,
    }));
    decor.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
    decor.sprite.alpha = 0.5;
    this.impactContainer.addChild(decor.sprite);
    this.decorAnim = decor;

    // Main impact animation (DefineSprite_6 through 11 behavior)
    const anim1Textures = textures.getFrames('anim1');
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    if (config.isScaleGrow) {
      // DefineSprite_6: growing scale effect
      // t = random(parent.t) + parent.t where parent.t is determined by the parent sprite
      // Since DefineSprite_6 is nested under DefineSprite_12, and DefineSprite_12 uses gotoAndStop(level),
      // the parent.t for level 1 isn't directly set by the numbered sprites.
      // Looking at the AS: DefineSprite_6/frame_1/DoAction_2.as uses _parent.t
      // The _parent here would be the container that holds DefineSprite_6.
      // For level 1 (DefineSprite_6), the parent is DefineSprite_12, which calls gotoAndStop(1).
      // There's no explicit t set on DefineSprite_12 itself in the scripts.
      // The only t values set are in DefineSprite_7(7), _8(11), _9(20), _10(25), _11(33).
      // For DefineSprite_6, _parent.t would be from whatever contains it.
      // Since it's gotoAndStop(1) in DefineSprite_12, and DefineSprite_12/frame_1 has no t set,
      // we use a reasonable default. Looking at the pattern, _parent for DefineSprite_6 inside
      // DefineSprite_12 would be DefineSprite_12, which doesn't set t.
      // The AS for frame_1/DoAction_2: t = random(_parent.t) + _parent.t
      // If _parent.t is undefined/0, this would produce t = 0.
      // But looking at the pattern with other levels, we use t=7 as the minimum meaningful value.
      // Actually, since level 1 uses DefineSprite_6, and the parent (DefineSprite_12) doesn't set t,
      // _parent.t would be whatever was set on that container before.
      // Let's use t=10 as a reasonable fallback (between 7 and 11).
      // Given the ambiguity, use parentT = 10 for level 1.
      const parentT = 10;
      this.scaleGrowT = Math.floor(Math.random() * parentT) + parentT;

      const growAnim = this.anims.add(new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        stopFrame: 18, // frame 19 AS -> index 18
      }));
      growAnim.sprite.scale.set(0);
      growAnim.onFrame(0, () => {
        this.callbacks.playSound('punch');
        this.scaleGrowActive = true;
      });
      // Hit signal is immediate for level 1 (no explicit end() frame in DefineSprite_6)
      growAnim.onFrame(0, () => this.signalHit());
      growAnim.onFrame(18, () => {
        this.scaleGrowActive = false;
        this.complete();
      });
      this.impactContainer.addChild(growAnim.sprite);
      this.mainAnim = growAnim;
      this.scaleGrowAnim = growAnim;
    } else {
      // Standard variants (DefineSprite_7, 8, 9, 10, 11)
      // Play punch sound at frame 1
      // The growing scale effect: _xscale = 0 initially, then grows by t each frame, t /= 1.6
      // These also have the growing effect from DefineSprite_6/DoAction_2 as they contain it,
      // but looking at the AS more carefully: DefineSprite_7/8/9/10/11 each set their own t value
      // and DefineSprite_6 is placed inside them using gotoAndStop in DefineSprite_12.
      // Actually re-reading: DefineSprite_12 uses gotoAndStop(_parent.level) which selects
      // between frames 1-6, each frame having a different DefineSprite placed.
      // DefineSprite_6 is the base impact sprite used within all of them.
      // But DefineSprite_7 through 11 are longer-running outer wrappers.

      // The structure is:
      // Main timeline -> DefineSprite_12 (selects by level) -> contains DefineSprite_6 + outer wrapper
      // DefineSprite_7/8/9/10/11 set _parent.t, then DefineSprite_6 reads _parent.t

      // For non-level-1, we still need the growing scale anim (DefineSprite_6) at start,
      // plus the longer-running outer animation.
      // DefineSprite_6 stops at frame 19. The outer sprite continues longer.

      // Implement: inner growing anim (DefineSprite_6 behavior) + outer frame counter
      // The outer animation determines hit and stop timing.

      const parentT = config.tValue;
      const innerT_initial = Math.floor(Math.random() * parentT) + parentT;

      // Inner growing animation (DefineSprite_6 behavior)
      const innerAnim = this.anims.add(new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        stopFrame: 18, // DefineSprite_6 stops at frame 19 (index 18)
      }));
      innerAnim.sprite.scale.set(0);

      // Store grow state for inner anim
      let innerScaleT = innerT_initial;
      let innerScaleCurrentX = 0;
      let innerScaleCurrentY = 0;
      let innerGrowActive = false;

      innerAnim.onFrame(0, () => {
        this.callbacks.playSound('punch');
        innerGrowActive = true;
        innerScaleCurrentX = 0;
        innerScaleCurrentY = 0;
        innerScaleT = innerT_initial;
      });

      // We need per-frame scale update for inner anim - handle in update()
      // Store references for update
      (innerAnim as unknown as Record<string, unknown>)['_innerGrowState'] = {
        get active() { return innerGrowActive; },
        set active(v: boolean) { innerGrowActive = v; },
        get t() { return innerScaleT; },
        set t(v: number) { innerScaleT = v; },
        get scaleX() { return innerScaleCurrentX; },
        set scaleX(v: number) { innerScaleCurrentX = v; },
        get scaleY() { return innerScaleCurrentY; },
        set scaleY(v: number) { innerScaleCurrentY = v; },
      };

      this.impactContainer.addChild(innerAnim.sprite);

      // Outer animation (the longer-running sprite for timing hit/stop)
      // We use a separate anim on the same textures, looping until the stop frame
      const outerAnim = this.anims.add(new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        stopFrame: config.stopFrame,
      }));
      outerAnim.sprite.visible = false; // invisible, just for timing
      outerAnim.onFrame(config.hitFrame, () => this.signalHit());
      outerAnim.onFrame(config.stopFrame, () => this.complete());
      this.impactContainer.addChild(outerAnim.sprite);

      this.mainAnim = outerAnim;

      // Store inner anim state for update
      this._innerGrowAnim = innerAnim;
      this._innerGrowActiveRef = () => innerGrowActive;
      this._innerGrowSetActive = (v: boolean) => { innerGrowActive = v; };
      this._innerGrowGetT = () => innerScaleT;
      this._innerGrowSetT = (v: number) => { innerScaleT = v; };
      this._innerGrowGetScaleX = () => innerScaleCurrentX;
      this._innerGrowSetScaleX = (v: number) => { innerScaleCurrentX = v; };
      this._innerGrowGetScaleY = () => innerScaleCurrentY;
      this._innerGrowSetScaleY = (v: number) => { innerScaleCurrentY = v; };
      this._hasInnerGrow = true;
    }
  }

  // Inner grow state accessors (for non-level-1)
  private _innerGrowAnim: FrameAnimatedSprite | null = null;
  private _hasInnerGrow = false;
  private _innerGrowActiveRef: (() => boolean) | null = null;
  private _innerGrowSetActive: ((v: boolean) => void) | null = null;
  private _innerGrowGetT: (() => number) | null = null;
  private _innerGrowSetT: ((v: number) => void) | null = null;
  private _innerGrowGetScaleX: (() => number) | null = null;
  private _innerGrowSetScaleX: ((v: number) => void) | null = null;
  private _innerGrowGetScaleY: (() => number) | null = null;
  private _innerGrowSetScaleY: ((v: number) => void) | null = null;

  // Frame accumulator for scale grow (per-frame physics, not deltaTime-smoothed)
  private _innerGrowFrameAccum = 0;
  private _scaleGrowFrameAccum = 0;

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Handle growing scale effect for level 1 (scaleGrow mode)
    if (this.scaleGrowActive && this.scaleGrowAnim !== null) {
      this._scaleGrowFrameAccum += deltaTime;
      while (this._scaleGrowFrameAccum >= this.FRAME_TIME && this.scaleGrowActive) {
        this._scaleGrowFrameAccum -= this.FRAME_TIME;
        // AS: _xscale = _xscale + t; _yscale = _yscale + t; t /= 1.6
        const currentScale = this.scaleGrowAnim.sprite.scale.x * 100;
        const newScale = currentScale + this.scaleGrowT;
        this.scaleGrowAnim.sprite.scale.set((newScale / 100) * (1 / 60) * 60); // keep as fraction
        // Actually scale is set directly as fraction of 100:
        this.scaleGrowAnim.sprite.scale.set(newScale / 100);
        this.scaleGrowT = this.scaleGrowT / 1.6;
      }
    }

    // Handle inner grow for non-level-1 variants
    if (this._hasInnerGrow && this._innerGrowAnim !== null && this._innerGrowActiveRef !== null) {
      if (this._innerGrowActiveRef()) {
        this._innerGrowFrameAccum += deltaTime;
        while (this._innerGrowFrameAccum >= this.FRAME_TIME && this._innerGrowActiveRef()) {
          this._innerGrowFrameAccum -= this.FRAME_TIME;
          const currentX = this._innerGrowGetScaleX!();
          const currentY = this._innerGrowGetScaleY!();
          const t = this._innerGrowGetT!();
          const newX = currentX + t;
          const newY = currentY + t;
          this._innerGrowSetScaleX!(newX);
          this._innerGrowSetScaleY!(newY);
          this._innerGrowSetT!(t / 1.6);
          this._innerGrowAnim.sprite.scale.set(newX / 100, newY / 100);

          if (this._innerGrowAnim.isStopped() || this._innerGrowAnim.isComplete()) {
            this._innerGrowSetActive!(false);
          }
        }
      }
    }

    if (this.anims.allStopped() || this.anims.allComplete()) {
      this.complete();
    }
  }
}
