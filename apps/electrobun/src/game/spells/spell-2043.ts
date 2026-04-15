/**
 * Spell 2043
 *
 * A projectile spell with a beam/line from caster to target, followed by an impact animation.
 *
 * Components:
 * - DefineSprite_29 (clip1): Line/beam from cellFrom to cellTo, width = distance, rotated toward target
 *   - DefineSprite_27 inside it: stops at frame 34
 * - DefineSprite_37 (impact): At target position, rotated same as beam
 *   - Frame 4: Play sound 'vol'
 *   - Frame 7: Signal hit (this.end())
 *   - Frame 28: stop() + removeMovieClip() -> complete
 * - DefineSprite_18_shoot (shoot): At target position (no Y offset), plays from frame 1
 *   - Frame 10: Play sound 'explosion'
 *   - Frame 70: stop()
 *
 * Original AS timing (1-indexed -> 0-indexed):
 * - DefineSprite_29/frame_1: Set position and rotation (init)
 * - DefineSprite_27/frame_34: stop() -> stopAt(33)
 * - DefineSprite_37/frame_1: Set position = cellTo, rotation = clip1._rotation (init)
 * - DefineSprite_37/frame_4: Play sound 'vol' -> onFrame(3)
 * - DefineSprite_37/frame_7: this.end() -> signalHit() at onFrame(6)
 * - DefineSprite_37/frame_28: stop() -> stopAt(27)
 * - DefineSprite_18_shoot/frame_1: Set position = cellTo (no y-20 offset) (init)
 * - DefineSprite_18_shoot/frame_10: Play sound 'explosion' -> onFrame(9)
 * - DefineSprite_18_shoot/frame_70: stop() -> stopAt(69)
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
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2043 extends BaseSpell {
  readonly spellId = 2043;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Calculate beam geometry from AS:
    // x1 = cellFrom.x, y1 = cellFrom.y - 20
    // x2 = cellTo.x, y2 = cellTo.y - 20
    // dx = x2 - x1, dy = y2 - y1
    // _rotation = atan2(dy, dx) * 57.29...
    // longueur = sqrt(dx*dx + dy*dy)
    const x1 = context.cellFrom.x;
    const y1 = context.cellFrom.y - 20;
    const x2 = context.cellTo.x;
    const y2 = context.cellTo.y - 20;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const beamRotation = Math.atan2(dy, dx);
    const longueur = Math.sqrt(dx * dx + dy * dy);

    // Target position relative to cellFrom (which is container origin)
    // DefineSprite_37 uses cellTo.x, cellTo.y - 20
    const targetRelX = context.cellTo.x - context.cellFrom.x;
    const targetRelY = context.cellTo.y - 20 - context.cellFrom.y;

    // DefineSprite_18_shoot uses cellTo.x, cellTo.y (no -20)
    const shootRelX = context.cellTo.x - context.cellFrom.x;
    const shootRelY = context.cellTo.y - context.cellFrom.y;

    // DefineSprite_29 (clip1 / beam) - the line from caster to target
    // It contains DefineSprite_27 which stops at frame 34
    // The beam is positioned at cellFrom (relative: 0, -20 from cellFrom)
    // In AS: _X = x1, _Y = y1 (absolute), container is at cellFrom
    // So relative to cellFrom: x = 0, y = -20
    const beamTextures = textures.getFrames("shoot");
    // We use the shoot animation for the beam (DefineSprite_27 inside DefineSprite_29)
    // The beam/clip1 uses the underlying sprite scaled to longueur
    // DefineSprite_27 has 34 frames and stops. We use shoot frames for it.
    // Actually looking at the manifest, we only have 'shoot' animation (84 frames).
    // DefineSprite_29 wraps DefineSprite_27 (the beam line), setting its width = longueur.
    // DefineSprite_27 stops at frame 34.
    // We'll treat the beam as using 'shoot' frames 0..33, stopped at 33.

    const beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: beamTextures.slice(0, 34),
        fps: 60,
        ...calculateAnchor(SHOOT_MANIFEST),
        scale: init.scale,
      })
    );
    beamAnim.sprite.position.set(0, -20);
    beamAnim.sprite.rotation = beamRotation;
    // Scale X to match longueur (beam width)
    beamAnim.sprite.scale.x = (longueur / SHOOT_MANIFEST.width) * init.scale;
    beamAnim.stopAt(33);
    this.container.addChild(beamAnim.sprite);

    // DefineSprite_37 (impact at target, rotated same as beam)
    // Frame 4 (0-indexed: 3): play sound 'vol'
    // Frame 7 (0-indexed: 6): signalHit
    // Frame 28 (0-indexed: 27): stop -> completion
    const impactTextures = beamTextures; // use available frames
    const impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: impactTextures.slice(0, 28),
        fps: 60,
        ...calculateAnchor(SHOOT_MANIFEST),
        scale: init.scale,
      })
    );
    impactAnim.sprite.position.set(targetRelX, targetRelY);
    impactAnim.sprite.rotation = beamRotation;
    impactAnim
      .stopAt(27)
      .onFrame(3, () => {
        this.callbacks.playSound("vol");
      })
      .onFrame(6, () => {
        this.signalHit();
      });
    this.container.addChild(impactAnim.sprite);

    // DefineSprite_18_shoot (impact at cellTo, no Y offset, rotation = 0)
    // Frame 10 (0-indexed: 9): play sound 'explosion'
    // Frame 70 (0-indexed: 69): stop
    const shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: beamTextures,
        fps: 60,
        ...calculateAnchor(SHOOT_MANIFEST),
        scale: init.scale,
      })
    );
    shootAnim.sprite.position.set(shootRelX, shootRelY);
    shootAnim.sprite.rotation = 0;
    shootAnim.stopAt(69).onFrame(9, () => {
      this.callbacks.playSound("explosion");
    });
    this.container.addChild(shootAnim.sprite);
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
