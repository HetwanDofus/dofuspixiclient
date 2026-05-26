// GameSession — composition root for the new dofus1-net stack. Plays
// the role the old `GameClient` did for the UI:
//   - Single object the React tree passes around (App → AuthFlow →
//     LoginScreen / ServerSelectScreen / CharacterSelectScreen,
//     App → MapRenderer → HudOverlay).
//   - `connect()` / `login(...)` / `selectServer(...)` /
//     `selectCharacter(...)` drive the bootstrap state machine.
//   - In-game outbound actions (move, fight commands, item ops) hand
//     off to dofus1-net via NetClient.
//
// Subscription wiring is split between bootstrap (`net/bootstrap.ts`,
// auth → game handshake) and the per-opcode handlers
// (`net/handlers/`, drives stores/machines on the running game
// socket). GameSession just owns the lifecycle.

import type {
  GDASegments,
  GMSpriteAdd,
  NeighborSegment,
} from "@dofus/dofus1-net";
import {
  type AH,
  GAOut,
  type GameServerEntry,
  GFOut,
  GIOut,
  GKKOut,
  GpOut,
  GROut,
  GtOut,
} from "@dofus/dofus1-net";
import { DofusPathfinding } from "@dofus/grid";

import type { ServerEntry } from "@/game/machines/login.machine";
import type { Battlefield } from "@/game/scene";
import { loadMap } from "@/game/datacenter/map-loader";
import { loginActor } from "@/game/machines/actors";
import {
  Bootstrap,
  type BootstrapOptions,
  type FightActionEvent,
  NetClient,
  onAdjacentMapsData,
  onFightAction,
  onMovement,
  onPlayerCoords,
  onPositionStart,
  registerAllHandlers,
} from "@/game/net";
import {
  compressPath,
  decompressPath,
  expandFullPath,
} from "@/game/net/path-codec";
import { fightActor } from "@/game/stores/fight-store";
import { setLocalSpriteId } from "@/game/stores/player-store";
import { HoverPreview } from "@/hud/fight/hover-preview";
import { createLogger } from "@/utils/logger";

const log = createLogger("GameSession");

export interface GameSessionConfig {
  authHost: string;
  authPort: number;
  /** Dofus build string sent in the first post-HC frame. Defaults to
   *  `1.29.1` (our protocol generation). AraknemuHorizon's
   *  `config.conf` ships `1.43.7` — change that value or override
   *  here so the two agree. */
  clientVersion?: string;
  /** Locale tag appended to the version frame (`<version>|<lang>`). */
  language?: string;
}

export interface CharacterInfo {
  id: string;
  name: string;
  spriteId: string;
  level: number;
  gfxId: number;
  classId: number;
  sex: number;
  color1: number;
  color2: number;
  color3: number;
}

export class GameSession {
  private readonly client = new NetClient();
  private bootstrap: Bootstrap | null = null;
  private characters: CharacterInfo[] = [];
  private currentCharacter: CharacterInfo | null = null;
  private servers: GameServerEntry[] = [];
  /** Latest AH (host status) snapshot, indexed by server id. Joined
   *  with `servers` (Ax per-account counts) before emitting
   *  SERVERS_RECEIVED to the login machine. */
  private hosts: Map<number, AH["hosts"][number]> = new Map();
  private onConnectedCb: (() => void) | null = null;
  private onDisconnectedCb: (() => void) | null = null;

  constructor(private readonly config: GameSessionConfig) {}

  /** Read-only access to the NetClient for handlers that need to fire
   *  outbound frames directly (e.g. typing into chat). */
  getClient(): NetClient {
    return this.client;
  }

