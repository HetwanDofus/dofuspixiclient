/**
 * Spell 2925 — Grina (likely a Feca or similar class spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2925/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_24 (165 frames): positions itself at _parent.cellFrom (caster-side);
 *     at frame 163 calls _parent.removeMovieClip() → spell complete.
 *   - sprite_23 (225 frames): target-side composite. frame_1 places sprite_6
 *     instances (via PlaceObject2 clip events). Fires sounds at frames 1, 49, 64.
 *     frame_58 calls this.end() → signalHit. No _parent reference found, so it
 *     is anchored independently; its children (sprite_6 instances) do a random
 *     gotoAndPlay on load.
 *
 * Library symbols (via animations[] only — librarySymbols[] is empty):
 *   - sprite_6 (15 frames): spinning decoration particle.
 *     frame_1/DoAction.as: _rotation = -random(180).
 *     PlaceObject2 clip events on sprite_23's children:
 *       onLoad: gotoAndPlay(random(_totalframes + 1)) — random phase offset.
 *   - sprite_17 (implicit container with a rotating child, DefineSprite_17):
 *     onLoad: v = 1728; onEnterFrame: _rotation += (v *= 0.849).
 *
 * Main timeline: frame_2/DoAction.as → stop(). No explicit main-timeline sounds
 * (sounds at frames 0, 48, 63 are fired from sprite_23's frame scripts).
 *
 * Both sprite_23 and sprite_24 are placed on the main timeline (top-level) and
 * reference _parent.cellFrom / _parent.cellTo — classic WorldAbsolute pattern.
 * The harness stores cellFrom/cellTo on root.vars; frame_1 scripts of these
 * sprites read them via clip.parent?.vars.
 *
 * Note: manifest has no librarySymbols[] entries. All textures use bare names
 * (no lib_ prefix). sprite_6, sprite_23, sprite_24 all appear in animations[].
 *
 * Sound timing per manifest.json sounds[]:
 *   frame 0  → "grina_709b"  (fired from DefineSprite_23/frame_1/DoAction.as)
 *   frame 48 → "grina_709"   (fired from DefineSprite_23/frame_49/DoAction.as, index 48)
 *   frame 63 → "grina_710"   (fired from DefineSprite_23/frame_64/DoAction.as, index 63)
 *
 * DefineSprite_17 is an internal sub-sprite of sprite_23 (placed via PlaceObject2
 * on sprite_23's timeline). It has a single child with spinning physics. We model
 * it as a sub-symbol attached by sprite_23's frame_1 frameScript. However, since
 * the manifest composites sprite_23 as a flat sprite sheet (isComposite: true),
 * the visual is already baked; we register sprite_17 as a container-only symbol
 * for logical completeness but its visual effect is embedded in sprite_23's frames.
 *
 * The three PlaceObject2 entries on sprite_23/frame_1 (depths 9, 5, 13) each place
 * a sprite_6 instance with onClipEvent(load) → gotoAndPlay(random(_totalframes+1)).
 * Since sprite_23 is a composite (baked frames), these visual children are already
 * rendered; we still port the logic for fidelity but sprite_6 uses frames: [] as
 * its visual is embedded in the composite.
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

// sprite_6 bounds from animations[]
const SPRITE_6_BOUNDS = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

// sprite_23 bounds from animations[]
const SPRITE_23_BOUNDS = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

// sprite_24 bounds from animations[]
const SPRITE_24_BOUNDS = {
  width: 249.35,
  height: 274.8,
  offsetX: -124.7,
  offsetY: -208.8,
};

export class Spell2925 extends RuntimeSpell {
  readonly spellId = 2925;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite6Sym!: SymbolDefinition;
  private sprite23Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);
    const sprite23Anchor = calculateAnchor(SPRITE_23_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE_24_BOUNDS);

    // ---- sprite_6 — spinning decoration particle ----------------
    // AS: DefineSprite_6/frame_1/DoAction.as
    //   _rotation = -random(180)
    // AS: DefineSprite_23/frame_1/PlaceObject2_6_*/CLIPACTIONRECORD onClipEvent(load).as
    //   gotoAndPlay(random(_totalframes + 1))  — random phase on spawn
    //
    // sprite_6 is a composite baked into sprite_23; frames: [] because the
    // visual is already rendered in sprite_23's composite frames. The frame
    // and clip-event logic is still ported for canonical fidelity.
    this.sprite6Sym = {
      name: "sprite_6",
      totalFrames: 15,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_23/frame_1/PlaceObject2_6_*/CLIPACTIONRECORD onClipEvent(load).as
        // gotoAndPlay(random(_totalframes + 1))
        const randomFrame = Math.floor(Math.random() * (clip.totalFrames + 1));
        clip.gotoAndPlay(randomFrame);
      },
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // _rotation = -random(180)
            const deg = -Math.floor(Math.random() * 180);
            clip.rotation = (deg * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_23 — target-side composite timeline (225 frames) ----
    // AS: DefineSprite_23/frame_1/DoAction.as → SOMA.playSound("grina_709b")
    // AS: DefineSprite_23/frame_49/DoAction.as → SOMA.playSound("grina_709")
    // AS: DefineSprite_23/frame_58/DoAction.as → this.end() → signalHit
    // AS: DefineSprite_23/frame_64/DoAction.as → SOMA.playSound("grina_710")
    // frame_1 also places three sprite_6 instances at depths 5, 9, 13 via
    // PlaceObject2 — each gets a random phase via onLoad (handled in sprite6Sym).
    //
    // sprite_23 is positioned at cellTo (target cell) in the WorldAbsolute model.
    // The AS doesn't explicitly set _X/_Y in DefineSprite_23's own scripts, but
    // canonically for WorldAbsolute the outer mc positions children at world coords.
    // We set position in frame_1 based on cellTo from root.vars.
    this.sprite23Sym = {
      name: "sprite_23",
      totalFrames: 225,
      frames: textures.getFrames("sprite_23"),
      anchorX: sprite23Anchor.x,
      anchorY: sprite23Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_23/frame_1/DoAction.as
            // SOMA.playSound("grina_709b")
            // Also: position at cellTo for WorldAbsolute pattern.
            // And: place three sprite_6 instances (depths 5, 9, 13) with
            // onLoad random-phase behaviour handled by sprite6Sym.onLoad.
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
            // Attach three sprite_6 children at canonical depths
            clip.attach(this.sprite6Sym, "sprite_6_5", 5, ctx);
            clip.attach(this.sprite6Sym, "sprite_6_9", 9, ctx);
            clip.attach(this.sprite6Sym, "sprite_6_13", 13, ctx);
          },
        ],
        [
          48,
          () => {
            // AS: DefineSprite_23/frame_49/DoAction.as
            // SOMA.playSound("grina_709")
            // Sound is fired via the stored callback reference.
            if (this.soundCallback) {
              this.soundCallback("grina_709");
            }
          },
        ],
        [
          57,
          () => {
            // AS: DefineSprite_23/frame_58/DoAction.as
            // this.end() → signals damage/hit at target
            this.runtime.signalHit();
          },
        ],
        [
          63,
          () => {
            // AS: DefineSprite_23/frame_64/DoAction.as
            // SOMA.playSound("grina_710")
            if (this.soundCallback) {
              this.soundCallback("grina_710");
            }
          },
        ],
      ]),
    };

    // ---- sprite_24 — caster-side composite timeline (165 frames) ----
    // AS: DefineSprite_24/frame_1/DoAction.as
    //   _X = _parent.cellFrom.x
    //   _Y = _parent.cellFrom.y
    // AS: DefineSprite_24/frame_163/DoAction.as
    //   _parent.removeMovieClip() → spell complete
    this.sprite24Sym = {
      name: "sprite_24",
      totalFrames: 165,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_24/frame_1/DoAction.as
            // _X = _parent.cellFrom.x
            // _Y = _parent.cellFrom.y
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
          },
        ],
        [
          162,
          (clip) => {
            // AS: DefineSprite_24/frame_163/DoAction.as
            // _parent.removeMovieClip() — this is the outer mc removal,
            // signals spell completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite6Sym);
    this.registry.register(this.sprite23Sym);
    this.registry.register(this.sprite24Sym);
  }

  // Store sound callback for use inside frame scripts
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Main timeline: frame_2/DoAction.as → stop()
    // The stop() is handled implicitly; the root doesn't auto-advance.
    // Store the sound callback for use in frame scripts.
    this.soundCallback = callbacks.playSound;

    // Play the entry sound (fires at frame 0 / manifest sounds[0] / sprite_23 frame_1).
    // DefineSprite_23/frame_1/DoAction.as: SOMA.playSound("grina_709b")
    callbacks.playSound("grina_709b");

    // Attach both parallel timelines at the root.
    // sprite_24 is the caster-side effect (positions itself at cellFrom in frame_1).
    // sprite_23 is the target-side effect (positions itself at cellTo in frame_1).
    this.root.attach(this.sprite24Sym, "sprite_24", 1, context);
    this.root.attach(this.sprite23Sym, "sprite_23", 2, context);
  }
}
