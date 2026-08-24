import { ItemSuperType } from "@dofus/protocol";

/**
 * Palette and metrics for the inventory window, sampled off the reference
 * capture `screenshot-ui/inventaire.png`.
 *
 * The capture has no companion "captured at zoom N" note like
 * `spell-book-theme.ts`'s did, so the zoom here is derived instead of
 * given: `Panel`'s title bar is a hardcoded `22` base units
 * (`titleH = Math.round(22 * zoom)`), and the reference window's title
 * bar measures 47px tall (y53→99 in the capture) — so this capture's
 * zoom is `47 / 22 ≈ 2.136`. Every other measurement below is that
 * capture's pixel value divided by the same 2.136, which is why the
 * numbers don't round to anything tidy.
 *
 * The window is a *single* Panel containing three nested boxes, not three
 * separate windows — confirmed by tracing the outer white 3px border in
 * the capture, which runs unbroken around all three (see the exploration
 * notes in the sprint plan). `EQUIP_BOX` and `DETAIL_BOX` share the left
 * column (paperdoll above, item detail below); `RESOURCES_BOX` is the
 * full-height bag browser on the right.
 */

export const INVENTORY_COLORS = {
  /** Panel body — same tan as every other 1.29 window. */
  body: "#d4d0b0",
  /** Title bar — `Panel`'s own default, kept for visual consistency. */
  header: "#514a3c",
  headerText: "#ffffff",
  text: "#4a4437",
  textMuted: "#5d5747",
  /** The three nested dark boxes: equip paperdoll, detail header, resources. */
  boxBg: "#504a3d",
  /** Kamas balance text — cream, sampled off the reference capture; not blue. */
  kamasText: "#edeadf",
  podsTrack: "#d3ceb0",
  podsFill: "#e9702e",
  /** Detail panel: effect list body and its zebra rows. */
  detailBody: "#dad7bb",
  detailRowEven: "#dbd6bb",
  detailRowOdd: "#c6c0a2",
  /** The selected tab, sampled off the reference capture — it is the *light*
   * one, flush with the row list below it; the unselected tab is the dark
   * `boxBg` with white text, which is the way round retail draws them. */
  detailTabActive: "#b3ac91",
  detailTabInactive: "#504a3d",
  /** Detail panel: description box, noticeably lighter than the row list. */
  descBody: "#edebdd",
  /** Resource grid: cell background and its filled/hover variants. */
  gridBg: "#c0bda1",
  gridCell: "#bdbaa0",
  scrollTrack: "#beb99c",
  scrollThumb: "#504a3a",
  positiveText: "#3d7a2a",
  negativeText: "#c0392b",
} as const;

/** Outer Panel size, in base units. */
export const WINDOW_METRICS = {
  width: 502,
  height: 426,
} as const;

/** The paperdoll box — top-left of the window content, below the title bar. */
export const EQUIP_BOX = { x: 6, y: 12, width: 318, height: 191 } as const;

/** The item detail card — directly below `EQUIP_BOX`, same width. */
export const DETAIL_BOX = { x: 8, y: 213, width: 325, height: 184 } as const;

/** The "Ressources" bag browser — full height, right of the other two. */
export const RESOURCES_BOX = {
  x: 347,
  y: 13,
  width: 145,
  height: 385,
} as const;

/**
 * Equipment slot boxes, in coordinates local to `EQUIP_BOX`'s own top-left
 * corner. Keyed by the canonical `EquipmentPosition` value
 * (`packages/protocol/src/item-types.ts`) so a slot can be found directly
 * from `ItemData.position` with no intermediate name lookup.
 *
 * Re-measured by detecting the slot *border* (`#ddd8c9` on `#504a3d`, the
 * outline `equip-slot-fill.svg` itself draws) rather than eyeballing the
 * icon each slot happens to hold — the belt/boots/amulet slots are square,
 * it's their 1.29 icon art that overflows the box in the reference capture.
 */
