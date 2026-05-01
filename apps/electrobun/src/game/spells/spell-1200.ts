/**
 * Spell 1200 — (Feca explosion spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/1200/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The manifest provides `move` (27-frame
 * animated projectile) and `shoot` (132-frame impact/explosion). The harness
 * drives `move` along a parabolic arc to the target, then attaches `shoot` at
 * the landing point and signals hit automatically.
 *
 * Library symbols:
 *   - DefineSprite_5 — smoke/explosion particle with full physics.
 *     frame_1 seeds vx/vy/size/vs/va/alpha/acc. onEnterFrame integrates
 *     alpha fade, scale expand, position drift with exponential decay.
 *   - DefineSprite_48_move — the "move" projectile container (27 frames).
 *     PlaceObject2_47_1 has a child clip that rotates +50°/frame. frame_25 stops.
 *
 * The `move` animation is a real authored-frame animation (27 SVG frames) so
 * we use textures.getFrames("move") for it. The `shoot` animation is also
 * authored (132 SVG frames) so we use textures.getFrames("shoot").
 *
 * The remaining DefineSprite_17, _20, _25, _29, _31, _36, _41 all call
 * GAC.applyColor — these are character coloring calls that have no visual
 * effect in the spell animation runtime (they recolor the Feca character sprite
 * which is managed by the character renderer, not the spell system). They are
 * no-ops here.
 *
 * Main timeline (frame_1/DoAction): SOMA.playSound("explosion") is inside
 * DefineSprite_7_shoot/frame_1, which fires when shoot is first attached by
 * the harness.
 *
 * signalHit: fired automatically by the harness on landing (displayType=30).
 * complete: fired from shoot's frame_130 script (_parent.removeMovieClip()).
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

// Bounds from manifest animations[] entries (no librarySymbols[] present).
const SHOOT_BOUNDS = {
  width: 116.95,
  height: 57.4,
  offsetX: -55.85,
  offsetY: -29.25,
};

const MOVE_BOUNDS = {
  width: 29.25,
  height: 58.25,
  offsetX: -14.35,
  offsetY: -52.95,
};

export class Spell1200 extends RuntimeSpell {
  readonly spellId = 1200;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- DefineSprite_5 — smoke/explosion particle ---------------
    // AS: DefineSprite_5/frame_1/DoAction.as
    // Seeds physics in frame_1 and sets onEnterFrame inline (AS2 pattern).
    // We port onEnterFrame to the SymbolDefinition's onEnterFrame handler.
    const particleSym: SymbolDefinition = {
      name: "particle",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_5/frame_1/DoAction.as
        const vi = 4.8;
        clip.vars.vx = (-0.5 + Math.random()) * vi;
        clip.vars.vy = (-0.5 + Math.random()) * vi / 2;
        const size = Math.floor(Math.random() * 80) + 40;
        clip.vars.size = size;
        clip.vars.vs = 10 + 10 * Math.random();
        clip.vars.va = 0.5 + Math.floor(Math.random() * 3.4);
        clip.alpha = (60 + Math.floor(Math.random() * 50)) / 100;
        clip.vars.acc = 0.84 + 0.15 * Math.random();
      },
      onEnterFrame: (clip) => {
        // AS DefineSprite_5/frame_1/DoAction.as — inline onEnterFrame
        let va = clip.vars.va as number;
        let size = clip.vars.size as number;
        let vs = clip.vars.vs as number;
        let vx = clip.vars.vx as number;
        let vy = clip.vars.vy as number;
        const acc = clip.vars.acc as number;

        clip.alpha -= va / 100;
        vs *= 0.23;
        const t = size + vs;
        clip.vars.size = t;
        clip.vars.vs = vs;
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.x += vx;
        clip.y += vy;
        vx *= acc;
        vy *= acc;
        clip.vars.vx = vx;
        clip.vars.vy = vy;
        clip.vars.va = va;

        if (clip.alpha <= 0) {
          clip.remove();
        }
      },
    };

    // ---- move — 27-frame animated projectile --------------------
    // AS: DefineSprite_48_move
    // The move symbol has actual authored frame textures (move_0.svg …
    // move_26.svg). It contains a child clip (PlaceObject2_47_1) that
    // has an onClipEvent(enterFrame) spinning it +50°/frame.
    // frame_25/DoAction.as: stop()
    //
    // Since the child's rotation is a dynamic clip event we model it
    // via onEnterFrame on the move symbol itself — the child is baked
    // into the SVG frames (static art), but the spinning behavior is
    // on a sub-child. We track cumulative rotation on the move clip's
    // vars as a spin offset for the sub-child effect.
    //
    // For the child PlaceObject2_47_1: it is a sub-clip placed inside
    // move. Its onClipEvent(enterFrame) does `_rotation += 50` (degrees
    // per Flash frame). We port this as an onEnterFrame on the move
    // symbol that tracks the spinning and applies it visually by
    // rotating the move container itself (the spinning element is
    // embedded in the move art). Since the SVG frames already contain
    // static art for the projectile body, we apply the cumulative spin
    // to the move clip's rotation to represent the spinning sub-element.
    //
    // Actually: the canonical approach is to register a child symbol for
    // the spinning sub-clip. But since DefineSprite_48_move is the "move"
    // symbol expected by the harness, and the spinning sub-child
    // (PlaceObject2_47_1) rotates independently, we model this by:
    // 1. Using the authored SVG frames for move (the static projectile body)
    // 2. Having an onEnterFrame on move that accumulates rotation on a
    //    child-tracking var (representing the inner spinning element).
    //
    // The rotation delta is 50 degrees per Flash frame = 50 * PI/180 radians.
    // frame_25 (0-indexed: 24) → stop().
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 27,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_48_move — no explicit onClipEvent(load) for the
        // parent move sprite itself. Initialize spin accumulator for the
        // inner spinning child (PlaceObject2_47_1 onClipEvent(enterFrame)).
        clip.vars.spinDeg = 0;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_48_move/frame_1/PlaceObject2_47_1/
        //     CLIPACTIONRECORD onClipEvent(enterFrame).as
        // _rotation = _rotation + 50  (degrees per frame)
        // We accumulate this on the move clip itself since the sub-child
        // is embedded in the SVG art. The spin is additive on the whole clip.
        let spinDeg = clip.vars.spinDeg as number;
        spinDeg += 50;
        clip.vars.spinDeg = spinDeg;
        // Apply the cumulative spin as an additional rotation overlay.
        // The harness sets move's rotation from the projectile velocity;
        // we add the spin on top of whatever the harness sets.
        // We store just the delta and let the harness/physics rotation
        // remain primary — apply spin to the clip's local rotation.
        clip.rotation += (50 * Math.PI) / 180;
      },
      frameScripts: new Map([
        [
          24,
          (clip) => {
            // AS: DefineSprite_48_move/frame_25/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- shoot — 132-frame impact/explosion composite -----------
    // AS: DefineSprite_7_shoot/frame_1/DoAction.as → SOMA.playSound("explosion")
    // AS: DefineSprite_7_shoot/frame_130/DoAction.as → _parent.removeMovieClip()
    //
    // The shoot symbol has authored SVG frames (shoot_0.svg … shoot_131.svg).
    // frame_1 plays the sound; frame_130 removes the parent (outer mc) →
    // this.runtime.complete().
    //
    // Note: For displayType 30/31, the harness calls runtime.signalHit()
    // automatically at landing. We must NOT call it again here.
    const self = this;
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 132,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (_clip, _ctx) => {
            // AS: DefineSprite_7_shoot/frame_1/DoAction.as
            // SOMA.playSound("explosion") — sound is played via onSpellStart
            // for the main timeline trigger, but the canonical source says
            // it's in the shoot sprite's frame_1. We capture the sound
            // callback reference to fire it here.
            if (self._playSoundCallback) {
              self._playSoundCallback("explosion");
              // Only fire once (shoot is attached once at landing)
            }
          },
        ],
        [
          129,
          (clip) => {
            // AS: DefineSprite_7_shoot/frame_130/DoAction.as
            // _parent.removeMovieClip() → spell complete
            clip.parent?.remove();
            self.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(particleSym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  // Sound callback captured from onSpellStart so shoot's frame_1 can use it.
  private _playSoundCallback: ((id: string) => void) | null = null;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // Capture the sound callback for use inside shoot's frame_1 script.
    // The canonical AS has SOMA.playSound("explosion") in shoot/frame_1,
    // which fires when shoot is attached by the harness on projectile landing.
    this._playSoundCallback = callbacks.playSound;
    // No main-timeline sound here; the explosion sound fires from shoot/frame_1.
  }
}
