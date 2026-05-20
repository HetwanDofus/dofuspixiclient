# Dofus Web Client

set shell := ["bash", "-cu"]

# Project paths
root := justfile_directory()

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
    cd rust/vello-wasm && wasm-pack build --target web --release

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

# Show current configuration
info:
    @echo "Configuration:"
    @echo "  Root: {{root}}"
