// GM — Sprite stream (Game.as → extendIn.onMovement, DataProcessor.as:314)
//
// Wire: opcode `GM<flag><rows>`, where:
//   - `flag` is a single discriminator byte (semantics not yet exercised
//     by the client beyond passing through; AS2 strips it with
//     `sData.substr(3)`).
//   - `rows` is pipe-separated; each row is one of:
//       `+<payload>`   — add sprite
//       `~<payload>`   — replace sprite (drop existing at the same
//                        sprite id, then add)
//       `-<spriteId>`  — remove sprite
//
// Per-row payload (split by `;`) for `+` / `~`:
//   [0]  cell                (or "-1" → "use my own cell")
//   [1]  direction
//   [2]  bonusValue/level    (sprite-type dependent)
//   [3]  sprite id
//   [4]  display name        (empty for -1/-2/-9 etc.)
//   [5]  gfx prefix          (comma-split: <spriteType,titleId?>) —
//                             charAt(0) of the first segment is the
//                             discriminator (">0" = player, "-1" =
//                             creature, "-2" = monster, …, see
//                             extend/GameIn.as:173-403)
//   [6]  gfx with optional `*` prefix/suffix and `^scaleX[xScaleY]`
//   [7…] type-specific block
//
// This file ports the envelope + the **player / creature / monster**
// type blocks (the bulk of roleplay + fight events). Other sprite
// types (NPC, monster group, mutant, prism, mount, offline character)
// land in `rest` as the raw `;`-separated row so the handler can
// triage them.

import { match } from "ts-pattern";

import { WireIn } from "../../wire";

/** Sprite-type discriminator, parsed from the gfx prefix cell. */
export type SpriteKind =
  | "player"
  | "creature"
  | "monster"
  | "monsterGroup"
  | "npc"
  | "offlineCharacter"
  | "taxCollector"
  | "mutant"
  | "mountPark"
  | "prism"
  | "unknown";

export interface GMSpriteAdd {
  op: "add" | "replace";
  spriteId: string;
  kind: SpriteKind;
  cell: number;
  direction: number;
  /** Display name. Empty for creatures / monsters / decorative entries. */
  name: string;
  /** Stripped gfx id (the post-`^`-split, post-`*`-trim form). */
  gfxId: number;
  /** Per-axis scale (percent — server sends 100 for "default size").
   *  Canonical `Number()` pass-through, fractional values allowed, no
   *  clamp (GameIn.as:152-166); NaN normalizes to 100. */
  scaleX: number;
  scaleY: number;
  /** AS2 `_loc18_` — "do not flip horizontally" flag. */
  noFlip: boolean;
  /** AS2 `_loc19_` — sprite-type modifier; `false` when the gfx had a
   *  leading `*` (used by mounts / chevauchors). */
  defaultRig: boolean;
  /** RGB colour zones — `-1` means "use gfx default" (canonical
   *  applyColor skips only `undefined`/`-1`; `0` is a REAL colour,
   *  flat black). Parsed for player / creature / monster / npc /
   *  offlineCharacter; `-1` for kinds we don't yet decode. */
  color1: number;
  color2: number;
  color3: number;
  /** Accessory block (raw `,`-separated id list). */
  accessories: string;
  /** GM restrictions bitfield — rides the ROLEPLAY player row tail at
   *  fixed index [18] (canonical GameIn.as:481
   *  `_loc52_.restrictions = _loc10_[18]`, non-fight branch only; the
   *  fight-row layout carries no restrictions field). Decoded base-36
   *  per CharactersManager.as:150
   *  (`parseInt(oData.restrictions, 36)`). Bit 0x40 = "cannot switch
   *  into creatures mode" (Character.as:175-178). 0 for every other
   *  sprite kind and for fight rows. */
  restrictions: number;
  /** Power / level token at [2]. Server semantics vary by kind. */
  bonusValue: number;
  /** Type-specific tail — `;`-rejoined for sprite kinds we haven't
   *  parsed yet (`monsterGroup`, NPC, mutants, etc.). Step-3 handlers
   *  can re-split this without re-running the envelope parser. */
  rest: string;
}

export interface GMSpriteRemove {
  op: "remove";
  spriteId: string;
}

export type GMRow = GMSpriteAdd | GMSpriteRemove;

/** Parsed GM frame. `flag` carries the post-opcode marker the AS2
 *  dispatcher strips (`sData.substr(3)`); we keep it for round-trip /
 *  step-5 diagnostics. */