  setOnConnected(fn: () => void): void {
    this.onConnectedCb = fn;
  }
  setOnDisconnected(fn: () => void): void {
    this.onDisconnectedCb = fn;
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  /** Start the handshake against the auth server. Resolves when the
   *  socket is open (HC frame will arrive shortly after). */
  async login(username: string, password: string): Promise<void> {
    if (this.bootstrap) {
      log.warn("login() called while a bootstrap is already running");
      return;
    }
    loginActor.send({ type: "START_LOGIN", username });
    const opts: BootstrapOptions = {
      authHost: this.config.authHost,
      authPort: this.config.authPort,
      login: username,
      password,
      clientVersion: this.config.clientVersion,
      language: this.config.language,
    };
    this.bootstrap = new Bootstrap(this.client, opts);
    this.bootstrap.setEvents({
      onLoginRejected: (reason) => {
        loginActor.send({
          type: "AUTH_FAILURE",
          reason: `${reason.label} ('${reason.char}')`,
        });
      },
      onHosts: (hosts) => {
        this.hosts.clear();
        for (const h of hosts) {
          this.hosts.set(h.id, h);
        }
        // If we already have Ax data, re-emit so the screen sees the
        // updated status without waiting for another Ax push.
        if (this.servers.length > 0) {
          loginActor.send({
            type: "SERVERS_RECEIVED",
            servers: this.joinedServers(),
          });
        }
      },
      onServers: (servers) => {
        this.servers = [...servers];
        loginActor.send({ type: "AUTH_SUCCESS" });
        loginActor.send({
          type: "SERVERS_RECEIVED",
          servers: this.joinedServers(),
        });
      },
      onCharacters: (chars) => {
        this.characters = chars.map(toCharacterInfo);
        loginActor.send({ type: "SERVER_SELECTED" });
        loginActor.send({
          type: "CHARACTERS_RECEIVED",
          characters: chars,
        });
      },
      onCharacterSelected: (as) => {
        this.currentCharacter = {
          id: as.id,
          name: as.name,
          spriteId: as.id,
          level: as.level,
          gfxId: as.gfxId,
          classId: Math.floor(as.gfxId / 10), // canonical 1.29 derivation
          sex: as.sex,
          color1: as.color1,
          color2: as.color2,
          color3: as.color3,
        };
        // Seed playerStore so inbound handlers (registerJoin, etc.)
        // can tag events as "ours". Without this the fight machine's
        // mySpriteId stays null and isMyTurn is unreachable.
        setLocalSpriteId(as.id);
      },
      onGameCreated: () => {
        // GC → roleplay mode is live; flip the login machine to inGame.
        loginActor.send({ type: "CHARACTER_LOADED" });
        this.onConnectedCb?.();
      },
    });

    // Watch for unexpected closes so we can fire the disconnect callback.
    this.client.onClose((info) => {
      if (!info.expected) {
        log.warn(`socket dropped (byPeer=${info.byPeer})`);
        this.onDisconnectedCb?.();
      }
    });

    // Wire the in-game opcode handlers up front. `NetClient` persists
    // subscriptions across reconnects, so registering once here keeps
    // every handler alive through the auth→game pivot. (Handlers that
    // listen for auth-only opcodes simply never fire on the game
    // socket — they cost nothing to leave installed.)
    registerAllHandlers(this.client);

    // Session-level subscriptions that track world state regardless of
    // whether the battlefield is attached. `setBattlefield` replays
    // the cached state on attach so frames that arrived between GC
    // and the battlefield mount aren't lost.
    onMovement({
      onSpriteAdd: (row) => this.onSpriteAddOrReplace(row, "add"),
      onSpriteReplace: (row) => this.onSpriteAddOrReplace(row, "replace"),
      onSpriteRemove: (row) => this.onSpriteRemove(row.spriteId),
    });
    onAdjacentMapsData((segs) => {
      this.lastGda = segs;
      void this.loadMapsAsset(segs);
    });
    onFightAction((e) => this.routeFightAction(e));
    // GIC — server-pushed sprite coordinates (placement swaps, fight
    // teleports). The handler already fans FIGHTER_UPDATE into the
    // fight store; here we (a) refresh `selfCellId` so the next click
    // computes its path from the real anchor and (b) snap the visual
    // sprite to the new cell, since GIC carries no movement path.
    onPlayerCoords((coords) => {
      const bf = this.battlefield;
      for (const { spriteId, cell } of coords) {
        if (spriteId === this.currentCharacter?.spriteId) {
          this.selfCellId = cell;
        }
        const row = this.sprites.get(spriteId);
        if (row) {
          this.sprites.set(spriteId, { ...row, cell });
        }
        const numericId = Number(spriteId);
        if (bf && Number.isFinite(numericId)) {
          bf.teleportWorldActor(numericId, cell);
        }
      }
    });
    // GP — placement cells. Decoded as base64-paired cell ids per
    // canonical `MapHandler.showFightCells` (MapHandler.as:993-1024).
    // FightUI may not exist yet when GP lands (the fightActor flips to
    // `placement` before this handler fires, but FightUI is created on
    // that same transition and we have no ordering guarantee), so we
    // cache the latest packet and replay it on every `enterFightMode`
    // via the fightActor subscription below.
    onPositionStart((info) => {
      const team0 = decodePackedCells(info.team1Cells);
      const team1 = decodePackedCells(info.team2Cells);
      this.lastPlacementCells = { team0, team1 };
      this.paintPlacementCells();
    });
    // Drive placement-cell lifecycle off fightActor transitions:
    //   • placement → paint (replay GP if it was cached pre-FightUI)
    //   • anything else (fighting / spectating / ended / none) →
    //     clear, otherwise the red/blue team tints linger over the
    //     map after the fight actually starts.
    let lastFightValue: unknown = null;
    fightActor.subscribe((snap) => {
      const v = snap.value;
      if (v === lastFightValue) {
        return;
      }
      lastFightValue = v;
      const ui = this.battlefield?.getFightUI();
      if (v === "placement") {
        if (this.lastPlacementCells) {
          this.paintPlacementCells();
        }
      } else {
        ui?.clearPlacementHighlights();
        if (v === "none" || v === "ended") {
          this.lastPlacementCells = null;
        }
      }
    });

    await this.bootstrap.start();
  }

  requestServers(): void {
    // Servers arrive automatically on the auth stream; this is a
    // no-op preserved for compatibility with the old GameClient.
  }

  selectServer(serverId: number): void {
    // Transition the login machine so subsequent `SERVER_SELECTED` /
    // `CHARACTERS_RECEIVED` events advance state properly — without
    // this dispatch loginActor stays in `serverSelect` and silently
    // drops the post-pivot AL-driven transition.
    loginActor.send({ type: "SELECT_SERVER", serverId });
    this.bootstrap?.selectServer(serverId);
  }

  requestCharacters(): void {
    // Triggered automatically by bootstrap after pivot + AT install.
  }

  selectCharacter(characterId: string): void {
    loginActor.send({ type: "SELECT_CHARACTER", characterId });
    this.bootstrap?.selectCharacter(characterId);
  }

  disconnect(): void {
    if (!this.client.isConnected()) {
      return;
    }
    this.client.disconnect({ expected: true });
  }

  destroy(): void {
    this.disconnect();
    this.bootstrap = null;
  }

  // ── In-game outbound actions ────────────────────────────────────
  // Each one wraps the canonical Dofus 1.29 `GA<type><csv>` frame the
  // server expects (`Aks.GameActions:24`). Until the in-game UI is
  // re-wired against this session, these are best-effort stubs.

  /**
   * Walk along a cell path. Canonical Dofus 1.29 wire: GA001 with a
   * single base64-compressed path argument (see `path-codec.ts`).
   * The server validates against MP / occupancy and broadcasts the
   * authoritative `GA;1` back to every player nearby — including us.
   */
  move(path: number[]): void {
    if (!this.client.isConnected() || path.length < 2) {
      log.warn(
        `move dropped: connected=${this.client.isConnected()} len=${path.length}`
      );
      return;
    }
    const mapWidth = this.currentMapWidth ?? 15;
    const compressed = compressPath(path, mapWidth);
    if (compressed.length === 0) {
      log.warn(
        `move dropped: compressPath returned empty for ${path.join(",")}`
      );
      return;
    }
    log.info(`→ GA001 ${compressed} (w=${mapWidth} steps=${path.length - 1})`);
    this.client.send(GAOut, { actionType: 1, args: [compressed] });
  }

  changeMap(mapId: number): void {
    if (!this.client.isConnected()) {
      return;
    }
    this.client.send(GAOut, { actionType: 2, args: [String(mapId)] });
  }

  // ── Fight commands ───────────────────────────────────────────────

  fightReady(): void {
    // Canonical `GR1` toggles "ready" on; placement only.
    this.client.send(GROut, { ready: true });
  }

  /**
   * Send the placement frame. Canonical wire: `Gp<cellNum>`
   * (aks/Game.as:32-35 — `setPlayerPosition`). The lowercase `p`
   * distinguishes this from inbound `GP` (position-start). Server
   * validates the cell is in the player's team set and echoes a
   * `GM` (replace) row carrying the new position.
   */
  fightPlace(cellId: number): void {
    if (!this.client.isConnected()) {
      return;
    }
    log.info(`→ Gp${cellId}`);
    this.client.send(GpOut, { cellId });
  }

  fightPassTurn(): void {
    // Canonical `Gt` (aks/Game.as:68-74 — `turnEnd`). The GA099 frame
    // I shipped previously is a fight-action *animation* slot, not a
    // turn-end signal — server silently ignores it. Real Dofus 1.29
    // sends a 2-byte `Gt` with no payload.
    if (!this.client.isConnected()) {
      return;
    }
    log.info("→ Gt");
    this.client.send(GtOut, {});
  }

  fightForfeit(): void {
    // Canonical `GF` (aks/Game.as:93 — `surrender`). No payload.
    if (!this.client.isConnected()) {
      return;
    }
    log.info("→ GF");
    this.client.send(GFOut, {});
  }

  /** Toggle the spell-cast UI for a specific slot. The actual cast is
   *  fired on cell-click. */
  fightSelectSpell(_spellId: number): void {
    // Pure UI state — the spell-cast machine drives the targeting
    // overlay. See `apps/electrobun/src/game/machines/spell-cast.machine.ts`.
  }

  // ── Item commands ────────────────────────────────────────────────

  moveItem(_unicId: number, _position: number, _quantity = 1): void {
    // TODO(step-5): port `Aks.Items.move(itemId, position, quantity)`.
  }
  useItem(_unicId: number): void {
    // TODO(step-5): port `Aks.Items.use(itemId)`.
  }
  dropItem(_unicId: number, _quantity: number): void {
    // TODO(step-5): port `Aks.Items.drop(itemId, quantity)`.
  }
  destroyItem(_unicId: number, _quantity: number): void {
    // TODO(step-5): port `Aks.Items.destroy(itemId, quantity)`.
  }

  // ── World state (session-owned, persists across battlefield attaches) ──

  private battlefield: Battlefield | null = null;
  /** Live sprite roster — keyed by canonical sprite id string. Updated
   *  by every GM frame; on `setBattlefield` we replay this map so the
   *  battlefield catches up even if frames arrived during the React
   *  mount window. */
  private sprites = new Map<string, GMSpriteAdd>();
  /** Most recent GDA (current map + neighbour descriptors). Replayed on
   *  battlefield attach so the map loader can drive the asset fetch. */
  private lastGda: GDASegments | null = null;
  /** Tracks the local player's last known cell. */
  private selfCellId: number | null = null;
  /** Last-known map width — only meaningful once a map is loaded. */
  private currentMapWidth: number | null = null;
  /** Last GP packet, decoded into cell-id arrays. Cached so we can
   *  replay placement cells onto FightUI when it (re)enters
   *  placement mode — covers the case where GP arrives before FightUI
   *  is created. */
  private lastPlacementCells: { team0: number[]; team1: number[] } | null =
    null;

  /**
   * Resolve the current cell id for a fighter by spriteId. Reads the
   * authoritative cell from the fightStore roster (kept in sync via
   * FIGHTER_UPSERT on GM add and FIGHTER_UPDATE on GTM). Falls back
   * to the cached GMSpriteAdd's cell so off-fight roleplay sprites
   * also resolve.
   */
  private fighterCell(spriteId: string): number | null {
    const fighter = fightActor.getSnapshot().context.fighters.get(spriteId);
    if (fighter && fighter.cell >= 0) {
      return fighter.cell;
    }
    const row = this.sprites.get(spriteId);
    return row && row.cell >= 0 ? row.cell : null;
  }

  private paintPlacementCells(): void {
    const cells = this.lastPlacementCells;
    const ui = this.battlefield?.getFightUI();
    if (!cells || !ui) {
      return;
    }
    ui.showPlacementCells(cells.team0, cells.team1);
  }

  // ── Inbound event side-effects ──────────────────────────────────

  private onSpriteAddOrReplace(row: GMSpriteAdd, op: "add" | "replace"): void {
    if (row.cell < 0) {
      return;
    }
    this.sprites.set(row.spriteId, row);
    if (row.spriteId === this.currentCharacter?.spriteId) {
      this.selfCellId = row.cell;
    }
    // FIGHTER_UPSERT for the fight machine. Without this, the
    // `fighters` map stays empty in fight mode and every consumer
    // that does `fight.fighters.get(spriteId)` resolves to undefined
    // — the TurnChangeBanner returns null, the TurnTimeline shows
    // placeholder names, and HP gauges fall back to characterStore.
    // We always emit; the fight machine guards on its own
    // placement/fighting/spectating substates so off-fight GM rows
    // (regular roleplay) are ignored cheaply.
    upsertFighterFromSpriteRow(row);
    const bf = this.battlefield;
    if (!bf) {
      return;
    }
    if (op === "replace") {
      bf.removeWorldActor(Number(row.spriteId) || 0);
    }
    this.applySpriteAdd(bf, row);
  }

  private onSpriteRemove(spriteId: string): void {
    this.sprites.delete(spriteId);
    this.battlefield?.removeWorldActor(Number(spriteId) || 0);
    fightActor.send({ type: "FIGHTER_REMOVE", spriteId });
  }

  private applySpriteAdd(bf: Battlefield, row: GMSpriteAdd): void {
    const look = `${row.gfxId}|${row.color1}|${row.color2}|${row.color3}|${row.accessories}`;
    void bf.addWorldActor({
      id: Number(row.spriteId) || 0,
      name: row.name,
      cellId: row.cell,
      direction: row.direction,
      look,
      isCurrentPlayer: row.spriteId === this.currentCharacter?.spriteId,
    });
  }

  // ── Battlefield attach ─────────────────────────────────────────

  setBattlefield(bf: Battlefield): void {
    this.battlefield = bf;
    // Replay the latest GDA (if it arrived before the battlefield was
    // attached) so the renderer has terrain + neighbour previews before
    // we start pushing sprites onto it.
    if (this.lastGda) {
      void this.loadMapsAsset(this.lastGda);
    }
    // Replay every sprite we've already heard about so the
    // battlefield catches up to the live world.
    for (const row of this.sprites.values()) {
      this.applySpriteAdd(bf, row);
    }
    // Cell-click router. Behaviour is mode-dependent:
    //
    //   • placement → send `Gp<cell>` (aks/Game.as:32-35). No
    //     pathfinding, no selfCell guard — the server validates the
    //     cell belongs to our team's placement set.
    //   • fighting (myTurn) → path-find + send `GA001` (move). Same
    //     as before.
    //   • everything else → roleplay walk (path-find + `GA001`).
    //
    // Canonical Game.as flips `datacenter.Game.setInteractionType`
    // between "place" / "move" / "spell" / "target" — we model that
    // here as a single switch on fightActor's state.
    bf.setOnCellClick((targetCellId) => {
      const snap = fightActor.getSnapshot();
      const fightValue = snap.value;
      if (fightValue === "placement") {
        log.info(`placement-click cell=${targetCellId}`);
        this.fightPlace(targetCellId);
        return;
      }

      log.info(
        `cell-click target=${targetCellId} self=${this.selfCellId} pf=${bf.getPathfinding() ? "yes" : "no"} map=${bf.getCurrentMapData() ? "yes" : "no"}`
      );
      if (this.selfCellId === null) {
        log.warn("cell click ignored: no known self cell yet");
        return;
      }
      if (targetCellId === this.selfCellId) {
        return;
      }
      const pf = bf.getPathfinding();
      const mapData = bf.getCurrentMapData();
      if (!mapData) {
        log.warn("cell click ignored: no map data loaded yet");
        return;
      }
      if (!pf) {
        log.warn("cell click ignored: no pathfinder");
        return;
      }
      this.currentMapWidth = mapData.width;
      // In combat the server only accepts paths along the four
      // iso-diagonals (canonical Dofus 1.29 — `findFightPath`); the
      // half-step cardinals (0/2/4/6) are roleplay-only and fail
      // server-side validation. Using `findPath` (8-directional)
      // makes the user "only able to walk one cell at a time" because
      // every multi-cell path the A* picks goes through an illegal
      // direction the moment the target isn't perfectly iso-diagonal.
      const fightingNow =
        typeof fightValue === "object" &&
        fightValue !== null &&
        "fighting" in (fightValue as Record<string, unknown>);
      const path = fightingNow
        ? pf.findFightPath(this.selfCellId, targetCellId)
        : pf.findPath(this.selfCellId, targetCellId);
      if (!path || path.length < 2) {
        log.warn(
          `cell click: no path from ${this.selfCellId} → ${targetCellId}`
        );
        return;
      }
      log.info(
        `move ${this.selfCellId} → ${targetCellId} (${path.length - 1} steps, ${fightingNow ? "fight" : "roleplay"}): ${path.join(",")}`
      );
      this.move(path);
    });
    // Hover preview — wires cell-hover → fight UI overlay (move path
    // during myTurn, spell AoE during targeting). One controller per
    // bf attach. The controller registers its own setOnCellHover
    // handler, so subsequent setBattlefield calls overwrite the prior
    // one cleanly.
    // The controller registers itself as bf's hover callback, so
    // bf keeps it alive — no field needed.
    new HoverPreview({
      battlefield: bf,
      fightUI: () => bf.getFightUI(),
      pathfinding: () => bf.getPathfinding(),
      currentCellId: () => this.selfCellId,
      mapDimensions: () => {
        const md = bf.getCurrentMapData();
        return md ? { width: md.width, height: md.height } : null;
      },
      isMoving: () => false,
      occupiedCells: () => new Set<number>(),
      syncOccupied: () => {
        /* TODO: feed fighter cells into pathfinder occupancy set */
      },
      losBlocked: () => false,
    });
    // Replay placement cells if GP arrived before bf was attached.
    if (this.lastPlacementCells) {
      this.paintPlacementCells();
    }
  }

  /**
   * Fetch + decrypt + decode the current map (critical path → render +
   * pathfinder + GI ack), then load the three GDA neighbour maps in the
   * background and push each into its widescreen band.
   *
   * The current map is awaited so the GI ack only fires once terrain is
   * up. Neighbours load via `Promise.allSettled` AFTER the ack so they
   * never delay the player's first interaction; a per-neighbour failure
   * is logged and treated as "no neighbour" (flat-black band).
   *
   * Errors on the current map are logged but never rethrown — the
   * server may push the next GDA before we finish, and we want that to
   * overwrite cleanly.
   */
  private async loadMapsAsset(segs: GDASegments): Promise<void> {
    const cur = segs.current;
    // Map-leave persist: flush the body_scene + accessory scene caches
    // for the outgoing map's actors to IDB before they churn further,
    // so a quick revisit hydrates warm even if the 30 s periodic flush
    // hasn't fired. Throttled (≥15 s) + fire-and-forget so fast
    // map-walking neither blocks the load nor storms IDB.
    void import("@/game/render/vello-loader")
      .then((m) => m.persistAllSceneCachesThrottled())
      .catch(() => {});
    try {
      const mapData = await loadMap(cur.mapId, cur.dateTime, cur.decryptKey);
      this.currentMapWidth = mapData.width;
      const bf = this.battlefield;
      if (!bf) {
        log.debug(`map ${cur.mapId} loaded but no battlefield attached yet`);
        return;
      }
      // Fresh map — drop the stale sprite roster and self anchor.
      // The follow-up GI ack will trigger a new GM stream that
      // repopulates from scratch. Belt-and-suspenders with the
      // GA;2 handler in `routeFightAction` (GA;2 also clears, but
      // zaaps/NPC teleports may skip it).
      this.sprites.clear();
      this.selfCellId = null;
      bf.clearWorldActors();
      await bf.loadMapFromData(mapData);
      // Build the A* pathfinder from the freshly loaded cells so
      // cell-clicks can compute a route. Walkable = `movement > 1`
      // (canonical 1.29 — see Compressor.uncompressCell). Without
      // this, `getPathfinding()` returns null and every click is
      // silently dropped.
      const walkableIds = mapData.cells
        .filter((c) => (c.movement ?? 0) > 1)
        .map((c) => c.id);
      const pf = new DofusPathfinding(
        mapData.width,
        mapData.height,
        walkableIds
      );
      bf.setPathfinding(pf);
      log.info(
        `map ${cur.mapId} rendered (${mapData.cells.length} cells, ${walkableIds.length} walkable)`
      );
      // Canonical Dofus 1.29: once the client finishes painting the
      // terrain it sends `GI` to ask the server for "extra info"
      // (sprite roster + active fights). AraknemuHorizon's
      // `LoadExtraInfo` handler responds with `AddSprites` (GM) then
      // `MapReady` (GDK). Without this ack the server never streams
      // our player sprite.
      this.client.send(GIOut, {});

      // Neighbour previews — non-blocking, after the ack.
      void this.loadNeighborBands(bf, segs);
    } catch (err) {
      log.error(`map load failed for ${cur.mapId}: ${String(err)}`);
    }
  }

  /**
   * Load the left/right/bottom neighbour maps (best-effort, parallel)
   * and push each into its band. Missing segments (server sent `;;`)
   * resolve immediately to a cleared (flat-black) band.
   */
  private async loadNeighborBands(
    bf: Battlefield,
    segs: GDASegments
  ): Promise<void> {
    const sides: Array<{
      side: "left" | "right" | "bottom";
      seg: NeighborSegment | null;
    }> = [
      { side: "left", seg: segs.left },
      { side: "right", seg: segs.right },
      { side: "bottom", seg: segs.bottom },
    ];
    await Promise.allSettled(
      sides.map(async ({ side, seg }) => {
        if (!seg) {
          bf.setNeighborMap(side, null);
          return;
        }
        try {
          const mapData = await loadMap(
            seg.mapId,
            seg.dateTime,
            seg.decryptKey
          );
          // Bail if the battlefield changed underneath us (rapid map
          // walks) — a newer GDA's loadMapsAsset owns the bands now.
          if (this.battlefield !== bf) return;
          bf.setNeighborMap(side, mapData);
        } catch (err) {
          log.warn(
            `neighbour ${side} (map ${seg.mapId}) load failed: ${String(err)}`
          );
          if (this.battlefield === bf) bf.setNeighborMap(side, null);
        }
      })
    );
  }

  /**
   * Route GA-action events that affect the visible battlefield.
   *   - `movement` (1): expand the compressed path and animate the
   *      mover along it.
   *   - `direction-change` (11/764): apply a facing change.
   *   - others: drop here today, owned by the fight HUD / store
   *      subscriptions we already wired.
   */
  private routeFightAction(e: FightActionEvent): void {
    const bf = this.battlefield;
    if (!bf) {
      return;
    }
    if (e.type === "change-map") {
      // Clear sprite roster + battlefield actors so the new map starts
      // empty. The new GDA has typically arrived just before this
      // signal (server order: leave → changeMap (GDA) → GA;2); the
      // fresh GM stream will repopulate sprites in a moment.
      log.info(`change-map (cinematic='${e.cinematic}')`);
      this.sprites.clear();
      this.selfCellId = null;
      bf.clearWorldActors();
      return;
    }
    // ── Damage / stat-change floaters ────────────────────────────
    // FightUI's damage view renders the canonical "−42" / "−2 PA"
    // floaters that travel up from the target's cell. Pre-fix these
    // events were emitted by the GA handler but never consumed —
    // hence "no damage animations". Cell lookup goes through
    // fightStore.fighters (populated by upsertFighterFromSpriteRow
    // on every GM row, then patched by GTM/FIGHTER_UPDATE).
    if (
      e.type === "damage" ||
      e.type === "ap-change" ||
      e.type === "mp-change"
    ) {
      const ui = bf.getFightUI();
      if (!ui) {
        return;
      }
      const targetCell = this.fighterCell(e.targetSpriteId);
      if (targetCell === null) {
        return;
      }
      if (e.type === "damage") {
        // GA 100/108/110 — `amount` is the HP lost (positive). The
        // canonical AS2 paths 100 (damage) and 105 (heal) split the
        // sign for us; since our handler lumps them, treat negative
        // amounts (if any ever arrive) as heal.
        if (e.amount >= 0) {
          ui.showDamageAtCell(targetCell, e.amount, e.element);
        } else {
          ui.showHealAtCell(targetCell, -e.amount);
        }
      } else {
        ui.showStatChangeAtCell(
          targetCell,
          e.delta,
          e.type === "ap-change" ? "AP" : "MP"
        );
      }
      return;
    }
    if (e.type === "death") {
      // Forward as FIGHTER_UPDATE { dead: true } so the timeline
      // greys out the portrait + the world-actor renderer drops the
      // sprite from active-turn rotation. GTM later confirms with
      // explicit hp=0.
      fightActor.send({
        type: "FIGHTER_UPDATE",
        spriteId: e.targetSpriteId,
        patch: { dead: true, hp: 0 },
      });
      return;
    }
    if (e.type === "movement") {
      const mapData = bf.getCurrentMapData();
      if (!mapData) {
        return;
      }
      this.currentMapWidth = mapData.width;
      const cellCount = mapData.cells.length;
      const light = decompressPath(e.path, mapData.width, cellCount);
      if (!light) {
        log.warn(`movement: malformed compressed path '${e.path}'`);
        return;
      }
      const full = expandFullPath(light, mapData.width);
      if (!full || full.length < 2) {
        return;
      }
      // If this is our own sprite, track the new tail cell so the
      // next click computes from the right anchor even before the
      // server pushes a fresh GM frame.
      const isSelf = e.spriteId === this.currentCharacter?.spriteId;
      if (isSelf) {
        this.selfCellId = full[full.length - 1] ?? this.selfCellId;
      }
      const id = Number(e.spriteId) || 0;
      const animation = bf.moveWorldActor(id, full);
      // Canonical `Aks.GameActions.actionAck(id)` — sends `GKK<id>`
      // once the visual move completes. Without it, AraknemuHorizon
      // keeps the player flagged "busy" and replies `GA;0` (NOOP) to
      // every subsequent action. We send it after the move animation
      // resolves (best-effort — if `moveWorldActor` rejects, ack
      // immediately so the player isn't stuck).
      if (isSelf && e.actionId > 0) {
        const ack = (): void => {
          this.client.send(GKKOut, { actionId: e.actionId });
        };
        animation.then(ack, ack);
      }
    }
  }

  getBattlefield(): Battlefield | null {
    return this.battlefield;
  }

  // ── Accessors ────────────────────────────────────────────────────

  getCurrentCharacter(): CharacterInfo | null {
    return this.currentCharacter;
  }
  getServers(): ReadonlyArray<GameServerEntry> {
    return this.servers;
  }

  /** Join Ax per-account char counts with the latest AH host status.
   *  Defaults missing host info to `status=1` (online) so a server
   *  that only appears in Ax is still selectable — the server will
   *  reject the AX request if the host is actually down. */
  private joinedServers(): ServerEntry[] {
    return this.servers.map((s) => {
      const h = this.hosts.get(s.id);
      return {
        id: s.id,
        status: h?.status ?? 1,
        completion: h?.completion ?? 0,
        canCreate: h?.canCreate ?? false,
        charactersWatched: s.charactersWatched,
      };
    });
  }
  getCharacters(): ReadonlyArray<CharacterInfo> {
    return this.characters;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Canonical Dofus 1.29 base64 alphabet — also used by path-codec and
 * map-loader. The placement-cells decoder shifts two chars into a
 * 12-bit cell id (`Compressor.decode64(c1) << 6 | Compressor.decode64(c2)`
 * — MapHandler.as:1011-1023).
 */
const CELL_B64_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const CELL_B64_INDEX = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < CELL_B64_ALPHABET.length; i++) {
    m[CELL_B64_ALPHABET[i] as string] = i;
  }
  return m;
})();

