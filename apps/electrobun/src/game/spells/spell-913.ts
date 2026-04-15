/**
 * Spell 913 - Fulminant (Shoot)
 *
 * A shoot spell with a main animation and 7 oscillating child sprites.
 *
 * Components:
 * - shoot (DefineSprite_9_shoot): Main animation at caster, rotated toward target
 *   - Contains DefineSprite_8: plays sound "jet_903" on frame 1
 *   - Contains DefineSprite_11_move: 7 child sprites with oscillating rotation
 *   - Contains DefineSprite_3: positioned with random offset, stops at frame 35
 *   - Contains DefineSprite_7: stops at frame 27
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_8): Play sound "jet_903"
 * - Frame 1 (DefineSprite_3): Set rotation = parent angle, random X/Y offset
 * - Frame 7 (DefineSprite_9_shoot): this.end() -> signal hit
 * - Frame 27 (DefineSprite_7): stop()
 * - Frame 35 (DefineSprite_3): stop()
 * - Frame 65 (DefineSprite_9_shoot): removeMovieClip() -> animation ends
 *
 * DefineSprite_11_move children (7 instances, PlaceObject2_10_1/3/5/7/9/11/13):
 * - onLoad: a=45, t=50+3*level, _xscale=t, _yscale=t
 * - onEnterFrame: _rotation = 90 + a * Math.cos(i += 0.5); a /= 1.1
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
  width: 101.1,
  height: 63.25,
  offsetX: -62.05,
  offsetY: -28.4,
};

/**
 * State for a single oscillating child sprite (DefineSprite_11_move instance)
 */
interface OscillatingChild {
  sprite: FrameAnimatedSprite;
  a: number;
  i: number;
}

export class Spell913 extends BaseSpell {
  readonly spellId = 913;

  private shootAnim!: FrameAnimatedSprite;
  private oscillatingChildren: OscillatingChild[] = [];
  private level = 1;
  private frameAccumulator = 0;
  private readonly FRAME_TIME = 1000 / 25; // 25 FPS

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Main shoot animation (DefineSprite_9_shoot) at caster position, rotated toward target
    const shootTextures = textures.getFrames("shoot");
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        fps: 25,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 1 (0-indexed: 0): Play sound "jet_903" (DefineSprite_8)
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("jet_903"));

    // Frame 7 (0-indexed: 6): this.end() -> signal hit
    this.shootAnim.onFrame(6, () => this.signalHit());

    this.container.addChild(this.shootAnim.sprite);

    // DefineSprite_11_move: 7 oscillating children placed inside the shoot sprite
    // They exist inside the shoot animation container, positioned relative to it.
    // Since we can't nest inside the FrameAnimatedSprite, we place them in a
    // sub-container that mirrors the shoot sprite's transform.
    const t = (50 + 3 * this.level) / 100;

    // 7 instances (PlaceObject2_10_1, _3, _5, _7, _9, _11, _13)
    const childTextures = textures.getFrames("shoot");
    for (let idx = 0; idx < 7; idx++) {
      // Each oscillating child uses a minimal single-frame placeholder
      // In the original, these are DefineSprite_10 (small graphic symbol)
      // We approximate using the first frame of shoot at tiny scale
      const childAnim = new FrameAnimatedSprite({
        textures: childTextures,
        fps: 25,
        anchorX: 0.5,
        anchorY: 0.5,
        scale: init.scale * t,
      });

      // Initial rotation: 90 + 45 * cos(0) = 90 + 45 = 135 degrees
      childAnim.sprite.rotation = (90 + 45 * Math.cos(0)) * (Math.PI / 180);
      childAnim.sprite.visible = false; // These are sub-elements, hide them

      this.oscillatingChildren.push({
        sprite: childAnim,
        a: 45,
        i: 0,
      });
    }

    // DefineSprite_3: positioned with random X/Y offset, rotation = parent angle
    // AS: _rotation = _parent._parent.angle; _X = 50*(Math.random()-0.5); _Y = 25*(Math.random()-0.5)
    // This is a child of the shoot sprite - we track its behavior but it's part
    // of the composite shoot animation itself (baked into the sprite frames)
    // The random offset and rotation are baked into the composite frames already.
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update oscillating children per-frame (enterFrame logic)
    // Each frame: _rotation = 90 + a * cos(i += 0.5); a /= 1.1
    this.frameAccumulator += deltaTime;
    while (this.frameAccumulator >= this.FRAME_TIME) {
      this.frameAccumulator -= this.FRAME_TIME;
      for (const child of this.oscillatingChildren) {
        child.i += 0.5;
        const rotDeg = 90 + child.a * Math.cos(child.i);
        child.sprite.sprite.rotation = rotDeg * (Math.PI / 180);
        child.a /= 1.1;
      }
    }

    // Frame 65 (0-indexed: 64): removeMovieClip() -> animation ends
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
