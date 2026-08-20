import type { SettingsCategory } from "./SettingsPanel";

export interface SettingsNavSearchItem {
  id: SettingsCategory;
  label: string;
  keywords?: string;
}

export function filterSettingsNav<T extends SettingsNavSearchItem>(items: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return items;
  return items.filter((item) => `${item.label} ${item.keywords ?? ""}`.toLocaleLowerCase().includes(normalized));
}
