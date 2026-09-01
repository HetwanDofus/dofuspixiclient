// Hand-maintained Kysely schema — keep in sync with apps/gameserver/db/migrations.
// Names use camelCase; the CamelCasePlugin translates to/from snake_case.
// `Generated<T>` is reserved for columns the DB produces on its own: identity
// (SERIAL/BIGSERIAL), `DEFAULT now()`, `DEFAULT gen_random_uuid()`. Plain
// defaults stay required on insert.

import type {
  ColumnType,
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from "kysely";

type TimestampTz = ColumnType<Date, Date | string, Date | string>;
type Json = unknown;

/**
 * i18n.translations — server-owned localised strings. See migration
 * 0038_i18n_translations.ts. The asset pipeline's `langs:server-sync` step
 * upserts rows for every (namespace, entry_key, locale) tuple in the
 * SERVER_NAMESPACES whitelist.
 */
export interface I18nTranslationsTable {
  namespace: string;
  entryKey: string;
  locale: string;
  value: string;
  updatedAt: Generated<TimestampTz>;
}
export type I18nTranslationRow = Selectable<I18nTranslationsTable>;
export type I18nTranslationInsert = Insertable<I18nTranslationsTable>;
export type I18nTranslationUpdate = Updateable<I18nTranslationsTable>;

export interface AccountsTable {
  id: Generated<string>;
  username: string;
  pwdHash: string;
  pseudo: string;
  community: Generated<number>;
  isAdmin: Generated<boolean>;
  isBanned: Generated<boolean>;
  question: Generated<string>;
  answer: Generated<string>;
  createdAt: Generated<TimestampTz>;
  lastLoginAt: TimestampTz | null;
  lastLoginIp: string | null;
  bannedUntil: TimestampTz | null;
  banReason: string | null;
}

export type AccountRow = Selectable<AccountsTable>;
export type NewAccount = Insertable<AccountsTable>;
export type AccountUpdate = Updateable<AccountsTable>;

export interface GameServersTable {
  id: number;
  name: string;
  address: string;
  port: number;
  state: number;
  community: number;
  maxPlayers: number;
  onlinePlayers: number;
  lastHeartbeat: Generated<TimestampTz>;
  acceptsMigration: boolean;
}

export type GameServerRow = Selectable<GameServersTable>;
export type NewGameServer = Insertable<GameServersTable>;
export type GameServerUpdate = Updateable<GameServersTable>;

export interface AccountServersTable {
  accountId: string;
  serverId: number;
  characterCount: number;
}

export type AccountServerRow = Selectable<AccountServersTable>;
export type NewAccountServer = Insertable<AccountServersTable>;
export type AccountServerUpdate = Updateable<AccountServersTable>;

export interface AuthTicketsTable {
  ticket: string;
  accountId: string;
  gameServerId: number;
  issuedAt: Generated<TimestampTz>;
  expiresAt: TimestampTz;
  usedAt: TimestampTz | null;
}

export type AuthTicketRow = Selectable<AuthTicketsTable>;
export type NewAuthTicket = Insertable<AuthTicketsTable>;
export type AuthTicketUpdate = Updateable<AuthTicketsTable>;

export interface PlayersTable {
  id: Generated<string>;
  accountId: string;
  serverId: number;
  name: string;
  sex: number;
  class: number;
  gfx: number;
  // Everything below carries a database default (migrations 0001, 0022,
  // 0024): a freshly created character sets only what makes it *that*
  // character and lets the schema answer for the rest.
  level: Generated<number>;
  experience: Generated<string>;
  kamas: Generated<string>;
  statsPoints: Generated<number>;
  spellPoints: Generated<number>;
  life: Generated<number>;
  energy: Generated<number>;
  mapId: Generated<number>;
  cellId: Generated<number>;
  direction: Generated<number>;
  savepointMapId: Generated<number>;
  savepointCellId: Generated<number>;
  channels: Generated<number>;
  alignment: Generated<number>;
  alignmentValue: Generated<number>;
  alignmentGrade: Generated<number>;
  pvpEnabled: Generated<boolean>;
  restrictions: Generated<string>;
  createdAt: Generated<TimestampTz>;
  deletedAt: TimestampTz | null;
  mmr: Generated<number>;
  koliseumPoints: Generated<number>;
  activeTitleId: Generated<number>;
  mountXpShare: Generated<number>;
  /**
   * When `life` was last exact. Out-of-combat regeneration derives the
   * points regained from this instant rather than from a timer, so it
   * also applies to time spent logged out. NULL means never measured.
   */
  lifeUpdatedAt: TimestampTz | null;
}

export type PlayerRow = Selectable<PlayersTable>;
export type NewPlayer = Insertable<PlayersTable>;
export type PlayerUpdate = Updateable<PlayersTable>;

export interface PlayerStatsTable {
  playerId: string;
  strength: Generated<number>;
  vitality: Generated<number>;
  wisdom: Generated<number>;
  intelligence: Generated<number>;
  chance: Generated<number>;
  agility: Generated<number>;
}

export type PlayerStatsRow = Selectable<PlayerStatsTable>;
export type NewPlayerStats = Insertable<PlayerStatsTable>;
export type PlayerStatsUpdate = Updateable<PlayerStatsTable>;

export interface PlayerColorsTable {
  playerId: string;
  color1: Generated<number>;
  color2: Generated<number>;
  color3: Generated<number>;
}

export type PlayerColorsRow = Selectable<PlayerColorsTable>;
export type NewPlayerColors = Insertable<PlayerColorsTable>;
export type PlayerColorsUpdate = Updateable<PlayerColorsTable>;

export interface PlayerSpellsTable {
  playerId: string;
  spellId: number;
  level: number;
  position: number;
}

export type PlayerSpellRow = Selectable<PlayerSpellsTable>;
export type NewPlayerSpell = Insertable<PlayerSpellsTable>;
export type PlayerSpellUpdate = Updateable<PlayerSpellsTable>;

/**
 * Every item instance in the world, whoever holds it.
 *
 * `owner_kind` + `owner_id` is what makes an exchange a single `UPDATE`
 * instead of a DELETE here and an INSERT there — see migration 0053 and
 * `items/item-owner.ts` for the kinds. `id` is the guid the protocol
 * carries as `ItemData.unic_id`, and it survives a whole-stack move.
 *
 * `effectsHash` is generated by the database (`md5(effects::text)`) and
 * exists only to key the partial unique index that makes two identical
 * stacks in one container unrepresentable. Never write it.
 */
export interface ItemsTable {
  id: Generated<string>;
  ownerKind: number;
  ownerId: string;
  templateId: number;
  position: number;
  quantity: number;
  effects: Json;
  effectsHash: ColumnType<string, never, never>;
}

export type ItemRow = Selectable<ItemsTable>;
export type NewItem = Insertable<ItemsTable>;
export type ItemUpdate = Updateable<ItemsTable>;

/**
 * One line per item or kamas movement, written inside the transaction
 * that performed it. `itemId` is deliberately not a foreign key: a stack
 * merged into another is deleted, and the record of where it went has to
 * outlive it.
 */
export interface ItemLedgerTable {
  id: Generated<string>;
  at: Generated<TimestampTz>;
  txId: string;
  actorCharacterId: string | null;
  itemId: string | null;
  templateId: number | null;
  quantity: number;
  kamas: string;
  fromKind: number;
  fromId: string;
  toKind: number;
  toId: string;
  exchangeKind: number | null;
  exchangeSessionId: string | null;
}

export type ItemLedgerRow = Selectable<ItemLedgerTable>;
export type NewItemLedgerEntry = Insertable<ItemLedgerTable>;

export interface PlayerMountTable {
  playerId: string;
  mountTemplateId: number | null;
  level: number;
  experience: string;
  energy: number;
  name: string;
}

export type PlayerMountRow = Selectable<PlayerMountTable>;
export type NewPlayerMount = Insertable<PlayerMountTable>;
export type PlayerMountUpdate = Updateable<PlayerMountTable>;

export interface SubareasTable {
  id: number;
  areaId: number;
  name: string;
  conquestable: boolean;
  alignment: number;
  prismId: number;
}

export type SubareaRow = Selectable<SubareasTable>;
export type NewSubarea = Insertable<SubareasTable>;
export type SubareaUpdate = Updateable<SubareasTable>;

export interface MapsTable {
  id: number;
  date: string;
  key: string;
  width: number;
  height: number;
  cells: Buffer;
  subareaId: number | null;
  x: number;
  y: number;
  superarea: number;
  background: number;
  /** Authentic retail flag; NULL until `import-map-swf` has covered the map. */
  outdoor: boolean | null;
  /** `audio` lang bundle indices — AUM[musicId] / AUA[ambianceId]. */
  musicId: number | null;
  ambianceId: number | null;
  mapData: string;
  capabilities: number;
  numgroup: number;
  mobSizeMin: number;
  mobSizeMax: number;
  mobFixSize: number;
  forbidden: string;
  monstersRaw: string;
}

export type MapRow = Selectable<MapsTable>;
export type NewMap = Insertable<MapsTable>;
export type MapUpdate = Updateable<MapsTable>;

export interface MapNeighborsTable {
  mapId: number;
  direction: number;
  neighborMapId: number;
}

export type MapNeighborRow = Selectable<MapNeighborsTable>;
export type NewMapNeighbor = Insertable<MapNeighborsTable>;
export type MapNeighborUpdate = Updateable<MapNeighborsTable>;

export interface MapFightPlacesTable {
  mapId: number;
  places0: string;
  places1: string;
}

export type MapFightPlacesRow = Selectable<MapFightPlacesTable>;
export type NewMapFightPlaces = Insertable<MapFightPlacesTable>;
export type MapFightPlacesUpdate = Updateable<MapFightPlacesTable>;

export interface ScriptedNpcsTable {
  id: Generated<string>;
  mapId: number;
  cellId: number;
  templateId: number;
  direction: number;
  /** Whether this placement walks its template's `path`. See migration 0052. */
  isMovable: ColumnType<boolean, boolean | undefined, boolean>;
}

export type ScriptedNpcRow = Selectable<ScriptedNpcsTable>;
export type NewScriptedNpc = Insertable<ScriptedNpcsTable>;
export type ScriptedNpcUpdate = Updateable<ScriptedNpcsTable>;

export interface ItemTemplatesTable {
  id: number;
  name: string;
  type: number;
  level: number;
  weight: number;
  gfxId: number;
  effects: Json;
  criteria: string;
  twoHanded: boolean;
  itemSetId: number;
  usable: boolean;
  targetable: boolean;
  price: number;
  superType: number;
  category: number;
  sellPrice: number;
  maxPerTarget: number;
  description: string;
  /** `items.json`'s `an`; roleplay default is `anim3`. */
  animationId: number;
}

export type ItemTemplateRow = Selectable<ItemTemplatesTable>;
export type NewItemTemplate = Insertable<ItemTemplatesTable>;
export type ItemTemplateUpdate = Updateable<ItemTemplatesTable>;

export interface ItemSetsTable {
  id: number;
  name: string;
  bonuses: Json;
}

export type ItemSetRow = Selectable<ItemSetsTable>;
export type NewItemSet = Insertable<ItemSetsTable>;
export type ItemSetUpdate = Updateable<ItemSetsTable>;

/** An item *type* (Amulette, Epée, …) — `items.json`'s `I.t`. */
export interface ItemTypesTable {
  id: number;
  name: string;
  superType: number;
  effectZone: string | null;
}

export type ItemTypeRow = Selectable<ItemTypesTable>;
export type NewItemType = Insertable<ItemTypesTable>;
export type ItemTypeUpdate = Updateable<ItemTypesTable>;

/**
 * superType → legal equipment positions — `items.json`'s `I.ss`. An empty
 * array means the superType is not equippable at all (resources, quest
 * objects, souls, …).
 */
export interface ItemSuperTypesTable {
  id: number;
  positions: number[];
}

export type ItemSuperTypeRow = Selectable<ItemSuperTypesTable>;
export type NewItemSuperType = Insertable<ItemSuperTypesTable>;
export type ItemSuperTypeUpdate = Updateable<ItemSuperTypesTable>;

export interface SpellTemplatesTable {
  id: number;
  name: string;
  sprite: number;
}

export type SpellTemplateRow = Selectable<SpellTemplatesTable>;
export type NewSpellTemplate = Insertable<SpellTemplatesTable>;
export type SpellTemplateUpdate = Updateable<SpellTemplatesTable>;

export interface SpellLevelsTable {
  spellId: number;
  level: number;
  effects: Json;
  criticalEffects: Json;
  apCost: number;
  rangeMin: number;
  rangeMax: number;
  criticalRate: number;
  failureRate: number;
  lineOfSight: boolean;
  emptyCell: boolean;
  modifiableRange: boolean;
  castPerTurn: number;
  castPerTarget: number;
  cooldown: number;
  lineOnly: boolean;
  /**
   * SWF/dofasset filename the client should load to render this spell
   * (StarLoco's `sorts.sprite`; Hetwan's GA;300 `visual` field).
   * Often differs from `spellId` — many gameplay spells share the same
   * gfx file. Defaults to `spellId` when seeded from the lang JSON;
   * canonical values come from the StarLoco `sorts` import.
   */
  visualGfxId: number | null;
  /**
   * Character level required to own this spell level. Display-only for
   * the spell book ("Niveau requis") and the gate the spell-upgrade
   * handler checks; the cast path never reads it. Seeded from the lang
   * bundle by migration 0045.
   */
  minPlayerLevel: number;
  /** "EC fini le tour" — a critical failure ends the caster's turn. */
  critFailureEndsTurn: boolean;
}

export type SpellLevelRow = Selectable<SpellLevelsTable>;
export type NewSpellLevel = Insertable<SpellLevelsTable>;
export type SpellLevelUpdate = Updateable<SpellLevelsTable>;

export interface MonsterAiProfilesTable {
  id: number;
  name: string;
  config: Json;
}

export type MonsterAiProfileRow = Selectable<MonsterAiProfilesTable>;
export type NewMonsterAiProfile = Insertable<MonsterAiProfilesTable>;
export type MonsterAiProfileUpdate = Updateable<MonsterAiProfilesTable>;

export interface MonsterTemplatesTable {
  id: number;
  name: string;
  gfx: number;
  aiProfileId: number | null;
  color1: number;
  color2: number;
  color3: number;
}

export type MonsterTemplateRow = Selectable<MonsterTemplatesTable>;
export type NewMonsterTemplate = Insertable<MonsterTemplatesTable>;
export type MonsterTemplateUpdate = Updateable<MonsterTemplatesTable>;

export interface MonsterLevelsTable {
  monsterId: number;
  level: number;
  life: number;
  initiative: number;
  ap: number;
  mp: number;
  stats: Json;
  resistances: Json;
  spells: Json;
  xp: string;
  kamasMin: number;
  kamasMax: number;
}

export type MonsterLevelRow = Selectable<MonsterLevelsTable>;
export type NewMonsterLevel = Insertable<MonsterLevelsTable>;
export type MonsterLevelUpdate = Updateable<MonsterLevelsTable>;

export interface MonsterGroupsTable {
  id: Generated<string>;
  mapId: number;
  cellId: number;
  sizeMin: number;
  sizeMax: number;
  members: Json;
  respawnSeconds: number;
  fixedMembers: boolean;
}

export type MonsterGroupRow = Selectable<MonsterGroupsTable>;
export type NewMonsterGroup = Insertable<MonsterGroupsTable>;
export type MonsterGroupUpdate = Updateable<MonsterGroupsTable>;

export interface MonsterDropsTable {
  monsterId: number;
  itemTemplateId: number;
  rate: number;
  minQuantity: number;
  maxQuantity: number;
}

export type MonsterDropRow = Selectable<MonsterDropsTable>;
export type NewMonsterDrop = Insertable<MonsterDropsTable>;
export type MonsterDropUpdate = Updateable<MonsterDropsTable>;

export interface FightHistoryTable {
  id: Generated<string>;
  type: number;
  mapId: number;
  startedAt: TimestampTz;
  endedAt: TimestampTz;
  winnerTeam: number;
  durationMs: number;
}

export type FightHistoryRow = Selectable<FightHistoryTable>;
export type NewFightHistory = Insertable<FightHistoryTable>;
export type FightHistoryUpdate = Updateable<FightHistoryTable>;

export interface FightParticipantsTable {
  fightId: string;
  playerId: string | null;
  monsterId: number | null;
  team: number;
  xpGained: string;
  kamasGained: string;
  dead: boolean;
  leftFight: boolean;
}

export type FightParticipantRow = Selectable<FightParticipantsTable>;
export type NewFightParticipant = Insertable<FightParticipantsTable>;
export type FightParticipantUpdate = Updateable<FightParticipantsTable>;

export interface NpcTemplatesTable {
  id: number;
  name: string;
  gfx: number;
  sex: number;
  color1: number;
  color2: number;
  color3: number;
  accessories: string;
  extraClip: number;
  customArtwork: number;
  initialQuestion: number;
  saleStoreId: number;
  /** Sprite scale as a percentage — 100 is life size. See migration 0051. */
  scaleX: ColumnType<number, number | undefined, number>;
  scaleY: ColumnType<number, number | undefined, number>;
  /**
   * Patrol route, `;`-separated `<H|B|G|D><cells>` steps (`"G2;B1"`). Only
   * read for placements flagged `isMovable`. See migration 0052.
   */
  path: ColumnType<string, string | undefined, string>;
}

export type NpcTemplateRow = Selectable<NpcTemplatesTable>;
export type NewNpcTemplate = Insertable<NpcTemplatesTable>;
export type NpcTemplateUpdate = Updateable<NpcTemplatesTable>;

/**
 * One node of an NPC dialog tree. The id doubles as the key into the `dialog`
 * lang bundle (`D.q[id]`), which is where the text lives — see migration 0052.
 */
export interface NpcDialogQuestionsTable {
  /** Answer ids, in the order the dump lists them; that is display order. */
  responseIds: Json;
  /** `#N` substitution values for the bundle text. Only 16 questions use them. */
  parameters: Json;
  id: number;
  /** Imported, not evaluated yet. See migration 0052. */
  cond: string;
  ifFalse: number;
}

export type NpcDialogQuestionRow = Selectable<NpcDialogQuestionsTable>;
export type NewNpcDialogQuestion = Insertable<NpcDialogQuestionsTable>;
export type NpcDialogQuestionUpdate = Updateable<NpcDialogQuestionsTable>;

/**
 * What picking an answer does. Keyed `(responseId, type)` like the dump —
 * 181 answers carry several actions, so this is deliberately not one row per
 * answer. Type 1 is 92% of the table: `args` is either the next question id
 * or the literal `DV`, meaning "end the conversation".
 */
export interface NpcDialogResponseActionsTable {
  responseId: number;
  type: number;
  args: string;
}

export type NpcDialogResponseActionRow =
  Selectable<NpcDialogResponseActionsTable>;
export type NewNpcDialogResponseAction =
  Insertable<NpcDialogResponseActionsTable>;
export type NpcDialogResponseActionUpdate =
  Updateable<NpcDialogResponseActionsTable>;

export interface WaypointsTable {
  id: Generated<string>;
  mapId: number;
  cellId: number;
  kind: number;
  costKamas: number;
  subAreaId: number | null;
}

export type WaypointRow = Selectable<WaypointsTable>;
export type NewWaypoint = Insertable<WaypointsTable>;
export type WaypointUpdate = Updateable<WaypointsTable>;

export interface WaypointKnownTable {
  playerId: string;
  waypointId: string;
  discoveredAt: Generated<TimestampTz>;
}

export type WaypointKnownRow = Selectable<WaypointKnownTable>;
export type NewWaypointKnown = Insertable<WaypointKnownTable>;
export type WaypointKnownUpdate = Updateable<WaypointKnownTable>;

/**
 * One hotbar item shortcut. Keyed by template, not by stack — see
 * `migrations/0050_hotbar_shortcuts.ts`. Spell slots are not here: they
 * live in `player_spells.position`.
 */
export interface PlayerItemShortcutsTable {
  playerId: string;
  /** 1-based, 1..42 (3 pages of 14). */
  slot: number;
  templateId: number;
}

export type PlayerItemShortcutRow = Selectable<PlayerItemShortcutsTable>;
export type NewPlayerItemShortcut = Insertable<PlayerItemShortcutsTable>;
export type PlayerItemShortcutUpdate = Updateable<PlayerItemShortcutsTable>;

export interface PlayerSoulStonesTable {
  itemId: string;
  captured: Json;
}

export type PlayerSoulStoneRow = Selectable<PlayerSoulStonesTable>;
export type NewPlayerSoulStone = Insertable<PlayerSoulStonesTable>;
export type PlayerSoulStoneUpdate = Updateable<PlayerSoulStonesTable>;

export interface LivingObjectsTable {
  itemId: string;
  level: number;
  experience: string;
  mood: number;
  skin: number;
  id: Generated<string> | null;
  xp: string;
  hunger: number;
  evolutionAge: number;
  bornAt: Generated<TimestampTz>;
}

export type LivingObjectRow = Selectable<LivingObjectsTable>;
export type NewLivingObject = Insertable<LivingObjectsTable>;
export type LivingObjectUpdate = Updateable<LivingObjectsTable>;

export interface LivingObjectTemplatesTable {
  id: number;
  name: string;
  foodItemIds: Json;
  bonusPerLevel: Json;
  evolutionThresholds: Json;
}

export type LivingObjectTemplateRow = Selectable<LivingObjectTemplatesTable>;
export type NewLivingObjectTemplate = Insertable<LivingObjectTemplatesTable>;
export type LivingObjectTemplateUpdate = Updateable<LivingObjectTemplatesTable>;

/**
 * The spell progression of a breed: which spells it owns and the player
 * level each one is learned at (`learn_level = 1` is a starter spell).
 * Seeded from the 1.29 lang bundles by migration 0048, which replaced
 * the starters-only `class_starter_spells`.
 */
export interface ClassSpellsTable {
  classId: number;
  spellId: number;
  learnLevel: number;
  position: number;
}

export type ClassSpellRow = Selectable<ClassSpellsTable>;
export type NewClassSpell = Insertable<ClassSpellsTable>;
export type ClassSpellUpdate = Updateable<ClassSpellsTable>;

export interface SpellCooldownsTable {
  playerId: string;
  spellId: number;
  availableAtTurn: number;
  persistent: boolean;
}

export type SpellCooldownRow = Selectable<SpellCooldownsTable>;
export type NewSpellCooldown = Insertable<SpellCooldownsTable>;
export type SpellCooldownUpdate = Updateable<SpellCooldownsTable>;

export interface ChatSubscriptionsTable {
  playerId: string;
  channel: string;
}

export type ChatSubscriptionRow = Selectable<ChatSubscriptionsTable>;
export type NewChatSubscription = Insertable<ChatSubscriptionsTable>;
export type ChatSubscriptionUpdate = Updateable<ChatSubscriptionsTable>;

export interface ModReportsTable {
  id: Generated<string>;
  reporterId: string | null;
  targetId: string | null;
  type: number;
  state: number;
  details: string;
  createdAt: Generated<TimestampTz>;
  handledBy: string | null;
  handledAt: TimestampTz | null;
}

export type ModReportRow = Selectable<ModReportsTable>;
export type NewModReport = Insertable<ModReportsTable>;
export type ModReportUpdate = Updateable<ModReportsTable>;

export interface BugReportsTable {
  id: Generated<string>;
  reporterId: string | null;
  category: number;
  body: string;
  createdAt: Generated<TimestampTz>;
}

export type BugReportRow = Selectable<BugReportsTable>;
export type NewBugReport = Insertable<BugReportsTable>;
export type BugReportUpdate = Updateable<BugReportsTable>;

export interface SurveysTable {
  id: number;
  question: string;
  options: Json;
  active: boolean;
  createdAt: Generated<TimestampTz>;
}

export type SurveyRow = Selectable<SurveysTable>;
export type NewSurvey = Insertable<SurveysTable>;
export type SurveyUpdate = Updateable<SurveysTable>;

export interface SurveyResponsesTable {
  surveyId: number;
  accountId: string;
  answer: number;
  submittedAt: Generated<TimestampTz>;
}

export type SurveyResponseRow = Selectable<SurveyResponsesTable>;
export type NewSurveyResponse = Insertable<SurveyResponsesTable>;
export type SurveyResponseUpdate = Updateable<SurveyResponsesTable>;

export interface FriendsTable {
  accountId: string;
  friendId: string;
  addedAt: Generated<TimestampTz>;
}

export type FriendRow = Selectable<FriendsTable>;
export type NewFriend = Insertable<FriendsTable>;
export type FriendUpdate = Updateable<FriendsTable>;

export interface EnemiesTable {
  accountId: string;
  enemyId: string;
  addedAt: Generated<TimestampTz>;
}

export type EnemyRow = Selectable<EnemiesTable>;
export type NewEnemy = Insertable<EnemiesTable>;
export type EnemyUpdate = Updateable<EnemiesTable>;

export interface GuildsTable {
  id: Generated<string>;
  serverId: number;
  name: string;
  emblem: Json;
  level: number;
  experience: string;
  bankKamas: string;
  founderId: string | null;
  createdAt: Generated<TimestampTz>;
}

export type GuildRow = Selectable<GuildsTable>;
export type NewGuild = Insertable<GuildsTable>;
export type GuildUpdate = Updateable<GuildsTable>;

export interface GuildMembersTable {
  guildId: string;
  playerId: string;
  rank: number;
  rights: string;
  xpShare: number;
  joinedAt: Generated<TimestampTz>;
}

export type GuildMemberRow = Selectable<GuildMembersTable>;
export type NewGuildMember = Insertable<GuildMembersTable>;
export type GuildMemberUpdate = Updateable<GuildMembersTable>;

export interface GuildRanksTable {
  guildId: string;
  rankId: number;
  name: string;
}

export type GuildRankRow = Selectable<GuildRanksTable>;
export type NewGuildRank = Insertable<GuildRanksTable>;
export type GuildRankUpdate = Updateable<GuildRanksTable>;

export interface GuildTaxCollectorsTable {
  id: Generated<string>;
  guildId: string;
  mapId: number;
  cellId: number;
  kamas: string;
  items: Json;
  spawnedAt: Generated<TimestampTz>;
  n1: number;
  n2: number;
  xpAccumulated: string;
}

export type GuildTaxCollectorRow = Selectable<GuildTaxCollectorsTable>;
export type NewGuildTaxCollector = Insertable<GuildTaxCollectorsTable>;
export type GuildTaxCollectorUpdate = Updateable<GuildTaxCollectorsTable>;

/**
 * Kamas held by a container — a bank, a house chest, later a stall or a
 * tax collector. Keyed exactly like `items`, and for the same reason:
 * one more kind of container is one more row, not one more table.
 */
export interface ContainerKamasTable {
  ownerKind: number;
  ownerId: string;
  kamas: string;
}

export type ContainerKamasRow = Selectable<ContainerKamasTable>;
export type NewContainerKamas = Insertable<ContainerKamasTable>;
export type ContainerKamasUpdate = Updateable<ContainerKamasTable>;

/**
 * One auction lot on sale.
 *
 * The stock itself is **not** here: it is the single `items` row owned
 * by `(OwnerKind.BigStore, this.id)`. A sold or withdrawn listing is
 * deleted, and `item_ledger` is the record of what happened to it.
 */
export interface BigStoreListingsTable {
  id: Generated<string>;
  hdvId: number;
  sellerId: string;
  /** The slot cap and the delivery of proceeds are both per account. */
  sellerAccountId: string;
  templateId: number;
  /** 1, 10 or 100. A unitary item is always a lot of 1. */
  lotSize: number;
  price: string;
  postedAt: Generated<TimestampTz>;
  expiresAt: TimestampTz;
}

export type BigStoreListingRow = Selectable<BigStoreListingsTable>;
export type NewBigStoreListing = Insertable<BigStoreListingsTable>;
export type BigStoreListingUpdate = Updateable<BigStoreListingsTable>;

export interface RecipesTable {
  resultItemId: number;
  skillId: number;
  skillLevel: number;
  ingredients: Json;
}

export type RecipeRow = Selectable<RecipesTable>;
export type NewRecipe = Insertable<RecipesTable>;
export type RecipeUpdate = Updateable<RecipesTable>;

export interface MountsTable {
  id: Generated<string>;
  playerId: string | null;
  name: string;
  modelId: number;
  sex: number;
  level: number;
  experience: string;
  energy: number;
  maturity: number;
  serenity: number;
  stamina: number;
  love: number;
  fecundity: number;
  pregnantUntil: TimestampTz | null;
  sterilized: boolean;
  color1: number;
  color2: number;
  color3: number;
  capacities: Json;
  lastFedAt: Generated<TimestampTz>;
  bornAt: Generated<TimestampTz>;
  reproductionCount: number;
}

export type MountRow = Selectable<MountsTable>;
export type NewMount = Insertable<MountsTable>;
export type MountUpdate = Updateable<MountsTable>;

export interface MountAncestorsTable {
  mountId: string;
  ancestorId: string;
  generation: number;
}

export type MountAncestorRow = Selectable<MountAncestorsTable>;
export type NewMountAncestor = Insertable<MountAncestorsTable>;
export type MountAncestorUpdate = Updateable<MountAncestorsTable>;

export interface MountPaddocksTable {
  mapId: number;
  cellId: number;
  guildId: string | null;
  mountId: string | null;
}

export type MountPaddockRow = Selectable<MountPaddocksTable>;
export type NewMountPaddock = Insertable<MountPaddocksTable>;
export type MountPaddockUpdate = Updateable<MountPaddocksTable>;

export interface MountPaddockDataTable {
  mapId: number;
  ownerId: string | null;
  guildId: string | null;
  size: number;
  price: string;
  priceBase: string;
  placeOfSpawn: number;
  doorCell: number;
  anchorCell: number;
  maxObject: number;
  allowedCells: number[];
  allowedObjectIds: number[];
  updatedAt: Generated<TimestampTz>;
}

export type MountPaddockDataRow = Selectable<MountPaddockDataTable>;
export type NewMountPaddockData = Insertable<MountPaddockDataTable>;
export type MountPaddockDataUpdate = Updateable<MountPaddockDataTable>;

export interface MountBreedingLogTable {
  id: Generated<string>;
  playerId: string;
  sireId: string;
  damId: string;
  childId: string;
  offspring: number;
  bredAt: Generated<TimestampTz>;
}

export type MountBreedingLogRow = Selectable<MountBreedingLogTable>;
export type NewMountBreedingLog = Insertable<MountBreedingLogTable>;
export type MountBreedingLogUpdate = Updateable<MountBreedingLogTable>;

export interface HousesTable {
  id: Generated<string>;
  mapId: number;
  cellId: number;
  price: string;
  ownerId: string | null;
  guildId: string | null;
  locked: boolean;
  lockCode: string;
  doors: Json;
  purchasedAt: TimestampTz | null;
  /** Interior map the door opens onto, and the cell the player lands on. */
  entryMapId: number | null;
  entryCellId: number | null;
  /** Every map that belongs to this house — ground floor plus upper floors. */
  interiorMapIds: Json;
}

export type HouseRow = Selectable<HousesTable>;
export type NewHouse = Insertable<HousesTable>;
export type HouseUpdate = Updateable<HousesTable>;

/** One row per clickable door cell; 40 houses have more than one. */
export interface HouseDoorsTable {
  mapId: number;
  cellId: number;
  houseId: string;
}

export type HouseDoorRow = Selectable<HouseDoorsTable>;
export type NewHouseDoor = Insertable<HouseDoorsTable>;
export type HouseDoorUpdate = Updateable<HouseDoorsTable>;

export interface PrismsTable {
  id: Generated<string>;
  subareaId: number;
  mapId: number;
  cellId: number;
  alignment: number;
  level: number;
  hp: number;
  maxHp: number;
  state: number;
  vulnerableAt: TimestampTz | null;
  lastAttackedAt: TimestampTz | null;
  placedAt: Generated<TimestampTz>;
}

export type PrismRow = Selectable<PrismsTable>;
export type NewPrism = Insertable<PrismsTable>;
export type PrismUpdate = Updateable<PrismsTable>;

export interface PrismModulesTable {
  prismId: string;
  slot: number;
  moduleId: number;
}

export type PrismModuleRow = Selectable<PrismModulesTable>;
export type NewPrismModule = Insertable<PrismModulesTable>;
export type PrismModuleUpdate = Updateable<PrismModulesTable>;

export interface AlignmentBalanceTable {
  serverId: number;
  bontarianPlayers: number;
  brakmarianPlayers: number;
  neutralityIndex: number;
  updatedAt: Generated<TimestampTz>;
}

export type AlignmentBalanceRow = Selectable<AlignmentBalanceTable>;
export type NewAlignmentBalance = Insertable<AlignmentBalanceTable>;
export type AlignmentBalanceUpdate = Updateable<AlignmentBalanceTable>;

export interface PlayerAlignmentLedgerTable {
  id: Generated<string>;
  playerId: string;
  deltaHonor: number;
  deltaDisgrace: number;
  reason: number;
  fightId: string | null;
  at: Generated<TimestampTz>;
}

export type PlayerAlignmentLedgerRow = Selectable<PlayerAlignmentLedgerTable>;
export type NewPlayerAlignmentLedger = Insertable<PlayerAlignmentLedgerTable>;
export type PlayerAlignmentLedgerUpdate =
  Updateable<PlayerAlignmentLedgerTable>;

export interface JobsTable {
  id: number;
  name: string;
  maxLevel: number;
  /** `J[id].g` — the icon id 1.29 resolves as `clips/jobs/<g>.swf`. */
  gfxId: number;
  /** `J[id].s` — 0 for a base job, else the job this one specialises. */
  specializationOf: number;
}

export type JobRow = Selectable<JobsTable>;
export type NewJob = Insertable<JobsTable>;
export type JobUpdate = Updateable<JobsTable>;

export interface PlayerJobsTable {
  playerId: string;
  jobId: number;
  level: number;
  experience: string;
  learnedAt: Generated<TimestampTz>;
  /** `JobOptions`'s bitmask: 1 paid, 2 free on failure, 4 client supplies. */
  options: Generated<number>;
  /** The smallest recipe the artisan will take on. */
  minSlots: Generated<number>;
  /** In the craftsmen's book. Cleared at logout and on losing the tool. */
  listed: Generated<boolean>;
}

export type PlayerJobRow = Selectable<PlayerJobsTable>;
export type NewPlayerJob = Insertable<PlayerJobsTable>;
export type PlayerJobUpdate = Updateable<PlayerJobsTable>;

/** `job_skills.kind` — which of `SK[id]`'s optional fields the row came from. */
export const JobSkillKind = {
  /** Neither: a menu-only skill the server has no behaviour for. */
  None: 0,
  /** `SK[id].i` is present — the skill harvests that item. */
  Harvest: 1,
  /** `SK[id].cl` is present — the skill crafts that list of items. */
  Craft: 2,
  /** `SK[id].f` is present — the skill improves that item type. */
  Forgemagie: 3,
} as const;

export type JobSkillKindValue =
  (typeof JobSkillKind)[keyof typeof JobSkillKind];

export interface JobSkillsTable {
  id: number;
  jobId: number;
  name: string;
  /** `SK[id].io` — the `IO.d` model id, not a gfx id. */
  interactiveId: number | null;
  toolItemId: number | null;
  minLevel: number;
  action: number;
  kind: Generated<number>;
  /** `SK[id].i`, the item a harvest yields. */
  harvestItemId: number | null;
  harvestXp: number | null;
  /**
   * Set only where the retail action does not scale with the level gap —
   * the well, which is a flat 1.5 s for anyone.
   */
  fixedDurationMs: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  /** `SK[id].c`, evaluated exactly as `Skill.getState` does. */
  criteria: Generated<string>;
  /** `SK[id].f`, the item type a forgemagie skill improves. */
  fmItemType: number | null;
}

export interface JobToolsTable {
  jobId: number;
  templateId: number;
}

export type JobToolRow = Selectable<JobToolsTable>;
export type NewJobTool = Insertable<JobToolsTable>;

/**
 * The live state of one placed resource. Its referential twin is
 * `job_gatherable_cells`, which an import rebuilds; this one must survive
 * that import, which is why it is a second table on the same key.
 */
export interface GatherableCellStatesTable {
  mapId: number;
  cellId: number;
  availableAt: Generated<TimestampTz>;
  reservedBy: string | null;
  reservedUntil: TimestampTz | null;
}

export type GatherableCellStateRow = Selectable<GatherableCellStatesTable>;
export type NewGatherableCellState = Insertable<GatherableCellStatesTable>;
export type GatherableCellStateUpdate = Updateable<GatherableCellStatesTable>;

export type JobSkillRow = Selectable<JobSkillsTable>;
export type NewJobSkill = Insertable<JobSkillsTable>;
export type JobSkillUpdate = Updateable<JobSkillsTable>;

export interface JobGatherableCellsTable {
  mapId: number;
  cellId: number;
  resourceItemId: number;
  skillId: number;
  respawnSeconds: number;
}

export type JobGatherableCellRow = Selectable<JobGatherableCellsTable>;
export type NewJobGatherableCell = Insertable<JobGatherableCellsTable>;
export type JobGatherableCellUpdate = Updateable<JobGatherableCellsTable>;

export interface QuestsTable {
  id: number;
  name: string;
  category: number;
  minLevel: number;
  repeatable: boolean;
}

export type QuestRow = Selectable<QuestsTable>;
export type NewQuest = Insertable<QuestsTable>;
export type QuestUpdate = Updateable<QuestsTable>;

export interface QuestStepsTable {
  questId: number;
  stepId: number;
  name: string;
  objectives: Json;
  rewards: Json;
}

export type QuestStepRow = Selectable<QuestStepsTable>;
export type NewQuestStep = Insertable<QuestStepsTable>;
export type QuestStepUpdate = Updateable<QuestStepsTable>;

export interface PlayerQuestsTable {
  playerId: string;
  questId: number;
  currentStep: number;
  completedObjectives: Json;
  completed: boolean;
  startedAt: Generated<TimestampTz>;
  completedAt: TimestampTz | null;
}

export type PlayerQuestRow = Selectable<PlayerQuestsTable>;
export type NewPlayerQuest = Insertable<PlayerQuestsTable>;
export type PlayerQuestUpdate = Updateable<PlayerQuestsTable>;

export interface TreasureHuntsTable {
  id: Generated<string>;
  playerId: string;
  templateId: number;
  currentStep: number;
  clues: Json;
  rewardMapId: number;
  rewardCellId: number;
  startedAt: Generated<TimestampTz>;
  completedAt: TimestampTz | null;
}

export type TreasureHuntRow = Selectable<TreasureHuntsTable>;
export type NewTreasureHunt = Insertable<TreasureHuntsTable>;
export type TreasureHuntUpdate = Updateable<TreasureHuntsTable>;

export interface TtgCardsTable {
  id: number;
  name: string;
  element: number;
  rarity: number;
  stats: Json;
}

export type TtgCardRow = Selectable<TtgCardsTable>;
export type NewTtgCard = Insertable<TtgCardsTable>;
export type TtgCardUpdate = Updateable<TtgCardsTable>;

export interface PlayerTtgCollectionTable {
  playerId: string;
  cardId: number;
  level: number;
  count: number;
}

export type PlayerTtgCollectionRow = Selectable<PlayerTtgCollectionTable>;
export type NewPlayerTtgCollection = Insertable<PlayerTtgCollectionTable>;
export type PlayerTtgCollectionUpdate = Updateable<PlayerTtgCollectionTable>;

export interface TtgMatchesTable {
  id: Generated<string>;
  player1Id: string;
  player2Id: string;
  winnerId: string | null;
  state: number;
  snapshot: Json;
  startedAt: Generated<TimestampTz>;
  endedAt: TimestampTz | null;
}

export type TtgMatchRow = Selectable<TtgMatchesTable>;
export type NewTtgMatch = Insertable<TtgMatchesTable>;
export type TtgMatchUpdate = Updateable<TtgMatchesTable>;

export interface AuthQueueTable {
  ticket: Generated<string>;
  accountId: string;
  enqueuedAt: Generated<TimestampTz>;
  promotedAt: TimestampTz | null;
}

export type AuthQueueRow = Selectable<AuthQueueTable>;
export type NewAuthQueue = Insertable<AuthQueueTable>;
export type AuthQueueUpdate = Updateable<AuthQueueTable>;

export interface GiftsTable {
  id: number;
  title: string;
  description: string;
  gfxUrl: string;
  items: Json;
  expiresAt: TimestampTz | null;
  objectsRaw: string;
}

export type GiftRow = Selectable<GiftsTable>;
export type NewGift = Insertable<GiftsTable>;
export type GiftUpdate = Updateable<GiftsTable>;

export interface AccountGiftsTable {
  accountId: string;
  giftId: number;
  claimed: boolean;
  claimedAt: TimestampTz | null;
}

export type AccountGiftRow = Selectable<AccountGiftsTable>;
export type NewAccountGift = Insertable<AccountGiftsTable>;
export type AccountGiftUpdate = Updateable<AccountGiftsTable>;

export interface KeysTable {
  id: number;
  kind: number;
  code: string;
  reward: Json;
  expiresAt: TimestampTz | null;
}

export type KeyRow = Selectable<KeysTable>;
export type NewKey = Insertable<KeysTable>;
export type KeyUpdate = Updateable<KeysTable>;

export interface AccountKeysTable {
  accountId: string;
  keyId: number;
  usedAt: Generated<TimestampTz>;
}

export type AccountKeyRow = Selectable<AccountKeysTable>;
export type NewAccountKey = Insertable<AccountKeysTable>;
export type AccountKeyUpdate = Updateable<AccountKeysTable>;

export interface BanishmentsTable {
  id: Generated<string>;
  accountId: string;
  bannedBy: string | null;
  reason: string;
  expiresAt: TimestampTz | null;
  permanent: boolean;
  createdAt: Generated<TimestampTz>;
}

export type BanishmentRow = Selectable<BanishmentsTable>;
export type NewBanishment = Insertable<BanishmentsTable>;
export type BanishmentUpdate = Updateable<BanishmentsTable>;

export interface BanIpsTable {
  ip: string;
  reason: string;
  expiresAt: TimestampTz | null;
  createdAt: Generated<TimestampTz>;
}

export type BanIpRow = Selectable<BanIpsTable>;
export type NewBanIp = Insertable<BanIpsTable>;
export type BanIpUpdate = Updateable<BanIpsTable>;

export interface ConnectionLogsTable {
  id: Generated<string>;
  accountId: string;
  ip: string;
  at: Generated<TimestampTz>;
}

export type ConnectionLogRow = Selectable<ConnectionLogsTable>;
export type NewConnectionLog = Insertable<ConnectionLogsTable>;
export type ConnectionLogUpdate = Updateable<ConnectionLogsTable>;

export interface CharacterMigrationsTable {
  id: Generated<string>;
  playerId: string;
  sourceServerId: number;
  targetServerId: number;
  requestedAt: Generated<TimestampTz>;
  completedAt: TimestampTz | null;
  state: number;
}

export type CharacterMigrationRow = Selectable<CharacterMigrationsTable>;
export type NewCharacterMigration = Insertable<CharacterMigrationsTable>;
export type CharacterMigrationUpdate = Updateable<CharacterMigrationsTable>;

export interface FightChallengeTemplatesTable {
  id: number;
  name: string;
  xpBonusPct: number;
  dropBonusPct: number;
  gainPerMobPct: number;
  conditionsMask: number;
}

export type FightChallengeTemplateRow =
  Selectable<FightChallengeTemplatesTable>;
export type NewFightChallengeTemplate =
  Insertable<FightChallengeTemplatesTable>;
export type FightChallengeTemplateUpdate =
  Updateable<FightChallengeTemplatesTable>;

export interface InteractiveObjectsTemplatesTable {
  id: number;
  name: string;
  respawnMs: number;
  durationMs: number;
  walkable: boolean;
  unknown: number;
  /** 1.29 `IO.d[id].t` — 1 resource, 2 workbench, 3 zaap, 5 house door, 6 storage, 10 zaapi… */
  type: number;
  /** 1.29 `IO.d[id].sk`, comma-separated: the skill ids the popup menu offers. */
  skills: string;
}

export type InteractiveObjectTemplateRow =
  Selectable<InteractiveObjectsTemplatesTable>;
export type NewInteractiveObjectTemplate =
  Insertable<InteractiveObjectsTemplatesTable>;
export type InteractiveObjectTemplateUpdate =
  Updateable<InteractiveObjectsTemplatesTable>;

export interface InteractiveDoorsTable {
  id: Generated<string>;
  maps: string;
  doorsEnable: string;
  doorsDisable: string;
  cellsEnable: string;
  cellsDisable: string;
  requiredCells: string;
  button: string;
  timeSeconds: number;
  mapId: number;
  cellId: number;
  requiredItemId: number;
  requiredQuestId: number;
}

export type InteractiveDoorRow = Selectable<InteractiveDoorsTable>;
export type NewInteractiveDoor = Insertable<InteractiveDoorsTable>;
export type InteractiveDoorUpdate = Updateable<InteractiveDoorsTable>;

export interface DungeonsTable {
  mapId: number;
  npcId: number;
  keyCode: string;
  name: string;
}

export type DungeonRow = Selectable<DungeonsTable>;
export type NewDungeon = Insertable<DungeonsTable>;
export type DungeonUpdate = Updateable<DungeonsTable>;

export interface RunesTemplatesTable {
  id: number;
  name: string;
  bonus: string;
  weight: number;
  effectId: number;
  minValue: number;
  maxValue: number;
}

export type RuneTemplateRow = Selectable<RunesTemplatesTable>;
export type NewRuneTemplate = Insertable<RunesTemplatesTable>;
export type RuneTemplateUpdate = Updateable<RunesTemplatesTable>;

export interface PetTemplatesTable {
  templateId: number;
  name: string;
  petType: number;
  gap: string;
  statsUp: string;
  statMax: number;
  gainPerMeal: number;
  deadTemplate: number;
  starvingMs: number;
  statsMax: string;
  jet: string;
  foodItemIds: Json;
  hungerDrainPerDay: number;
  bonusEffects: Json;
  evolutionLevels: Json;
}

export type PetTemplateRow = Selectable<PetTemplatesTable>;
export type NewPetTemplate = Insertable<PetTemplatesTable>;
export type PetTemplateUpdate = Updateable<PetTemplatesTable>;

export interface EndFightActionsTable {
  id: Generated<string>;
  mapId: number;
  fightType: number;
  action: number;
  args: string;
  condition: string;
}

export type EndFightActionRow = Selectable<EndFightActionsTable>;
export type NewEndFightAction = Insertable<EndFightActionsTable>;
export type EndFightActionUpdate = Updateable<EndFightActionsTable>;

export interface ItemActionsTable {
  id: Generated<string>;
  templateId: number;
  actionType: string;
  args: string;
}

export type ItemActionRow = Selectable<ItemActionsTable>;
export type NewItemAction = Insertable<ItemActionsTable>;
export type ItemActionUpdate = Updateable<ItemActionsTable>;

/**
 * One auction house, keyed by the **map** it stands on — that is how the
 * 1.29 dump keys it, and the vendor NPC is only the way in.
 */
export interface HdvTemplatesTable {
  id: number;
  mapId: number;
  /** Comma-separated `item_types.id` this hall accepts. */
  categories: string;
  /** Listing tax, in percent of the lot price. */
  sellTax: number;
  levelMax: number;
  /** Simultaneous listings allowed per account, in this hall. */
  accountItems: number;
  sellTimeHours: number;
}

export type HdvTemplateRow = Selectable<HdvTemplatesTable>;
export type NewHdvTemplate = Insertable<HdvTemplatesTable>;
export type HdvTemplateUpdate = Updateable<HdvTemplatesTable>;

export interface FullMorphsTable {
  id: number;
  name: string;
  gfxId: number;
  spells: string;
  args: string;
}

export type FullMorphRow = Selectable<FullMorphsTable>;
export type NewFullMorph = Insertable<FullMorphsTable>;
export type FullMorphUpdate = Updateable<FullMorphsTable>;

export interface MapAnimationsTable {
  id: Generated<string>;
  templateId: number;
  name: string;
  area: number;
  action: number;
  size: number;
}

export type MapAnimationRow = Selectable<MapAnimationsTable>;
export type NewMapAnimation = Insertable<MapAnimationsTable>;
export type MapAnimationUpdate = Updateable<MapAnimationsTable>;

export interface ChestsTable {
  id: number;
  items: string;
  kamas: string;
  keyCode: string;
  ownerId: string;
}

export type ChestRow = Selectable<ChestsTable>;
export type NewChest = Insertable<ChestsTable>;
export type ChestUpdate = Updateable<ChestsTable>;

export interface TutorialsTable {
  id: number;
  name: string;
  start: string;
  reward1: string;
  reward2: string;
  reward3: string;
  reward4: string;
  endStep: string;
}

export type TutorialRow = Selectable<TutorialsTable>;
export type NewTutorial = Insertable<TutorialsTable>;
export type TutorialUpdate = Updateable<TutorialsTable>;

export interface BanditsTable {
  scheduleMs: string;
  mobsRaw: string;
  mapsRaw: string;
}

export type BanditRow = Selectable<BanditsTable>;
export type NewBandit = Insertable<BanditsTable>;
export type BanditUpdate = Updateable<BanditsTable>;

export interface MountPaddockTemplatesTable {
  mapId: number;
  price: string;
  data: string;
  enclosRaw: string;
  placedRaw: string;
  durability: string;
}

export type MountPaddockTemplateRow = Selectable<MountPaddockTemplatesTable>;
export type NewMountPaddockTemplate = Insertable<MountPaddockTemplatesTable>;
export type MountPaddockTemplateUpdate = Updateable<MountPaddockTemplatesTable>;

export interface KoliseumQueueTable {
  playerId: string;
  teamSize: number;
  mmr: number;
  enqueuedAt: Generated<TimestampTz>;
}

export type KoliseumQueueRow = Selectable<KoliseumQueueTable>;
export type NewKoliseumQueue = Insertable<KoliseumQueueTable>;
export type KoliseumQueueUpdate = Updateable<KoliseumQueueTable>;

export interface KoliseumMatchesTable {
  id: Generated<string>;
  teamSize: number;
  startedAt: Generated<TimestampTz>;
  endedAt: TimestampTz | null;
  winnerTeam: number | null;
}

export type KoliseumMatchRow = Selectable<KoliseumMatchesTable>;
export type NewKoliseumMatch = Insertable<KoliseumMatchesTable>;
export type KoliseumMatchUpdate = Updateable<KoliseumMatchesTable>;

export interface KoliseumSeasonsTable {
  id: Generated<number>;
  name: string;
  startedAt: Generated<TimestampTz>;
  endedAt: TimestampTz | null;
  mmrReset: boolean;
}

export type KoliseumSeasonRow = Selectable<KoliseumSeasonsTable>;
export type NewKoliseumSeason = Insertable<KoliseumSeasonsTable>;
export type KoliseumSeasonUpdate = Updateable<KoliseumSeasonsTable>;

export interface KoliseumConfigTable {
  singleton: boolean;
  arenaMapId: number;
}

export type KoliseumConfigRow = Selectable<KoliseumConfigTable>;
export type NewKoliseumConfig = Insertable<KoliseumConfigTable>;
export type KoliseumConfigUpdate = Updateable<KoliseumConfigTable>;

export interface AchievementTemplatesTable {
  id: number;
  category: string;
  name: string;
  description: string;
  objectives: Json;
  rewards: Json;
}

export type AchievementTemplateRow = Selectable<AchievementTemplatesTable>;
export type NewAchievementTemplate = Insertable<AchievementTemplatesTable>;
export type AchievementTemplateUpdate = Updateable<AchievementTemplatesTable>;

export interface PlayerAchievementsTable {
  playerId: string;
  achievementId: number;
  earnedAt: TimestampTz | null;
  progress: Json;
}

export type PlayerAchievementRow = Selectable<PlayerAchievementsTable>;
export type NewPlayerAchievement = Insertable<PlayerAchievementsTable>;
export type PlayerAchievementUpdate = Updateable<PlayerAchievementsTable>;

export interface WorldBossTemplatesTable {
  id: Generated<number>;
  monsterTemplateId: number;
  spawnWeight: number;
}

export type WorldBossTemplateRow = Selectable<WorldBossTemplatesTable>;
export type NewWorldBossTemplate = Insertable<WorldBossTemplatesTable>;
export type WorldBossTemplateUpdate = Updateable<WorldBossTemplatesTable>;

export interface WorldBossSpawnsTable {
  mapId: number;
  lastKilledAt: TimestampTz | null;
  nextSpawnAt: TimestampTz;
  activeBossId: string | null;
}

export type WorldBossSpawnRow = Selectable<WorldBossSpawnsTable>;
export type NewWorldBossSpawn = Insertable<WorldBossSpawnsTable>;
export type WorldBossSpawnUpdate = Updateable<WorldBossSpawnsTable>;

export interface DungeonTemplatesTable {
  id: number;
  name: string;
  keyItemTemplateId: number;
  maxLevel: number;
  entranceMapId: number;
}

export type DungeonTemplateRow = Selectable<DungeonTemplatesTable>;
export type NewDungeonTemplate = Insertable<DungeonTemplatesTable>;
export type DungeonTemplateUpdate = Updateable<DungeonTemplatesTable>;

export interface DungeonMapsTable {
  templateId: number;
  position: number;
  mapId: number;
}

export type DungeonMapRow = Selectable<DungeonMapsTable>;
export type NewDungeonMap = Insertable<DungeonMapsTable>;
export type DungeonMapUpdate = Updateable<DungeonMapsTable>;

export interface DungeonBossSpawnsTable {
  templateId: number;
  monsterTemplateId: number;
}

export type DungeonBossSpawnRow = Selectable<DungeonBossSpawnsTable>;
export type NewDungeonBossSpawn = Insertable<DungeonBossSpawnsTable>;
export type DungeonBossSpawnUpdate = Updateable<DungeonBossSpawnsTable>;

export interface DungeonInstancesTable {
  id: Generated<string>;
  templateId: number;
  ownerPlayerId: string;
  createdAt: Generated<TimestampTz>;
  expiresAt: TimestampTz;
  currentMapId: number;
  currentMapPos: number;
}

export type DungeonInstanceRow = Selectable<DungeonInstancesTable>;
export type NewDungeonInstance = Insertable<DungeonInstancesTable>;
export type DungeonInstanceUpdate = Updateable<DungeonInstancesTable>;

export interface DungeonParticipantsTable {
  instanceId: string;
  playerId: string;
  joinedAt: Generated<TimestampTz>;
}

export type DungeonParticipantRow = Selectable<DungeonParticipantsTable>;
export type NewDungeonParticipant = Insertable<DungeonParticipantsTable>;
export type DungeonParticipantUpdate = Updateable<DungeonParticipantsTable>;

export interface PetsTable {
  id: Generated<string>;
  playerId: string;
  templateId: number;
  name: string;
  level: number;
  xp: string;
  hunger: number;
  lastFedAt: Generated<TimestampTz>;
  isDead: boolean;
  bornAt: Generated<TimestampTz>;
}

export type PetRow = Selectable<PetsTable>;
export type NewPet = Insertable<PetsTable>;
export type PetUpdate = Updateable<PetsTable>;

export interface MountFoodTemplatesTable {
  templateId: number;
  energy: number;
  maturity: number;
  serenity: number;
  stamina: number;
  love: number;
  fecundity: number;
}

export type MountFoodTemplateRow = Selectable<MountFoodTemplatesTable>;
export type NewMountFoodTemplate = Insertable<MountFoodTemplatesTable>;
export type MountFoodTemplateUpdate = Updateable<MountFoodTemplatesTable>;

export interface TutorialStepsTable {
  id: number;
  name: string;
  startMapId: number;
  startCellId: number;
  objectiveKind: string;
  objectiveTarget: number;
  rewardItems: Json;
  rewardKamas: string;
  rewardXp: string;
  nextStepId: number;
}

export type TutorialStepRow = Selectable<TutorialStepsTable>;
export type NewTutorialStep = Insertable<TutorialStepsTable>;
export type TutorialStepUpdate = Updateable<TutorialStepsTable>;

export interface PlayerTutorialProgressTable {
  playerId: string;
  currentStep: number;
  completed: boolean;
  startedAt: Generated<TimestampTz>;
  completedAt: TimestampTz | null;
}

export type PlayerTutorialProgressRow = Selectable<PlayerTutorialProgressTable>;
export type NewPlayerTutorialProgress = Insertable<PlayerTutorialProgressTable>;
export type PlayerTutorialProgressUpdate =
  Updateable<PlayerTutorialProgressTable>;

export interface DocumentTemplatesTable {
  id: string;
  title: string;
  body: string;
  category: number;
}

export type DocumentTemplateRow = Selectable<DocumentTemplatesTable>;
export type NewDocumentTemplate = Insertable<DocumentTemplatesTable>;
export type DocumentTemplateUpdate = Updateable<DocumentTemplatesTable>;

export interface BannedIpsTable {
  ip: string;
  bannedUntil: TimestampTz;
  reason: string | null;
  bannedByAdminId: string | null;
  createdAt: Generated<TimestampTz>;
}

export type BannedIpRow = Selectable<BannedIpsTable>;
export type NewBannedIp = Insertable<BannedIpsTable>;
export type BannedIpUpdate = Updateable<BannedIpsTable>;

export interface MutedPlayersTable {
  playerId: string;
  channel: number;
  mutedUntil: TimestampTz;
  reason: string | null;
  createdAt: Generated<TimestampTz>;
}

export type MutedPlayerRow = Selectable<MutedPlayersTable>;
export type NewMutedPlayer = Insertable<MutedPlayersTable>;
export type MutedPlayerUpdate = Updateable<MutedPlayersTable>;

export interface PlayerJailTable {
  playerId: string;
  jailMapId: number;
  jailCellId: number;
  previousMapId: number | null;
  previousCellId: number | null;
  jailedUntil: TimestampTz;
  jailedByAdminId: string | null;
  reason: string | null;
  createdAt: Generated<TimestampTz>;
}

export type PlayerJailRow = Selectable<PlayerJailTable>;
export type NewPlayerJail = Insertable<PlayerJailTable>;
export type PlayerJailUpdate = Updateable<PlayerJailTable>;

export interface HeroicMobsGroupsTable {
  id: string;
  mapId: number;
  cellId: number;
  group: string;
  objects: string;
  stars: number;
  defeated: boolean;
}

export type HeroicMobsGroupRow = Selectable<HeroicMobsGroupsTable>;
export type NewHeroicMobsGroup = Insertable<HeroicMobsGroupsTable>;
export type HeroicMobsGroupUpdate = Updateable<HeroicMobsGroupsTable>;

export interface HeroicMobsGroupsLimitsTable {
  mapId: number;
  minLevel: number;
  maxLevel: number;
  maxAlive: number;
}

export type HeroicMobsGroupsLimitRow = Selectable<HeroicMobsGroupsLimitsTable>;
export type NewHeroicMobsGroupsLimit = Insertable<HeroicMobsGroupsLimitsTable>;
export type HeroicMobsGroupsLimitUpdate =
  Updateable<HeroicMobsGroupsLimitsTable>;

export interface ScriptedCellsTable {
  mapId: number;
  cellId: number;
  actionId: number;
  eventId: number;
  verb: string;
  actionsArgs: string;
  conditions: string;
}

export type ScriptedCellRow = Selectable<ScriptedCellsTable>;
export type NewScriptedCell = Insertable<ScriptedCellsTable>;
export type ScriptedCellUpdate = Updateable<ScriptedCellsTable>;

export type MarriageState = "proposed" | "engaged" | "married" | "divorced";

export interface MarriagesTable {
  id: Generated<string>;
  playerA: string;
  playerB: string;
  state: MarriageState;
  proposedAt: Generated<TimestampTz>;
  marriedAt: TimestampTz | null;
  locationMapId: number;
  locationCellId: number;
}

export type MarriageRow = Selectable<MarriagesTable>;
export type NewMarriage = Insertable<MarriagesTable>;
export type MarriageUpdate = Updateable<MarriagesTable>;

/**
 * One row per `POST /admin/accounts` call that reached the database, keyed
 * by its `Idempotency-Key` (migration 0055). `accountId` / `characterId`
 * are nullable only because the row is claimed before the account exists —
 * they are set later in the same transaction, so any row you can *see* has
 * both.
 */
export interface ProvisioningRequestsTable {
  idempotencyKey: string;
  requestHash: string;
  accountId: string | null;
  characterId: string | null;
  createdAt: Generated<TimestampTz>;
}

export type ProvisioningRequestRow = Selectable<ProvisioningRequestsTable>;
export type NewProvisioningRequest = Insertable<ProvisioningRequestsTable>;
export type ProvisioningRequestUpdate = Updateable<ProvisioningRequestsTable>;

export type DB = {
  accounts: AccountsTable;
  gameServers: GameServersTable;
  accountServers: AccountServersTable;
  authTickets: AuthTicketsTable;
  provisioningRequests: ProvisioningRequestsTable;
  players: PlayersTable;
  playerStats: PlayerStatsTable;
  playerColors: PlayerColorsTable;
  playerSpells: PlayerSpellsTable;
  items: ItemsTable;
  itemLedger: ItemLedgerTable;
  playerMount: PlayerMountTable;
  subareas: SubareasTable;
  maps: MapsTable;
  mapNeighbors: MapNeighborsTable;
  mapFightPlaces: MapFightPlacesTable;
  scriptedNpcs: ScriptedNpcsTable;
  itemTemplates: ItemTemplatesTable;
  itemSets: ItemSetsTable;
  itemTypes: ItemTypesTable;
  itemSuperTypes: ItemSuperTypesTable;
  spellTemplates: SpellTemplatesTable;
  spellLevels: SpellLevelsTable;
  monsterAiProfiles: MonsterAiProfilesTable;
  monsterTemplates: MonsterTemplatesTable;
  monsterLevels: MonsterLevelsTable;
  monsterGroups: MonsterGroupsTable;
  monsterDrops: MonsterDropsTable;
  fightHistory: FightHistoryTable;
  fightParticipants: FightParticipantsTable;
  npcTemplates: NpcTemplatesTable;
  npcDialogQuestions: NpcDialogQuestionsTable;
  npcDialogResponseActions: NpcDialogResponseActionsTable;
  waypoints: WaypointsTable;
  waypointKnown: WaypointKnownTable;
  playerItemShortcuts: PlayerItemShortcutsTable;
  playerSoulStones: PlayerSoulStonesTable;
  livingObjects: LivingObjectsTable;
  livingObjectTemplates: LivingObjectTemplatesTable;
  classSpells: ClassSpellsTable;
  spellCooldowns: SpellCooldownsTable;
  chatSubscriptions: ChatSubscriptionsTable;
  modReports: ModReportsTable;
  bugReports: BugReportsTable;
  surveys: SurveysTable;
  surveyResponses: SurveyResponsesTable;
  friends: FriendsTable;
  enemies: EnemiesTable;
  guilds: GuildsTable;
  guildMembers: GuildMembersTable;
  guildRanks: GuildRanksTable;
  guildTaxCollectors: GuildTaxCollectorsTable;
  containerKamas: ContainerKamasTable;
  bigStoreListings: BigStoreListingsTable;
  recipes: RecipesTable;
  mounts: MountsTable;
  mountAncestors: MountAncestorsTable;
  mountPaddocks: MountPaddocksTable;
  mountPaddockData: MountPaddockDataTable;
  mountBreedingLog: MountBreedingLogTable;
  houses: HousesTable;
  houseDoors: HouseDoorsTable;
  prisms: PrismsTable;
  prismModules: PrismModulesTable;
  alignmentBalance: AlignmentBalanceTable;
  playerAlignmentLedger: PlayerAlignmentLedgerTable;
  jobs: JobsTable;
  jobTools: JobToolsTable;
  gatherableCellStates: GatherableCellStatesTable;
  playerJobs: PlayerJobsTable;
  jobSkills: JobSkillsTable;
  jobGatherableCells: JobGatherableCellsTable;
  quests: QuestsTable;
  questSteps: QuestStepsTable;
  playerQuests: PlayerQuestsTable;
  treasureHunts: TreasureHuntsTable;
  ttgCards: TtgCardsTable;
  playerTtgCollection: PlayerTtgCollectionTable;
  ttgMatches: TtgMatchesTable;
  authQueue: AuthQueueTable;
  gifts: GiftsTable;
  accountGifts: AccountGiftsTable;
  keys: KeysTable;
  accountKeys: AccountKeysTable;
  banishments: BanishmentsTable;
  banIps: BanIpsTable;
  connectionLogs: ConnectionLogsTable;
  characterMigrations: CharacterMigrationsTable;
  fightChallengeTemplates: FightChallengeTemplatesTable;
  interactiveObjectsTemplates: InteractiveObjectsTemplatesTable;
  interactiveDoors: InteractiveDoorsTable;
  dungeons: DungeonsTable;
  runesTemplates: RunesTemplatesTable;
  petTemplates: PetTemplatesTable;
  endFightActions: EndFightActionsTable;
  itemActions: ItemActionsTable;
  hdvTemplates: HdvTemplatesTable;
  fullMorphs: FullMorphsTable;
  mapAnimations: MapAnimationsTable;
  chests: ChestsTable;
  tutorials: TutorialsTable;
  bandits: BanditsTable;
  mountPaddockTemplates: MountPaddockTemplatesTable;
  koliseumQueue: KoliseumQueueTable;
  koliseumMatches: KoliseumMatchesTable;
  koliseumSeasons: KoliseumSeasonsTable;
  koliseumConfig: KoliseumConfigTable;
  achievementTemplates: AchievementTemplatesTable;
  playerAchievements: PlayerAchievementsTable;
  worldBossTemplates: WorldBossTemplatesTable;
  worldBossSpawns: WorldBossSpawnsTable;
  dungeonTemplates: DungeonTemplatesTable;
  dungeonMaps: DungeonMapsTable;
  dungeonBossSpawns: DungeonBossSpawnsTable;
  dungeonInstances: DungeonInstancesTable;
  dungeonParticipants: DungeonParticipantsTable;
  pets: PetsTable;
  mountFoodTemplates: MountFoodTemplatesTable;
  tutorialSteps: TutorialStepsTable;
  playerTutorialProgress: PlayerTutorialProgressTable;
  documentTemplates: DocumentTemplatesTable;
  bannedIps: BannedIpsTable;
  mutedPlayers: MutedPlayersTable;
  playerJail: PlayerJailTable;
  heroicMobsGroups: HeroicMobsGroupsTable;
  heroicMobsGroupsLimits: HeroicMobsGroupsLimitsTable;
  scriptedCells: ScriptedCellsTable;
  marriages: MarriagesTable;
  "i18n.translations": I18nTranslationsTable;
};
