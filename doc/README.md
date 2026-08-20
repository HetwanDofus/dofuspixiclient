# Documentation

Notes written while getting this repository to run end-to-end on a clean
machine (macOS, August 2026). They document what the project *is*, what it
takes to start it, and where the sharp edges are.

| Document | What it covers |
|---|---|
| [getting-started.md](getting-started.md) | Exact steps from a fresh clone to a character standing in the world |
| [architecture.md](architecture.md) | Processes, packages, and how a message travels client → server → database |
| [assets.md](assets.md) | The `.dofasset` pipeline, the lang bundles, and which inputs the repo does not ship |
| [retail-client.md](retail-client.md) | What a retail 1.29 client holds that nothing else does, and where one is on this machine |
| [audio.md](audio.md) | How per-map music and ambience resolve, from the map SWF to the mp3 |
| [data-seeding.md](data-seeding.md) | What the migrations do and do not seed, and how to hand-write the rows they leave out |
| [troubleshooting.md](troubleshooting.md) | Every failure hit during setup, with the cause and the fix |
| [qa-findings.md](qa-findings.md) | Defects and gaps found while actually playing the game, by severity |

## Current state

Working, verified end-to-end:

- **Server** — gateway + authd + gamed, locally with Bun or as containers.
- **Database** — 40 migrations, 2 091 spells / 10 632 spell levels seeded.
- **Client** — boots in a WebGPU browser, logs in, selects a server and a
  character, enters the world; the Vello WASM renderer initialises with
  zero-copy GPU texture sharing, and the map and HUD render at 72 FPS.
- **The world** — 9 358 maps, 265 subareas and their fight-placement cells,
  imported from a StarLoco dump with `just import-maps`.
- **Audio** — per-map music and ambience, driven by the ids the retail client
  used. See [audio.md](audio.md).
- **Tests** — 181 server unit + 13 integration, 99 client, both typechecks.

Not working, or needing an input the repository does not carry:

- **Everything that lives in a map's own SWF** — fixed, but it needs a retail
  client. Backgrounds, the outdoor flag, the music id and the ambiance id all
  live in `maps/<id>_<date>X.swf`, which is why neither StarLoco nor the lang
  bundles carry them: the original client reads them itself.
  `just import-map-swf <Client/data/maps>` parses the AS2 bytecode of all
  9 209 files and writes all four. Without it, maps render with black gaps
  between their tiles (about 71% of cells carry no per-cell ground tile), the
  neighbour election has to guess which map at a world position is the street
  rather than a house, and the world is silent.

  The same SWFs also hold `capabilities` and the authentic 1.29 `mapData`,
  richer than the 1.39.8 cell payload the StarLoco dump provides. Neither is
  imported — the dump's cells are what the world currently runs on.

- **Rebuilding art from source.** The asset pipeline reads the retail Dofus
  1.29 SWFs, which are not committed. The *outputs* are (5.8 GB under
  `apps/electrobun/public/assets`), so the client runs — you just cannot
  regenerate them.
- **Character creation.** Not implemented: no create-character screen, no
  server feature. Characters are inserted by hand (see
  [data-seeding.md](data-seeding.md)).
- **Version skew.** The world dump is StarLoco 1.39.8 while this project
  targets 1.29. Positions, subareas and fight places are taken from the
  in-repo 1.29 lang bundle instead of the dump for exactly that reason; the
  cell payloads are the dump's. The two agree wherever both have an entry.
