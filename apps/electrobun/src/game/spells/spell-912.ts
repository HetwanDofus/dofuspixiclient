/**
 * Spell 912 - Fulminant (variant)
 *
 * A beam spell with a beam animation at the caster and an impact animation at the target.
 * The beam (sprite_20) plays from caster toward target, stops at frame 42.
 * The impact (sprite_35) plays at target, signals hit at frame 75, ends at frame 126.
 * sprite_30 is a child of sprite_35 with random rotation and scale on load.
 *
 * Components:
 * - sprite_20: Beam at caster position, rotated toward target, stops at frame 42
 * - sprite_35: Impact at target position, rotated toward caster angle
 * - sprite_30: Sub-sprite of sprite_35 with random rotation/scale, stops at frame 39
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'jet_903', stop main timeline
 * - Frame 1 (sprite_35): Position at target, set rotation
 * - Frame 10 (sprite_35): Play sound 'jet_912'
 * - Frame 43 (sprite_20): stop()
 * - Frame 76 (sprite_35): Play sound 'jet_912b', signal hit (this.end())
 * - Frame 127 (sprite_35): removeMovieClip() - animation ends
 * - Frame 1 (sprite_30): random rotation, random scale (50-99)
 * - Frame 40 (sprite_30): stop()
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
  width: 186.6,
  height: 41.2,
  offsetX: 5.15,
  offsetY: -25.1,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 147.8,
  height: 103,
  offsetX: -72.85,
  offsetY: -53.45,
};

const SPARK_MANIFEST: SpriteManifest = {
  width: 75.05,
  height: 1.05,
  offsetX: 0,
  offsetY: -1.05,
};

export class Spell912 extends BaseSpell {
  readonly spellId = 912;

  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private sparkAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Beam (sprite_20): positioned at caster, rotated toward target
    // AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 30; _rotation = _parent.angle;
    // Since our container is at cellFrom, position is (0, -30) relative
    // But init.casterY = Y_OFFSET = -50, and AS uses -30. Use -30 directly.
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_20"),
        anchorX: beamAnchor.x,
        anchorY: beamAnchor.y,
        scale: init.scale,
      })
    );
    this.beamAnim.sprite.position.set(0, -30);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim.stopAt(42);
    this.container.addChild(this.beamAnim.sprite);

    // spark (sprite_30): child of impact, with random rotation and scale on load
    // AS frame_1: _rotation = random(360); t = random(50) + 50; _xscale = t; _yscale = t;
    // AS frame_40: stop()
    const sparkAnchor = calculateAnchor(SPARK_MANIFEST);
    const sparkRotationDeg = Math.floor(Math.random() * 360);
    const sparkT = Math.floor(Math.random() * 50) + 50;
    const sparkScale = (sparkT / 100) * init.scale;

    this.sparkAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_30"),
        anchorX: sparkAnchor.x,
        anchorY: sparkAnchor.y,
        scale: sparkScale,
      })
    );
    this.sparkAnim.sprite.rotation = (sparkRotationDeg * Math.PI) / 180;
    this.sparkAnim.stopAt(39);

    // Impact (sprite_35): positioned at target, rotated
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle;
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_35"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY - 30 - -50);
    this.impactAnim.sprite.rotation = init.angleRad;

    // Frame 10 (0-indexed: 9): Play sound 'jet_912'
    this.impactAnim.onFrame(9, () => this.callbacks.playSound("jet_912"));
    // Frame 76 (0-indexed: 75): Play sound 'jet_912b' and signal hit
    this.impactAnim.onFrame(75, () => {
      this.callbacks.playSound("jet_912b");
      this.signalHit();
    });
    // Frame 127 (0-indexed: 126): animation ends
    this.impactAnim.onFrame(126, () => this.complete());

    // Add spark as child of impact sprite's parent container
    // In AS, sprite_30 is a child of sprite_35. We add sparkAnim to the container
    // at the same position as impact.
    this.sparkAnim.sprite.position.set(init.targetX, init.targetY - 30 - -50);

    this.container.addChild(this.sparkAnim.sprite);
    this.container.addChild(this.impactAnim.sprite);

    // Play sound at frame 1 (0-indexed: 0) - main timeline frame 2 in AS (1-indexed)
    // AS frame_2/DoAction: SOMA.playSound("jet_903"); stop();
    // The sound fires at the start
    this.callbacks.playSound("jet_903");
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
  }
}