function decodePackedCells(packed: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < packed.length; i += 2) {
    const c1 = packed.charAt(i);
    const c2 = packed.charAt(i + 1);
    const hi = CELL_B64_INDEX[c1] ?? 0;
    const lo = CELL_B64_INDEX[c2] ?? 0;
    out.push((hi << 6) | lo);
  }
  return out;
}

/**
 * Project a GM sprite-add row into a FIGHTER_UPSERT event.
 *
 * Most of FighterSnapshot's fields are unknown until later opcodes
 * arrive (HP/AP/MP land via GTM → FIGHTER_UPDATE; team comes from the
 * fight-row tail we don't yet decode). We seed the minimum the HUD
 * needs to render: name, gfxId, colors, cell, level. HP defaults to
 * 1/1 so divide-by-zero in the timeline's hpFraction math doesn't
 * NaN; the first GTM in combat overwrites with the real values.
 *
 * Off-fight GM rows still emit the event — the fight machine's
 * `FIGHTER_UPSERT` transitions are scoped to placement/fighting/
 * spectating substates, so roleplay rows are no-ops.
 */
function upsertFighterFromSpriteRow(row: GMSpriteAdd): void {
  if (row.kind === "monsterGroup") {
    // Monster groups are aggregated placeholders, not fightable
    // entities. They never enter a fight's `fighters` map.
    return;
  }
  fightActor.send({
    type: "FIGHTER_UPSERT",
    fighter: {
      spriteId: row.spriteId,
      name: row.name,
      level: row.bonusValue,
      team: 0,
      cell: row.cell,
      hp: 1,
      maxHp: 1,
      ap: 0,
      maxAp: 0,
      mp: 0,
      maxMp: 0,
      gfxId: row.gfxId,
      dead: false,
      color1: row.color1,
      color2: row.color2,
      color3: row.color3,
    },
  });
}

function toCharacterInfo(c: {
  id: string;
  name: string;
  level: number;
  gfxId: number;
  color1: number;
  color2: number;
  color3: number;
}): CharacterInfo {
  return {
    id: c.id,
    name: c.name,
    spriteId: c.id,
    level: c.level,
    gfxId: c.gfxId,
    classId: Math.floor(c.gfxId / 10),
    sex: c.gfxId % 10,
    color1: c.color1,
    color2: c.color2,
    color3: c.color3,
  };
}
