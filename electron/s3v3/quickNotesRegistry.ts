import type { QuickNotesStore } from "../quickNotes.js";

let quickNotesStore: QuickNotesStore | null = null;

/** 由 main 注入桌面 QuickNotesStore；v3 小记开关打开时适配器使用。 */
export function setQuickNotesStoreForV3(store: QuickNotesStore): void { quickNotesStore = store; }
export function getQuickNotesStoreForV3(): QuickNotesStore | null { return quickNotesStore; }
