#!/usr/bin/env bash
#
# Lance tout le jeu en dev dans un seul terminal :
#
#   postgres (docker) → gateway :8080 → gamed + authd (watch) → client Vite :5173
#
# Les logs des quatre processus sont préfixés et colorés, et un Ctrl-C tue tout
# le monde. gamed et authd tournent en `bun --watch` : éditer une slice ne
# redémarre que ce core, le gateway garde les WebSockets ouvertes (c'est tout
# l'intérêt du split, cf. doc/architecture.md).
#
# Usage: scripts/dev.sh [options]
#   --migrate           joue `just db-migrate` avant de démarrer
#   --seed              joue `just db-seed` avant de démarrer (SPAWN_MAP_ID respecté)
#   --no-client         serveur seul, pas de Vite
#   --no-gateway        ne lance pas le gateway (pour le garder à part, avec sa
#                       TUI Ink : `bunx just gateway` dans un autre terminal)
#   --watch-gateway     redémarre aussi le gateway à chaud (coupe les clients)
#   --keep-containers   ne stoppe pas les conteneurs gateway/authd/gamed
#   -h, --help

set -euo pipefail
set -m   # chaque job dans son propre process group, pour pouvoir tuer l'arbre

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_CLIENT=1
WITH_GATEWAY=1
RUN_MIGRATE=0
RUN_SEED=0
WATCH_GATEWAY=0
KEEP_CONTAINERS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --migrate)         RUN_MIGRATE=1 ;;
    --seed)            RUN_SEED=1 ;;
    --no-client)       WITH_CLIENT=0 ;;
    --no-gateway)      WITH_GATEWAY=0 ;;
    --watch-gateway)   WATCH_GATEWAY=1 ;;
    --keep-containers) KEEP_CONTAINERS=1 ;;
    -h|--help)         sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "option inconnue: $1 (voir --help)" >&2; exit 2 ;;
  esac
  shift
done

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
BLUE=$'\033[34m'; MAGENTA=$'\033[35m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; RESET=$'\033[0m'

say()  { printf '%s==>%s %s\n' "$CYAN" "$RESET" "$*"; }
warn() { printf '%s /!\\%s %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%s ✗ %s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

JUST="bunx just"
command -v just >/dev/null 2>&1 && JUST="just"

# --- 1. postgres ------------------------------------------------------------

say "postgres (conteneur)"
docker compose up -d postgres >/dev/null
tries=0
until docker compose exec -T postgres pg_isready -U dofus -d dofus >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -gt 60 ] && die "postgres ne répond pas après 60 s"
  sleep 1
done
say "postgres prêt sur :5432"

# --- 2. libérer le port 8080 -----------------------------------------------

running_containers="$(docker compose ps --services --filter status=running 2>/dev/null | grep -E '^(gateway|authd|gamed)$' || true)"
if [ -n "$running_containers" ]; then
  if [ "$KEEP_CONTAINERS" = "1" ]; then
    warn "conteneurs encore up: $(echo "$running_containers" | tr '\n' ' ')— le gateway local ne pourra pas bind :8080"
  else
    warn "stop des conteneurs serveur (ils tiennent :8080) — \`$JUST docker-up\` pour les relancer"
    docker compose stop gateway authd gamed >/dev/null 2>&1 || true
  fi
fi

# Un run précédent tué sans ménagement (kill -9, terminal fermé, pkill sur le
# script) laisse ses enfants orphelins : ils tiennent toujours leurs ports. On
# récupère les nôtres — reconnus à leur ligne de commande — plutôt que de
# refuser de démarrer. Tout autre process sur le port reste une erreur.
reclaim_port() {
  local port="$1" pattern="$2" label="$3"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -n "$pids" ] || return 0

  for pid in $pids; do
    if ps -o command= -p "$pid" 2>/dev/null | grep -q "$pattern"; then
      warn "$label orphelin d'un run précédent (pid $pid) — je le remplace"
      kill -CONT "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
    else
      die ":$port est pris par un autre process (pid $pid) — \`lsof -nP -iTCP:$port -sTCP:LISTEN\`"
    fi
  done

  local waited=0
  while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
    waited=$((waited + 1))
    [ "$waited" -gt 10 ] && die ":$port toujours occupé après TERM — kill -9 à la main"
    sleep 1
  done
}

if [ "$WITH_GATEWAY" = "1" ]; then
  reclaim_port 8080 "src/gateway/main.ts" "gateway"
fi
if [ "$WITH_CLIENT" = "1" ]; then
  reclaim_port 5173 "vite --port 5173" "client Vite"
fi

