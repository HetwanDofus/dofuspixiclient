import { SetMetadata } from "@nestjs/common";

export const CHALLENGE_META = "dofus:challenge";

export interface ChallengeMeta {
  id: number;
}

export const Challenge = (id: number) =>
  SetMetadata(CHALLENGE_META, { id } satisfies ChallengeMeta);
