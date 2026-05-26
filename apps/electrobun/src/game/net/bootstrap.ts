// `Bootstrap` drives the auth → game handshake top-to-bottom.
//
//   connect(auth)              connect(game)
//        │                          │
//        ▼                          ▼
//      HC →                       HG →
//      Af (creds)                 AT (ticket)
//      Al ─ ok=false ──► reject   AT (in) ─ keyId>0 → install + Ak
//      Al ─ ok=true ───► AK in    AT (in) ─ keyId=0 → useKey(0)
//      install key + Ak                                │
//      AH/Aq/Af/AR/Ac/Ad/AV (carry through)            ▼
//      Ax ──► SERVERS_LIST                            sendRaw("AL")
//             ▼                                       AL ──► CHARACTERS
//             selectServer(id) → AX (out)                    ▼
//             AX/AY (in) → save ip/port/ticket               selectCharacter(id) → AS (out)
//             client.disconnect({ expected: true })          AS (in) → emit CHARACTER_SELECTED
//             close({expected}) → connect(game)              sendRaw("GC1")
//                                                            GC (in) → emit GAME_CREATED

import {
  Ac,
  Ad,
  Af,
  AH,
  AK,
  AkOut,
  AL,
  Al,
  Aq,
  AR,
  AS,
  ASOut,
  As,
  AT,
  ATOut,
  AV,
  AX,
  AXOut,
  Ax,
  AY,
  buildLoginFrame,
  type CharacterEntry,
  type GameServerEntry,
  GC,
  HC,
  HG,
  Im,
  ServerMessage,
} from "@dofus/dofus1-net";

import { createLogger } from "@/utils/logger";

import type { NetClient } from "./client";

const log = createLogger("net.bootstrap");

export interface BootstrapOptions {
  authHost: string;
  authPort: number;
  login: string;
  password: string;
  /**
   * Dofus build string the server checks for compatibility. Canonical
   * 1.29 wire: `<major>.<minor>.<patch>` optionally followed by an
   * `e`/`s` build-letter suffix and a `|<lang>` locale tag.
   *
   * AraknemuHorizon (`config.conf`) is hard-coded to `1.43.7` by
   * default — adjust there or here so they match. Defaults to `1.29.1`
   * because that's the protocol generation this client targets.
   */
  clientVersion?: string;
  /** Locale tag appended to the version frame (`<version>|<lang>`). */
  language?: string;
}

export interface QueueInfo {
  position: number;
  total: number;
  isSubscriber: boolean;
}

export interface SessionContext {
  hashKey: string | null;
  serverId: number | null;
  ticket: string | null;
  gameHost: string | null;
  gamePort: number | null;
  selectedCharacterId: string | null;
  regionalVersion: number | null;
  communityId: number | null;
  pseudo: string | null;
  restrictions: number | null;
  selfId: string | null;
}

export interface LoginRejection {
  /** Single wire char emitted by the server (e.g. 'a','k','s'). */
  char: string;
  /** Canonical AS2 label — "ALREADY_LOGGED", "KICKED", … */
  label: string;
  /** Hex decode of `char` when applicable, else -1. */
  code: number | undefined;
}

export interface BootstrapEvents {
  onLoginRejected?: (reason: LoginRejection) => void;
  onServerSelectError?: (code: string) => void;
  onQueue?: (info: QueueInfo) => void;
  onServers?: (servers: GameServerEntry[]) => void;
  onHosts?: (hosts: AH["hosts"]) => void;
  onCharacters?: (chars: CharacterEntry[], subscriberFlag: number) => void;
  onCharacterSelected?: (char: AS) => void;
  onCharacterStats?: (stats: As) => void;
  onGameCreated?: (gc: GC) => void;
  onServerMessage?: (msg: ServerMessage) => void;
  onInfo?: (msg: Im) => void;
}

export class Bootstrap {
  readonly ctx: SessionContext = {
    hashKey: null,
    serverId: null,
    ticket: null,
    gameHost: null,
    gamePort: null,
    selectedCharacterId: null,
    regionalVersion: null,
    communityId: null,
    pseudo: null,
    restrictions: null,
    selfId: null,
  };
  private events: BootstrapEvents = {};
  /** Idempotency guard — AraknemuHorizon emits AH once at login and
   *  again on host status changes. We only want to fire the initial
   *  `Ax` request the first time. */
  private askedServerList = false;

  constructor(
    readonly client: NetClient,
    private readonly opts: BootstrapOptions
  ) {}

