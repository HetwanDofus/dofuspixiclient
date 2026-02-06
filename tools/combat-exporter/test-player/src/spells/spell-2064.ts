/**
 * Spell 2064 - Unknown
 *
 * A spell with a beam effect from caster to target followed by an impact.
 *
 * Components:
 * - sprite_15: Beam sprite that stretches from caster to target with rotation
 * - sprite_13: Beam child sprite that scales based on beam length 
 * - sprite_28: Impact explosion at target position
 *
 * Original AS timing:
 * - Frame 1: Play sound "wab_explo", setup beam position/rotation
 * - Frame 4: Play sound "licrounch_1008b"
 * - Frame 10: Play sound "vol" and signal hit (this.end())
 * - Frame 40: sprite_13 stops
 * - Frame 49: sprite_28 stops
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_13_MANIFEST: SpriteManifest = {
  width: 1344.3,
  height: 298.5,
  offsetX: 0,
  offsetY: -162.6,
};

const SPRITE_15_MANIFEST: SpriteManifest = {
  width: 1338.9,
  height: 297.3,
  offsetX: -2.4,
  offsetY: -160.2,
};

const SPRITE_28_MANIFEST: SpriteManifest = {
  width: 1032,
  height: 883.8,
  offsetX: -597.3,
  offsetY: -356.4,
};

export class Spell2064 extends BaseSpell {
  readonly spellId = 2064;

  private beamAnim!: FrameAnimatedSprite;
  private beamChildAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate beam properties (from AS DoAction_2.as)
    const x1 = 0;
    const y1 = -40;
    const x2 = init.targetX;
    const y2 = init.targetY - 40;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const rotation = Math.atan2(dy, dx);
    const longueur = Math.sqrt(dx * dx + dy * dy);

    // Main beam animation (sprite_15)
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_15'),
      ...calculateAnchor(SPRITE_15_MANIFEST),
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(x1, y1 + init.casterY);
    this.beamAnim.sprite.rotation = rotation;
    this.beamAnim
      .onFrame(0, () => this.callbacks.playSound('wab_explo'))
      .onFrame(3, () => this.callbacks.playSound('licrounch_1008b'));
    this.container.addChild(this.beamAnim.sprite);

    // Beam child animation (sprite_13) - scales based on beam length
    this.beamChildAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_13'),
      ...calculateAnchor(SPRITE_13_MANIFEST),
      scale: init.scale,
    }));
    // AS: _width = _parent.longueur - 10
    this.beamChildAnim.sprite.width = (longueur - 10) * init.scale;
    this.beamChildAnim.stopAt(39);
    this.beamAnim.sprite.addChild(this.beamChildAnim.sprite);

    // Impact animation (sprite_28) at target
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_28'),
      ...calculateAnchor(SPRITE_28_MANIFEST),
      scale: init.scale,
    }));
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 40
    this.impactAnim.sprite.position.set(init.targetX, init.targetY - 40);
    // AS: _rotation = _parent.clip1._rotation (clip1 is sprite_15)
    this.impactAnim.sprite.rotation = rotation;
    this.impactAnim
      .stopAt(48)
      .onFrame(9, () => {
        this.callbacks.playSound('vol');
        this.signalHit();
      });
    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}