export const EQUIP_SLOT_BOXES: Record<
  number,
  { x: number; y: number; w: number; h: number }
> = {
  0: { x: 141, y: 24.5, w: 30.9, h: 30.4 }, // AMULET
  1: { x: 205.6, y: 13.3, w: 40.3, h: 40.7 }, // WEAPON
  2: { x: 75.4, y: 66.2, w: 30.4, h: 30 }, // RING_LEFT
  3: { x: 136.3, y: 63.4, w: 40.7, h: 41.7 }, // BELT
  4: { x: 211.2, y: 66.2, w: 30.9, h: 30 }, // RING_RIGHT
  5: { x: 136.3, y: 126.6, w: 40.7, h: 41.2 }, // BOOTS
  6: { x: 273.4, y: 13.3, w: 35.6, h: 35.6 }, // HAT
  7: { x: 273.4, y: 55.4, w: 35.6, h: 35.6 }, // CAPE
  8: { x: 273.4, y: 98, w: 35.6, h: 35.6 }, // PET
  9: { x: 19.7, y: 13.3, w: 25.3, h: 25.3 }, // DOFUS_1
  10: { x: 19.7, y: 41.4, w: 25.3, h: 25.3 }, // DOFUS_2
  11: { x: 19.7, y: 69, w: 25.3, h: 25.3 }, // DOFUS_3
  12: { x: 19.7, y: 97.1, w: 25.3, h: 25.3 }, // DOFUS_4
  13: { x: 19.7, y: 124.7, w: 25.3, h: 25.3 }, // DOFUS_5
  14: { x: 19.7, y: 152.8, w: 25.3, h: 25.3 }, // DOFUS_6
  15: { x: 71.2, y: 13.3, w: 40.7, h: 40.7 }, // SHIELD
  16: { x: 273.4, y: 140.1, w: 35.6, h: 35.6 }, // MOUNT
} as const;

/**
 * Effect ids that carry an empty equipment slot in retail: no label, no
 * per-type icon, just the bare `equip-slot-fill.svg` case. QA-015 asked for
 * a grayed type icon per slot; the reference capture shows retail draws
 * neither — this table existed only because that icon set doesn't exist in
 * the asset pipeline, and it never should have been drawing a substitute.
 */

/** Kamas + pods row, local to `EQUIP_BOX`. */
export const EQUIP_FOOTER = {
  /** Kamas rune icon — not square, ~13×16 in the reference capture. */
  kamasIcon: { x: 83.5, y: 153.5, width: 13, height: 16 },
  kamasTextCenter: { x: 90, y: 173.4 },
  podsLabel: { x: 237, y: 160.7 },
  podsBar: { x: 190, y: 173, width: 75, height: 9 },
} as const;

/** Item detail card, local to `DETAIL_BOX`. */
export const DETAIL_METRICS = {
  headerHeight: 24,
  leftColumnWidth: 95,
  tabsTop: 24,
  tabsHeight: 22,
  /** Tabs are sized to their own label, not to a shared fixed width: in the
   * reference capture "Effets" is 47 units wide and "Conditions" 71, and a
   * single width wide enough for both would leave "Effets" adrift while a
   * width that fits "Effets" spills "Conditions" out of its own tab. */
  tabPaddingX: 11,
  icon: { x: 26, y: 42, w: 44, h: 63 },
  magnifier: { x: 73, y: 108, w: 19, h: 19 },
  rowsTop: 46,
  rowHeight: 27,
  visibleRows: 3,
  /** Top of the description box, from `DETAIL_BOX`'s own top — so the box is
   * `DETAIL_BOX.height - descriptionTop` tall (55 units). Measured in the
   * capture at y 831→949 px, i.e. 129.2→184.4 units. */
  descriptionTop: 129,
  descriptionFontSize: 10,
} as const;

