# Dofus Web Client

set shell := ["bash", "-cu"]

# Project paths
root := justfile_directory()
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

# Create database and run migrations
db: db-create db-migrate

# Create PostgreSQL database and user
db-create:
    @echo "Creating database..."
    @psql -h {{db_host}} -p {{db_port}} -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='{{db_user}}'" | grep -q 1 || \
        psql -h {{db_host}} -p {{db_port}} -U postgres -c "CREATE ROLE {{db_user}} WITH LOGIN PASSWORD '{{db_pass}}';"
    @psql -h {{db_host}} -p {{db_port}} -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='{{db_name}}'" | grep -q 1 || \
        psql -h {{db_host}} -p {{db_port}} -U postgres -c "CREATE DATABASE {{db_name}} OWNER {{db_user}};"
    @echo "Database ready."

# Run database migrations
db-migrate:
    cd apps/server && bun run migrate

# Build the Vello WASM renderer
wasm:
    cd ../dofus-vello-custom-format/packages/vello-wasm && wasm-pack build --target web --release

# Start the game server (dev mode with watch)
server:
    cd apps/server && bun run dev

# Start the client (Electrobun dev mode)
client:
    cd apps/electrobun && bun run dev

# Start client with HMR
client-hmr:
    cd apps/electrobun && bun run dev:hmr

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

# Wipe every cache + dist + public/assets spritesheets artifact.
clean-assets:
    rm -rf assets/cache assets/dist
    @echo "✓ Cleaned asset-pipeline caches (assets/cache, assets/dist)"

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
    @echo "  Root:     {{root}}"
    @echo "  Pipeline: {{pipeline}}"
