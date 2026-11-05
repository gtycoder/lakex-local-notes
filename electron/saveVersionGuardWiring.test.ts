import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 保存版本守卫的**接线**护栏（Batch4-D）：契约类型/码在 src/lib/types.ts（单一来源），
 * 三处通道必须同步：IPC 注册（含 baseHash 入参与校验）→ preload → native 类型/封装。
 * 行为测试见 electron/saveVersionGuard.test.ts 与 src/hooks/useSavePipeline.test.ts。
 */
const registerNotes = readFileSync(new URL("./ipc/registerNotes.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
const native = readFileSync(new URL("../src/lib/native.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/lib/types.ts", import.meta.url), "utf8");

describe("保存版本守卫接线（Batch4-D）", () => {
  it("唯一冲突码/类型在 src/lib/types.ts，且主进程与渲染层共用", () => {
    expect(types).toContain('export const SAVE_CONFLICT_CODE = "external_changed" as const;');
    expect(types).toContain("export interface SaveNoteConflict");
    expect(types).toContain("export function isSaveConflict");
    expect(types).toContain("contentHash?: string;");
  });

  it("IPC 注册：save_note 收第 5 参 baseHash，校验后交给 saveNoteVersioned", () => {
    expect(registerNotes).toContain("function assertBaseHash(value: unknown): string | undefined");
    expect(registerNotes).toContain("baseHash?: unknown) =>");
    expect(registerNotes).toContain("assertBaseHash(baseHash)");
    expect(registerNotes).toContain("store.saveNoteVersioned(");
  });

  it("preload 透传 baseHash；native 类型与封装同步（不传 = 旧行为）", () => {
    expect(preload).toContain('saveNote: (id, title, content, caches, baseHash) => invoke("save_note", id, title, content, caches, baseHash)');
    expect(native).toContain("saveNote(id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }, baseHash?: string): Promise<SaveNoteResult>;");
    expect(native).toContain("saveNote: (id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }, baseHash?: string) => api().saveNote(id, title, content, caches, baseHash)");
  });
});
