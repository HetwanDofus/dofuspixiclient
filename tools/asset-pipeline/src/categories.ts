import {
  CategoryRegistrySchema,
  type CategoryRegistry,
} from "./category.ts";

// Only character sprites + chevauchors carry runtime-tintable zones in
// Dofus 1.29 (verified: the GAC.applyColor AS2 pattern only shows up in
// those). Every other "looks colorful" asset ships as fixed-palette art.
const PLAYER_COLOR_ZONES = {
  zoneCount: 3,
  tintMode: "player",
} as const;

const raw: CategoryRegistry = [
  {
    name: "sprites",
    source: "clips/sprites/[0-9]*.swf",
    idFrom: "filename",
    shape: "animated",
    traits: {
      colorZones: PLAYER_COLOR_ZONES,
      accessorySlots: { count: 5 },
    },
  },
  {
    // The client fetches these under /assets/spritesheets/chevauchors/<id>.dofasset
    // (note the plural). Source dir on disk stays the singular "chevauchor".
    name: "sprites.chevauchors",
    source: "clips/sprites/chevauchor/*.swf",
    idFrom: "filename",
    shape: "animated",
    traits: {
      colorZones: PLAYER_COLOR_ZONES,
      accessorySlots: { count: 5 },
    },
  },
  {
    name: "sprites.accessories",
    source: "clips/sprites/accessories/*.swf",
    idFrom: "symbolName",
    shape: "animated",
    traits: {
      multiSymbol: { symbolRegex: /^(\d+)_(\d+)$/ },
      directionLabels: {
        names: ["R", "L", "F", "B", "S", "RR", "RL", "WR", "WL", "WF", "WB", "WS"],
      },
    },
  },
  {
    name: "spells",
    source: "clips/spells/*.swf",
    idFrom: "filename",
    shape: "animated",
    traits: {
      sound: { source: "DoAction.PlaySound" },
      lifecycle: {
        markers: ["stopFrame", "fadingFrame", "requiresTypeScript"],
      },
    },
  },
  {
    // Spell-hotbar icon *glyph* layer — one SWF per spell `info.up` id under
    // clips/spells/icons/up/<id>.swf. Not directly published: the compile
    // stage merges this with the `spells.icons.back` layer + bakes pack
    // colors from the lang bundle, emitting one dofasset per spell_id.
    name: "spells.icons",
    source: "clips/spells/icons/up/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    // Spell-hotbar icon *backdrop* layer (filled circle + frame). Keyed by
    // `info.b` in the lang bundle (not spell id). Consumed only by the
    // compile stage — same note as spells.icons.
    name: "spells.icons.back",
    source: "clips/spells/icons/back/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "tiles.ground",
    source: "clips/gfx/g*.swf",
    idFrom: "symbolName",
    shape: "tile",
    traits: {
      tileBehavior: {
        classificationsPath: "assets/tile-classifications.json",
        overridesPath: "assets/tile-overrides.json",
      },
    },
  },
  {
    name: "tiles.objects",
    source: "clips/gfx/o*.swf",
    idFrom: "symbolName",
    shape: "tile",
    traits: {
      tileBehavior: {
        classificationsPath: "assets/tile-classifications.json",
        overridesPath: "assets/tile-overrides.json",
      },
    },
  },
  {
    name: "items",
    source: "clips/items/*/*.swf",
    idFrom: "parentDirFilename",
    shape: "static",
    traits: {},
  },
  // Artworks / emblems / auras / alignments SWFs carry no AS2 zone markers
  // (verified: 0 GAC.applyColor opcodes across breeds/1, emblems/up/1,
  // emblems/back/1, auras/1, artworks/faces/10 and only unrelated opcodes
  // in artworks/big/10). Dofus 1.29 ships them as fixed-palette static art.
  // They compile as plain static shapes — no tintMode, no zone metadata.
  {
    name: "artworks.big",
    source: "clips/artworks/big/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "artworks.breeds",
    source: "clips/artworks/breeds/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "artworks.breeds.back",
    source: "clips/artworks/breeds/back/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "artworks.breeds.slide",
    source: "clips/artworks/breeds/slide/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "artworks.faces",
    source: "clips/artworks/faces/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "artworks.illu",
    source: "clips/artworks/illu/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "artworks.mini",
    source: "clips/artworks/mini/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "emblems.back",
    source: "clips/emblems/back/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "emblems.up",
    source: "clips/emblems/up/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "emblems.customset",
    source: "clips/emblems/customset/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "emblems.spellareas",
    source: "clips/emblems/spellareas/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "auras",
    source: "clips/auras/*.swf",
    idFrom: "filename",
    shape: "animated",
    traits: {},
  },
  {
    name: "emotes",
    source: "clips/emotes/*.swf",
    idFrom: "filename",
    shape: "animated",
    traits: {},
  },
  {
    name: "smileys",
    source: "clips/smileys/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "smileys.bundle",
    source: "clips/smileys.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: { multiSymbol: { symbolRegex: /^(.+)$/ } },
  },
  {
    name: "alignments",
    source: "clips/alignments/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "alignments.feats",
    source: "clips/alignments/feats/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "challenges",
    source: "clips/challenges/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "jobs",
    source: "clips/jobs/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "extra",
    source: "clips/extra/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "points.0",
    source: "clips/points/0/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "points.1",
    source: "clips/points/1/*.swf",
    idFrom: "filename",
    shape: "static",
    traits: {},
  },
  {
    name: "effectsicons",
    source: "clips/effectsicons.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: { multiSymbol: { symbolRegex: /^(.+)$/ } },
  },
  {
    name: "statesicons",
    source: "clips/statesicons.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: { multiSymbol: { symbolRegex: /^(.+)$/ } },
  },
  {
    name: "demonangel",
    source: "clips/demonangel.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: { multiSymbol: { symbolRegex: /^(.+)$/ } },
  },
  {
    name: "fallenDemonAngel",
    source: "clips/fallenDemonAngel.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: { multiSymbol: { symbolRegex: /^(.+)$/ } },
  },
  {
    name: "gfx.cell",
    source: "clips/gfx/cell.swf",
    idFrom: "symbolName",
    shape: "staticTile",
    traits: {},
  },
  {
    name: "gfx.tactic",
    source: "clips/gfx/tactic.swf",
    idFrom: "symbolName",
    shape: "staticTile",
    traits: {},
  },
  {
    name: "ui.cells",
    source: "clips/cells.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.crafter",
    source: "clips/crafter.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.defaultcc",
    source: "clips/defaultcc.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.flag",
    source: "clips/flag.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.forbidden",
    source: "clips/forbidden.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.gift",
    source: "clips/gift.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.ground",
    source: "clips/ground.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.highlight",
    source: "clips/highlight.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.objects",
    source: "clips/objects.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "ui.ready",
    source: "clips/ready.swf",
    idFrom: "symbolName",
    shape: "static",
    traits: {},
  },
  {
    name: "cinematics",
    source: "clips/cinematics/*.swf",
    idFrom: "filename",
    shape: "animated",
    skip: true,
    traits: {},
  },
  {
    name: "maps",
    source: "clips/maps/*.swf",
    idFrom: "filename",
    shape: "static",
    skip: true,
    traits: {},
  },
];

export const CATEGORIES = CategoryRegistrySchema.parse(raw);

export function categoryByName(name: string) {
  return CATEGORIES.find((c) => c.name === name);
}
