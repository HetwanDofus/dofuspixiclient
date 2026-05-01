/**
 * Spell 805 — Vlad (Sacrieur beam-line spell).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/805/scripts/scripts/
 *
 * displayType=40 (BeamLine). The manifest has a `duplicate` animation in
 * animations[] (87 frames, isComposite: true) and the AS scripts are all on
 * DefineSprite_8_duplicate — matching the BeamLine pattern exactly: the harness
 * periodically drops `duplicate` clips along the caster→target line.
 *
 * Library symbols:
 *   - sprite4 (characterId 4, directlyDynamic: true) — thin vertical bar
 *     placed inside sprite6. onClipEvent(load) reads level via 5-hop parent
 *     traversal (collapses to 3 hops in our clip tree: sprite4 → sprite6 →
 *     duplicate → root) and sets _yscale = 20 * (level - 1).
 *   - sprite6 (characterId 6, directlyDynamic: false) — 126-frame wrapper
 *     placed inside duplicate at depths 10, 13, 16. Attaches sprite4 at
 *     depth 2 on its frame 0.
 *   - duplicate (DefineSprite_8_duplicate) — 87-frame beam segment.
 *     frame_1: scale self by 40 + 20*level; attach three sprite6 instances.
 *     frame_85: removeMovieClip → runtime.complete().
 *
 * Main timeline: SOMA.playSound("vlad_805")
 *
 * signalHit: fired automatically by the BeamLine harness when the beam
 * reaches the target. Per-spell code must NOT call it again.
 *
 * complete: fired from frame 84 (AS frame_85) of duplicate.
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

const SPRITE4_BOUNDS = {
  width: 11.05,
  height: 101.7,
  offsetX: -6.5,
  offsetY: -102.05,
};

const SPRITE6_BOUNDS = {
  width: 81.6,
  height: 130.3,
  offsetX: -36.4,
  offsetY: -123.3,
};

const DUPLICATE_BOUNDS = {
  width: 104.15,
  height: 109.5,
  offsetX: -46.85,
  offsetY: -82.4,
};

export class Spell805 extends RuntimeSpell {
  readonly spellId = 805;
  readonly displayType = SpellDisplayType.BeamLine;

  // Store symbol definitions as instance fields so forward references
  // inside frameScripts closures are safe (captured by reference, not value).
  private sprite4Sym!: SymbolDefinition;
  private sprite6Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const sprite4Anchor = calculateAnchor(SPRITE4_BOUNDS);
    const sprite6Anchor = calculateAnchor(SPRITE6_BOUNDS);
    const duplicateAnchor = calculateAnchor(DUPLICATE_BOUNDS);

    // ---- sprite4 — thin vertical bar, placed inside sprite6 --------
    // directlyDynamic: true — has its own onClipEvent(load).
    //
    // AS: scripts/DefineSprite_4/frame_1/PlaceObject2_3_1/
    //     CLIPACTIONRECORD onClipEvent(load).as
    //   t = 20 * (_parent._parent._parent._parent._parent.level - 1)
    //   _yscale = t
    //
    // Canonical 5-hop traversal from sprite4:
    //   sprite4 → sprite6 → duplicate → root → (outer mc in Flash)
    // In our clip tree root.vars.level carries the spell level, so we
    // walk 3 hops: sprite4.parent → sprite6.parent → duplicate.parent = root.
    this.sprite4Sym = {
      name: "sprite4",
      totalFrames: 1,
      frames: textures.getFrames("lib_sprite4"),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      onLoad: (clip) => {
        // AS: t = 20 * (_parent._parent._parent._parent._parent.level - 1)
        //     _yscale = t
        const root =
          clip.parent?.parent?.parent ??
          clip.parent?.parent ??
          clip.parent;
        const level = (root?.vars.level as number) ?? 1;
        const t = 20 * (level - 1);
        // AS _yscale is percent → TS decimal
        clip.scaleY = t / 100;
      },
    };

    // ---- sprite6 — wrapper placed inside duplicate -----------------
    // directlyDynamic: false — no clip event handlers of its own.
    // Placements show sprite4 at depth 2, parentSpriteId=6, frame=0.
    // We attach sprite4 in frameScripts[0] to fire its onLoad (level scale).
    // The 126 authored frames of sprite6 carry the tween visuals for the
    // bar animation; sprite4's onLoad drives the level-dependent y-scale.
    this.sprite6Sym = {
      name: "sprite6",
      totalFrames: 126,
      frames: textures.getFrames("lib_sprite6"),
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: PlaceObject2 at parentSpriteId=6, frame=0, depth=2
            // places sprite4 inside sprite6. Attach so onLoad fires.
            clip.attach(this.sprite4Sym, "sprite4_bar", 2, ctx);
          },
        ],
      ]),
    };

    // ---- duplicate — 87-frame beam segment -------------------------
    // AS: DefineSprite_8_duplicate
    //
    // frame_1 (index 0):
    //   t = 40 + 20 * this._parent.level
    //   _xscale = t; _yscale = t;
    //
    // Also at frame 0: three sprite6 instances at depths 10, 13, 16
    // (placements in manifest: parentSpriteId=8, frame=0, depths 10/13/16).
    //
    // frame_85 (index 84):
    //   this.removeMovieClip()  → spell complete
    const duplicateSym: SymbolDefinition = {
      name: "duplicate",
      totalFrames: 87,
      frames: textures.getFrames("duplicate"),
      anchorX: duplicateAnchor.x,
      anchorY: duplicateAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_8_duplicate/frame_1/DoAction.as
            //   t = 40 + 20 * this._parent.level
            //   _xscale = t; _yscale = t;
            const level = (clip.parent?.vars.level as number) ?? 1;
            const t = 40 + 20 * level;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;

            // Canonical placements at frame 0 of DefineSprite_8 (duplicate):
            // three sprite6 instances at depths 10, 13, 16 with authored
            // initial transforms from the manifest placements[].

            // depth 10: scaleX=0.421, scaleY=0.421, skew1=0.111 (slight rotation),
            //   tx=-17.8, ty=5.1
            const s6a = clip.attach(this.sprite6Sym, "sprite6_d10", 10, ctx);
            s6a.x = -17.8;
            s6a.y = 5.1;
            s6a.scaleX = 0.4209136962890625;
            s6a.scaleY = 0.4209136962890625;
            // rotateSkew0=-0.111, rotateSkew1=0.111 → rotation = atan2(rotateSkew1, scaleX)
            s6a.rotation = Math.atan2(
              0.1111907958984375,
              0.4209136962890625,
            );

            // depth 13: scaleX=-0.594, scaleY=0.594 (mirrored X), skew≈-0.143,
            //   tx=18.05, ty=5.4
            const s6b = clip.attach(this.sprite6Sym, "sprite6_d13", 13, ctx);
            s6b.x = 18.05;
            s6b.y = 5.4;
            s6b.scaleX = -0.593597412109375;
            s6b.scaleY = 0.593597412109375;
            s6b.rotation = Math.atan2(
              -0.1429290771484375,
              -0.593597412109375,
            );

            // depth 16: scaleX=0.436, scaleY=0.436, no rotation,
            //   tx=-6.05, ty=12.85
            const s6c = clip.attach(this.sprite6Sym, "sprite6_d16", 16, ctx);
            s6c.x = -6.05;
            s6c.y = 12.85;
            s6c.scaleX = 0.435699462890625;
            s6c.scaleY = 0.435699462890625;
            s6c.rotation = 0;
          },
        ],
        [
          84,
          (clip) => {
            // AS: DefineSprite_8_duplicate/frame_85/DoAction.as
            //   this.removeMovieClip()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.sprite4Sym);
    this.registry.register(this.sprite6Sym);
    this.registry.register(duplicateSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    _context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as
    //   SOMA.playSound("vlad_805");
    callbacks.playSound("vlad_805");
  }
}
