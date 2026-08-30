import registryJson from "@/registry.json";

export type RegistryItem = (typeof registryJson.items)[number];

export function getRegistryItems() {
  return registryJson.items;
}

export function getRegistryItem(slug: string) {
  return registryJson.items.find((item) => item.name === slug);
}
