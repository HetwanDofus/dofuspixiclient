/**
 * Spell 2001 - Wab
 *
 * A projectile beam spell that travels from caster to target, then shows an impact.
 *
 * Components:
 * - sprite_10: Beam traveling from caster to target, positioned at caster with rotation
 * - sprite_8: Part of the beam/trail effect, positioned at caster
 * - sprite_19: Impact effect at target position
 *
 * Original AS timing:
 * - sprite_10 frame 1: Play sound 'wab_explo', position at caster, rotate toward target
 * - sprite_19 frame 1: Position at target, copy rotation from beam
 * - sprite_19 frame 7: Play sound 'vol', signal hit (this.end())
 * - sprite_19 frame 33: stop() + removeMovieClip() - animation ends
 * - sprite_8 frame 46: stop()
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const BEAM_MANIFEST: SpriteManifest = {
  width: 223.25,
  height: 61.65,
  offsetX: -0.4,
  offsetY: -30.1,
};

const TRAIL_MANIFEST: SpriteManifest = {
  width: 224.15,
  height: 61.9,
  offsetX: 0,
  offsetY: -30.5,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 119.15,
  height: 63.9,
  offsetX: -24.7,
  offsetY: -33.15,
};

export class Spell2001 extends BaseSpell {
  readonly spellId = 2001;

  private beamAnim!: FrameAnimatedSprite;
  private trailAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Calculate angle and distance from caster to target (AS uses y - 20 offset)
    const x1 = context?.cellFrom?.x ?? 0;
    const y1 = (context?.cellFrom?.y ?? 0) - 20;
    const x2 = context?.cellTo?.x ?? 0;
    const y2 = (context?.cellTo?.y ?? 0) - 20;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const rotation = Math.atan2(dy, dx);
    const longueur = Math.sqrt(dx * dx + dy * dy);

    // sprite_10: Beam - positioned at cellFrom, rotated toward cellTo
    // AS: _X = x1; _Y = y1; _rotation = atan2(dy,dx)*57.29...; longueur = sqrt(...)
    // The beam width is set to longueur via _width = _parent.longueur on the inner clip
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_10"),
        anchorX: beamAnchor.x,
        anchorY: beamAnchor.y,
        scale: init.scale,
      })
    );
    // Position relative to the container origin (which is at cellFrom)
    this.beamAnim.sprite.position.set(0, -20);
    this.beamAnim.sprite.rotation = rotation;
    // Scale X to match longueur (width of beam = distance to target)
    // The beam sprite's natural width is 223.25 at scale 1
    // We need to stretch it to longueur pixels
    const beamNaturalWidth = BEAM_MANIFEST.width;
    const beamScaleX = (longueur / beamNaturalWidth) * init.scale;
    this.beamAnim.sprite.scale.set(beamScaleX, init.scale);
    this.beamAnim.onFrame(0, () => this.callbacks.playSound("wab_explo"));
    this.container.addChild(this.beamAnim.sprite);

    // sprite_8: Trail/additional beam effect at caster position
    const trailAnchor = calculateAnchor(TRAIL_MANIFEST);
    this.trailAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_8"),
        anchorX: trailAnchor.x,
        anchorY: trailAnchor.y,
        scale: init.scale,
        stopFrame: 45,
      })
    );
    this.trailAnim.sprite.position.set(0, -20);
    this.trailAnim.sprite.rotation = rotation;
    this.container.addChild(this.trailAnim.sprite);

    // sprite_19: Impact effect at target position
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 20; _rotation = _parent.clip1._rotation
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_19"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
        stopFrame: 32,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY - 20 + 50);
    // targetY already includes Y_OFFSET (-50), so we add back 50 and subtract 20
    // Actually: targetY = (cellTo.y - cellFrom.y) + Y_OFFSET = dy_screen + (-50)
    // We need position relative to container (which is at cellFrom)
    // cellTo.y - 20 relative to container = (cellTo.y - cellFrom.y) - 20
    // init.targetY = (cellTo.y - cellFrom.y) + SPELL_CONSTANTS.Y_OFFSET = (cellTo.y - cellFrom.y) - 50
    // So cellTo.y - cellFrom.y - 20 = init.targetY + 50 - 20 = init.targetY + 30
    this.impactAnim.sprite.position.set(init.targetX, init.targetY + 30);
    this.impactAnim.sprite.rotation = rotation;
    this.impactAnim
      .onFrame(6, () => this.callbacks.playSound("vol"))
      .onFrame(6, () => this.signalHit());
    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.impactAnim.isStopped() || this.impactAnim.isComplete()) {
      this.complete();
    }
  }
}
