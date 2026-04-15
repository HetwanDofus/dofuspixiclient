/**
 * Spell 2910 - Wabbit Explo
 *
 * A beam spell that travels from caster to target, with a projectile/impact effect.
 *
 * Components:
 * - sprite_19: Beam from caster to target (composite, 144 frames), positioned at caster,
 *              rotated toward target, width set to distance. Plays sound 'wab_explo' at frame 1.
 * - sprite_17: Beam visual (48 frames), stops at frame 46 (AS frame 46 -> index 45). Child of sprite_19.
 * - sprite_28: Impact effect (51 frames) at target position, rotated to match beam.
 *              Plays sound 'vol' at frame 10 (AS frame 10 -> index 9).
 *              Signals hit at frame 10 (AS frame 10 -> index 9).
 *              Stops at frame 49 (AS frame 49 -> index 48).
 *
 * Original AS timing:
 * - Frame 1 (sprite_19): Play sound 'wab_explo', set position/rotation/width
 * - Frame 10 (sprite_28): Play sound 'vol', signal hit (this.end())
 * - Frame 46 (sprite_17): stop()
 * - Frame 49 (sprite_28): stop(), removeMovieClip()
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const BEAM_MANIFEST: SpriteManifest = {
  width: 224.1,
  height: 78.95,
  offsetX: -0.4,
  offsetY: -35.25,
};

const BEAM_INNER_MANIFEST: SpriteManifest = {
  width: 225,
  height: 79.25,
  offsetX: 0,
  offsetY: -35.7,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 119.15,
  height: 63.9,
  offsetX: -24.7,
  offsetY: -33.15,
};

export class Spell2910 extends BaseSpell {
  readonly spellId = 2910;

  private beamAnim!: FrameAnimatedSprite;
  private beamInnerAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate beam rotation and length from caster to target
    // AS: dx = cellTo.x - cellFrom.x; dy = (cellTo.y - 20) - (cellFrom.y - 20) = cellTo.y - cellFrom.y
    // AS: _rotation = Math.atan2(dy, dx) * 57.29...
    // AS: longueur = Math.sqrt(dx*dx + dy*dy)
    const dx = context?.cellTo ? (context.cellTo.x - context.cellFrom.x) : 0;
    const dy = context?.cellTo ? (context.cellTo.y - context.cellFrom.y) : 0;
    const beamAngleRad = Math.atan2(dy, dx);
    const longueur = Math.sqrt(dx * dx + dy * dy);

    // sprite_17 (inner beam) - child of sprite_19
    // AS onClipEvent(load): _width = _parent.longueur
    // The beam's width is set to the distance. We replicate this by scaling scaleX.
    // sprite_17 natural width = 225, so scaleX = longueur / 225
    const beamInnerAnchor = calculateAnchor(BEAM_INNER_MANIFEST);
    this.beamInnerAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_17'),
      anchorX: beamInnerAnchor.x,
      anchorY: beamInnerAnchor.y,
      scale: init.scale,
    }));
    // Apply width scaling: scaleX = longueur / (width * scale) * scale = longueur / width
    this.beamInnerAnim.sprite.scale.x = (longueur / 225) * init.scale;
    this.beamInnerAnim.sprite.scale.y = init.scale;
    // Stop at AS frame 46 -> index 45
    this.beamInnerAnim.stopAt(45);

    // sprite_19 (beam container) - positioned at caster, rotated toward target
    // AS: _X = x1 (cellFrom.x); _Y = y1 (cellFrom.y - 20); _rotation = atan2(dy,dx)*57.29...
    // In our coordinate system the container is already at cellFrom, so position at (0, -20) relative to that.
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_19'),
      anchorX: beamAnchor.x,
      anchorY: beamAnchor.y,
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, -20);
    this.beamAnim.sprite.rotation = beamAngleRad;
    // Play sound at frame 1 (index 0)
    this.beamAnim.onFrame(0, () => this.callbacks.playSound('wab_explo'));

    // Add inner beam as child of beam container sprite
    this.beamAnim.sprite.addChild(this.beamInnerAnim.sprite);

    this.container.addChild(this.beamAnim.sprite);

    // sprite_28 (impact) - positioned at target
    // AS: _X = cellTo.x; _Y = cellTo.y - 20; _rotation = clip1._rotation (same as beam rotation)
    // In our coordinate system, target is at (targetX, targetY + 20 - 20) = (targetX, targetY)
    // but AS uses cellTo.y - 20, and targetY = cellTo.y - cellFrom.y + Y_OFFSET (Y_OFFSET = -50)
    // So we need position (targetX, cellTo.y - cellFrom.y - 20)
    // targetY = cellTo.y - cellFrom.y + (-50) => cellTo.y - cellFrom.y = targetY + 50
    // cellTo.y - 20 relative to cellFrom.y = (cellTo.y - cellFrom.y) - 20 = targetY + 50 - 20 = targetY + 30
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_28'),
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY + 30);
    this.impactAnim.sprite.rotation = beamAngleRad;
    // AS frame 10 -> index 9: play sound 'vol' and signal hit
    this.impactAnim.onFrame(9, () => this.callbacks.playSound('vol'));
    this.impactAnim.onFrame(9, () => this.signalHit());
    // AS frame 49 -> index 48: stop
    this.impactAnim.stopAt(48);

    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
