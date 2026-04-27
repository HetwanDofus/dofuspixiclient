/**
 * Spell 2064 — (Wabbit-type spell, displayType=50 WorldAbsolute).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2064/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). The main timeline has two authored symbols placed
 * in parallel: sprite_15 (a beam from caster to target) and sprite_28 (an impact at
 * target). Both read `_parent.cellFrom` / `_parent.cellTo` in their frame_1 scripts
 * to position themselves at world coords — the canonical pattern for WorldAbsolute.
 * sprite_13 is a child placed inside sprite_15 (via PlaceObject2_13_1) whose onLoad
 * sets its width to `_parent.longueur - 10`.
 *
 * Canonical AS layout:
 *   - frame_2/DoAction.as: stop()  (main timeline stops at frame 2)
 *
 *   - sprite_15 (120-frame beam, composite):
 *       frame_1/DoAction.as:    SOMA.playSound("wab_explo")
 *       frame_1/DoAction_2.as:  position self at cellFrom→cellTo, compute rotation
 *                               + longueur; sets _X/_Y/_rotation/longueur on self
 *       frame_1/PlaceObject2_13_1/onClipEvent(load).as:
 *                               child sprite_13 sets _width = _parent.longueur - 10
 *       frame_4/DoAction.as:    SOMA.playSound("licrounch_1008b")
 *
 *   - sprite_13 (42-frame beam inner, child of sprite_15):
 *       frame_40/DoAction.as:   stop()
 *
 *   - sprite_28 (51-frame impact, composite):
 *       frame_1/DoAction.as:    position self at cellTo (y-40), copy rotation from
 *                               _parent.clip1._rotation
 *       frame_10/DoAction.as:   SOMA.playSound("vol")
 *       frame_10/DoAction_2.as: this.end() → signalHit
 *       frame_49/DoAction.as:   stop(); _parent.removeMovieClip() → spell complete
 *
 * The sounds list in manifest.json (frame 0: wab_explo, frame 3: licrounch_1008b,
 * frame 9: vol) maps to what sprite_15 and sprite_28 fire internally.
 *
 * Library symbols: none in librarySymbols[]. All three symbols appear only in
 * animations[] — use bare name keys (no lib_ prefix).
 *
 * signalHit: fired from sprite_28 frame_10 (this.end()).
 * complete:  fired from sprite_28 frame_49 (_parent.removeMovieClip()).
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

// Bounds from manifest animations[] entries (no librarySymbols — use bare name keys).
const SPRITE_13_BOUNDS = {
  width: 224.05,
  height: 49.75,
  offsetX: 0,
  offsetY: -27.1,
};
const SPRITE_15_BOUNDS = {
  width: 223.15,
  height: 49.55,
  offsetX: -0.4,
  offsetY: -26.7,
};
const SPRITE_28_BOUNDS = {
  width: 172,
  height: 147.3,
  offsetX: -99.55,
  offsetY: -59.4,
};

export class Spell2064 extends RuntimeSpell {
  readonly spellId = 2064;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private sprite13Sym!: SymbolDefinition;
  private sprite15Sym!: SymbolDefinition;
  private sprite28Sym!: SymbolDefinition;

  // Capture sound callback for use inside frameScripts.
  private playSound?: (id: string) => void;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite13Anchor = calculateAnchor(SPRITE_13_BOUNDS);
    const sprite15Anchor = calculateAnchor(SPRITE_15_BOUNDS);
    const sprite28Anchor = calculateAnchor(SPRITE_28_BOUNDS);

    // ---- sprite_13 — inner beam strip (child of sprite_15) ------
    // No lib_ prefix — only in animations[].
    // AS: DefineSprite_13/frame_40/DoAction.as → stop()
    // AS: DefineSprite_15/frame_1/PlaceObject2_13_1/onClipEvent(load).as
    //     → _width = _parent.longueur - 10
    //     We mirror this with onLoad: read parent.vars.longueur, set scaleX
    //     to stretch the sprite to (longueur - 10) pixels.
    this.sprite13Sym = {
      name: "sprite_13",
      totalFrames: 42,
      frames: textures.getFrames("sprite_13"),
      anchorX: sprite13Anchor.x,
      anchorY: sprite13Anchor.y,
      onLoad: (clip) => {
        // AS DefineSprite_15/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(load).as
        // _width = _parent.longueur - 10
        // In Pixi we approximate _width by scaling: scaleX = targetWidth / nativeWidth
        const longueur = (clip.parent?.vars.longueur as number) ?? 0;
        const targetWidth = longueur - 10;
        if (SPRITE_13_BOUNDS.width > 0) {
          clip.scaleX = targetWidth / SPRITE_13_BOUNDS.width;
        }
      },
      frameScripts: new Map([
        [
          39,
          (clip) => {
            // AS DefineSprite_13/frame_40/DoAction.as → stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- sprite_15 — beam from caster to target (120 frames) ----
    // No lib_ prefix — only in animations[].
    // AS: DefineSprite_15/frame_1/DoAction.as   → SOMA.playSound("wab_explo")
    // AS: DefineSprite_15/frame_1/DoAction_2.as → position + rotation + longueur
    // AS: DefineSprite_15/frame_4/DoAction.as   → SOMA.playSound("licrounch_1008b")
    this.sprite15Sym = {
      name: "sprite_15",
      totalFrames: 120,
      frames: textures.getFrames("sprite_15"),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_15/frame_1/DoAction.as
            // SOMA.playSound("wab_explo")
            this.playSound?.("wab_explo");

            // AS DefineSprite_15/frame_1/DoAction_2.as
            // x1 = _parent.cellFrom.x; y1 = _parent.cellFrom.y - 40;
            // x2 = _parent.cellTo.x;  y2 = _parent.cellTo.y - 40;
            // _X = x1; _Y = y1;
            // dx = x2 - x1; dy = y2 - y1;
            // _rotation = Math.atan2(dy,dx) * 57.29746936176985;
            // longueur = Math.sqrt(dx*dx + dy*dy);
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            const x1 = cellFrom?.x ?? 0;
            const y1 = (cellFrom?.y ?? 0) - 40;
            const x2 = cellTo?.x ?? 0;
            const y2 = (cellTo?.y ?? 0) - 40;
            clip.x = x1;
            clip.y = y1;
            const dx = x2 - x1;
            const dy = y2 - y1;
            // AS uses degrees; convert atan2 result (radians) to radians directly.
            clip.rotation = Math.atan2(dy, dx);
            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;

            // Place the inner beam child (sprite_13) — canonical PlaceObject2_13_1.
            // Its onLoad will read longueur from clip.vars.longueur.
            clip.attach(this.sprite13Sym, "clip1", 1, ctx);
          },
        ],
        [
          3,
          (_clip) => {
            // AS DefineSprite_15/frame_4/DoAction.as → SOMA.playSound("licrounch_1008b")
            this.playSound?.("licrounch_1008b");
          },
        ],
      ]),
    };

    // ---- sprite_28 — impact at target (51 frames) ---------------
    // No lib_ prefix — only in animations[].
    // AS: DefineSprite_28/frame_1/DoAction.as   → position at cellTo, copy rotation from clip1
    // AS: DefineSprite_28/frame_10/DoAction.as  → SOMA.playSound("vol")
    // AS: DefineSprite_28/frame_10/DoAction_2.as → this.end() → signalHit
    // AS: DefineSprite_28/frame_49/DoAction.as  → stop(); _parent.removeMovieClip()
    this.sprite28Sym = {
      name: "sprite_28",
      totalFrames: 51,
      frames: textures.getFrames("sprite_28"),
      anchorX: sprite28Anchor.x,
      anchorY: sprite28Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_28/frame_1/DoAction.as
            // _X = _parent.cellTo.x;
            // _Y = _parent.cellTo.y - 40;
            // _rotation = _parent.clip1._rotation;
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;
            clip.x = cellTo?.x ?? 0;
            clip.y = (cellTo?.y ?? 0) - 40;
            // Copy rotation from clip1 (sprite_15 child, which was attached as "clip1"
            // inside sprite_15 — but _parent.clip1 refers to the root-level sprite_15
            // instance named "clip1" in the canonical AS. We stored sprite_15 at root
            // as "sprite15"; its rotation is the beam angle we want.
            const sprite15 = root?.children.get("sprite15");
            if (sprite15) {
              clip.rotation = sprite15.rotation;
            }
          },
        ],
        [
          9,
          (_clip) => {
            // AS DefineSprite_28/frame_10/DoAction.as → SOMA.playSound("vol")
            this.playSound?.("vol");
            // AS DefineSprite_28/frame_10/DoAction_2.as → this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          48,
          (clip) => {
            // AS DefineSprite_28/frame_49/DoAction.as
            // stop(); _parent.removeMovieClip();
            clip.stop();
            clip.parent?.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite13Sym);
    this.registry.register(this.sprite15Sym);
    this.registry.register(this.sprite28Sym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback for use inside frameScripts.
    this.playSound = callbacks.playSound;

    // frame_2/DoAction.as: stop()
    // The main timeline stops; we attach the two authored children here.
    // sprite_15 (beam) is attached at depth 1, named "sprite15".
    // sprite_28 (impact) is attached at depth 2, named "sprite28".
    // Both position themselves in their own frame_1 scripts using root.vars.cellFrom/cellTo.
    this.root.attach(this.sprite15Sym, "sprite15", 1, context);
    this.root.attach(this.sprite28Sym, "sprite28", 2, context);
  }
}
