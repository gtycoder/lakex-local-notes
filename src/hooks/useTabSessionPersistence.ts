/**
 * 桌面标签会话落盘（device-local）：App 的唯一写点（Batch4-D 收口）。
 *
 * 判据不在组件里重复判断——统一走 useSafeModeStatus.tabSessionWriteDecision：
 * 安全模式/判定未到 ⇒ **完全不碰**会话文件（既不清也不写），保证用户原会话能留到下次正常启动恢复。
 * 正常模式行为与旧 effect 完全一致（clearTabsOnExit=true 清档，否则写 ids/activeId）。
 */
import { useEffect } from "react";
import { clearTabSession, writeTabSession } from "../desktop/tabSession";
import type { OpenTab } from "../desktop/desktopTypes";
import { tabSessionWriteDecision, type SafeModeStatus } from "./useSafeModeStatus";

export interface TabSessionPersistenceOptions {
  /** 工作区已就绪（首个 workspace 到达）才写：启动前不落盘，避免把空标签写进去。 */
  ready: boolean;
  openTabs: readonly OpenTab[];
  activeNoteId: string | null;
  clearTabsOnExit: boolean | undefined;
  /** 安全模式判据（由 useSafeModeStatus 提供；做成入参以便测试与「只问一次 IPC」）。 */
  safeModeStatus: SafeModeStatus;
}

export function useTabSessionPersistence(options: TabSessionPersistenceOptions): void {
  const { ready, openTabs, activeNoteId, clearTabsOnExit, safeModeStatus } = options;
  useEffect(() => {
    if (!ready) return;
    const decision = tabSessionWriteDecision(safeModeStatus, clearTabsOnExit);
    if (decision === "skip") return;
    if (decision === "clear") { clearTabSession(); return; }
    writeTabSession({ ids: openTabs.map((tab) => tab.noteId), activeId: activeNoteId });
  }, [ready, openTabs, activeNoteId, clearTabsOnExit, safeModeStatus]);
}
