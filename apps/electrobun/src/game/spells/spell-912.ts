/**
 * Spell 912 — Flèche de Recul (Cra wind/push arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/912/scripts/scripts/
 *
 * displayType=51 (WorldAbsoluteAlt). Two parallel authored timelines:
 *   - sprite_20 (45 frames): caster-side bow-draw animation, anchored at cellFrom.
 *     Positions self at _parent.cellFrom, rotates to _parent.angle. Stops at frame_43.
 *   - sprite_35 (129 frames): target-side impact animation, anchored at cellTo.
 *     Positions self at _parent.cellTo, rotates to _parent.angle.
 *     frame_10: plays "jet_912" sound.
 *     frame_76: plays "jet_912b" sound + signals hit (this.end()).
 *     frame_127: _parent.removeMovieClip() → spell complete.
 *   - sprite_30 (42 frames): a rotation/scale-randomised sparkle particle,
 *     attached inside sprite_35 (it is NOT a librarySymbol direct-dynamic sprite,
 *     but it IS placed on the main sprite_35 composite as a child; we treat it as
 *     a container-only symbol whose frame_1 seeds random rotation/scale and whose
 *     frame_40 stops it).
 *
 * Library symbol:
 *   - sprite27 (characterId=27, directlyDynamic=true): placed inside sprite_35
 *     at frame 24 (0-based) at depth 4. It has an onClipEvent(load) that counter-
 *     rotates itself relative to its parent's rotation, and an onClipEvent(enterFrame)
 *     that pulses _alpha randomly between 50–149. The combat-exporter has extracted
 *     it as lib_sprite27_0.svg.
 *
 * Main timeline (frame_2/DoAction.as): SOMA.playSound("jet_903"); stop();
 * The harness for WorldAbsoluteAlt (51) stores cellFrom/cellTo/angle on root.vars.
 * Both sprite_20 and sprite_35 are attached from onSpellStart and self-position
 * via root.vars.cellFrom / root.vars.cellTo in their frame_1 scripts.
 *
 * Sounds schedule:
 *   frame 1 of main timeline: jet_903 (fired in onSpellStart)
 *   sprite_35 frame_10: jet_912
 *   sprite_35 frame_76: jet_912b
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

// ---- Manifest bounds for library / animation symbols ----

const SPRITE27_BOUNDS = {
  width: 24.75,
  height: 20.8,
  offsetX: -12.55,
  offsetY: -12.95,
};

const SPRITE20_BOUNDS = {
  width: 186.6,
  height: 41.2,
  offsetX: 5.15,
  offsetY: -25.1,
};

const SPRITE30_BOUNDS = {
  width: 75.05,
  height: 1.05,
  offsetX: 0,
  offsetY: -1.05,
};

const SPRITE35_BOUNDS = {
  width: 147.8,
  height: 103,
  offsetX: -72.85,
  offsetY: -53.45,
};

export class Spell912 extends RuntimeSpell {
  readonly spellId = 912;
  readonly displayType = SpellDisplayType.WorldAbsoluteAlt;

  private sprite20Sym!: SymbolDefinition;
  private sprite35Sym!: SymbolDefinition;
  private sprite27Sym!: SymbolDefinition;
  private sprite30Sym!: SymbolDefinition;

  private soundCallback?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite27Anchor = calculateAnchor(SPRITE27_BOUNDS);
    const sprite20Anchor = calculateAnchor(SPRITE20_BOUNDS);
    const sprite30Anchor = calculateAnchor(SPRITE30_BOUNDS);
    const sprite35Anchor = calculateAnchor(SPRITE35_BOUNDS);

    // ---- sprite27 — clipEvent-driven sparkle glyph (lib symbol) ----
    // Placed inside sprite_35 at parent frame 24 (0-based), depth 4.
    // AS DefineSprite_27/frame_1/PlaceObject2_26_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   _rotation = -_parent._parent._rotation;
    // AS DefineSprite_27/frame_1/PlaceObject2_26_1/CLIPACTIONRECORD onClipEvent(enterFrame).as:
    //   _alpha = random(100) + 50;
    this.sprite27Sym = {
      name: "sprite27",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite27"),
      anchorX: sprite27Anchor.x,
      anchorY: sprite27Anchor.y,
      onLoad: (clip) => {
        // AS: _rotation = -_parent._parent._rotation
        // clip.parent is sprite_35 clip inside sprite_35Sym's hierarchy.
        // _parent._parent in AS = clip.parent (sprite_35 clip), whose
        // rotation was set from _parent.angle in sprite_35's frame_1.
        const parentRotation = clip.parent?.rotation ?? 0;
        clip.rotation = -parentRotation;
      },
      onEnterFrame: (clip) => {
        // AS: _alpha = random(100) + 50  (range 50-149 in AS 0-100 units)
        // Convert: (50 + random 0..99) / 100
        clip.alpha = (Math.floor(Math.random() * 100) + 50) / 100;
      },
    };

    // ---- sprite30 — randomised sparkle particle placed in sprite_35 ----
    // sprite_30 appears in animations[] (not librarySymbols) but is used
    // inside the sprite_35 composite. We model it as a symbol so sprite_35
    // can attach live instances with random rotation/scale per the AS.
    // AS DefineSprite_30/frame_1/DoAction.as:
    //   _rotation = random(360); t = random(50)+50; _xscale = t; _yscale = t;
    // AS DefineSprite_30/frame_40/DoAction.as:
    //   stop();
    this.sprite30Sym = {
      name: "sprite30",
      totalFrames: 42,
      frames: textures.getFrames("sprite_30"),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_30/frame_1/DoAction.as
            clip.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
            const t = Math.floor(Math.random() * 50) + 50;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
          },
        ],
        [
          39,
          (clip) => {
            // AS DefineSprite_30/frame_40/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_20 — caster-side bow-draw animation ----
    // AS DefineSprite_20/frame_1/DoAction.as:
    //   _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 30; _rotation = _parent.angle;
    // AS DefineSprite_20/frame_43/DoAction.as:
    //   stop();
    this.sprite20Sym = {
      name: "sprite_20",
      totalFrames: 45,
      frames: textures.getFrames("sprite_20"),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_20/frame_1/DoAction.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellFrom) {
              clip.x = cellFrom.x;
              clip.y = cellFrom.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          42,
          (clip) => {
            // AS DefineSprite_20/frame_43/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_35 — target-side impact timeline (129 frames) ----
    // AS DefineSprite_35/frame_1/DoAction.as:
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle;
    // AS DefineSprite_35/frame_10/DoAction.as:
    //   SOMA.playSound("jet_912");
    // AS DefineSprite_35/frame_76/DoAction.as:
    //   SOMA.playSound("jet_912b");
    // AS DefineSprite_35/frame_76/DoAction_2.as:
    //   this.end(); → signalHit
    // AS DefineSprite_35/frame_127/DoAction.as:
    //   _parent.removeMovieClip(); → spell complete
    //
    // The manifest's librarySymbols entry for sprite27 has placements
    // on parentSpriteId=35 at frame 24 (0-based index 23), depth 4,
    // with a PlaceObject2 matrix and color transforms that tween across
    // frames 24–81. We attach at frame 23 and let the clip event
    // handlers drive its alpha/rotation dynamically as canonical AS does.
    this.sprite35Sym = {
      name: "sprite_35",
      totalFrames: 129,
      frames: textures.getFrames("sprite_35"),
      anchorX: sprite35Anchor.x,
      anchorY: sprite35Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_35/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as
              | { x: number; y: number }
              | undefined;
            const angleDeg = (root?.vars.angle as number) ?? 0;
            if (cellTo) {
              clip.x = cellTo.x;
              clip.y = cellTo.y - 30;
            }
            clip.rotation = (angleDeg * Math.PI) / 180;
          },
        ],
        [
          9,
          () => {
            // AS DefineSprite_35/frame_10/DoAction.as: SOMA.playSound("jet_912")
            this.soundCallback?.("jet_912");
          },
        ],
        [
          23,
          (clip, ctx) => {
            // Canonical PlaceObject2 placement of sprite27 at frame 24 (0-based 23),
            // depth 4. Initial matrix from placements[0]:
            //   translateX: -1.85, translateY: 6.65, scaleX/Y: ~0.7336, alphaMult: 79
            // The onLoad and onEnterFrame of sprite27Sym drive the dynamic behavior.
            clip.attach(this.sprite27Sym, "sprite27_4", 4, ctx, {
              x: -1.85,
              y: 6.65,
            });
            // Apply initial alpha from placement colorTransform.alphaMult = 79 / 256
            const s27 = clip.children.get("sprite27_4");
            if (s27) {
              s27.scaleX = 0.7336;
              s27.scaleY = 0.7336;
              s27.alpha = 79 / 256;
            }
          },
        ],
        [
          75,
          () => {
            // AS DefineSprite_35/frame_76/DoAction.as: SOMA.playSound("jet_912b")
            // AS DefineSprite_35/frame_76/DoAction_2.as: this.end() → signalHit
            this.soundCallback?.("jet_912b");
            this.runtime.signalHit();
          },
        ],
        [
          126,
          (clip) => {
            // AS DefineSprite_35/frame_127/DoAction.as: _parent.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite27Sym);
    this.registry.register(this.sprite30Sym);
    this.registry.register(this.sprite20Sym);
    this.registry.register(this.sprite35Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frame scripts can fire sounds later.
    this.soundCallback = callbacks.playSound;

    // AS scripts/frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    callbacks.playSound("jet_903");

    // Attach the two parallel authored timelines to the root.
    // For WorldAbsoluteAlt (51) the container is at world (0,0);
    // each sprite's frame_1 self-positions at cellFrom / cellTo.
    this.root.attach(this.sprite20Sym, "sprite20", 1, context);
    this.root.attach(this.sprite35Sym, "sprite35", 2, context);
  }
}
