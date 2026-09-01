import type { SkillEntry } from "@modules/jobs/jobs.catalog.service";
import type { OnModuleInit } from "@nestjs/common";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { GatherableStateRepository } from "@modules/harvest/gatherable-state.repository";
import {
  HARVEST_RESPAWN,
  type HarvestRespawnPayload,
  InteractiveFrame,
  RESERVATION_GRACE_MS,
  respawnJobId,
} from "@modules/harvest/harvest.constants";
import { HarvestFramesService } from "@modules/harvest/harvest.frames.service";
import {
  harvestDuration,
  harvestQuantity,
} from "@modules/harvest/harvest.rules";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { rollItemEffects } from "@modules/inventory/item-effects";
import { currentPods, maxPods } from "@modules/inventory/pods";
import { JobsCatalogService } from "@modules/jobs/jobs.catalog.service";
import { jobPodsBonus } from "@modules/jobs/jobs.pods";
import { JobsRepository } from "@modules/jobs/jobs.repository";
import { BASE_JOB_ID } from "@modules/jobs/jobs.rules";
import { JobsService } from "@modules/jobs/jobs.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { SchedulerService } from "@modules/scheduler/scheduler.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { TransactionHost } from "@nestjs-cls/transactional";

/** Why a harvest was refused. Every branch names one; none is silent. */
export type HarvestDenialReason =
  | "not-in-world"
  | "in-fight"
  | "already-harvesting"
  | "no-resource-here"
  | "skill-not-runnable"
  | "job-not-learned"
  | "job-level-too-low"
  | "no-tool-equipped"
  | "no-energy"
  | "too-heavy"
  | "resource-taken";

export type HarvestResult =
  | { ok: true; durationMs: number }
  | { ok: false; reason: HarvestDenialReason };

/** One action in flight, keyed by character. */
interface RunningHarvest {
  sessionId: string;
  characterId: string;
  mapId: number;
  cellId: number;
  skillId: number;
  jobId: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The harvest loop — QA-123, end to end.
 *
 * The shape is deliberately the same as the exchange's: the client names a
 * cell and a skill, everything else is re-derived server-side, and the
 * resource is *taken* before anything is promised. Ordering matters twice.
 *
 * **The reservation comes before the animation.** It is a single
 * `INSERT … ON CONFLICT DO UPDATE` whose `WHERE` is the availability test
 * (`GatherableStateRepository.reserve`), so two clients double-clicking the
 * same tree cannot both win — `WsRouter.dispatch` is not awaited, so that is
 * a real race and not a hypothetical one.
 *
 * **The reward comes after a second look.** Twelve seconds is long enough to
 * walk away, change map, or be dragged into a fight, so the state that was
 * checked at the start is checked again at the end and the whole credit —
 * items and experience — happens in one transaction.
 *
 * In-flight actions are held in memory, and deliberately not in the handoff:
 * a restart mid-action loses at most one harvest, and the reservation it left
 * behind expires on its own (`RESERVATION_GRACE_MS`). What *is* persisted is
 * the respawn instant, which is the thing a player would notice.
 */
@Injectable()
export class HarvestService implements OnModuleInit {
  private readonly logger = new Logger(HarvestService.name);
  private readonly running = new Map<string, RunningHarvest>();

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly state: GatherableStateRepository,
    private readonly jobsRepo: JobsRepository,
    private readonly catalog: JobsCatalogService,
    private readonly jobs: JobsService,
    private readonly presence: PlayerPresenceService,
    private readonly players: PlayersRepository,
    private readonly fights: FightRegistryService,
    private readonly inventory: InventoryRepository,
    private readonly inventoryFrames: InventoryFramesService,
    private readonly stats: StatsService,
    private readonly scheduler: SchedulerService,
    private readonly frames: HarvestFramesService
  ) {}

  /**
   * Re-arms every respawn the database still owes.
   *
   * `SchedulerService` survives a blue/green handoff on its own; a **cold**
   * start has nothing to restore from, and without this sweep a felled tree
   * would stay felled forever. Arming a job twice is harmless — `schedule`
   * replaces by id — and one already overdue is scheduled in the past, which
   * the scheduler clamps to the next tick.
   */
  async onModuleInit(): Promise<void> {
    const pending = await this.state.pending();

    for (const row of pending) {
      this.armRespawn(
        row.mapId,
        row.cellId,
        new Date(row.availableAt).getTime()
      );
    }

    if (pending.length > 0) {
      this.logger.log(`armed ${pending.length} resource respawns`);
    }
  }

