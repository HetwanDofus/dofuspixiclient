import { JobsCatalogService } from "@modules/jobs/jobs.catalog.service";
import { JobsFramesService } from "@modules/jobs/jobs.frames.service";
import { JobsRepository } from "@modules/jobs/jobs.repository";
import { JobsService } from "@modules/jobs/jobs.service";
import { Module } from "@nestjs/common";

/**
 * The jobs referential and a character's progress in it.
 *
 * It deliberately imports nothing. Inventory needs it (a tool changes what
 * `OT` says and what the pods are worth) and so does the harvest loop; if it
 * reached back for either, every one of those edges would become a
 * `forwardRef`. Everything it needs is the database and the socket.
 */
@Module({
  providers: [
    JobsRepository,
    JobsCatalogService,
    JobsFramesService,
    JobsService,
  ],
  exports: [JobsRepository, JobsCatalogService, JobsFramesService, JobsService],
})
export class JobsModule {}
