import { SchedulerService } from "@modules/scheduler/scheduler.service";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
