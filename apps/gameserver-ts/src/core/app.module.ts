import { AuthModule } from "@features/auth/auth.module";
import { GameModule } from "@features/game/game.module";
import { LangsModule } from "@modules/langs/langs.module";
import { SchedulerModule } from "@modules/scheduler/scheduler.module";
import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { AppConfigModule } from "@shared/config/config.module";
import { DatabaseModule } from "@shared/db/db.module";
import { EventsModule } from "@shared/events/events.module";
import { GatewayAdapterModule } from "@shared/gateway-adapter/gateway-adapter.module";
import { HandoffModule } from "@shared/handoff/handoff.module";

// Feature bundles are selected per MODE. process.env.MODE is set before
// AppModule is imported (main forces it or the user provides it);
// AppConfigModule re-validates through zod so an invalid value fails boot.
// LangsModule is game-only — authd doesn't build localized payloads.
const featureModules =
  process.env.MODE === "auth" ? [AuthModule] : [GameModule, LangsModule];

@Module({
  imports: [
    AppConfigModule,
    EventEmitterModule.forRoot({ wildcard: true, delimiter: "." }),
    DatabaseModule,
    EventsModule,
    GatewayAdapterModule,
    HandoffModule,
    SchedulerModule,
    ...featureModules,
  ],
})
export class AppModule {}