  /**
   * The depleted cells of a map, for a client that has just arrived on it.
   * Without this a newcomer sees every stump as a standing tree.
   */
  async framesForMap(sessionId: string, mapId: number): Promise<void> {
    const depleted = await this.state.depletedOnMap(mapId);

    this.frames.sendFrames(
      [sessionId],
      depleted.map((row) => ({
        cellId: row.cellId,
        frame: row.reserved ? InteractiveFrame.Locked : InteractiveFrame.InUse,
      }))
    );
  }

  /**
   * `GA;500` with a harvest skill: check everything, take the resource, then
   * announce the action.
   *
   * The caller (`InteractiveObjectsService`) has already established that the
   * cell carries an interactive element whose template offers this skill.
   * What is added here is everything about the *character*.
   */
  async start(
    sessionId: string,
    characterId: string,
    cellId: number,
    skillId: number
  ): Promise<HarvestResult> {
    await this.catalog.load();

    const placed = this.presence.getByCharacter(characterId);

    if (!placed) {
      return this.refuse(sessionId, characterId, "not-in-world");
    }

    if (this.fights.isInFight(sessionId)) {
      return this.refuse(sessionId, characterId, "in-fight");
    }

    if (this.running.has(characterId)) {
      return this.refuse(sessionId, characterId, "already-harvesting");
    }

    const skill = this.catalog.runnableHarvestSkill(skillId);

    if (!skill) {
      return this.refuse(sessionId, characterId, "skill-not-runnable");
    }

    const gatherable = await this.jobsRepo.findGatherable(placed.mapId, cellId);

    // The import decides what stands where; a client naming a cell the scan
    // never recorded is naming a decorative copy of the same sprite.
    if (!gatherable || gatherable.skillId !== skillId) {
      return this.refuse(sessionId, characterId, "no-resource-here");
    }

    // `-Base-` is not a job. It carries the actions anyone can perform —
    // drawing water from a well is its only implemented one — and no
    // character ever holds a row for it, so gating it like a real job made
    // every well in the world permanently refused.
    const jobless = skill.jobId === BASE_JOB_ID;
    const playerJob = jobless
      ? null
      : await this.jobsRepo.findPlayerJob(characterId, skill.jobId);

    let toolTemplateId: number | null = null;

    if (!jobless) {
      if (!playerJob) {
        return this.refuse(sessionId, characterId, "job-not-learned");
      }

      if (playerJob.level < skill.minLevel) {
        return this.refuse(sessionId, characterId, "job-level-too-low");
      }

      toolTemplateId = await this.toolFor(characterId, skill.jobId);
      if (toolTemplateId === null) {
        return this.refuse(sessionId, characterId, "no-tool-equipped");
      }
    }

    const player = await this.players.findById(characterId);

    // 1.29 does not *spend* energy on a harvest — it is a condition, not a
    // cost. A character at zero is a ghost and cannot act at all.
    if (!player || player.energy <= 0) {
      return this.refuse(sessionId, characterId, "no-energy");
    }

    if (await this.isOverloaded(characterId)) {
      return this.refuse(sessionId, characterId, "too-heavy");
    }

    // Resolve presentation before taking the resource. No awaited lookup may
    // sit between a successful reservation and registering the in-flight
    // action, or a database error would leave a ghost lock behind.
    const toolTemplate =
      toolTemplateId === null
        ? null
        : await this.inventory.findTemplate(toolTemplateId);
    const animationId = toolTemplate?.animationId ?? 3;

    const durationMs = skill.fixedDurationMs
      ? skill.fixedDurationMs
      : harvestDuration(playerJob?.level ?? 1, skill.minLevel);

    const taken = await this.state.reserve(
      placed.mapId,
      cellId,
      characterId,
      durationMs + RESERVATION_GRACE_MS
    );

    if (!taken) {
      return this.refuse(sessionId, characterId, "resource-taken");
    }

    const witnesses = this.presence.sessionsOnMap(placed.mapId);

    this.frames.sendAction(
      witnesses,
      characterId,
      cellId,
      durationMs,
      animationId
    );
    this.frames.sendFrame(witnesses, cellId, InteractiveFrame.Locked);

    this.running.set(characterId, {
      sessionId,
      characterId,
      mapId: placed.mapId,
      cellId,
      skillId,
      jobId: skill.jobId,
      timer: setTimeout(() => {
        void this.finish(characterId, skill, gatherable.respawnSeconds);
      }, durationMs),
    });

    return { ok: true, durationMs };
  }

