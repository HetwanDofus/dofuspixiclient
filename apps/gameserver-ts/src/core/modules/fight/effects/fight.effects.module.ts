import {
  EFFECT_HANDLER_META,
  type EffectHandlerMeta,
} from "@modules/fight/effects/fight.effect-handler.decorator";
import { EffectRegistry } from "@modules/fight/effects/fight.effect-registry";
import { ApMpEffectHandler } from "@modules/fight/effects/handlers/ap-mp.handler";
import { DamageEffectHandler } from "@modules/fight/effects/handlers/damage.handler";
import { HealEffectHandler } from "@modules/fight/effects/handlers/heal.handler";
import { LifeStealEffectHandler } from "@modules/fight/effects/handlers/life-steal.handler";
import { MovementEffectHandler } from "@modules/fight/effects/handlers/movement.handler";
import { PctLifeEffectHandler } from "@modules/fight/effects/handlers/pct-life.handler";
import { ResistanceEffectHandler } from "@modules/fight/effects/handlers/resistance.handler";
import { SpecialEffectHandler } from "@modules/fight/effects/handlers/special.handler";
import { StatBoostEffectHandler } from "@modules/fight/effects/handlers/stat-boost.handler";
import { StatStealEffectHandler } from "@modules/fight/effects/handlers/stat-steal.handler";
import { StateEffectHandler } from "@modules/fight/effects/handlers/state.handler";
import { SummonEffectHandler } from "@modules/fight/effects/handlers/summon.handler";
import { TrapGlyphEffectHandler } from "@modules/fight/effects/handlers/trap-glyph.handler";
import { Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from "@nestjs/core";

const HANDLER_PROVIDERS = [
  DamageEffectHandler,
  LifeStealEffectHandler,
  HealEffectHandler,
  ApMpEffectHandler,
  MovementEffectHandler,
  StatBoostEffectHandler,
  StatStealEffectHandler,
  StateEffectHandler,
  PctLifeEffectHandler,
  SpecialEffectHandler,
  ResistanceEffectHandler,
  TrapGlyphEffectHandler,
  SummonEffectHandler,
];

@Injectable()
class EffectHandlerDiscovery implements OnModuleInit {
  private readonly logger = new Logger(EffectHandlerDiscovery.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly registry: EffectRegistry
  ) {}

  onModuleInit(): void {
    let total = 0;

    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== "object") {
        continue;
      }

      const proto = Object.getPrototypeOf(instance);
      for (const methodName of this.scanner.getAllMethodNames(proto)) {
        const meta = this.reflector.get<EffectHandlerMeta | undefined>(
          EFFECT_HANDLER_META,
          proto[methodName]
        );
        if (!meta) {
          continue;
        }

        const fn = proto[methodName] as (...args: unknown[]) => void;
        const bound = fn.bind(instance);
        for (const id of meta.effectIds) {
          this.registry.register(id, bound);
          total++;
        }
      }
    }

    this.logger.log(`Registered ${total} effect handlers`);
  }
}

@Module({
  providers: [
    {
      provide: EffectRegistry,
      useFactory: () => new EffectRegistry(),
    },
    EffectHandlerDiscovery,
    ...HANDLER_PROVIDERS,
  ],
  imports: [DiscoveryModule],
  exports: [EffectRegistry],
})
export class FightEffectsModule {}
