/**
 * 小记库启动接线（C-04 从 main.ts H 原样搬出）：独立库打开/降级判定、标签存储统一迁移、
 * 孤儿文档标签关系清理。Batch3-A：小记库损坏**不得卡住整个应用**（降级「无小记」模式，
 * 文档/表格照常；绝不把整库判为坏库 —— 启动恢复页只管主库）。
 * 边界：不做 v3 注册（setQuickNotesStoreForV3 由 main.ts 经 registerQuickNotesForV3 注入，
 * boot 层不 import s3v3）；小记 IPC/同步判据见 quickNotesAvailability / desktopSync。
 * 护栏：electron/quickNotesDegradedWiring.test.ts（降级分支不注册 v3、不跑 recoverConversions）。
 */
import { QuickNotesStore, createUnavailableQuickNotesStore } from "../quickNotes.js";
import {
  decideQuickNotesAvailability,
  quickNotesDegradedMessage,
  setQuickNotesAvailability,
} from "../quickNotesAvailability.js";
import { migrateNoteTagLinksToQuickNotes } from "../tagStorage.js";
import type { Store } from "../store.js";
import { log } from "../logger.js";
import { formatLogFields } from "../../src/core/logFormat.js";

export interface QuickNotesWiringDeps {
  workspaceRoot: () => string;
  store: Store;
  /** v3 注册（main.ts 注入 setQuickNotesStoreForV3；降级分支绝不调用）。 */
  registerQuickNotesForV3: (quickNotes: QuickNotesStore) => void;
}

export function openQuickNotesWorkspace(deps: QuickNotesWiringDeps): QuickNotesStore {
  // Batch3-A（261105）：小记**独立库**损坏不得卡住整个应用。QuickNotesStore 单独 try/catch：
  // 失败 ⇒ 降级「无小记」模式（主库/文档/表格照常启动），小记相关 IPC 返回可读错误、v3 同步暂停；
  // 绝不把整库判为坏库（启动恢复页只管主库，语义见 startupRecovery）。
  // 确定赋值：try 成功或降级分支必给值（TS 无法穿透 decideQuickNotesAvailability 的判据）。
  let quickNotes!: QuickNotesStore;
  let quickNotesOpenError: unknown = null;
  try {
    quickNotes = new QuickNotesStore(deps.workspaceRoot(), log);
  } catch (error) {
    quickNotesOpenError = error;
  }
  const quickNotesAvailability = decideQuickNotesAvailability({ openError: quickNotesOpenError });
  setQuickNotesAvailability(quickNotesAvailability);
  if (quickNotesAvailability.mode === "degraded") {
    const degradedMessage = quickNotesDegradedMessage(quickNotesAvailability);
    quickNotes = createUnavailableQuickNotesStore(degradedMessage);
    log.app.error("[quick-notes] 小记库不可用，进入降级模式（文档/表格不受影响）"
      + formatLogFields({ reason: quickNotesAvailability.reason, detail: quickNotesAvailability.detail }));
    log.sync.warn("[sync] 小记库降级中：v3 同步已暂停（避免空小记世界被误判为删除）；出口见 设置→同步诊断");
  } else {
    // 只有正常打开时才注册给 v3：降级替身的空世界会被同步判成删除/下载（desktopSync 另有前置断言）。
    deps.registerQuickNotesForV3(quickNotes);
    quickNotes.recoverConversions((noteId) => deps.store.hasNote(noteId), (noteId) => deps.store.removeUntrackedNoteArtifacts(noteId));
    // 261107（上线前最后一批）：标签存储统一 —— 文档标签关系一次性迁入小记库，成功后把 documentTags 切到小记库；
    // 失败则保持主库旧关系（可回退），并在下次启动重试；旧表保留一个版本，不删除。
    try {
      const migration = migrateNoteTagLinksToQuickNotes({
        mainDbPath: deps.store.databasePath,
        quickDb: quickNotes.databaseHandle,
        log: (message) => log.app.info(message),
      });
      if (migration.ok) {
        deps.store.attachDocumentTagsDatabase(quickNotes.databaseHandle);
        if (!migration.already) log.app.info("[tags] 标签存储已统一到小记库（moved=" + migration.moved + "）");
      } else {
        log.app.warn("[tags] 标签存储迁移失败，继续使用主库旧关系：" + (migration.reason ?? "unknown"));
      }
    } catch (error) {
      log.app.warn("[tags] 标签存储迁移异常，继续使用主库旧关系：" + (error as Error).message);
    }
    // 261105 P1：启动自检清理「文档关系指向不存在标签」的孤儿行（目录唯一来源 = 小记库 tags）。
    try {
      const cleanup = deps.store.documentTags.cleanupOrphans(new Set(quickNotes.tags.list().map((tag) => tag.id)));
      if (cleanup.links > 0) log.app.warn("[tags] 启动清理孤儿文档标签关系 " + cleanup.links + " 行（" + cleanup.tags + " 个标签）");
    } catch (error) { log.app.warn("[tags] 孤儿文档标签关系清理失败：" + (error as Error).message); }
  }
  return quickNotes;
}
