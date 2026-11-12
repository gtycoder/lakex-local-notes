/**
 * 261105 Batch4-D：设置 → 数据与存储 →「重建数据」。
 *
 * 语义（与主进程 RecoveredNotesService 对齐）：
 * - 先「扫描」得到候选（只读；文件在、元数据行丢），列表展示 路径/size/mtime/可派生标题；
 * - 勾选后「重建所选」→ danger 二次确认 → 只重建本次扫描候选（正文不可读的行禁用勾选）；
 * - 结果逐条列出 成功/跳过/拒绝/失败 与原因；**不改/不删正文文件**（重建只补元数据行，标 dirty 待同步）。
 *
 * 依赖通过 props 注入（native / confirm），便于渲染测试不依赖 IPC。
 */
import { useState } from "react";
import type { RebuildResultShape, RebuildScanResultShape } from "../../lib/types";
import { formatDateTime } from "../../core/dateFormat";

export interface RebuildConfirmOptions {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
}

export interface RebuildDataBlockProps {
  scan(): Promise<RebuildScanResultShape>;
  rebuild(ids: string[]): Promise<RebuildResultShape>;
  confirm(options: RebuildConfirmOptions): Promise<boolean>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function formatTime(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? String(ms) : formatDateTime(date);
}

const STATUS_LABEL: Record<string, string> = {
  created: "已重建",
  skipped: "已跳过",
  rejected: "拒绝",
  failed: "失败",
};

export function RebuildDataBlock({ scan, rebuild, confirm }: RebuildDataBlockProps) {
  const [busy, setBusy] = useState<"scan" | "rebuild" | null>(null);
  const [scanResult, setScanResult] = useState<RebuildScanResultShape | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<RebuildResultShape | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const toggle = (noteId: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(noteId); else next.delete(noteId);
      return next;
    });
  };

  const runScan = async () => {
    setBusy("scan");
    setNotice(null);
    try {
      const scanned = await scan();
      setScanResult(scanned);
      setSelected(new Set());
      setResult(null);
    } catch (error) {
      setNotice({ kind: "error", text: "扫描失败：" + (error instanceof Error ? error.message : String(error)) });
    } finally {
      setBusy(null);
    }
  };

  const runRebuild = async () => {
    if (busy !== null || selected.size === 0) return;
    const ids = [...selected];
    const ok = await confirm({
      title: `重建 ${ids.length} 条笔记行？`,
      body: "将从正文文件补建缺失的笔记行（放进「恢复的笔记」笔记本，标记为待同步）；不会修改或删除任何正文文件。正文不可解析的条目会被拒绝。",
      confirmText: "重建所选",
      danger: true,
    });
    if (!ok) return;
    setBusy("rebuild");
    setNotice(null);
    try {
      setResult(await rebuild(ids));
      setSelected(new Set());
    } catch (error) {
      setNotice({ kind: "error", text: "重建失败：" + (error instanceof Error ? error.message : String(error)) });
    } finally {
      setBusy(null);
    }
  };

  const rebuildableCount = scanResult?.candidates.filter((candidate) => candidate.rebuildable).length ?? 0;

  return (
    <>
      <div className="config-block__actions">
        <button className="ln-btn ln-btn--outlined" onClick={() => void runScan()} disabled={busy !== null}>
          {busy === "scan" ? "扫描中…" : "扫描"}
        </button>
        {scanResult && (
          <>
            <span className="config-stats">
              扫描 {scanResult.scannedFiles} 个正文文件，候选 {scanResult.candidates.length} 个（可重建 {rebuildableCount}）
              {scanResult.truncated ? "（已截断）" : ""}
            </span>
            <button className="ln-btn ln-btn--outlined ln-btn--danger-text" onClick={() => void runRebuild()} disabled={busy !== null || selected.size === 0}>
              {busy === "rebuild" ? "重建中…" : `重建所选（${selected.size}）`}
            </button>
            <button className="ln-btn ln-btn--outlined" onClick={() => { setScanResult(null); setSelected(new Set()); setResult(null); setNotice(null); }} disabled={busy !== null}>清除列表</button>
          </>
        )}
      </div>
      {notice && <div className="checks" role="status"><div className={"checks__row " + (notice.kind === "error" ? "checks__row--error" : "checks__row--ok")}>{notice.text}</div></div>}
      {scanResult && scanResult.candidates.length === 0 && (
        <div className="checks"><div className="checks__row checks__row--ok">没有发现「文件在、笔记行丢失」的候选。</div></div>
      )}
      {scanResult && scanResult.candidates.length > 0 && (
        <div className="checks" role="list">
          {scanResult.candidates.map((candidate) => (
            <label className="checks__row" key={candidate.noteId} role="listitem">
              <input
                type="checkbox"
                checked={selected.has(candidate.noteId)}
                disabled={!candidate.rebuildable || busy !== null}
                onChange={(event) => toggle(candidate.noteId, event.target.checked)}
                aria-label={"选择 " + candidate.title}
              />
              <span> {candidate.title}（{candidate.kind}，{formatSize(candidate.sizeBytes)}，{formatTime(candidate.mtimeMs)}）</span>
              <span className={candidate.rebuildable ? "" : "checks__row--warn"}>
                {candidate.relativePath}
                {candidate.titleSource === "fallback" ? "（标题为兜底名）" : ""}
                {candidate.rebuildable ? "" : "（不可重建：" + (candidate.reason ?? "正文无法解析") + "）"}
              </span>
            </label>
          ))}
        </div>
      )}
      {result && (
        <div className="checks" role="status">
          <div className="checks__row">重建结果：{result.results.map((item) => STATUS_LABEL[item.status] ?? item.status).join("、")}（笔记本：{result.notebookId}）</div>
          {result.results.map((item) => (
            <div className={"checks__row " + (item.status === "created" ? "checks__row--ok" : item.status === "skipped" ? "" : "checks__row--warn")} key={item.noteId}>
              {STATUS_LABEL[item.status] ?? item.status}：{item.title ?? item.noteId}
              {item.reason ? "（" + item.reason + "）" : ""}
            </div>
          ))}
        </div>
      )}
      <div className="checks"><div className="checks__row">重建只补元数据行（标记待同步），不改写、不删除正文文件；「恢复的笔记」笔记本可整体改名/移动。</div></div>
    </>
  );
}
