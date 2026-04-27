import { Element } from "@modules/fight/fight.types";
import { match } from "ts-pattern";

export function effectIdToElement(effectId: number): Element | null {
  return match(effectId)
    .with(96, () => Element.Water as Element)
    .with(97, () => Element.Earth as Element)
    .with(98, () => Element.Air as Element)
    .with(99, () => Element.Fire as Element)
    .with(100, () => Element.Neutral as Element)
    .otherwise(() => null);
}
