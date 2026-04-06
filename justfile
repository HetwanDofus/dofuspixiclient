# Dofus Web Client

set shell := ["bash", "-cu"]

# Project paths
root := justfile_directory()
assets_exporter := root + "/tools/assets-exporter"
svg_spritesheet := root + "/tools/svg-spritesheet"
tile_classifier := root + "/tools/tile-classifier"
sources := root + "/assets/sources"
tiles_output := root + "/assets/rasters/tiles"
sprites_output := root + "/assets/rasters/sprites"
items_output := root + "/apps/electrobun/public/assets/items"
tiles_spritesheets := root + "/assets/spritesheets/tiles"
sprites_spritesheets := root + "/assets/spritesheets/sprites"
tile_classifications := root + "/assets/tile-classifications.json"

# Rasterized images output (for cross-animation deduplication)
tiles_rasters := root + "/assets/spritesheets/rasters/tiles"
sprites_rasters := root + "/assets/spritesheets/rasters/sprites"

db_user := env_var_or_default("PG_USER", "dofus")
db_pass := env_var_or_default("PG_PASSWORD", "dofus")
db_name := env_var_or_default("PG_DATABASE", "dofus")
db_host := env_var_or_default("PG_HOST", "localhost")
db_port := env_var_or_default("PG_PORT", "5432")

# Maximum parallelism for svg-spritesheet (use all available cores)
parallel := `sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 16`

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
# Asset Pipeline
# =============================================================================

# Full pipeline: extract tiles then generate spritesheets
tiles-spritesheet: extract-tiles generate-tile-spritesheets
    @echo "✓ Tiles spritesheet generation complete"

# Extract tiles from SWF sources to SVG
extract-tiles:
    @echo "Extracting tiles from SWF sources..."
    cd "{{assets_exporter}}" && php bin/extract-tiles --output "{{tiles_output}}"

# Extract tiles with clean (removes existing output first)
extract-tiles-clean:
    @echo "Extracting tiles from SWF sources (clean)..."
    cd "{{assets_exporter}}" && php bin/extract-tiles --output "{{tiles_output}}" --clean

# Generate spritesheets from extracted SVG tiles (ground then objects)
generate-tile-spritesheets: spritesheet-ground spritesheet-objects
    @echo "✓ Tile spritesheets generated"

# Generate ground tiles spritesheet only
spritesheet-ground:
    @echo "Generating ground tiles spritesheet..."
    @mkdir -p "{{tiles_spritesheets}}/ground"
    cd "{{svg_spritesheet}}" && bun run src/cli.ts \
        "{{tiles_output}}/svg/ground" \
        "{{tiles_spritesheets}}/ground" \
        --parallel {{parallel}} \
        --tile-classifications "{{tile_classifications}}" \
        --tile-type ground

# Generate objects tiles spritesheet only
spritesheet-objects:
    @echo "Generating objects tiles spritesheet..."
    @mkdir -p "{{tiles_spritesheets}}/objects"
    cd "{{svg_spritesheet}}" && bun run src/cli.ts \
        "{{tiles_output}}/svg/objects" \
        "{{tiles_spritesheets}}/objects" \
        --parallel {{parallel}} \
        --tile-classifications "{{tile_classifications}}" \
        --tile-type objects

# Open visual gallery to review and classify tiles (auto-saves on each change)
review-tiles:
    @echo "Starting tile classifier gallery..."
    cd "{{tile_classifier}}" && bun run src/cli.ts review \
        "{{tiles_output}}/svg" \
        --classifications "{{tile_classifications}}"

# Show tile classification stats
classify-stats:
    cd "{{tile_classifier}}" && bun run src/cli.ts stats "{{tile_classifications}}"

# Clean all generated output
clean:
    @echo "Cleaning generated tiles, sprites and spritesheets..."
    rm -rf "{{tiles_output}}" "{{tiles_spritesheets}}" "{{sprites_spritesheets}}" "{{tiles_rasters}}" "{{sprites_rasters}}"
    @echo "✓ Cleaned"

# Clean only tile spritesheets (keep extracted tiles)
clean-tile-spritesheets:
    @echo "Cleaning tile spritesheets..."
    rm -rf "{{tiles_spritesheets}}"
    @echo "✓ Cleaned tile spritesheets"

# Clean only sprite spritesheets (keep extracted sprites)
clean-sprite-spritesheets:
    @echo "Cleaning sprite spritesheets..."
    rm -rf "{{sprites_spritesheets}}"
    @echo "✓ Cleaned sprite spritesheets"

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
    @echo "  Root:                 {{root}}"
    @echo "  Assets Exporter:      {{assets_exporter}}"
    @echo "  SVG Spritesheet:      {{svg_spritesheet}}"
    @echo "  Sources:              {{sources}}"
    @echo "  Tiles Output:         {{tiles_output}}"
    @echo "  Sprites Output:       {{sprites_output}}"
    @echo "  Tiles Spritesheets:   {{tiles_spritesheets}}"
    @echo "  Sprites Spritesheets: {{sprites_spritesheets}}"
    @echo "  Tiles Rasters:        {{tiles_rasters}}"
    @echo "  Sprites Rasters:      {{sprites_rasters}}"
    @echo "  Parallel Workers:     {{parallel}}"

# =============================================================================
# Item icons extraction
# =============================================================================

# Extract item icons from SWF sources to SVG
extract-items:
    @echo "Extracting item icons from SWF sources..."
    cd "{{assets_exporter}}" && php bin/extract-items --output "{{items_output}}"

# Extract item icons with clean (removes existing output first)
extract-items-clean:
    @echo "Extracting item icons from SWF sources (clean)..."
    cd "{{assets_exporter}}" && php bin/extract-items --output "{{items_output}}" --clean

# Extract a single item type (e.g., just extract-item-type 1)
extract-item-type type:
    @echo "Extracting item type {{type}}..."
    cd "{{assets_exporter}}" && php bin/extract-items --output "{{items_output}}" --type {{type}}

# =============================================================================
# Sprites spritesheet generation
# =============================================================================

# Full pipeline: extract sprites then generate spritesheets
sprites-spritesheet: extract-sprites generate-sprite-spritesheets
    @echo "✓ Sprites spritesheet generation complete"

# Extract sprites from SWF sources to SVG
extract-sprites:
    @echo "Extracting sprites from SWF sources..."
    cd "{{assets_exporter}}" && php bin/extract-sprites --output "{{sprites_output}}"

# Extract sprites with clean (removes existing output first)
extract-sprites-clean:
    @echo "Extracting sprites from SWF sources (clean)..."
    cd "{{assets_exporter}}" && php bin/extract-sprites --output "{{sprites_output}}" --clean

# Generate spritesheets from extracted SVG sprites (WARNING: takes ~8 hours)
generate-sprite-spritesheets:
    @echo "Generating sprite spritesheets with {{parallel}} parallel workers..."
    @echo "WARNING: This process takes approximately 8 hours to complete"
    @mkdir -p "{{sprites_spritesheets}}"
    cd "{{svg_spritesheet}}" && bun run src/cli.ts \
        "{{sprites_output}}/svg" \
        "{{sprites_spritesheets}}" \
        --parallel {{parallel}}
    @echo "✓ Sprite spritesheets generated"
