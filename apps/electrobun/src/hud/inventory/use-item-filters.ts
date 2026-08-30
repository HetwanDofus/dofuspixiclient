import { type Dispatch, type SetStateAction, useMemo, useState } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";

import { FILTER_CATEGORIES } from "./inventory-theme";

export interface ItemFilters {
  /** Selected `FILTER_CATEGORIES` id, or null for "every category". */
  categoryId: string | null;
  setCategoryId: (id: string | null) => void;
  /** Selected `ItemTemplateData.typeName`, or null for "Tous types". */
  typeName: string | null;
  setTypeName: (name: string | null) => void;
  /** The type names present in the current category — the dropdown's options. */
  typeOptions: string[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  /** What survives all three filters, in the caller's own order. */
  visible: ItemData[];
}

/**
 * The 1.29 item browser's filtering: a category, a type and a name search,
 * applied client-side over a list the caller already holds.
 *
 * Extracted from `ItemGrid` when the trade window needed the same three
 * filters under a *different* header — retail lays the exchange window's
 * category buttons, dropdown and pods gauge out in one horizontal row,
 * which is not a variant of the stacked header `ItemGrid` draws. The state
 * and the predicates are the part both share; the markup is not.
 *
 * Selecting a category clears the type, because the type options are drawn
 * from the category and a stale one would filter everything away.
 */
export function useItemFilters(
  items: ItemData[],
  templates: Map<number, ItemTemplateData>
): ItemFilters {
  const [categoryId, setCategoryIdState] = useState<string | null>(null);
  const [typeName, setTypeName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");

  const category = FILTER_CATEGORIES.find((c) => c.id === categoryId) ?? null;

  const byCategory = useMemo(() => {
    if (!category) {
      return items;
    }
    return items.filter((item) => {
      const template = templates.get(item.itemId);
      return !!template && category.superTypes?.includes(template.superType);
    });
  }, [items, category, templates]);

  const typeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of byCategory) {
      const name = templates.get(item.itemId)?.typeName;
      if (name) {
        names.add(name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "fr"));
  }, [byCategory, templates]);

  const visible = useMemo(() => {
    return byCategory.filter((item) => {
      const template = templates.get(item.itemId);
      if (typeName && template?.typeName !== typeName) {
        return false;
      }
      if (
        search.trim() &&
        !template?.name.toLowerCase().includes(search.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [byCategory, templates, typeName, search]);

  const setCategoryId = (id: string | null) => {
    setCategoryIdState(id);
    setTypeName(null);
  };

  return {
    categoryId,
    setCategoryId,
    typeName,
    setTypeName,
    typeOptions,
    search,
    setSearch,
    searchOpen,
    setSearchOpen,
    visible,
  };
}
