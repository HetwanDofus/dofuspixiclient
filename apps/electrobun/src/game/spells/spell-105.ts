/**
 * Spell 105 - Arty (Sadida)
 *
 * A radial flower/plant effect with animated "tige" (stem) instances
 * arranged in a circular pattern using sine/cosine positioning.
 *
 * Components:
 * - Main animation (anim1): 243 frames at target position
 * - Library symbol "tige" instances: 20 stems spawned over frames 0-38,
 *   each positioned using _parent.i angle offset (sine/cosine math)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'arty_105'
 * - DefineSprite_11 frame_1: Start spawning tige instances (c=0 to c<40, step 2)
 *   Each tige placed at: x = 20*sin(i), y = 7*cos(i), xscale = 50*cos(i)
 *   i starts at -PI, increments by 0.3 each step
 * - DefineSprite_11 frame_178: this.end() -> signal hit (0-indexed: 177)
 * - DefineSprite_11 frame_241: removeMovieClip() -> complete (0-indexed: 240)
 * - DefineSprite_9 frame_220: stop() (0-indexed: 219) - inner sprite stops
 *
 * The "tige" sprites are placed at the beginning and remain static after placement.
 * Each tige has:
 *   _X = 20 * Math.sin(i)
 *   _Y = 7 * Math.cos(i)
 *   _xscale = 50 * Math.cos(i)
 *   if (_Y < 0): _alpha = 70 * Math.cos(i) + 100
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  SPELL_CONSTANTS,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, Sprite } from "pixi.js";

const TIGE_MANIFEST: SpriteManifest = {
  width: 244.6,
  height: 224.85,
  offsetX: -102.55,
  offsetY: -176.7,
};

export class Spell105 extends BaseSpell {
  readonly spellId = 105;

  private mainAnim!: FrameAnimatedSprite;
  private tigeContainer!: Container;
  private tigeSprites: Sprite[] = [];

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Container for tige instances, positioned at target
    this.tigeContainer = new Container();
    this.tigeContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.tigeContainer);

    // Spawn tige instances as per DefineSprite_11 frame_1 logic:
    // _parent.i = -3.1415; c = 0;
    // while c < 40: attachMovie("tige", "tige"+c, c); c += 2; i += 0.3
    let i = -Math.PI;
    const tigeTexture = textures.getFrames("lib_tige")[0];
    const anchor = calculateAnchor(TIGE_MANIFEST);

    for (let c = 0; c < 40; c += 2) {
      // DefineSprite_10_tige frame_1 DoAction:
      // _X = 20 * Math.sin(_parent._parent.i)
      // _Y = 7 * Math.cos(_parent._parent.i)
      // _xscale = 50 * Math.cos(_parent._parent.i)
      // if (_Y < 0) { _alpha = 70 * Math.cos(_parent._parent.i) + 100; }
      const x = 20 * Math.sin(i);
      const y = 7 * Math.cos(i);
      const xscale = 50 * Math.cos(i);

      const sprite = new Sprite(tigeTexture);
      sprite.anchor.set(anchor.x, anchor.y);
      sprite.position.set(x * init.scale, y * init.scale);

      // Apply xscale (percentage -> fraction) with extraction scale
      // _xscale = 50 * cos(i) means scale.x = (50 * cos(i)) / 100 * init.scale
      // yscale is not set in AS so it defaults to 100% = init.scale
      sprite.scale.set((xscale / 100) * init.scale, init.scale);

      // Alpha: if _Y < 0, alpha = 70 * cos(i) + 100 (AS alpha is 0-100)
      if (y < 0) {
        const asAlpha = 70 * Math.cos(i) + 100;
        sprite.alpha = asAlpha / 100;
      }

      this.tigeContainer.addChild(sprite);
      this.tigeSprites.push(sprite);

      i += 0.3;
    }

    // Main animation (anim1) at target position
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: SPELL_CONSTANTS.FPS,
        anchorX: 0.5,
        anchorY: 0.5,
        scale: init.scale,
      })
    );
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("arty_105"));

    // DefineSprite_11 frame_178 -> 0-indexed: 177 -> signal hit
    this.mainAnim.onFrame(177, () => this.signalHit());

    // DefineSprite_11 frame_241 -> 0-indexed: 240 -> complete
    this.mainAnim.onFrame(240, () => this.complete());

    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
