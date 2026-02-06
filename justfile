# Spritesheet generation workflow
# Extracts tiles/sprites from SWF sources and generates optimized SVG spritesheets

set shell := ["bash", "-cu"]

# Project paths
root := justfile_directory()
assets_exporter := root + "/tools/assets-exporter"
svg_spritesheet := root + "/tools/svg-spritesheet"
sources := root + "/assets/sources"
tiles_output := root + "/assets/rasters/tiles"
sprites_output := root + "/assets/rasters/sprites"
tiles_spritesheets := root + "/assets/spritesheets/tiles"
sprites_spritesheets := root + "/assets/spritesheets/sprites"

# Rasterized images output (for cross-animation deduplication)
tiles_rasters := root + "/assets/spritesheets/rasters/tiles"
sprites_rasters := root + "/assets/spritesheets/rasters/sprites"

# Maximum parallelism for svg-spritesheet (use all available cores)
parallel := `sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 16`

# Default recipe: run full pipeline
default: tiles-spritesheet

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
        --parallel {{parallel}}

# Generate objects tiles spritesheet only
spritesheet-objects:
    @echo "Generating objects tiles spritesheet..."
    @mkdir -p "{{tiles_spritesheets}}/objects"
    cd "{{svg_spritesheet}}" && bun run src/cli.ts \
        "{{tiles_output}}/svg/objects" \
        "{{tiles_spritesheets}}/objects" \
        --parallel {{parallel}}

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