/** Resource bag browser, local to `RESOURCES_BOX`. */
export const RESOURCES_METRICS = {
  titleTop: 6,
  titleHeight: 16,
  filtersTop: 26,
  filterSize: 24,
  filterGap: 2,
  filterColumns: 5,
  dropdownTop: 84,
  dropdownHeight: 18,
  searchSize: 18,
  gridTop: 106.7,
  gridColumns: 4,
  /** Cell edge, in base units. Cells share their border (`grid-cell-bg.svg`
   * already draws it), so there is no gutter between them. */
  cellSize: 33,
  cellGap: 0,
  /** Rows shown before the grid scrolls — `(RESOURCES_BOX.height -
   * gridTop - bottom margin) / cellSize`, same fixed-metric approach as
   * `SPELL_LIST_METRICS.visibleRows`. */
  visibleRows: 8,
  scrollbarWidth: 10.7,
} as const;

const ICON_BASE = "/themes/classic/assets/stats";

/**
 * Maps a `formatEffect().characteristic` id (Ankama's characteristic
 * enum, e.g. wisdom = 12) to its 1.29 icon under `stats/`.
 *
 * These come from `stats/icon-*.svg`, **not** from `stats/effects/
 * effect-<n>-*.svg`. That second set was the one this table used, on the
 * assumption that the number in the filename was the characteristic id;
 * it is not (it looks like a SWF library index), which is how "+2 à la
 * chance" ended up badged with a green head — see QA-082. Checked icon by
 * icon against a 1.29 encyclopedia that renders the retail set: every
 * pairing below is the same drawing, not a resemblance.
 *
 * The mapping is Dofus's own element/characteristic pairing, which is why
 * the same file serves both: Force is earth, Intelligence fire, Chance
 * water, Agility air. `-bonus` is the resistance variant of an element,
 * `-damage` the damage variant (`elementIcon` below).
 *
 * Six characteristics an imported item can carry have **no icon in the
 * repo at all** — 18 coups critiques, 49 soins, 80/17 dommages, 69/70
 * dommages aux pièges, 96 poids portable, 29 énergie. Retail draws them
 * (a blue anvil, a red cross, a lightning bolt, a black gem); the SWF
 * extraction never produced them. They fall through to `null` and the row
 * shows no icon, which is the honest rendering until the assets exist.
 */
const CHARACTERISTIC_ICON: Record<number, string> = {
  1: `${ICON_BASE}/icon-ap.svg`,
  10: `${ICON_BASE}/icon-earth.svg`,
  11: `${ICON_BASE}/icon-vitality.svg`,
  12: `${ICON_BASE}/icon-wisdom.svg`,
  13: `${ICON_BASE}/icon-water.svg`,
  14: `${ICON_BASE}/icon-air.svg`,
  15: `${ICON_BASE}/icon-fire.svg`,
  19: `${ICON_BASE}/icon-range.svg`,
  23: `${ICON_BASE}/icon-mp.svg`,
  26: `${ICON_BASE}/icon-summons.svg`,
  30: `${ICON_BASE}/icon-alignment.svg`,
  44: `${ICON_BASE}/icon-initiative.svg`,
  48: `${ICON_BASE}/icon-prospection.svg`,
  // Resistances, percent (33-37) and flat (83-87). Retail tells the two
  // apart by the badge's outline (hexagon vs square); only one shape was
  // extracted, so both share it.
  33: `${ICON_BASE}/icon-earth-bonus.svg`,
  34: `${ICON_BASE}/icon-fire-bonus.svg`,
  35: `${ICON_BASE}/icon-water-bonus.svg`,
  36: `${ICON_BASE}/icon-air-bonus.svg`,
  37: `${ICON_BASE}/icon-neutral-bonus.svg`,
  83: `${ICON_BASE}/icon-earth-bonus.svg`,
  84: `${ICON_BASE}/icon-fire-bonus.svg`,
  85: `${ICON_BASE}/icon-water-bonus.svg`,
  86: `${ICON_BASE}/icon-air-bonus.svg`,
  87: `${ICON_BASE}/icon-neutral-bonus.svg`,
  // 82 = heal effects (110/143/2171), 99 = the pet "Points de vie" line.
  82: `${ICON_BASE}/icon-hp.svg`,
  99: `${ICON_BASE}/icon-hp.svg`,
};

