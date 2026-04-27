import { z } from "zod";

export const ShapeSchema = z.enum(["static", "animated", "tile", "staticTile"]);
export type Shape = z.infer<typeof ShapeSchema>;

export const IdFromSchema = z.enum([
  "filename",
  "symbolName",
  "parentDirFilename",
]);
export type IdFrom = z.infer<typeof IdFromSchema>;

export const TintModeSchema = z.enum([
  "player",
  "guild",
  "alignmentLevel",
  "spell",
]);
export type TintMode = z.infer<typeof TintModeSchema>;

const ColorZonesTrait = z.object({
  zoneCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  tintMode: TintModeSchema,
});

const AccessorySlotsTrait = z.object({
  count: z.literal(5),
});

const DirectionLabelsTrait = z.object({
  names: z.array(z.string()).nonempty(),
});

const MultiSymbolTrait = z.object({
  symbolRegex: z.instanceof(RegExp),
});

const TileBehaviorTrait = z.object({
  classificationsPath: z.string(),
  overridesPath: z.string().optional(),
});

const SoundTrait = z.object({
  source: z.literal("DoAction.PlaySound"),
});

const LifecycleTrait = z.object({
  markers: z.array(
    z.enum(["stopFrame", "fadingFrame", "requiresTypeScript"])
  ),
});

export const CategoryTraitsSchema = z.object({
  colorZones: ColorZonesTrait.optional(),
  accessorySlots: AccessorySlotsTrait.optional(),
  directionLabels: DirectionLabelsTrait.optional(),
  multiSymbol: MultiSymbolTrait.optional(),
  tileBehavior: TileBehaviorTrait.optional(),
  sound: SoundTrait.optional(),
  lifecycle: LifecycleTrait.optional(),
});
export type CategoryTraits = z.infer<typeof CategoryTraitsSchema>;

export const CategoryDefSchema = z.object({
  name: z.string(),
  source: z.string(),
  idFrom: IdFromSchema,
  idOffset: z.number().int().optional(),
  shape: ShapeSchema,
  skip: z.boolean().optional(),
  traits: CategoryTraitsSchema.default({}),
});
export type CategoryDef = z.infer<typeof CategoryDefSchema>;

export const CategoryRegistrySchema = z.array(CategoryDefSchema);
export type CategoryRegistry = z.infer<typeof CategoryRegistrySchema>;

export const PIPELINE_VERSION = 1;
