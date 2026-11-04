/**
 * 「缺正文」「缺小记」列表（设置 → 资源管理，261104 B-lite）。
 *
 * 版式：复用设置页既有骨架（mb-set-block / mb-btn），**不新增 CSS**（移动端样式层已有全部类名）。
 * 动作三类（与桌面资源页同语义）：
 *   文档：从云端拉回 / 恢复最新历史 / 彻底删除（先移入回收站再 purge）；
 *   小记：从云端拉回 / 用搜索缓存重建纯文本 / 彻底删除（**没有历史快照**，不造历史路径）。
 * 危险动作与网络动作都走 confirmMobile 二次确认。
 *
 * 结果必须**看得见**（用户 261104 口径）：成功/失败都写一条 sheet 内常驻结果行（失败在 role=alert，
 * 不像 toast 那样 6 秒就没了）；成功后由宿主 reload ⇒ 计数与列表一起刷新，处理完自动落到空态。
 */
import { useState } from "react";
import { bridge } from "../bridge";
import { confirmMobile } from "../ui/ConfirmDialog";
import { MobileSheet } from "../ui/MobileSheet";
import { showToast } from "../ui/toastBus";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { MissingNoteBody, MissingQuickNote } from "../data/missingBodies";
import {
  docRecoveryLabel,
  missingRecoveryFailureText,
  quickNoteRecoveryLabel,
} from "../data/missingBodyMessages";

export type MissingBodiesMode = "docs" | "quickNotes";

export interface MissingBodiesListProps {
  mode: MissingBodiesMode;
  cloudConfigured: boolean;
  docs: readonly MissingNoteBody[];
  quickNotes: readonly MissingQuickNote[];
  /** 动作完成后刷新计数（由设置页传 reload）。 */
  onChanged: () => Promise<void> | void;
}

export interface MissingBodiesSheetProps extends MissingBodiesListProps {
  open: boolean;
  onClose: () => void;
}

