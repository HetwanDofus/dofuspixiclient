import { FightModule } from "@modules/fight/fight.module";
import { GatherableStateRepository } from "@modules/harvest/gatherable-state.repository";
import { HarvestFramesService } from "@modules/harvest/harvest.frames.service";
import { HarvestService } from "@modules/harvest/harvest.service";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { JobsModule } from "@modules/jobs/jobs.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { SchedulerModule } from "@modules/scheduler/scheduler.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

/**
 * The harvest loop. It sits above jobs rather than inside it: `JobsModule`
 * deliberately imports nothing, and this one needs half the game — presence,
 * inventory, stats, fights and the scheduler.
 */
@Module({
  imports: [
    JobsModule,
    InventoryModule,
    PlayersModule,
    PlayerPresenceModule,
    StatsModule,
    FightModule,
    SchedulerModule,
  ],
  providers: [GatherableStateRepository, HarvestFramesService, HarvestService],
  exports: [HarvestService, HarvestFramesService],
})
export class HarvestModule {}