# Les cores, eux, ne tiennent aucun port TCP : un orphelin reste vivant sur sa
# socket UDS et continue de tourner dans le vide pendant que le nouveau prend
# la main. À ce stade du script on n'a encore rien démarré, donc tout core qui
# tourne vient forcément d'ailleurs.
stale_cores="$(pgrep -f "bun --watch run src/core/main.ts" 2>/dev/null || true)"
if [ -n "$stale_cores" ]; then
  warn "cores orphelins d'un run précédent (pid $(echo $stale_cores | tr '\n' ' ')) — je les remplace"
  for pid in $stale_cores; do
    kill -CONT "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 1
fi

# Sockets UDS laissées par un run précédent : Bun.listen refuse de binder si le
# fichier existe encore. On ne supprime que ce que personne n'écoute.
for sock in /tmp/dofus-gamed.sock /tmp/dofus-authd.sock; do
  if [ -S "$sock" ] && ! lsof -n "$sock" >/dev/null 2>&1; then
    rm -f "$sock"
  fi
done

# --- 3. migrations / seed optionnels ---------------------------------------

if [ "$RUN_MIGRATE" = "1" ]; then say "migrations"; $JUST db-migrate; fi
if [ "$RUN_SEED" = "1" ]; then say "seed"; $JUST db-seed; fi

# --- 4. les processus -------------------------------------------------------

PIDS=""
NAMES=""

# start <nom> <couleur> <dossier> <commande...>
start() {
  local name="$1" color="$2" dir="$3"
  shift 3
  (
    cd "$ROOT/$dir"
    # stdin sur /dev/null, obligatoire : le gateway lance une TUI Ink quand
    # `process.stdin.isTTY` (src/gateway/cli.tsx), et un process en arrière-plan
    # qui touche au terminal se prend un SIGTTIN — il finit à l'état T, il tient
    # toujours :8080 mais ne répond plus, et le client tourne en "connecting"
    # à l'infini. Sans TTY il saute la TUI et log en clair sur stdout, ce qui
    # est exactement ce qu'on veut ici. Pour la TUI : `just gateway` à part.
    "$@" </dev/null 2>&1 | while IFS= read -r line; do
      printf '%s%-8s%s %s\n' "$color" "$name" "$RESET" "$line"
    done
  ) &
  PIDS="$PIDS $!"
  NAMES="$NAMES $name"
  # sort le job de la table des jobs : bash n'imprimera pas son texte de
  # commande au moment de le tuer. Le process group, lui, reste.
  disown %% 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  echo
  say "arrêt…"
  for pid in $PIDS; do
    # CONT d'abord : un process arrêté (T) ne traiterait jamais le TERM.
    kill -CONT "-$pid" 2>/dev/null || true
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in $PIDS; do
    kill -KILL "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM EXIT

if [ "$WITH_GATEWAY" = "1" ]; then
  if [ "$WATCH_GATEWAY" = "1" ]; then
    start gateway "$GREEN" apps/gameserver-ts bun --watch run src/gateway/main.ts
  else
    start gateway "$GREEN" apps/gameserver-ts bun run src/gateway/main.ts
  fi
fi
start gamed "$BLUE"    apps/gameserver-ts env MODE=game bun --watch run src/core/main.ts
start authd "$MAGENTA" apps/gameserver-ts env MODE=auth bun --watch run src/core/main.ts
if [ "$WITH_CLIENT" = "1" ]; then
  start client "$YELLOW" apps/electrobun bun run hmr
fi

gw_label="gateway :8080 · "
[ "$WITH_GATEWAY" = "1" ] || gw_label="(gateway à part) "
cl_label="client http://localhost:5173"
[ "$WITH_CLIENT" = "1" ] || cl_label="pas de client"
say "${gw_label}gamed · authd · ${cl_label}"
printf '%s    login dev / dev — Ctrl-C pour tout arrêter%s\n' "$DIM" "$RESET"

# Si l'un des quatre meurt, on arrête tout le reste plutôt que de laisser un
# demi-serveur en vie.
while :; do
  set -- $PIDS
  i=1
  for name in $NAMES; do
    eval "pid=\${$i}"
    if ! kill -0 "$pid" 2>/dev/null; then
      warn "$name s'est arrêté"
      exit 1
    fi
    # Filet de sécurité : un process suspendu (état T) garde ses ports mais ne
    # répond plus — c'est le symptôme d'un process qui a voulu lire le terminal
    # depuis l'arrière-plan. Mieux vaut le dire que laisser tourner à vide.
    case "$(ps -o stat= -p "$pid" 2>/dev/null)" in
      T*) warn "$name est suspendu (SIGTTIN/SIGTTOU) — il tient ses ports sans répondre"; exit 1 ;;
    esac
    i=$((i + 1))
  done
  sleep 2
done
