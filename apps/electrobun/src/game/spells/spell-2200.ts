/**
 * Spell 2200 - Aspiration
 *
 * A beam spell that travels from caster to target with an impact effect.
 *
 * Components:
 * - sprite_28: Main beam, positioned at caster, rotated toward target. Signals hit at frame 52, stops at frame 97.
 * - sprite_26: Impact effect at target position, random Y offset and possible Y-flip. Stops at frame 48.
 * - sprite_15: Additional effect at target position.
 *
 * Original AS timing:
 * - Frame 2 (main): Play sound 'aspiration', stop main timeline
 * - sprite_28 frame_4: Set position to cellFrom, rotated by angle
 * - sprite_28 frame_52: this.end() -> signal hit
 * - sprite_28 frame_97: stop() + removeMovieClip() -> animation ends
 * - sprite_26 frame_1: random Y offset, possible Y-flip
 * - sprite_26 frame_48: stop()
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_15_MANIFEST: SpriteManifest = {
  width: 193.15,
  height: 169.75,
  offsetX: -88.4,
  offsetY: -132.3,
};

const SPRITE_26_MANIFEST: SpriteManifest = {
  width: 220.25,
  height: 34.55,
  offsetX: -140.95,
  offsetY: -20.3,
};

const SPRITE_28_MANIFEST: SpriteManifest = {
  width: 549.05,
  height: 52.95,
  offsetX: -63.6,
  offsetY: -27.8,
};

export class Spell2200 extends BaseSpell {
  readonly spellId = 2200;

  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private extraAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // sprite_28: beam at caster position, rotated toward target
    // frame_4 in AS sets position; 0-indexed = frame 3
    // frame_52 in AS = signal hit; 0-indexed = frame 51
    // frame_97 in AS = stop + remove; 0-indexed = frame 96
    const beamAnchor = calculateAnchor(SPRITE_28_MANIFEST);
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_28"),
        anchorX: beamAnchor.x,
        anchorY: beamAnchor.y,
        scale: init.scale,
      })
    );
    // Position at caster: _X = cellFrom.x relative to container (0), _Y = cellFrom.y - 20
    // In our coordinate system, caster is at (0, casterY), and casterY = Y_OFFSET = -50
    // AS says _Y = _parent.cellFrom.y - 20, meaning 20px above the cell center
    // Since we offset by Y_OFFSET (-50), the beam Y = casterY - 20... but actually
    // AS sets position in world coords; our container is at cellFrom, so relative pos is (0, -20)
    this.beamAnim.sprite.position.set(0, -20);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim
      .onFrame(0, () => this.callbacks.playSound("aspiration"))
      .onFrame(51, () => this.signalHit())
      .stopAt(96);
    this.container.addChild(this.beamAnim.sprite);

    // sprite_26: impact effect at target position
    // frame_1 in AS (0-indexed = frame 0): random Y offset, possible Y-flip
    // frame_48 in AS (0-indexed = frame 47): stop
    const impactAnchor = calculateAnchor(SPRITE_26_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_26"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    // AS: _Y = 20 * (-0.5 + Math.random())
    const randomY = 20 * (-0.5 + Math.random());
    // AS: if(random(4) == 1) { _yscale = -_yscale; }
    let yScale = init.scale;
    if (Math.floor(Math.random() * 4) === 1) {
      yScale = -init.scale;
    }
    this.impactAnim.sprite.position.set(init.targetX, init.targetY + randomY);
    this.impactAnim.sprite.scale.set(init.scale, yScale);
    this.impactAnim.stopAt(47);
    this.container.addChild(this.impactAnim.sprite);

    // sprite_15: additional effect at target position
    const extraAnchor = calculateAnchor(SPRITE_15_MANIFEST);
    this.extraAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_15"),
        anchorX: extraAnchor.x,
        anchorY: extraAnchor.y,
        scale: init.scale,
      })
    );
    this.extraAnim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.extraAnim.sprite);
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
