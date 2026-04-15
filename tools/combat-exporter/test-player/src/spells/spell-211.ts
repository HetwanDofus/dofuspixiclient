/**
 * Spell 211 - Crockette (Sram)
 *
 * A projectile spell that travels from caster to target, then plays an impact animation.
 *
 * Components:
 * - sprite_21: Projectile beam at caster position, rotated toward target, stops at frame 66
 * - sprite_22: Composite sprite (beam body), width scaled by distance
 * - sprite_28: Impact animation at target position, signals hit at frame 36, ends at frame 111
 *
 * Original AS timing:
 * - frame_2/PlaceObject2_22_1 onClipEvent(load): Position at cellFrom, rotate toward cellTo
 * - sprite_22/frame_1/PlaceObject2_21_1 onClipEvent(load): _width = d / 4.5 (handled by scale)
 * - DefineSprite_21/frame_67: stop()
 * - DefineSprite_28/frame_37: this.end() + SOMA.playSound("crockette_211")
 * - DefineSprite_28/frame_112: _parent.removeMovieClip()
 *
 * Note: sprite_22 is a composite that includes sprite_21 (the beam),
 * and sprite_28 is the impact at target. The main timeline (frame_2) stops immediately.
 * The animation is driven by the clip events.
 *
 * Hit signal: frame 36 of sprite_28 (0-indexed: 36)
 * Sound: "crockette_211" at frame 36 of sprite_28
 * Completion: frame 111 of sprite_28 (0-indexed: 111, AS frame_112 = removeMovieClip)
 * Beam stops: frame 66 of sprite_21 (0-indexed: 66, AS frame_67 = stop())
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const BEAM_MANIFEST: SpriteManifest = {
  width: 394.8,
  height: 95.35,
  offsetX: -9.35,
  offsetY: -53.8,
};

const BEAM_COMPOSITE_MANIFEST: SpriteManifest = {
  width: 224.9,
  height: 95.35,
  offsetX: 1.75,
  offsetY: -53.95,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 59,
  height: 49.75,
  offsetX: -27.35,
  offsetY: -24.25,
};

export class Spell211 extends BaseSpell {
  readonly spellId = 211;

  private beamAnim!: FrameAnimatedSprite;
  private beamCompositeAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate distance for beam width scaling
    // AS: _width = _parent.d / 4.5
    // d = Math.sqrt(dx*dx + dy*dy) where dx = cellTo.x - cellFrom.x, dy = cellTo.y - cellFrom.y
    const dx = init.targetX;
    // The Y offset applied in cellFrom/cellTo is -20 in AS, but we use init values
    // AS: y1 = cellFrom.y - 20; y2 = cellTo.y - 20; dy = y2 - y1
    // Since both have -20, dy = (cellTo.y - 20) - (cellFrom.y - 20) = cellTo.y - cellFrom.y
    // init.targetX = cellTo.x - cellFrom.x, init.targetY = (cellTo.y - cellFrom.y) + Y_OFFSET
    // We need raw dy without Y_OFFSET for distance calculation
    const rawDy = context?.cellTo && context?.cellFrom
      ? context.cellTo.y - context.cellFrom.y
      : 0;
    const d = Math.sqrt(dx * dx + rawDy * rawDy);

    // Beam (sprite_21) - projectile body
    // Positioned at caster, rotated toward target
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_21'),
      fps: 40,
      anchorX: beamAnchor.x,
      anchorY: beamAnchor.y,
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    // AS DefineSprite_21/frame_67: stop() -> 0-indexed frame 66
    this.beamAnim.stopAt(66);
    this.container.addChild(this.beamAnim.sprite);

    // Beam composite (sprite_22) - includes beam body scaled by distance
    // AS: _width = _parent.d / 4.5 -> scale the sprite width proportionally
    const beamCompositeAnchor = calculateAnchor(BEAM_COMPOSITE_MANIFEST);
    // The composite sprite width should be d/4.5 in original Flash units
    // We scale X by (d / 4.5) / BEAM_COMPOSITE_MANIFEST.width to get proportional scaling
    const beamWidthScale = d > 0 ? (d / 4.5) / BEAM_COMPOSITE_MANIFEST.width : 1;
    this.beamCompositeAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      fps: 40,
      anchorX: beamCompositeAnchor.x,
      anchorY: beamCompositeAnchor.y,
    }));
    this.beamCompositeAnim.sprite.position.set(0, init.casterY);
    this.beamCompositeAnim.sprite.rotation = init.angleRad;
    this.beamCompositeAnim.sprite.scale.set(beamWidthScale * init.scale, init.scale);
    this.beamCompositeAnim.stopAt(66);
    this.container.addChild(this.beamCompositeAnim.sprite);

    // Impact (sprite_28) - plays at target position
    // AS DefineSprite_28/frame_37: this.end() + playSound -> 0-indexed frame 36
    // AS DefineSprite_28/frame_112: removeMovieClip -> 0-indexed frame 111 -> complete
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_28'),
      fps: 40,
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim
      .stopAt(111)
      .onFrame(36, () => {
        this.signalHit();
        this.callbacks.playSound('crockette_211');
      });
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
