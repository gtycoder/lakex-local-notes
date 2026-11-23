/**
 * 「云端首次相遇」询问的 UI 状态（会话级、设备本地）：只被**手动同步**路径写入（useSyncController）。
 * 后台/自动同步路径不读不写 ⇒ 天然满足「后台同步绝不弹窗」红线（失败只挂状态文案）。
 * 语义与选项单一来源 = core/firstEncounter.ts（SYNC-PROTOCOL §21）。
 */
import type { EncounterFacts } from "../core/firstEncounter.js";

type Listener = () => void;
let facts: EncounterFacts | null = null;
const listeners = new Set<Listener>();

export function getEncounterAsk(): EncounterFacts | null { return facts; }
export function subscribeEncounterAsk(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function askFirstEncounter(f: EncounterFacts): void { facts = f; for (const fn of [...listeners]) fn(); }
export function clearFirstEncounterAsk(): void { if (facts !== null) { facts = null; for (const fn of [...listeners]) fn(); } }