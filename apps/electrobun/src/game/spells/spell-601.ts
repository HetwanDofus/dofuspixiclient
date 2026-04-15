/**
 * Spell 601 - Dodge
 *
 * A dodge/evasion animation. The spell has two phases:
 * - "move" animation: plays briefly then stops (caster dodging)
 * - "shoot" animation: the main animation with fade-out starting at frame 109
 *
 * Components:
 * - shoot (DefineSprite_12_shoot): Main animation, 144 frames, stops at frame 142 (0-indexed: 141)
 *   - At frame 109 (0-indexed: 108): alpha starts fading by 3.33 per frame
 * - move (DefineSprite_14_move): Brief 2-frame animation at caster position
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'dodge_601'
 * - Frame 109 (shoot): Alpha fades by 3.33/frame until end
 * - Frame 142 (shoot): stop()
 *
 * Note: The "shoot" animation contains particle sub-sprites (DefineSprite_10) with
 * rotation, velocity, and scale effects, but these are baked into the composite frames.
 * The "move" animation also contains sub-sprites (DefineSprite_13) that move horizontally,
 * also baked into composite frames.
 *
 * The main behavior to replicate in TS:
 * - Play sound at start
 * - Play shoot animation, stop at frame 141
 * - Starting at frame 108, fade alpha by 3.33/frame
 * - Signal hit at start (dodge is self-cast evasion, no projectile impact)
 * - Complete when shoot animation stops
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 106.3,
  height: 43,
  offsetX: -66,
  offsetY: -27.25,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 68.35,
  height: 40.3,
  offsetX: -31.35,
  offsetY: -18.8,
};

export class Spell601 extends BaseSpell {
  readonly spellId = 601;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;

  // Track alpha fade for shoot animation
  private fadeStarted = false;
  private shootAlpha = 1;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Move animation (DefineSprite_14_move) - 2 frames, plays at caster position
    // In AS, move plays first, then shoot removes it
    const moveTextures = textures.getFrames("move");
    if (moveTextures.length > 0) {
      const moveAnchor = calculateAnchor(MOVE_MANIFEST);
      this.moveAnim = this.anims.add(
        new FrameAnimatedSprite({
          textures: moveTextures,
          anchorX: moveAnchor.x,
          anchorY: moveAnchor.y,
          scale: init.scale,
          // Start at random frame (AS: gotoAndStop(random(_totalframes) + 1))
          startFrame: Math.floor(Math.random() * moveTextures.length),
        })
      );
      this.moveAnim.sprite.position.set(0, init.casterY);
      this.moveAnim.addTo(this.container);
    }

    // Shoot animation (DefineSprite_12_shoot) - 144 frames, stops at frame 141 (0-indexed)
    const shootTextures = textures.getFrames("shoot");
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);

    // Play sound at frame 0 (AS frame 1)
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound("dodge_601");
    });

    // Stop at frame 141 (AS frame 142: stop())
    this.shootAnim.stopAt(141);

    this.shootAnim.addTo(this.container);

    // Signal hit immediately - dodge is a self-effect, no projectile travel
    this.signalHit();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Starting at frame 108 (AS frame 109), fade alpha by 3.33 per frame
    // AS: onClipEvent(enterFrame) { _parent._alpha -= 3.33; }
    // This runs every frame once the clip at frame 109 is placed
    const currentFrame = this.shootAnim.getFrame();
    if (currentFrame >= 108) {
      if (!this.fadeStarted) {
        this.fadeStarted = true;
        this.shootAlpha = 1;
      }
      // Each update tick represents one frame at 60fps
      // deltaTime is in ms, frameTime = 1000/60 ≈ 16.67ms
      // We need to apply 3.33 alpha reduction per frame
      const framesElapsed = deltaTime / (1000 / 60);
      this.shootAlpha = Math.max(
        0,
        this.shootAlpha - (3.33 / 100) * framesElapsed
      );
      this.shootAnim.sprite.alpha = this.shootAlpha;
    }

    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