  setEvents(events: BootstrapEvents): void {
    this.events = events;
  }

  /** Begin the handshake: connect → HC → buildLoginFrame. */
  async start(): Promise<void> {
    // Cross-stage close hook — fires for both auth and game sockets.
    // Pivot is the only "expected" intermediate close; everything else
    // surfaces to the caller as a disconnect event via the NetClient.
    this.client.onClose((info) => {
      if (info.expected && this.client.getStage() === "pivoting") {
        void this.connectGame();
      }
    });
    this.wireAuthSubscriptions();
    this.wireSharedSubscriptions();
    this.client.setStage("auth-connecting");
    await this.client.connect({
      host: this.opts.authHost,
      port: this.opts.authPort,
    });
    // The Bun socket is open; we now wait for HC from the server.
  }

  selectServer(serverId: number): void {
    this.ctx.serverId = serverId;
    this.client.setStage("server-selecting");
    this.client.send(AXOut, { serverId });
  }

  selectCharacter(characterId: string): void {
    this.ctx.selectedCharacterId = characterId;
    this.client.setStage("loading-character");
    this.client.send(ASOut, { characterId });
  }

  disconnect(): void {
    this.client.disconnect({ expected: true });
    this.client.setStage("disconnected");
  }

  /** Subscriptions installed on the *auth* connection only. */
  private wireAuthSubscriptions(): void {
    this.client.on(HC, (hc) => {
      log.info(`HC hashKey=${hc.hashKey.length} chars`);
      this.ctx.hashKey = hc.hashKey;
      this.client.setStage("authenticating");
      // Canonical Dofus 1.29 sends TWO frames after HC, in this order
      // (Account.as#logon L39+):
      //   1. `<version>|<lang>` — the realm middleware's "indexed"
      //      first packet (AraknemuHorizon RealmPacketParserMiddleware).
      //      Server replies `AlEv<expected>` if mismatched, then closes.
      //   2. `<login>\n#1<vigenere>` — credentials, parsed positionally
      //      as the second indexed packet.
      const version = this.opts.clientVersion ?? "1.29.1";
      const lang = this.opts.language ?? "en";
      this.client.sendRaw(`${version}|${lang}`);
      const frame = buildLoginFrame({
        login: this.opts.login,
        password: this.opts.password,
        connexionKey: hc.hashKey,
      });
      this.client.sendRaw(frame);
    });

    this.client.on(Al, (al) => {
      if (!al.ok) {
        log.warn(
          `Al rejected '${al.errorChar}' (${al.errorLabel}) code=${al.code ?? "?"}`
        );
        this.events.onLoginRejected?.({
          char: al.errorChar,
          label: al.errorLabel,
          code: al.code,
        });
        this.client.disconnect({ expected: true });
        this.client.setStage("disconnected");
        return;
      }
      log.info(`Al ok flags=${al.flags ?? 0}`);
    });

    this.client.on(AK, (ak) => {
      log.info(`AK install keyId=${ak.keyId}`);
      this.client.crypto.setKey(ak.keyId, ak.keyHex);
      this.client.crypto.useKey(ak.keyId);
      this.client.send(AkOut, { keyId: ak.keyId });
    });

    this.client.on(AH, (ah) => {
      log.info(`AH hosts=${ah.hosts.length}`);
      this.events.onHosts?.(ah.hosts);
      // AraknemuHorizon's `AbstractRealmAuthenticationResponse` emits
      // `HostList` as the LAST frame of the post-login auth response
      // (Ad → Ac → AlK → Question → AH). The canonical 1.29 client
      // requests the per-account server roster (`Ax`) immediately
      // after — `aks.Account.getServersList()` in Account.as:83. Fire
      // it automatically so the login flow doesn't stall here.
      if (!this.askedServerList) {
        this.askedServerList = true;
        log.info("requesting server list (Ax)");
        this.client.sendRaw("Ax");
      }
    });

    this.client.on(Aq, (aq) => {
      this.client.setStage("queued");
      this.events.onQueue?.({
        position: aq.position,
        total: aq.position,
        isSubscriber: false,
      });
    });

    this.client.on(Af, (af) => {
      this.client.setStage("queued");
      this.events.onQueue?.({
        position: af.position,
        total: af.totalSubscriber + af.totalNonSubscriber,
        isSubscriber: af.isSubscriber,
      });
    });

    this.client.on(AR, (ar) => {
      this.ctx.restrictions = ar.restrictions;
    });
    this.client.on(Ac, (ac) => {
      this.ctx.communityId = ac.communityId;
    });
    this.client.on(Ad, (ad) => {
      this.ctx.pseudo = ad.pseudo;
    });
    this.client.on(AV, (av) => {
      this.ctx.regionalVersion = av.version;
    });

    this.client.on(Ax, (ax) => {
      log.info(`Ax servers=${ax.servers.length}`);
      this.events.onServers?.(ax.servers);
    });

    // Server selection result — packed IP+port+ticket on success;
    // `AXE<char>` on failure (server full, can't-select, …).
    this.client.on(AX, (ax) => {
      if (!ax.ok) {
        log.warn(`AX rejected code='${ax.errorCode}'`);
        this.events.onServerSelectError?.(ax.errorCode);
        return;
      }
      log.info(`AX → game ${ax.ip}:${ax.port} ticket=${ax.ticket.length}c`);
      this.ctx.gameHost = ax.ip;
      this.ctx.gamePort = ax.port;
      this.ctx.ticket = ax.ticket;
      this.startPivot();
    });
    // Text variant — same contract.
    this.client.on(AY, (ay) => {
      log.info(`AY → game ${ay.ip}:${ay.port} ticket=${ay.ticket.length}c`);
      this.ctx.gameHost = ay.ip;
      this.ctx.gamePort = ay.port;
      this.ctx.ticket = ay.ticket;
      this.startPivot();
    });
  }

