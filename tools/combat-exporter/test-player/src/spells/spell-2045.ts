/**
 * Spell 2045 - Pok
 *
 * A projectile spell that moves from caster to target over 45 frames,
 * then plays impact animation.
 *
 * Components:
 * - sprite_10: Projectile/impact animation at moving position
 *   - Contains an inner rotating element (DefineSprite_3) with random rotation speed
 *
 * Original AS timing:
 * - Frame 2 (main): stop() - main timeline stops
 * - PlaceObject2_10_1 (onClipEvent load): Set position to cellFrom, calculate dx/dy for 45-frame travel
 * - PlaceObject2_10_1 (onClipEvent enterFrame): Move for 45 frames toward cellTo
 * - DefineSprite_3 (onClipEvent load): r = random(90)
 * - DefineSprite_3 (onClipEvent enterFrame): _rotation += r (spins at random speed)
 * - Frame 46 (sprite_10): Play sound 'pok' + signal hit (this.end())
 * - Frame 88 (sprite_10): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 124.95,
  height: 185,
  offsetX: -65.55,
  offsetY: -157.6,
};

export class Spell2045 extends BaseSpell {
  readonly spellId = 2045;

  private mainAnim!: FrameAnimatedSprite;

  // Projectile movement state
  private posX = 0;
  private posY = 0;
  private dx = 0;
  private dy = 0;
  private t = 0;

  // Inner rotation state (DefineSprite_3)
  private rotationR = 0;
  private innerRotation = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // AS: r = random(90) -> 0 to 89
    this.rotationR = Math.floor(Math.random() * 90);
    this.innerRotation = 0;

    // AS onClipEvent(load):
    // _X = _parent.cellFrom.x
    // _Y = _parent.cellFrom.y
    // dx = (- _parent.cellFrom.x + _parent.cellTo.x) / 45
    // dy = (- _parent.cellFrom.y - 20 + _parent.cellTo.y) / 45
    // t = 0
    //
    // We work in local container space (container is at cellFrom).
    // cellFrom is origin (0, 0) in local space.
    // cellTo relative to cellFrom:
    const cellFromX = context?.cellFrom?.x ?? 0;
    const cellFromY = context?.cellFrom?.y ?? 0;
    const cellToX = context?.cellTo?.x ?? 0;
    const cellToY = context?.cellTo?.y ?? 0;

    this.posX = cellFromX;
    this.posY = cellFromY;
    this.dx = (-cellFromX + cellToX) / 45;
    this.dy = (-cellFromY - 20 + cellToY) / 45;
    this.t = 0;

    // sprite_10 animation
    const anchor = calculateAnchor(SPRITE_10_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Frame 46 (0-indexed: 45): play sound + signal hit
    this.mainAnim.onFrame(45, () => {
      this.callbacks.playSound('pok');
      this.signalHit();
    });

    // Frame 88 (0-indexed: 87): removeMovieClip -> complete
    this.mainAnim.onFrame(87, () => {
      this.complete();
    });

    // Initial position: start at cellFrom in world space.
    // The container is positioned at cellFrom by the combat system,
    // so we set the sprite at (0, 0) initially and update each frame.
    this.mainAnim.sprite.position.set(0, 0);
    this.container.addChild(this.mainAnim.sprite);

    // Apply initial world position offset
    // The container itself is at (cellFrom.x, cellFrom.y) in the stage,
    // so sprite starts at local (0, 0) = cellFrom world position.
    // We'll track world positions and convert to local each frame.
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // AS onClipEvent(enterFrame) for the projectile:
    // if (t++ < 45) { _X += dx; _Y += dy; }
    if (this.t < 45) {
      this.posX += this.dx;
      this.posY += this.dy;
      this.t++;
    }

    // AS onClipEvent(enterFrame) for the inner rotating element:
    // _rotation = _rotation + r
    this.innerRotation += this.rotationR;
    // Apply rotation to the main sprite (the inner element is part of the composite)
    this.mainAnim.sprite.rotation = (this.innerRotation * Math.PI) / 180;

    // Convert world position to local container space.
    // The container is at (0, 0) in the parent, and represents world origin
    // (combat system places the container at cellFrom position, but we
    // track absolute positions from AS, so we need to convert).
    // Actually: container is at cellFrom in world space. Our posX/posY are world coords.
    // Local = world - cellFrom... but we don't have direct access to cellFrom coords here.
    // We store them from setup.
    // Use the stored cellFrom as origin offset:
    this.mainAnim.sprite.position.set(
      this.posX - this._cellFromX,
      this.posY - this._cellFromY,
    );
  }

  private _cellFromX = 0;
  private _cellFromY = 0;

  init(context: SpellContext, callbacks: import('@dofus/spell-runtime').SpellCallbacks, textures: SpellTextureProvider): void {
    this._cellFromX = context?.cellFrom?.x ?? 0;
    this._cellFromY = context?.cellFrom?.y ?? 0;
    super.init(context, callbacks, textures);
  }
}
