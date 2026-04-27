import type { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import {
  CHALLENGE_META,
  type ChallengeMeta,
} from "@modules/fight/challenges/fight.challenge.decorator";
import { FightChallengeService } from "@modules/fight/challenges/fight.challenge.service";
import { AbnegationChallenge } from "@modules/fight/challenges/types/abnegation.challenge";
import { AraknophileChallenge } from "@modules/fight/challenges/types/araknophile.challenge";
import { BarbaricChallenge } from "@modules/fight/challenges/types/barbaric.challenge";
import { BlitzkriegChallenge } from "@modules/fight/challenges/types/blitzkrieg.challenge";
import { CasinoRoyalChallenge } from "@modules/fight/challenges/types/casino-royal.challenge";
import { CleanHandsChallenge } from "@modules/fight/challenges/types/clean-hands.challenge";
import { ContaminationChallenge } from "@modules/fight/challenges/types/contamination.challenge";
import { ContractKillerChallenge } from "@modules/fight/challenges/types/contract-killer.challenge";
import { CruelChallenge } from "@modules/fight/challenges/types/cruel.challenge";
import { DuelChallenge } from "@modules/fight/challenges/types/duel.challenge";
import { ElementaryChallenge } from "@modules/fight/challenges/types/elementary.challenge";
import { ElitistChallenge } from "@modules/fight/challenges/types/elitist.challenge";
import { ExuberantChallenge } from "@modules/fight/challenges/types/exuberant.challenge";
import { FirstTheMulesChallenge } from "@modules/fight/challenges/types/first-the-mules.challenge";
import { FocusChallenge } from "@modules/fight/challenges/types/focus.challenge";
import { GardenerChallenge } from "@modules/fight/challenges/types/gardener.challenge";
import { GravediggerChallenge } from "@modules/fight/challenges/types/gravedigger.challenge";
import { HermitChallenge } from "@modules/fight/challenges/types/hermit.challenge";
import { ImpertinenceChallenge } from "@modules/fight/challenges/types/impertinence.challenge";
import { IncurableChallenge } from "@modules/fight/challenges/types/incurable.challenge";
import { KeepMovingChallenge } from "@modules/fight/challenges/types/keep-moving.challenge";
import { LimpwristChallenge } from "@modules/fight/challenges/types/limpwrist.challenge";
import { LowLevelsFirstChallenge } from "@modules/fight/challenges/types/low-levels-first.challenge";
import { ManiacChallenge } from "@modules/fight/challenges/types/maniac.challenge";
import { MystiqueChallenge } from "@modules/fight/challenges/types/mystique.challenge";
import { NeitherPiwiChallenge } from "@modules/fight/challenges/types/neither-piwi.challenge";
import { NeitherPiwinChallenge } from "@modules/fight/challenges/types/neither-piwin.challenge";
import { NomadChallenge } from "@modules/fight/challenges/types/nomad.challenge";
import { PigheadChallenge } from "@modules/fight/challenges/types/pighead.challenge";
import { ProtectTheMulesChallenge } from "@modules/fight/challenges/types/protect-the-mules.challenge";
import { ReprieveChallenge } from "@modules/fight/challenges/types/reprieve.challenge";
import { ScantyChallenge } from "@modules/fight/challenges/types/scanty.challenge";
import { SharingChallenge } from "@modules/fight/challenges/types/sharing.challenge";
import { SightseeingChallenge } from "@modules/fight/challenges/types/sightseeing.challenge";
import { StatueChallenge } from "@modules/fight/challenges/types/statue.challenge";
import { SurvivorChallenge } from "@modules/fight/challenges/types/survivor.challenge";
import { TightChallenge } from "@modules/fight/challenges/types/tight.challenge";
import { TimeFliesChallenge } from "@modules/fight/challenges/types/time-flies.challenge";
import { ToEachHisPwnChallenge } from "@modules/fight/challenges/types/to-each-his-pwn.challenge";
import { TwoForOneChallenge } from "@modules/fight/challenges/types/two-for-one.challenge";
import { UnpredictableChallenge } from "@modules/fight/challenges/types/unpredictable.challenge";
import { UntouchableChallenge } from "@modules/fight/challenges/types/untouchable.challenge";
import { UnwillingVolunteerChallenge } from "@modules/fight/challenges/types/unwilling-volunteer.challenge";
import { VersatileChallenge } from "@modules/fight/challenges/types/versatile.challenge";
import { ZombieChallenge } from "@modules/fight/challenges/types/zombie.challenge";
import { Injectable, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { DiscoveryModule, DiscoveryService, Reflector } from "@nestjs/core";

const CHALLENGE_PROVIDERS = [
  AbnegationChallenge,
  AraknophileChallenge,
  BarbaricChallenge,
  BlitzkriegChallenge,
  CasinoRoyalChallenge,
  CleanHandsChallenge,
  ContaminationChallenge,
  ContractKillerChallenge,
  CruelChallenge,
  DuelChallenge,
  ElementaryChallenge,
  ElitistChallenge,
  ExuberantChallenge,
  FirstTheMulesChallenge,
  FocusChallenge,
  GardenerChallenge,
  GravediggerChallenge,
  HermitChallenge,
  ImpertinenceChallenge,
  IncurableChallenge,
  KeepMovingChallenge,
  LimpwristChallenge,
  LowLevelsFirstChallenge,
  ManiacChallenge,
  MystiqueChallenge,
  NeitherPiwiChallenge,
  NeitherPiwinChallenge,
  NomadChallenge,
  PigheadChallenge,
  ProtectTheMulesChallenge,
  ReprieveChallenge,
  ScantyChallenge,
  SharingChallenge,
  SightseeingChallenge,
  StatueChallenge,
  SurvivorChallenge,
  TightChallenge,
  TimeFliesChallenge,
  ToEachHisPwnChallenge,
  TwoForOneChallenge,
  UnpredictableChallenge,
  UntouchableChallenge,
  UnwillingVolunteerChallenge,
  VersatileChallenge,
  ZombieChallenge,
];

@Injectable()
class ChallengeDiscovery implements OnModuleInit {
  private readonly logger = new Logger(ChallengeDiscovery.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly service: FightChallengeService
  ) {}

  onModuleInit(): void {
    let total = 0;
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== "object") {
        continue;
      }
      const meta = this.reflector.get<ChallengeMeta | undefined>(
        CHALLENGE_META,
        instance.constructor
      );
      if (!meta) {
        continue;
      }
      const ctor = instance.constructor as new () => FightChallenge;
      this.service.registerFactory(meta.id, () => new ctor());
      total++;
    }
    this.logger.log(`Registered ${total} challenge types`);
  }
}

@Module({
  imports: [DiscoveryModule],
  providers: [
    FightChallengeService,
    ChallengeDiscovery,
    ...CHALLENGE_PROVIDERS,
  ],
  exports: [FightChallengeService],
})
export class FightChallengeModule {}
