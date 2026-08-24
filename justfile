# Dofus Web Client

set shell := ["bash", "-cu"]

# Project paths
root := justfile_directory()
vello_root := env_var_or_default("VELLO_ROOT", justfile_directory() + "/../dofus-vello-custom-format")
pipeline := "cd " + root + "/tools/asset-pipeline && bun run src/cli.ts"

db_user := env_var_or_default("PG_USER", "dofus")
db_pass := env_var_or_default("PG_PASSWORD", "dofus")
db_name := env_var_or_default("PG_DATABASE", "dofus")
db_host := env_var_or_default("PG_HOST", "localhost")
db_port := env_var_or_default("PG_PORT", "5432")

# Show available commands
default:
    @just --list

# =============================================================================
# Setup & Development
# =============================================================================

# Full setup: install deps, create DB, run migrations, build WASM
setup: install db wasm
    @echo "Setup complete."

# Install all JS/TS dependencies
install:
    bun install

# Start PostgreSQL, run migrations, seed a dev account
db: db-up db-migrate db-seed

# Start the PostgreSQL container (creates role + database on first run)
db-up:
    docker compose up -d postgres
    @until docker compose exec -T postgres pg_isready -U {{db_user}} -d {{db_name}} >/dev/null 2>&1; do sleep 1; done
    @echo "Database ready."

# Ouvre un psql sur la base de dev (ou exécute une requête : just psql "select 1").
psql query="":
    @if [ -z "{{query}}" ]; then \
        docker compose exec postgres psql -U {{db_user}} -d {{db_name}}; \
    else \
        docker compose exec -T postgres psql -U {{db_user}} -d {{db_name}} -c "{{query}}"; \
    fi

# Point `assets/dist/langs` at the published lang bundles.
#
# Migration 0039 and the gameserver both read `assets/dist/langs/<locale>/
# <namespace>.json` — the asset-pipeline's *output* directory, which only
# exists after `just pipeline-langs` (and that needs the retail lang SWFs).
# A checkout already carries the published copy under
# `apps/electrobun/public/assets/langs`, so link the two.
langs-link:
    @test -e assets/dist/langs || ( \
        mkdir -p assets/dist && \
        ln -s ../../apps/electrobun/public/assets/langs assets/dist/langs && \
        echo "linked assets/dist/langs -> apps/electrobun/public/assets/langs" )

# Run database migrations
db-migrate: langs-link
    cd apps/gameserver-ts && bun run db:migrate

# Seed one dev account (dev/dev) + one game server row
db-seed:
    cd apps/gameserver-ts && bun run db:seed:dev

# Show which migrations have run
db-status:
    cd apps/gameserver-ts && bun run db:status

# Run this BEFORE `just import-maps`: the neighbour election uses the flag.

# Read map background, outdoor flag, music + ambiance from a retail 1.29 client's map SWFs
import-map-swf maps_dir:
    cd apps/gameserver-ts && bun run scripts/import-map-swf.ts "{{ maps_dir }}"

# Get the dump first:
#   curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql

# Import the world (maps, subareas, fight places) from a StarLoco game.sql
import-maps dump:
    cd apps/gameserver-ts && bun run scripts/import-starloco-maps.ts "{{ if dump =~ '^/' { dump } else { justfile_directory() / dump } }}"

# Needs `import-maps` to have run first: NPC placements reference `maps.id`.

# Import what lives *in* the world: monsters, drops, items, item sets, NPCs
import-content dump:
    cd apps/gameserver-ts && bun run scripts/import-starloco-content.ts "{{ if dump =~ '^/' { dump } else { justfile_directory() / dump } }}"

# The whole world in one go — geometry, then contents.
import-world dump: (import-maps dump) (import-content dump)

# Build the Vello WASM renderer.
# `vello_root` is the sibling checkout of HetwanDofus/vello-dofasset-format —
# its own package.json calls itself `dofus-vello-custom-format`, which is the
# name `apps/electrobun/vite.config.ts` aliases `vello-wasm` to. Override
# VELLO_ROOT if your clone lives elsewhere.
wasm:
    cd {{vello_root}}/packages/vello-wasm && wasm-pack build --target web --release

# The gameserver is three processes, one per terminal: `just gateway`,
# `just gamed`, `just authd`. `just server` is an alias for the gateway.

# Alias for `just gateway` (kept for muscle memory)
server: gateway

# WebSocket gateway (:8080) — dials the authd + gamed sockets
gateway:
    cd apps/gameserver-ts && bun run dev:gateway

# Game core (MODE=game), watch mode
gamed:
    cd apps/gameserver-ts && bun run dev:gamed

# Auth core (MODE=auth), watch mode
authd:
    cd apps/gameserver-ts && bun run dev:authd

# Whole server stack in containers (postgres + migrate + authd + gamed + gateway)
docker-up:
    docker compose up -d --build

docker-down:
    docker compose down

# Start the client (Electrobun dev mode)
client:
    cd apps/electrobun && bun run dev

# Start client with HMR
client-hmr:
    cd apps/electrobun && bun run dev:hmr

