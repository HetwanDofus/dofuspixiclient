/**
 * Spell 709 — Grina (Osamodas / Roublard area, fire/earth zone).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/709/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines:
 *   - sprite_17 (183 frames): caster-side. frame_1 positions at cellFrom.
 *     frame_181 removes itself (_parent.removeMovieClip → spell complete).
 *   - sprite_24 (174 frames): target-side. frame_1 positions at cellTo.
 *     frame_73 plays "vlad_804" sound. frame_79 calls this.end() → signalHit.
 *     frame_172 removes itself (_parent.removeMovieClip).
 *
 * sprite_16 (117 frames): a child of sprite_17 (caster-side composite).
 *   Three sub-clips of sprite_6 (15-frame rotation anim) are placed on
 *   sprite_16's frame_1 with onClipEvent(load) that jumps each to a random
 *   starting frame. sprite_16/frame_49 plays "grina_709" sound.
 *
 * sprite_6 (15 frames): small rotation anim. frame_1 sets _rotation to a
 *   random negative value in [0, -179] degrees.
 *
 * Main timeline (frame_2): SOMA.playSound("grina_709b"); stop();
 *
 * Library symbols: none (librarySymbols[] is empty in manifest). All four
 * animations (sprite_6, sprite_16, sprite_17, sprite_24) are in animations[]
 * only → textures.getFrames("<name>") with NO lib_ prefix.
 *
 * signalHit: fired from sprite_24/frame_79 (this.end() call).
 * complete: fired from sprite_17/frame_181 (_parent.removeMovieClip on the
 *   outer mc — sprite_17 is the longer-lived sibling that drives completion).
 *   sprite_24/frame_172 also removes itself but only calls clip.remove() since
 *   sprite_17 owns the completion signal.
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

// Bounds from manifest animations[] entries (not librarySymbols — that list is empty).
const SPRITE_6_BOUNDS = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};
const SPRITE_16_BOUNDS = {
  width: 249.35,
  height: 295.35,
  offsetX: -124.7,
  offsetY: -229.35,
};
const SPRITE_17_BOUNDS = {
  width: 249.35,
  height: 295.35,
  offsetX: -124.7,
  offsetY: -229.35,
};
const SPRITE_24_BOUNDS = {
  width: 96.45,
  height: 254.3,
  offsetX: -47.35,
  offsetY: -229.35,
};

export class Spell709 extends RuntimeSpell {
  readonly spellId = 709;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite17Sym!: SymbolDefinition;
  private sprite24Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite6Anchor = calculateAnchor(SPRITE_6_BOUNDS);
    const sprite16Anchor = calculateAnchor(SPRITE_16_BOUNDS);
    const sprite17Anchor = calculateAnchor(SPRITE_17_BOUNDS);
    const sprite24Anchor = calculateAnchor(SPRITE_24_BOUNDS);

    // ---- sprite_6 — 15-frame rotation anim (child of sprite_16) ----
    // AS DefineSprite_6/frame_1/DoAction.as:
    //   _rotation = -random(180);
    const sprite6Sym: SymbolDefinition = {
      name: "sprite_6",
      totalFrames: 15,
      frames: textures.getFrames("sprite_6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_6/frame_1/DoAction.as: _rotation = -random(180)
            clip.rotation = (-(Math.floor(Math.random() * 180)) * Math.PI) / 180;
          },
        ],
      ]),
    };

    // ---- sprite_16 — 117-frame composite (child of sprite_17) -------
    // Three instances of sprite_6 are placed on frame_1 at depths 5, 9, 13
    // each with onClipEvent(load): gotoAndPlay(random(_totalframes + 1))
    // sprite_6 totalFrames = 15, so random(16) → [0,15], gotoAndPlay(N) →
    // clip.gotoAndPlay(N - 1). Since N can be 0 (AS gotoAndPlay(0) is
    // effectively frame 1 in AS, but we clamp), we handle that via the
    // SpellClip.gotoAndPlay clamp.
    //
    // AS DefineSprite_16/frame_49/DoAction.as: SOMA.playSound("grina_709")
    // — played from inside a sub-clip. We capture the callbacks reference
    // in onSpellStart so we can call it here.
    const sprite16Sym: SymbolDefinition = {
      name: "sprite_16",
      totalFrames: 117,
      frames: textures.getFrames("sprite_16"),
      anchorX: sprite16Anchor.x,
      anchorY: sprite16Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_16/frame_1 places three sprite_6 instances at
            // depths 5, 9, 13. Each has onClipEvent(load):
            //   gotoAndPlay(random(_totalframes + 1))
            // We attach them and fire their onLoad via the attach() call which
            // calls symbol.onLoad. However, the gotoAndPlay belongs in onLoad
            // of those sub-clips; we inline it here via a wrapper since the
            // canonical PlaceObject events are per-instance, not per-symbol.
            // We create three inline SymbolDefinition variants that each jump
            // to a random start frame on load.

            // AS PlaceObject2_6_5/onClipEvent(load): gotoAndPlay(random(16))
            const sub5 = clip.attach(sprite6Sym, "sprite_6_5", 5, ctx);
            sub5.gotoAndPlay(Math.max(0, Math.floor(Math.random() * (15 + 1)) - 1));

            // AS PlaceObject2_6_9/onClipEvent(load): gotoAndPlay(random(16))
            const sub9 = clip.attach(sprite6Sym, "sprite_6_9", 9, ctx);
            sub9.gotoAndPlay(Math.max(0, Math.floor(Math.random() * (15 + 1)) - 1));

            // AS PlaceObject2_6_13/onClipEvent(load): gotoAndPlay(random(16))
            const sub13 = clip.attach(sprite6Sym, "sprite_6_13", 13, ctx);
            sub13.gotoAndPlay(Math.max(0, Math.floor(Math.random() * (15 + 1)) - 1));
          },
        ],
        [
          48,
          () => {
            // AS DefineSprite_16/frame_49/DoAction.as: SOMA.playSound("grina_709")
            // Sound played from within a sub-clip — use captured callback.
            this.soundCallback?.("grina_709");
          },
        ],
      ]),
    };

    // ---- sprite_17 — 183-frame caster-side timeline -----------------
    // AS DefineSprite_17/frame_1/DoAction.as:
    //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
    // AS DefineSprite_17/frame_181/DoAction.as:
    //   _parent.removeMovieClip(); → spell complete
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 183,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_17/frame_1/DoAction.as
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
          180,
          (clip) => {
            // AS DefineSprite_17/frame_181/DoAction.as: _parent.removeMovieClip()
            // sprite_17's _parent is the outer mc — signal completion.
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- sprite_24 — 174-frame target-side timeline -----------------
    // AS DefineSprite_24/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // AS DefineSprite_24/frame_73/DoAction.as:
    //   SOMA.playSound("vlad_804")
    // AS DefineSprite_24/frame_79/DoAction.as:
    //   this.end() → signalHit (damage popup at target)
    // AS DefineSprite_24/frame_172/DoAction.as:
    //   _parent.removeMovieClip() — sprite_24 removes itself; sprite_17
    //   owns completion, so just clip.remove() here.
    this.sprite24Sym = {
      name: "sprite_24",
      totalFrames: 174,
      frames: textures.getFrames("sprite_24"),
      anchorX: sprite24Anchor.x,
      anchorY: sprite24Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_24/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y;
            }
          },
        ],
        [
          72,
          () => {
            // AS DefineSprite_24/frame_73/DoAction.as: SOMA.playSound("vlad_804")
            this.soundCallback?.("vlad_804");
          },
        ],
        [
          78,
          () => {
            // AS DefineSprite_24/frame_79/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          171,
          (clip) => {
            // AS DefineSprite_24/frame_172/DoAction.as: _parent.removeMovieClip()
            // sprite_17 drives completion; sprite_24 just removes itself.
            clip.remove();
          },
        ],
      ]),
    };

    // sprite_16 is a child of sprite_17 placed at runtime — it needs to be
    // registered so sprite_17's frame_1 script can attach it via the registry.
    // However sprite_17's frame_1 script above doesn't attach sprite_16 yet.
    // In the canonical SWF, sprite_16 is placed on the sprite_17 main timeline
    // as a static child (not via attachMovie). We treat it as a child that
    // sprite_17 attaches on frame_1.
    //
    // Re-define sprite_17 to include sprite_16 attachment in frame_1:
    this.sprite17Sym = {
      name: "sprite_17",
      totalFrames: 183,
      frames: textures.getFrames("sprite_17"),
      anchorX: sprite17Anchor.x,
      anchorY: sprite17Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_17/frame_1/DoAction.as:
            //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y;
            }
            // sprite_16 is a static timeline child of sprite_17 in the SWF.
            // Attach it here so it starts animating from frame_1.
            clip.attach(sprite16Sym, "sprite_16", 1, ctx);
          },
        ],
        [
          180,
          (clip) => {
            // AS DefineSprite_17/frame_181/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(sprite6Sym);
    this.registry.register(sprite16Sym);
    this.registry.register(this.sprite17Sym);
    this.registry.register(this.sprite24Sym);
  }

  // Captured sound callback for use inside frame scripts of sub-clips.
  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use in sub-clip frame scripts.
    this.soundCallback = callbacks.playSound;

    // AS frame_2/DoAction.as: SOMA.playSound("grina_709b");
    // AS frame_2/DoAction_2.as: stop();
    // (Main timeline frame_2 = index 1, but sounds[] lists it at frame 1
    //  and the main timeline only has frame_2 scripts — we play it on start.)
    callbacks.playSound("grina_709b");

    // Attach sprite_17 (caster-side) and sprite_24 (target-side) as parallel
    // timelines on the root, mirroring the canonical SWF main timeline which
    // places both as static children.
    this.root.attach(this.sprite17Sym, "sprite17", 1, context);
    this.root.attach(this.sprite24Sym, "sprite24", 2, context);
  }
}