/**
 * Damage lines ("Dommages : 5 à 8 (feu)") carry characteristic 0 — the
 * bundle puts their element in its own slot instead. Retail badges them
 * with the element's damage variant, so they are keyed off
 * `FormattedEffect.element` rather than the characteristic.
 */
const ELEMENT_ICON: Record<string, string> = {
  neutral: `${ICON_BASE}/icon-neutral-damage.svg`,
  earth: `${ICON_BASE}/icon-earth-damage.svg`,
  fire: `${ICON_BASE}/icon-fire-damage.svg`,
  water: `${ICON_BASE}/icon-water-damage.svg`,
  air: `${ICON_BASE}/icon-air-damage.svg`,
};

/**
 * Icon path for one effect row, or `null` when the repo holds no icon for
 * it. The element is the fallback, not the primary key: a characteristic
 * boost ("+41 à 60 en force") wins over the elemental damage badge even
 * though the bundle gives strength lines an element too.
 */
export function characteristicIcon(
  characteristic: number,
  element?: string | null
): string | null {
  return (
    CHARACTERISTIC_ICON[characteristic] ??
    (element ? (ELEMENT_ICON[element] ?? null) : null)
  );
}

/**
 * Characteristics `ItemDetailPanel` colors green — every real stat/AP/MP/
 * initiative/resistance/… buff ("+20 en sagesse", "+10 en initiative").
 * A blocklist rather than an allowlist: the imported item set touches far
 * more characteristics (44 initiative, 18 critical, 83-87 flat resistance…)
 * than any curated list would name, and the live client confirmed
 * "+10 en initiative" wrongly stayed plain text under an earlier allowlist
 * version of this function.
 *
 * 82 and 99 are the two "life" characteristics (82 = heal effects like
 * 110/143/2171, 99 = the pet "Points de vie" line, effect 800 — now hidden
 * outright by `HIDDEN_EFFECT_IDS` for other reasons). Neither is a
 * permanent characteristic buff, and there's no reference capture with a
 * potion selected to confirm retail's actual color for one — excluding
 * them here is 1.29 convention (green is for stat buffs, not heal/life
 * amounts), not something directly verified.
 */
const NON_STAT_CHARACTERISTICS = new Set([82, 99]);

export function isStatCharacteristic(characteristic: number): boolean {
  return characteristic !== 0 && !NON_STAT_CHARACTERISTICS.has(characteristic);
}

/**
 * Pet husbandry bookkeeping effects (808 "A mangé le", 806 "Corpulence",
 * 807 "Dernier repas") — live feeding state this server doesn't simulate.
 * The template's stored defaults are meaningless noise, not real state, so
 * they're filtered out of the effect list rather than shown. Drop an id
 * from this set once husbandry is implemented for real.
 *
 * 800 ("Points de vie : #3", a pet's current HP) belongs in the same
 * bucket for a different, verified reason: its `param3` — the value the
 * pattern substitutes — is the literal string `"a"` (hex 10) on *every*
 * imported pet template, Chienchien through Wabbit, level 1 through 200.
 * It is not per-pet data at all, just a constant sentinel; decoding it
 * would print "Points de vie : 10" identically on every pet in the game,
 * which is worse than showing nothing. The real number retail shows is
 * computed from the pet's live growth state (corpulence/feeding), same
 * gap as 806-808.
 */
export const HIDDEN_EFFECT_IDS = new Set([800, 806, 807, 808]);