# Client in a plain WebGPU browser (Vite dev server on :5173) — no Electrobun
client-web:
    cd apps/electrobun && bun run hmr

# Build everything for production
build:
    bun run build

# =============================================================================
# Asset pipeline — unified entrypoint for every asset category.
# Replaces the old combination of (just sprites-spritesheet | tiles-spritesheet
# | tools/compile-for-web.sh | tools/compile-accessories.sh).
# =============================================================================

# List every registered category + its traits.
pipeline-list:
    @{{pipeline}} list

# Run extract + atlas (when applicable) + compile + publish for a single category.
pipeline-build category='' id='':
    @just _pipeline-build "{{category}}" "{{id}}"

_pipeline-build category id:
    @test -n "{{category}}" || (echo "usage: just pipeline-build <category> [id]"; exit 1)
    @{{pipeline}} run {{category}} {{ if id != "" { "--id " + id } else { "" } }}
    @if [ "{{category}}" = "sprites" ] || [ "{{category}}" = "sprites.chevauchors" ]; then \
        {{pipeline}} atlas {{category}} {{ if id != "" { "--id " + id } else { "" } }} ; \
    fi
    @{{pipeline}} compile {{category}} {{ if id != "" { "--id " + id } else { "" } }}
    @{{pipeline}} publish {{category}}

# Extract all lang SWFs (every namespace × locale).
pipeline-langs:
    @{{pipeline}} langs

# Show or update a single stage.
pipeline-run category id='':
    @{{pipeline}} run {{category}} {{ if id != "" { "--id " + id } else { "" } }}
pipeline-atlas category id='':
    @{{pipeline}} atlas {{category}} {{ if id != "" { "--id " + id } else { "" } }}
pipeline-compile category id='':
    @{{pipeline}} compile {{category}} {{ if id != "" { "--id " + id } else { "" } }}
pipeline-publish category:
    @{{pipeline}} publish {{category}}

# Item icon extraction (items stay as SVGs; no dofasset consumption on runtime).
items-build:
    @{{pipeline}} run items
    @{{pipeline}} publish items

# Tile dofassets — frame-direct compile reads per-frame SVGs from
# `extract-tiles` output; no atlas stage.
tiles-build:
    @{{pipeline}} run tiles.ground
    @{{pipeline}} run tiles.objects
    @{{pipeline}} compile tiles.ground
    @{{pipeline}} compile tiles.objects
    @{{pipeline}} publish tiles.ground
    @{{pipeline}} publish tiles.objects

# Spell dofassets (assumes combat-exporter produced assets/spritesheets/spells/<id>/).
spells-build:
    @{{pipeline}} compile spells
    @{{pipeline}} publish spells

# Tactic-view dofassets (gfx.tactic + gfx.cell) — single-frame SVGs repackaged
# as tile-shaped dofassets so the client's atlas loader can pull them.
tactic-build:
    @{{pipeline}} run gfx.tactic
    @{{pipeline}} run gfx.cell
    @{{pipeline}} compile gfx.tactic
    @{{pipeline}} compile gfx.cell
    @{{pipeline}} publish gfx.tactic
    @{{pipeline}} publish gfx.cell

# Sprites + chevauchors + accessories together — end-to-end from raw SWF
# via frame-direct compile (no atlas intermediary).
sprites-build:
    @{{pipeline}} run sprites
    @{{pipeline}} compile sprites
    @{{pipeline}} publish sprites
    @{{pipeline}} run sprites.chevauchors
    @{{pipeline}} compile sprites.chevauchors
    @{{pipeline}} publish sprites.chevauchors
    @{{pipeline}} run sprites.accessories
    @{{pipeline}} compile sprites.accessories
    @{{pipeline}} publish sprites.accessories

# Fixes the PHP extractor's crop bug on mirrored symbols (QA-080). Idempotent:
# an SVG whose viewBox already contains its drawing is left alone. `--check`
# only reports, and exits 1 if anything is still off.

# Re-crop published SVGs whose drawing falls outside their viewBox
recrop-svg *args:
    @cd "{{root}}" && bun run scripts/recrop-svg-viewbox.ts {{args}}

# Wipe every cache + dist + public/assets spritesheets artifact.
clean-assets:
    rm -rf assets/cache assets/dist
    @echo "✓ Cleaned asset-pipeline caches (assets/cache, assets/dist)"

# =============================================================================
# Suivi des issues
# =============================================================================

# Régénère l'index de doc/issues/README.md depuis les frontmatter.
issues:
    @cd "{{root}}" && bun run scripts/issues.ts

# Valide doc/issues/ sans rien écrire (ids, enums, domaines, liens, index).
issues-check:
    @cd "{{root}}" && bun run scripts/issues.ts --check

# =============================================================================
# UI Builder
# =============================================================================

# Launch the interactive UI panel builder (http://localhost:4200)
ui-builder:
    @echo "Starting UI Builder on http://localhost:4200..."
    cd "{{root}}/tools/ui-builder" && bun run dev

# Show current configuration
info:
    @echo "Configuration:"
    @echo "  Root:       {{root}}"
    @echo "  Vello root: {{vello_root}}"
    @echo "  Pipeline:   {{pipeline}}"