/** 列表本体（与 Sheet 外壳分开：渲染测试只测列表，不碰 Sheet 的手势/返回栈）。 */
export function MissingBodiesList(props: MissingBodiesListProps) {
  const { mode, cloudConfigured, onChanged } = props;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** 最近一次动作的结果（常驻在 sheet 内；失败必须留在屏上，不能只靠 toast）。 */
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const runAction = async (key: string, task: () => Promise<void>): Promise<void> => {
    if (busyKey !== null) return;
    setBusyKey(key);
    try {
      await task();
    } catch (error) {
      const text = "操作失败：" + getNativeErrorMessage(error);
      setFeedback({ kind: "error", text });
      showToast(text, { type: "error" });
    } finally {
      setBusyKey(null);
    }
  };

  /** 失败统一走同一处：sheet 常驻行 + toast。 */
  const reportFailure = (reason: string): void => {
    const text = missingRecoveryFailureText(reason);
    setFeedback({ kind: "error", text });
    showToast(text, { type: "error" });
  };

  const reportSuccess = (text: string): void => {
    setFeedback({ kind: "ok", text });
    showToast(text);
  };

  const restoreDocFromCloud = (doc: MissingNoteBody): Promise<void> => runAction("cloud-" + doc.id, async () => {
    const ok = await confirmMobile({
      title: "从云端拉回正文？",
      body: "会用云端版本写入这篇文章的正文。本机正文文件已经缺失，没有内容会被覆盖。",
      confirmText: "从云端拉回",
    });
    if (!ok) return;
    const result = await bridge.restoreMissingNoteBody(doc.id);
    if (!result.ok) { reportFailure(result.reason); return; }
    reportSuccess("已从云端拉回：" + result.title);
    await onChanged();
  });

  const restoreDocFromHistory = (doc: MissingNoteBody): Promise<void> => runAction("history-" + doc.id, async () => {
    if (doc.lastHistoryId == null) return;
    await bridge.restoreHistory(doc.lastHistoryId);
    reportSuccess("已恢复最新历史版本");
    await onChanged();
  });

  const purgeDoc = (doc: MissingNoteBody): Promise<void> => runAction("purge-" + doc.id, async () => {
    const ok = await confirmMobile({
      title: "彻底删除这篇文档？",
      body: "先移入回收站再彻底删除，云端副本会一起下架，删除后无法恢复。",
      confirmText: "彻底删除",
      danger: true,
    });
    if (!ok) return;
    await bridge.trashNote(doc.id);
    await bridge.purgeTreeItem(doc.id, "note");
    reportSuccess("已彻底删除");
    await onChanged();
  });

  const restoreQuickNoteFromCloud = (item: MissingQuickNote): Promise<void> => runAction("cloud-" + item.id, async () => {
    const ok = await confirmMobile({
      title: "从云端拉回小记？",
      body: "会用云端版本写入这条小记的正文。本机正文文件已经缺失，没有内容会被覆盖。",
      confirmText: "从云端拉回",
    });
    if (!ok) return;
    const result = await bridge.restoreMissingQuickNoteFromCloud(item.id);
    if (!result.ok) { reportFailure(result.reason); return; }
    reportSuccess("已从云端拉回这条小记");
    await onChanged();
  });

  const rebuildQuickNoteFromText = (item: MissingQuickNote): Promise<void> => runAction("text-" + item.id, async () => {
    // 重建出来的是**本机新版本**（is_dirty=1）：下次同步会上传，可能覆盖云端版本 ⇒ 必须先说清后果。
    const ok = await confirmMobile({
      title: "用搜索缓存重建纯文本？",
      body: "只会恢复文字，图片与格式会丢失；重建后本机版本会在下次同步时上传，可能覆盖云端版本。",
      confirmText: "重建纯文本",
    });
    if (!ok) return;
    const result = await bridge.recoverMissingQuickNoteFromText(item.id);
    if (!result.ok) { reportFailure(result.reason); return; }
    reportSuccess("已用搜索缓存重建纯文本，图片与格式会丢失");
    await onChanged();
  });

  const purgeQuickNote = (item: MissingQuickNote): Promise<void> => runAction("purge-" + item.id, async () => {
    const ok = await confirmMobile({
      title: "彻底删除这条小记？",
      body: "会写入不可恢复的删除标记，云端副本一起下架，删除后无法恢复。",
      confirmText: "彻底删除",
      danger: true,
    });
    if (!ok) return;
    await bridge.purgeQuickNote(item.id);
    reportSuccess("已彻底删除");
    await onChanged();
  });

  const feedbackLine = feedback ? (
    <div className="mb-set-item__desc" role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</div>
  ) : null;

  if (mode === "docs") {
    return (
      <div className="mb-set-items">
        {feedbackLine}
        {props.docs.length === 0 && <div className="mb-empty mb-empty--inset">没有缺正文的文档</div>}
        {props.docs.map((doc) => (
          <div key={doc.id} className="mb-set-block">
            <div className="mb-set-block__name mb-ellipsis">{doc.title || "未命名文档"}</div>
            <div className="mb-set-item__desc">
              {docRecoveryLabel(doc.recovery)}
              {doc.historyCount > 0 ? `，${doc.historyCount} 份历史` : ""}
            </div>
            <div className="mb-set-block__actions">
              {doc.recovery === "cloud" && (
                <button className="mb-btn mb-btn--secondary" disabled={!cloudConfigured || busyKey !== null} onClick={() => void restoreDocFromCloud(doc)}>
                  从云端拉回
                </button>
              )}
              {doc.lastHistoryId != null && (
                <button className="mb-btn mb-btn--secondary" disabled={busyKey !== null} onClick={() => void restoreDocFromHistory(doc)}>
                  恢复最新历史
                </button>
              )}
              <button className="mb-btn mb-btn--secondary" disabled={busyKey !== null} onClick={() => void purgeDoc(doc)}>
                彻底删除
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mb-set-items">
      {feedbackLine}
      {props.quickNotes.length === 0 && <div className="mb-empty mb-empty--inset">没有缺小记</div>}
      {props.quickNotes.map((item) => (
        <div key={item.id} className="mb-set-block">
          <div className="mb-set-block__name mb-ellipsis">{item.previewText || "小记"}</div>
          <div className="mb-set-item__desc">{quickNoteRecoveryLabel(item.recovery)}</div>
          <div className="mb-set-block__actions">
            {item.recovery === "cloud" && (
              <button className="mb-btn mb-btn--secondary" disabled={!cloudConfigured || busyKey !== null} onClick={() => void restoreQuickNoteFromCloud(item)}>
                从云端拉回
              </button>
            )}
            {item.hasTextCache && (
              <button className="mb-btn mb-btn--secondary" disabled={busyKey !== null} onClick={() => void rebuildQuickNoteFromText(item)}>
                重建纯文本
              </button>
            )}
            <button className="mb-btn mb-btn--secondary" disabled={busyKey !== null} onClick={() => void purgeQuickNote(item)}>
              彻底删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 底部 Sheet 外壳（设置 → 资源管理里两行按钮各自打开一种模式）。 */
export function MissingBodiesSheet(props: MissingBodiesSheetProps) {
  const count = props.mode === "docs" ? props.docs.length : props.quickNotes.length;
  return (
    <MobileSheet open={props.open} title={(props.mode === "docs" ? "缺正文（" : "缺小记（") + count + "）"} onClose={props.onClose}>
      <MissingBodiesList
        mode={props.mode}
        cloudConfigured={props.cloudConfigured}
        docs={props.docs}
        quickNotes={props.quickNotes}
        onChanged={props.onChanged}
      />
    </MobileSheet>
  );
}