@WireIn({
  opcode: "GM",
  bodyOffset: 3,
  parse(body) {
    const inst = new GM();

    if (body.length === 0) {
      return inst;
    }

    const rawRows = body.split("|");

    for (const raw of rawRows) {
      if (raw.length === 0) {
        continue;
      }

      const op = raw.charAt(0);

      if (op === "-") {
        inst.rows.push({ op: "remove", spriteId: raw.slice(1) });
        continue;
      }

      if (op !== "+" && op !== "~") {
        // Unknown leading op — surface as a remove of an empty id so
        // step-5 sees the malformed row instead of dropping it.
        continue;
      }

      const opKind = op === "+" ? "add" : "replace";
      const fields = raw.slice(1).split(";");
      const cellRaw = fields[0] ?? "";
      const cell =
        cellRaw === "-1" || cellRaw === ""
          ? -1
          : Number.parseInt(cellRaw, 10) || 0;
      const direction = Number.parseInt(fields[1] ?? "", 10) || 0;
      const bonusValue = Number.parseInt(fields[2] ?? "", 10) || 0;
      const spriteId = fields[3] ?? "";
      const name = fields[4] ?? "";
      const gfxPrefix = fields[5] ?? "";
      const gfxWithFlags = fields[6] ?? "";

      const [spriteTypeToken = ""] = gfxPrefix.split(",");
      const kind = classifyKind(spriteTypeToken);

      // gfx parsing — leading `*` flips defaultRig; trailing `*` sets
      // noFlip; `^<scale>` (or `^<sx>x<sy>`) carries per-axis scale.
      let defaultRig = true;
      let noFlip = false;
      let gfxBase = gfxWithFlags;

      if (gfxBase.length > 0 && gfxBase.charAt(gfxBase.length - 1) === "*") {
        gfxBase = gfxBase.slice(0, -1);
        noFlip = true;
      }

      if (gfxBase.length > 0 && gfxBase.charAt(0) === "*") {
        gfxBase = gfxBase.slice(1);
        defaultRig = false;
      }

      let scaleX = 100;
      let scaleY = 100;
      let gfxIdStr = gfxBase;
      const caretIdx = gfxBase.indexOf("^");

      if (caretIdx >= 0) {
        gfxIdStr = gfxBase.slice(0, caretIdx);

        // Canonical GameIn.as:152-166 — try `Number(raw)` first (the
        // uniform `^V` form; floats pass through, NO clamp). Only when
        // that is NaN, split on "x" and `Number()` each axis (exactly 2
        // parts, otherwise the 100 defaults stand). A NaN axis
        // normalizes to 100: canonical guards with isNaN before
        // setSpriteScale (GameIn.as:258) / lets the NaN `_xscale` write
        // no-op, so "NaN scale" == "scale never applied" == default.
        const scaleRaw = gfxBase.slice(caretIdx + 1);
        const uniform = Number(scaleRaw);

        if (Number.isNaN(uniform)) {
          const xSplit = scaleRaw.split("x");

          if (xSplit.length === 2) {
            scaleX = numberOr100(xSplit[0]);
            scaleY = numberOr100(xSplit[1]);
          }
        } else {
          scaleX = uniform;
          scaleY = uniform;
        }
      }

      const gfxId = Number.parseInt(gfxIdStr, 10) || 0;

      // Color / accessory layout is kind-specific (canonical
      // GameIn.as#onMovement L173+). Colors arrive as hex strings.
      //
      //   creature / monster (`-1`/`-2`):  c1=[8] c2=[9] c3=[10] acc=[11]
      //   npc (`-4`):                      sex=[7] c1=[8] c2=[9] c3=[10]
      //                                    acc=[11] extraClip=[12]
      //                                    customArtwork=[13]
      //   offlineCharacter (`-5`):         c1=[7] c2=[8] c3=[9] acc=[10]
      //                                    guild=[11] emblem=[12] ...
      //   player (>0, non-fight):          c1=[9] c2=[10] c3=[11] acc=[12]
      //   player (>0, in-fight):           c1=[10] c2=[11] c3=[12] acc=[13]
      //
      // Fight detection: fight rows carry LP/AP/MP between sex and
      // alignment, so the row is longer. Cheapest heuristic: if
      // fields[8] is a digit string AND fields[12] is non-empty,
      // it's a fight row. Roleplay non-fight is the only path the
      // step-3 vertical needs today; the heuristic keeps us correct
      // when the server later flips into combat.
      let color1 = -1;
      let color2 = -1;
      let color3 = -1;
      let accessories = "";
      let restrictions = 0;
      let restStart = 7;
      if (kind === "creature" || kind === "monster") {
        color1 = parseHexOr(fields[8], -1);
        color2 = parseHexOr(fields[9], -1);
        color3 = parseHexOr(fields[10], -1);
        accessories = fields[11] ?? "";
        restStart = 12;
      } else if (kind === "npc") {
        // wc3 PARITY (user directive, 2026-07-07): NPCs render their
        // AUTHORED palette unconditionally — wire colors are NOT
        // applied. Canonical GameIn.as:284-287 does parse+apply them,
        // but wc3 never does (from_net.rs falls through to
        // (None, None, None) for Npc) and its months-validated visuals
        // are the product truth; emulator seed data also uses 0 where
        // canonical means "none", which canonical clients would render
        // as flat black. Colors stay -1 (unset → authored).
        accessories = fields[11] ?? "";
        restStart = 12; // keep extraClip/customArtwork in `rest`
      } else if (kind === "offlineCharacter") {
        color1 = parseHexOr(fields[7], -1);
        color2 = parseHexOr(fields[8], -1);
        color3 = parseHexOr(fields[9], -1);
        accessories = fields[10] ?? "";
        restStart = 11; // guildName/emblem/offlineType/characterID in `rest`
      } else if (kind === "player") {
        // Field [8] is `alignment` in roleplay, `level` in fight.
        // Field count is the cleanest discriminator: fight rows
        // carry 25+ fields (LP/AP/MP/resistances/team/...), roleplay
        // rows stop around 18.
        const isFightRow = fields.length >= 25;
        const colorBase = isFightRow ? 10 : 9;
        color1 = parseHexOr(fields[colorBase], -1);
        color2 = parseHexOr(fields[colorBase + 1], -1);
        color3 = parseHexOr(fields[colorBase + 2], -1);
        accessories = fields[colorBase + 3] ?? "";
        restStart = colorBase + 4;
        if (!isFightRow) {
          // Roleplay tail: [13]=aura [14]=emote [15]=emoteTimer
          // [16]=guildName [17]=emblem [18]=restrictions (base-36),
          // [19]=mount — canonical GameIn.as:475-481. Fight rows never
          // ship restrictions (canonical fight branch stops at LPmax).
          restrictions = parseBase36Or(fields[18], 0);
        }
      }

      const rest = fields.slice(restStart).join(";");

      inst.rows.push({
        op: opKind,
        spriteId,
        kind,
        cell,
        direction,
        name,
        gfxId,
        scaleX,
        scaleY,
        noFlip,
        defaultRig,
        color1,
        color2,
        color3,
        accessories,
        restrictions,
        bonusValue,
        rest,
      });
    }
    return inst;
  },
})
export class GM {
  rows: GMRow[] = [];
}

