import { LangsService } from "@modules/langs/langs.service";
import { Global, Module } from "@nestjs/common";

/**
 * Global because every feature handler that resolves localized strings
 * (spells, items, monsters, …) would otherwise need to import LangsModule
 * by hand. The service is a singleton backed by a warm in-memory cache, so
 * promoting it to global scope doesn't change memory behaviour.
 */
@Global()
@Module({
  providers: [LangsService],
  exports: [LangsService],
})
export class LangsModule {}
