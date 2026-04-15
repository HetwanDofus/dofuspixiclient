/**
 * Spell 2064
 *
 * A beam spell that travels from caster to target, with an impact effect.
 *
 * Components:
 * - sprite_15: Beam from caster to target, positioned and rotated based on
 *   cellFrom/cellTo, plays sound 'wab_explo' at frame 1, 'licrounch_1008b' at frame 4
 * - sprite_13: Beam component (clip1) used for rotation reference, stops at frame 39
 * - sprite_28: Impact effect at target position, rotated from clip1._rotation,
 *   plays sound 'vol' at frame 10, signals hit at frame 10, stops at frame 48
 *
 * Original AS timing:
 * - DefineSprite_15/frame_1: Play 'wab_explo', set position from cellFrom/cellTo, calc rotation/length
 * - DefineSprite_15/frame_4: Play 'licrounch_1008b'
 * - DefineSprite_13/frame_40: stop()
 * - DefineSprite_28/frame_1: Position at cellTo, rotation from clip1
 * - DefineSprite_28/frame_10: Play 'vol', this.end() (signal hit)
 * - DefineSprite_28/frame_49: stop(), removeMovieClip()
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
  width: 223.15,
  height: 49.55,
  offsetX: -0.4,
  offsetY: -26.7,
};

const CLIP1_MANIFEST: SpriteManifest = {
  width: 224.05,
  height: 49.75,
  offsetX: 0,
  offsetY: -27.1,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 172,
  height: 147.3,
  offsetX: -99.55,
  offsetY: -59.4,
};

export class Spell2064 extends BaseSpell {
  readonly spellId = 2064;

  private beamAnim!: FrameAnimatedSprite;
  private clip1Anim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Calculate beam position/rotation from cellFrom to cellTo
    // AS: x1 = cellFrom.x; y1 = cellFrom.y - 40; x2 = cellTo.x; y2 = cellTo.y - 40;
    // AS: _X = x1; _Y = y1;
    // AS: _rotation = Math.atan2(dy,dx) * 57.29...
    // AS: longueur = Math.sqrt(dx*dx + dy*dy)
    // In our coordinate system, container is at cellFrom, so positions are relative.
    const dx = init.targetX;
    const dy =
      (context?.cellTo?.y ?? 0) - 40 - ((context?.cellFrom?.y ?? 0) - 40);
    const angleRad = Math.atan2(dy, dx);
    const longueur = Math.sqrt(dx * dx + dy * dy);

    // sprite_15 (beam): positioned at caster (cellFrom), rotated toward target
    // AS: _X = x1; _Y = y1 (cellFrom.y - 40)
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_15"),
        anchorX: beamAnchor.x,
        anchorY: beamAnchor.y,
        scale: init.scale,
      })
    );
    this.beamAnim.sprite.position.set(0, -40 * init.scale);
    this.beamAnim.sprite.rotation = angleRad;
    // AS: _width = longueur - 10 (applied to inner clip_13 inside sprite_15)
    // We approximate by scaling the beam width proportionally
    // The beam width in sprite coords is BEAM_MANIFEST.width; we scale x to match longueur - 10
    const beamNativeWidth = BEAM_MANIFEST.width * init.scale;
    const targetWidth = (longueur - 10) * init.scale;
    if (beamNativeWidth > 0) {
      this.beamAnim.sprite.scale.x =
        (targetWidth / beamNativeWidth) * init.scale;
      this.beamAnim.sprite.scale.y = init.scale;
    }
    this.beamAnim
      .onFrame(0, () => this.callbacks.playSound("wab_explo"))
      .onFrame(3, () => this.callbacks.playSound("licrounch_1008b"));
    this.container.addChild(this.beamAnim.sprite);

    // sprite_13 (clip1): beam component used for rotation reference, stops at frame 39 (AS frame 40)
    const clip1Anchor = calculateAnchor(CLIP1_MANIFEST);
    this.clip1Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_13"),
        anchorX: clip1Anchor.x,
        anchorY: clip1Anchor.y,
        scale: init.scale,
      })
    );
    this.clip1Anim.sprite.position.set(0, -40 * init.scale);
    this.clip1Anim.sprite.rotation = angleRad;
    this.clip1Anim.stopAt(39);
    this.container.addChild(this.clip1Anim.sprite);

    // sprite_28 (impact): positioned at target (cellTo), rotated same as clip1
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 40; _rotation = _parent.clip1._rotation
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_28"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    // Position relative to caster container: targetX, (cellTo.y - 40) - cellFrom.y
    const impactY =
      ((context?.cellTo?.y ?? 0) - 40 - (context?.cellFrom?.y ?? 0)) *
      init.scale;
    this.impactAnim.sprite.position.set(init.targetX * init.scale, impactY);
    this.impactAnim.sprite.rotation = angleRad;
    this.impactAnim.stopAt(48).onFrame(9, () => {
      this.callbacks.playSound("vol");
      this.signalHit();
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