  /** Subscriptions installed on whichever connection is currently up. */
  private wireSharedSubscriptions(): void {
    this.client.on(ServerMessage, (m) => this.events.onServerMessage?.(m));
    this.client.on(Im, (m) => this.events.onInfo?.(m));
  }

  /** AX/AY received — close auth socket, then connect to the game host. */
  private startPivot(): void {
    this.client.setStage("pivoting");
    this.client.disconnect({ expected: true });
  }

  private async connectGame(): Promise<void> {
    if (!this.ctx.gameHost || !this.ctx.gamePort || !this.ctx.ticket) {
      log.error("connectGame: missing pivot context");
      return;
    }
    this.client.setStage("game-connecting");

    // Drop auth-side keys before we reconnect — the game socket starts
    // un-encrypted and installs a fresh key via AT.
    this.client.crypto.reset();

    await this.client.connect({
      host: this.ctx.gameHost,
      port: this.ctx.gamePort,
    });

    // Subscriptions must be installed AFTER `connect()` rebinds the
    // inner Client, otherwise they bind to the disposed auth instance.
    this.wireGameSubscriptions();
    this.wireSharedSubscriptions();
  }

  private wireGameSubscriptions(): void {
    this.client.on(HG, (hg) => {
      log.info(`HG ${hg.info}`);
      this.client.setStage("game-authenticating");
      this.client.send(ATOut, { ticket: this.ctx.ticket ?? "" });
    });

    this.client.on(AT, (at) => {
      log.info(`AT keyId=${at.keyId}`);
      if (at.keyId > 0) {
        this.client.crypto.setKey(at.keyId, at.keyHex);
        this.client.crypto.useKey(at.keyId);
        this.client.send(AkOut, { keyId: at.keyId });
      } else if (at.keyId === 0) {
        this.client.crypto.useKey(0);
      }
      // Once the game socket is fully encrypted (or confirmed plain),
      // request the character list.
      this.client.setStage("characters-list");
      this.client.sendRaw("AL");
    });

    this.client.on(AL, (al) => {
      log.info(`AL characters=${al.characters.length}`);
      this.events.onCharacters?.(al.characters, al.subscriberFlag);
    });

    this.client.on(AS, (as) => {
      log.info(`AS selected id=${as.id} name=${as.name}`);
      this.ctx.selfId = as.id;
      this.events.onCharacterSelected?.(as);
      // Canonical Aks.Account.onCharacterSelected → Game.create()
      // immediately fires `GC1` to ask the server to spin up the
      // roleplay session (TYPE_SOLO=1, see aks/Game.as:6).
      this.client.sendRaw("GC1");
    });

    this.client.on(As, (st) => {
      this.events.onCharacterStats?.(st);
    });

    this.client.on(GC, (gc) => {
      log.info(`GC gameType=${gc.gameType}`);
      this.client.setStage("in-game");
      this.events.onGameCreated?.(gc);
    });
  }
}