  /**
   * Interrupts whatever this character was harvesting, with no reward.
   *
   * Called on a move, a map change and a dropped socket. Nothing here is
   * best-effort: the resource goes back to everyone immediately, which is
   * the difference between a cancelled action and a tree nobody can touch
   * for a minute.
   */
  async interrupt(characterId: string, why: string): Promise<void> {
    // A harvest is intentionally uncancellable by gameplay input. Movement
    // is rejected by MoveHandler too; keeping this guard makes the invariant
    // hold even if another caller accidentally reports a move here later.
    if (why === "moved") {
      return;
    }

    const running = this.running.get(characterId);

    if (!running) {
      return;
    }

    clearTimeout(running.timer);
    this.running.delete(characterId);

    await this.state.release(running.mapId, running.cellId, characterId);

    this.frames.sendFrame(
      this.presence.sessionsOnMap(running.mapId),
      running.cellId,
      InteractiveFrame.Ready
    );

    this.logger.debug(
      `harvest: ${characterId} interrupted on ${running.mapId}:${running.cellId} (${why})`
    );
  }

  /** Movement and other character-owning actions consult this synchronously. */
  isRunning(characterId: string): boolean {
    return this.running.has(characterId);
  }

  @OnEvent("session.closed")
  onSessionClosed({
    session,
  }: {
    session: { sessionId: string; characterId?: string | null };
  }): void {
    const characterId = session.characterId;

    if (characterId) {
      void this.interrupt(characterId, "disconnected");
    }
  }

  @OnEvent(HARVEST_RESPAWN)
  onRespawn({ mapId, cellId }: HarvestRespawnPayload): void {
    this.frames.sendFrame(
      this.presence.sessionsOnMap(mapId),
      cellId,
      InteractiveFrame.Ready
    );
  }

  /**
   * The action ran its course. Everything is re-checked, then items and
   * experience are credited together — a reward that half-happened is worse
   * than one that did not.
   */
  private async finish(
    characterId: string,
    skill: SkillEntry,
    respawnSeconds: number
  ): Promise<void> {
    const running = this.running.get(characterId);

    if (!running) {
      return;
    }

    this.running.delete(characterId);

    const placed = this.presence.getByCharacter(characterId);
    const stillThere =
      placed?.mapId === running.mapId &&
      !this.fights.isInFight(running.sessionId);

    if (!stillThere) {
      await this.state.release(running.mapId, running.cellId, characterId);
      this.frames.sendFrame(
        this.presence.sessionsOnMap(running.mapId),
        running.cellId,
        InteractiveFrame.Ready
      );
      return;
    }

    const itemId = skill.harvestItemId;
    const xp = skill.harvestXp ?? 0;

    if (itemId === null) {
      await this.state.release(running.mapId, running.cellId, characterId);
      return;
    }

    const playerJob = await this.jobsRepo.findPlayerJob(
      characterId,
      skill.jobId
    );
    const level = playerJob?.level ?? 1;
    const quantity = this.rollQuantity(skill, level);

    const outcome = await this.txHost.withTransaction(async () => {
      const template = await this.inventory.findTemplate(itemId);

      if (!template) {
        this.logger.warn(
          `harvest: skill ${skill.id} yields unknown template ${itemId}`
        );
        return null;
      }

      const row = await this.inventory.insertItem({
        playerId: characterId,
        templateId: itemId,
        quantity,
        effects: rollItemEffects(template.effects),
      });

      const gain = await this.jobs.addExperience(characterId, skill.jobId, xp);
      const availableAt = await this.state.deplete(
        running.mapId,
        running.cellId,
        characterId,
        respawnSeconds
      );

      return { row, gain, availableAt };
    });

    if (!outcome) {
      await this.state.release(running.mapId, running.cellId, characterId);
      return;
    }

    this.inventoryFrames.sendItemAdd(running.sessionId, outcome.row);

    if (outcome.gain) {
      await this.jobs.announceGain(
        running.sessionId,
        characterId,
        outcome.gain
      );

      // A level bought pods (QA-133), and the weight frame is the only
      // thing that carries capacity to a client.
      if (outcome.gain.leveledTo !== null) {
        await this.stats.sendStats(running.sessionId, characterId);
      }
    }

    const witnesses = this.presence.sessionsOnMap(running.mapId);
    this.frames.sendFrame(witnesses, running.cellId, InteractiveFrame.InUse);

    if (outcome.availableAt) {
      this.armRespawn(
        running.mapId,
        running.cellId,
        new Date(outcome.availableAt).getTime()
      );
    }
  }

