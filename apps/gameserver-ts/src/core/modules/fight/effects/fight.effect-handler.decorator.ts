import { SetMetadata } from "@nestjs/common";

export const EFFECT_HANDLER_META = "dofus:effectHandler";

export interface EffectHandlerMeta {
  effectIds: number[];
}

export const EffectHandler = (...effectIds: number[]) =>
  SetMetadata(EFFECT_HANDLER_META, { effectIds } satisfies EffectHandlerMeta);
