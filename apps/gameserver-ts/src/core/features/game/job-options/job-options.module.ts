import { JobOptionsHandler } from "@features/game/job-options/job-options.handler";
import { JobsModule } from "@modules/jobs/jobs.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [JobsModule],
  providers: [JobOptionsHandler],
})
export class JobOptionsModule {}
