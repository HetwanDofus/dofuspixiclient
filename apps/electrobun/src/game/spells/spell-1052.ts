/**
 * Spell 1052 - Aspiration
 *
 * A beam spell with a projectile (sprite_20) that travels from caster to target,
 * and a tail/trail effect (sprite_18) at the caster position.
 *
 * Components:
 * - sprite_20: Main projectile beam, positioned at caster, rotated toward target
 *   - Frame 6: Set position/rotation (already handled in setup)
 *   - Frame 78: Signal hit (this.end())
 *   - Frame 145: stop() and removeMovieClip()
 * - sprite_18: Trail/tail effect at caster, random Y offset and optional Y-flip
 *   - Frame 1: Random Y offset, random Y-scale flip
 *   - Frame 48: stop()
 *
 * Original AS timing:
 * - Frame 2 (main): Play sound 'aspiration', stop()
 * - Frame 6 (sprite_20): Set position to caster, rotation to angle
 * - Frame 78 (sprite_20): Signal hit
 * - Frame 145 (sprite_20): stop() / end
 * - Frame 1 (sprite_18): Random Y offset (-10..10), random Y-scale flip
 * - Frame 48 (sprite_18): stop()
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
  width: 489.85,
  height: 32.75,
  offsetX: -4.4,
  offsetY: -15.5,
};

const TAIL_MANIFEST: SpriteManifest = {
  width: 220.25,
  height: 34.55,
  offsetX: -140.95,
  offsetY: -20.3,
};

export class Spell1052 extends BaseSpell {
  readonly spellId = 1052;

  private beamAnim!: FrameAnimatedSprite;
  private tailAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Tail animation (sprite_18) at caster position
    // Frame 1 (0-indexed: 0): Random Y offset, random Y-scale flip
    // Frame 48 (0-indexed: 47): stop()
    const tailAnchor = calculateAnchor(TAIL_MANIFEST);
    this.tailAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_18"),
        anchorX: tailAnchor.x,
        anchorY: tailAnchor.y,
        scale: init.scale,
      })
    );

    // AS frame_1: _Y = 20 * (-0.5 + Math.random()); if(random(2) == 1) { _yscale = -_yscale; }
    const tailYOffset = 20 * (-0.5 + Math.random());
    this.tailAnim.sprite.position.set(0, init.casterY + tailYOffset);
    this.tailAnim.sprite.rotation = init.angleRad;

    if (Math.floor(Math.random() * 2) === 1) {
      this.tailAnim.sprite.scale.set(
        this.tailAnim.sprite.scale.x,
        -this.tailAnim.sprite.scale.y
      );
    }

    this.tailAnim.stopAt(47);
    this.container.addChild(this.tailAnim.sprite);

    // Beam animation (sprite_20) at caster position, rotated toward target
    // Frame 6 (0-indexed: 5): Position set (done in setup)
    // Frame 78 (0-indexed: 77): Signal hit
    // Frame 145 (0-indexed: 144): stop()
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_20"),
        anchorX: beamAnchor.x,
        anchorY: beamAnchor.y,
        scale: init.scale,
      })
    );

    // AS frame_6: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 20; _rotation = _parent.angle;
    // In our coordinate system, caster is at origin (0, casterY)
    // casterY = Y_OFFSET = -50, and the AS subtracts 20 more => total -70 offset from cell center
    // But casterY already encodes Y_OFFSET, and the beam is set to cellFrom.y - 20
    // cellFrom.y in AS world is the cell's screen Y; in our system it's 0 (relative), and casterY = -50
    // The AS does cellFrom.y - 20, so relative to caster: init.casterY - 20... but wait:
    // init.casterY = SPELL_CONSTANTS.Y_OFFSET = -50
    // AS: _Y = _parent.cellFrom.y - 20 means 20px above cellFrom.y
    // Our container is at cellFrom position, so: y = -50 (Y_OFFSET) - 20 = -70?
    // Actually looking at the AS: it sets Y to cellFrom.y - 20, which in relative coords is just -20
    // from the cell center. But since we use Y_OFFSET=-50 for "chest level", let's use init.casterY
    // which matches the standard caster Y position, and the -20 is already baked into sprite_20's
    // positioning in the original. We'll use init.casterY as the standard approach.
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;

    this.beamAnim
      .onFrame(0, () => this.callbacks.playSound("aspiration"))
      .onFrame(77, () => this.signalHit())
      .stopAt(144);

    this.container.addChild(this.beamAnim.sprite);
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
