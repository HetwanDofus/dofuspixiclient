# Data seeding

## What the migrations do

`apps/gameserver-ts/migrations/` holds 40 Kysely migrations. They create the
schema and seed **static game data**: spell templates and levels (from the
lang bundle, 0039), spell→visual mappings (from
`assets/sources/starloco/sorts.sql`, 0041), breed spell positions, tutorial
content, achievements, item and monster scaffolding.

Run them with `just db-migrate`, inspect with `just db-status`.

## What they deliberately leave empty

Per-deployment tables stay empty, and three of them are load-bearing:

| Table | Consequence when empty |
|---|---|
| `game_servers` | The server list comes back empty — login dead-ends on the server-select screen |
| `accounts` | Nothing to log in as |
| `players` (+ `player_stats`) | The character-select screen is a dead end |
| `maps` | `enter-game: map not found id=10300` — see *Importing the world* below |

**Character creation is not implemented** — there is no create-character
screen in the client and no server feature behind it. Until it exists, the
rows have to be written by hand.

## `just db-seed`

`apps/gameserver-ts/scripts/dev-seed.ts` writes a minimal playable set. It is
idempotent — every row is upserted — and takes optional arguments:

```bash
cd apps/gameserver-ts
bun run scripts/dev-seed.ts [username] [password] [character]   # defaults: dev dev Dev
```

It creates:

- **`game_servers` id 1**, `state = 1`. State must be `1` (online) or the
  server list filters it out.
- **`accounts`**, with `pwd_hash = argon2(PBKDF2(password))` — see the login
  section of [architecture.md](architecture.md). Hashing the plaintext
  password authenticates nothing.
- **`players` + `player_stats` + `player_colors`.** `select-character`
  INNER JOINs `player_stats`, so a character without a stats row is listed but
  cannot be selected.
- **`player_spells`**, copied from `spell_templates`. Migration 0036 does this
  with a cross join, but it runs before any player exists, so a hand-seeded
  character would otherwise have an empty spellbook.
- **`maps` id 10300** — *only if absent*, see below.

### Spawn cell

The schema's default spawn is `map_id = 10300, cell_id = 319`, and **319 is
not walkable on that map**. The seed decodes `maps.cells` (the StarLoco
HASH_CELL payload, via `src/core/modules/maps/maps.cells-codec.ts`) and picks
the first cell that is both active and walkable.

### The placeholder map

If the spawn map has no row at all, the seed inserts a **blank walkable
placeholder** so `enter-game` succeeds, and says so. It is a bare test room —
prefer importing the real world, below. The seed never touches an existing
map row.

## Importing the world

`maps.cells` — the walkability/ground/object payload the server sends on
enter-game — has no in-repo source. StarLoco publishes its full game database,
and its `maps` table carries the same HASH_CELL payload this project decodes:

```bash
curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
just import-maps game.sql
```

That writes 9 358 maps, 265 subareas, 9 358 fight-placement rows and 36 219
neighbour links.

Two things the importer
(`apps/gameserver-ts/scripts/import-starloco-maps.ts`) has to get right:

- **Half the maps are ciphered.** StarLoco stores some `mapData` as plain
  HASH_CELL and some as hex ciphered under the row's `key`. You cannot tell
  them apart by character set — hex digits are valid HASH_CELL characters —
  so the discriminator is length against the expected cell count. Deciphering
  is a port of StarLoco's `CryptManager.decryptMapData`.
- **A Dofus map does not have `width × height × 2` cells.** The grid is a
  diamond: `(height - 1) × (2·width - 1) + width`. A 15×17 map is 479 cells,
  not 510.

Positions, subareas and fight-placement cells are deliberately *not* taken
from the dump: StarLoco targets 1.39.8 while this project targets 1.29, and
the 1.29 truth already ships in the repo as `MA` in
`apps/electrobun/public/assets/langs/fr/maps.json`. The dump's own
`mappos`/`places` are the fallback for maps the lang bundle does not list.
(Both sources agree where they overlap — verified on map 10300.)

Two of the 9 360 rows are skipped: their payload decodes to the wrong cell
count under either interpretation.

### Neighbour links

`map_neighbors` answers "the player just walked off the north side — which map
is that?". Nothing in the schema or the dump fills it, so without it walking
off a map does nothing at all. The importer derives the links from world
coordinates (x grows east, y grows south), with two guards:

- Coordinates only compare inside one superarea — Amakna and Incarnam each
  have their own grid.
- About half of all positions are shared by several maps, because interiors
  stack on the position of their building. One map per position is elected to
  represent it, by **area first, then per-cell ground tiles, then id**.

  Electing on *edge-cell count* looks obvious and is wrong: a small house
  interior whose floor runs to the border of its diamond has more walkable
  edge cells than the street outside it — 48 against 34 at Astrub (2, -18) —
  so walking east off the street teleported the player into the house, where
  there is no edge link back out. Size and ground coverage separate the two
  cleanly: the street is 15x17 with 210 ground tiles, the house 9x12 with 9.

  Better still, run `just import-map-swf <Client/data/maps>` first: it writes
  the retail `maps.outdoor` flag, which settles the election outright and lets
  the importer refuse to link into an interior at all. With it, no neighbour
  link points at an indoor map; the size/ground rule is only the fallback for
  maps it has not covered.

Of the 35 890 links, 27 946 are traversable end to end. 7 442 are inert — the
departure side has no walkable cell on that edge, so nothing ever triggers
them. The remaining 502 have an exit but no walkable landing spot on the far
side; `resolveLandingCell` refuses those and logs a warning, leaving the player
where they stand rather than stranding them.

### Why the viewport can still be empty

A map draws scenery from per-cell ground/object tiles **plus** a single
background image. Nothing in this project populates `maps.background` — not a
migration, not the dump. Maps that relied on the background render as an empty
viewport even though they are fully playable, and the schema's default spawn
(10300, "Pitons rocheux") is one of them.

8 774 of the 9 358 imported maps do have ground tiles. Start on one of those:

```bash
SPAWN_MAP_ID=7365 just db-seed    # Cité d'Astrub
```

The seed warns when the map you picked will render empty.

## Inspecting the database

```bash
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus \
  -c "SELECT count(*) FROM spell_templates"   # 2091
docker exec dofuspixiclient-postgres-1 psql -U dofus -d dofus \
  -c "SELECT id, name, map_id, cell_id FROM players"
```