  private rollQuantity(skill: SkillEntry, jobLevel: number): number {
    // The well and its like carry an explicit range and do not scale.
    if (skill.quantityMin !== null && skill.quantityMax !== null) {
      const spread = Math.max(1, skill.quantityMax - skill.quantityMin + 1);
      return skill.quantityMin + Math.floor(Math.random() * spread);
    }

    return harvestQuantity(jobLevel, skill.minLevel, Math.random());
  }

  private armRespawn(mapId: number, cellId: number, dueAt: number): void {
    this.scheduler.schedule({
      id: respawnJobId(mapId, cellId),
      dueAt,
      channel: HARVEST_RESPAWN,
      payload: { mapId, cellId } satisfies HarvestRespawnPayload,
    });
  }

  /** The weapon slot holds a tool this job accepts — nothing else counts. */
  private async toolFor(
    characterId: string,
    jobId: number
  ): Promise<number | null> {
    const equipped = await this.inventory.findEquipped(characterId);
    const weapon = equipped.find((row) => row.position === WEAPON_POSITION);

    return weapon !== undefined &&
      this.catalog.isToolOf(weapon.templateId, jobId)
      ? weapon.templateId
      : null;
  }

  /**
   * Whether the character is already at capacity.
   *
   * 1.29 refuses the action when the bag is full rather than truncating the
   * reward, so this is a precondition and not a clamp. Capacity is the same
   * three terms `StatsService` puts in the `Ow` frame — strength including
   * equipment, the pods effect, and the jobs — because a character told they
   * carry 2 500 and refused at 1 800 would be looking at a bug.
   */
  private async isOverloaded(characterId: string): Promise<boolean> {
    const [items, stats, jobs, equipment] = await Promise.all([
      this.inventory.findByPlayer(characterId),
      this.players.findStats(characterId),
      this.jobsRepo.findPlayerJobs(characterId),
      this.stats.computeEquipmentStats(characterId),
    ]);

    const weightByTemplate = new Map<number, number>();

    for (const templateId of new Set(items.map((item) => item.templateId))) {
      const template = await this.inventory.findTemplate(templateId);

      if (template) {
        weightByTemplate.set(templateId, template.weight);
      }
    }

    const carried = currentPods(items, weightByTemplate);
    const capacity = maxPods(
      (stats?.strength ?? 0) + equipment.strength,
      equipment.pods,
      jobPodsBonus(jobs.map((job) => job.level))
    );

    return carried >= capacity;
  }

  /**
   * Every refusal ends here, and every refusal tells the player why.
   *
   * The `sessionId` is threaded through for that alone: a branch that only
   * writes to the log is exactly what QA-123 forbids, and it is what makes a
   * missing axe indistinguishable from a broken game.
   */
  private refuse(
    sessionId: string,
    characterId: string,
    reason: HarvestDenialReason
  ): HarvestResult {
    this.logger.debug(`harvest: ${characterId} refused (${reason})`);
    this.frames.sendRefusal(sessionId, reason);

    return { ok: false, reason };
  }
}

/** `equip-rules.ts`'s weapon slot — where every job tool is worn. */
const WEAPON_POSITION = 1;