/**
 * Item effect ids that carry no meaningful numeric value — 1.29 shows
 * them as a plain flag line ("Lié au compte") rather than substituting
 * `#1` from `param1`, unlike every stat-boost effect. `formatEffect`
 * always substitutes, so these are special-cased in `ItemDetailPanel`
 * instead of trusting the bundle's pattern for them.
 */
export const FLAG_EFFECT_LABELS: Record<number, string> = {
  983: "Lié au compte",
  2151: "Lié au personnage",
  2154: "Verrouillé au compte",
  2155: "Verrouillé au compte (objet en favoris)",
};

const FILTER_ASSET_BASE = "/themes/classic/assets/panels/inventory";

/**
 * The bag's category filter row. The reference capture shows ten icons;
 * only nine filter SVGs were ever extracted
 * (`assets/panels/inventory/filter-*.svg`), so this is nine, arranged
 * the same 5-then-4 way. Each category is a list of `ItemSuperType`
 * values (`@dofus/protocol`) — `null` means "no filter" (Tous types).
 *
 * The grouping is this project's own call, not a transcription of
 * anything verifiable in the retail data: 1.29's actual category
 * groupings live in client code this repo doesn't have. `equipment`
 * covers everything with a paperdoll slot except pets/mounts, which
 * get their own bucket (`customSet`) for lack of a better one, and
 * `nonEquip` catches the small superTypes with no icon set of their
 * own (documents, roleplay buffs, boost food).
 */
export const FILTER_CATEGORIES: Array<{
  id: string;
  label: string;
  icon: string;
  superTypes: number[] | null;
}> = [
  {
    id: "equipment",
    label: "Équipement",
    icon: `${FILTER_ASSET_BASE}/filter-equipment.svg`,
    superTypes: [
      ItemSuperType.AMULET,
      ItemSuperType.WEAPON,
      ItemSuperType.RING,
      ItemSuperType.BELT,
      ItemSuperType.BOOT,
      ItemSuperType.SHIELD,
      ItemSuperType.HAT,
      ItemSuperType.CAPE,
      ItemSuperType.DOFUS,
    ],
  },
  {
    id: "consumables",
    label: "Consommables",
    icon: `${FILTER_ASSET_BASE}/filter-consumables.svg`,
    superTypes: [ItemSuperType.CONSUMABLE],
  },
  {
    id: "resources",
    label: "Ressources",
    icon: `${FILTER_ASSET_BASE}/filter-resources.svg`,
    superTypes: [ItemSuperType.RESOURCE],
  },
  {
    id: "quest",
    label: "Quête",
    icon: `${FILTER_ASSET_BASE}/filter-quest.svg`,
    superTypes: [ItemSuperType.QUEST],
  },
  {
    id: "souls",
    label: "Pierres d'âme",
    icon: `${FILTER_ASSET_BASE}/filter-souls.svg`,
    superTypes: [ItemSuperType.SOUL],
  },
  {
    id: "runes",
    label: "Runes",
    icon: `${FILTER_ASSET_BASE}/filter-runes.svg`,
    superTypes: [ItemSuperType.RUNE],
  },
  {
    id: "cards",
    label: "Cartes",
    icon: `${FILTER_ASSET_BASE}/filter-cards.svg`,
    superTypes: [ItemSuperType.CARD],
  },
  {
    id: "customSet",
    label: "Familiers & montures",
    icon: `${FILTER_ASSET_BASE}/filter-custom-set.svg`,
    superTypes: [ItemSuperType.PET, ItemSuperType.MOUNT],
  },
  {
    id: "nonEquip",
    label: "Autres",
    icon: `${FILTER_ASSET_BASE}/filter-non-equipment.svg`,
    superTypes: [
      ItemSuperType.DOCUMENT,
      ItemSuperType.BOOST_FOOD,
      ItemSuperType.BENEDICTION,
      ItemSuperType.MALEDICTION,
      ItemSuperType.ROLEPLAY_BUFF,
    ],
  },
];