/** Canonical `^scale` axis conversion (GameIn.as:160-161) — AS2
 *  `Number()` semantics (floats pass through, no clamp), with NaN
 *  normalized to the 100 default (canonical never applies a NaN
 *  scale — GameIn.as:258 isNaN guard). */
function numberOr100(s: string | undefined): number {
  const v = Number(s);

  return Number.isNaN(v) ? 100 : v;
}

/** Canonical restrictions decode — CharactersManager.as:150
 *  `_global.parseInt(oData.restrictions, 36)`. Empty / malformed →
 *  fallback (canonical guards with `oData.restrictions != undefined`). */
function parseBase36Or(s: string | undefined, fallback: number): number {
  if (!s || s.length === 0) {
    return fallback;
  }

  const n = Number.parseInt(s, 36);

  return Number.isNaN(n) ? fallback : n;
}

function parseHexOr(s: string | undefined, fallback: number): number {
  if (!s || s.length === 0) {
    return fallback;
  }

  const n = Number.parseInt(s, 16);

  return Number.isNaN(n) ? fallback : n;
}

function classifyKind(token: string): SpriteKind {
  return match(token)
    .with("-1", () => "creature" as const)
    .with("-2", () => "monster" as const)
    .with("-3", () => "monsterGroup" as const)
    .with("-4", () => "npc" as const)
    .with("-5", () => "offlineCharacter" as const)
    .with("-6", () => "taxCollector" as const)
    .with("-7", "-8", () => "mutant" as const)
    .with("-9", () => "mountPark" as const)
    .with("-10", () => "prism" as const)
    .otherwise(() => {
      const n = Number.parseInt(token, 10);

      return Number.isNaN(n) || n < 0 ? "unknown" : ("player" as const);
    });
}
