/**
 * 设置 → 备份与恢复 →「从便携包导入（覆盖本机）」（docs/PORTABLE-TRANSFER.md §3）。
 *
 * 流程：系统文件选择器选 zip（原生解压+校验）→ 二次确认（覆盖范围/明文提示）→ 导入进度
 * → 结果计数（失败会回滚，提示里写明）。不需要先配置 S3；导入后如需增量同步再配。
 * 视觉只用移动端既有 mb-* 原语与 MobileSheet，不新增 CSS。
 */
import { useState } from "react";
import { Upload } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { formatBytes } from "../../lib/formatBytes";
import { isPortableImportNativeAvailable } from "../native/portablePackage";
import {
  discardStagedPortablePackage,
  pickPortablePackageForImport,
  runPortableImport,
  type PortableImportProgress,
  type PortableImportResult,
  type StagedPortablePackage,
} from "../portable/importPortable";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}

const PHASE_TEXT: Record<PortableImportProgress["phase"], string> = {
  "rollback-point": "准备回滚点",
  "copy-files": "复制文件",
  "read-rows": "读取桌面数据",
  "write-rows": "写入本机",
  baseline: "写入同步基线",
  commit: "提交",
  done: "收尾",
};

export function PortableImportSection({ onImported }: { onImported?: () => void }) {
  const native = isPortableImportNativeAvailable();
  const [staged, setStaged] = useState<StagedPortablePackage | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PortableImportProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PortableImportResult | null>(null);

  const closeSheet = async (): Promise<void> => {
    if (busy) return;
    setSheetOpen(false);
    setProgress(null);
    if (!result && staged) await discardStagedPortablePackage(staged);
    setStaged(null);
  };

  const pick = async (): Promise<void> => {
    if (!native || picking) return;
    setError("");
    setResult(null);
    setPicking(true);
    try {
      const next = await pickPortablePackageForImport();
      if (!next) return;
      setStaged(next);
      setSheetOpen(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPicking(false);
    }
  };

  const start = async (): Promise<void> => {
    if (!staged || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setProgress({ phase: "rollback-point", detail: "准备中…" });
    try {
      const imported = await runPortableImport(staged, setProgress);
      setResult(imported);
      onImported?.();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const footer = result ? (
    <div className="mb-set-block__actions">
      <button type="button" className="mb-btn mb-btn--primary" onClick={() => void closeSheet()}>完成</button>
    </div>
  ) : busy ? (
    <div className="mb-set-block__actions">
      <button type="button" className="mb-btn mb-btn--secondary" disabled>导入中…请不要退出 App</button>
    </div>
  ) : (
    <div className="mb-set-block__actions">
      <button type="button" className="mb-btn mb-btn--secondary" onClick={() => void closeSheet()}>取消</button>
      <button type="button" className="mb-btn mb-btn--danger" disabled={!staged} onClick={() => void start()}>
        覆盖本机并导入
      </button>
    </div>
  );

  return (
    <div className="mb-set-block">
      <div className="mb-set-block__name">从便携包导入（覆盖本机）</div>
      {/* 261109 用户定稿：能点的放前面，说明/状态放后面。 */}
      <div className="mb-set-block__actions">
        <button
          type="button"
          className="mb-btn mb-btn--secondary"
          disabled={!native || picking || busy}
          onClick={() => void pick()}
        >
          <Upload size={16} />{picking ? "正在解析…" : "选择便携包…"}
        </button>
      </div>
      <div className="mb-set-item__desc">
        用桌面导出的单个 .zip.lln 包（兼容旧 .zip）一次性搬全部数据（不含历史快照）。导入会覆盖本机全部笔记、小记、标签与回收站；
        包内是明文笔记，请自行选择可信的传输方式。不需要先配置云同步。
      </div>
      {!native && <div className="mb-set-item__desc">浏览器预览不支持（需要 Android 原生解压与只读 SQLite 读取）。</div>}
      {error && <div className="mb-set-item__desc" role="alert">{error}</div>}
      {result && !sheetOpen && (
        <div className="mb-set-item__desc" aria-live="polite">
          上次导入完成：笔记 {result.counts.notes} / 目录 {result.counts.folders} / 小记 {result.counts.quickNotes}
          / 标签 {result.counts.tags} / 文件 {result.counts.assets}
        </div>
      )}

      <MobileSheet open={sheetOpen} title={result ? "导入完成" : "从便携包导入"} dismissible={!busy} onClose={() => void closeSheet()} footer={footer}>
        <div className="mb-set-items">
          <div className="mb-set-block">
            {staged && !result && (
              <>
                <div className="mb-set-block__name">包信息</div>
                <div className="mb-set-item__desc">
                  导出于 {staged.manifest.exportedAt.slice(0, 10)}（桌面 {staged.manifest.appVersion}）
                </div>
                <div className="mb-set-item__desc">
                  笔记 {staged.manifest.counts.notes} / 目录 {staged.manifest.counts.folders}
                  / 小记 {staged.manifest.counts.quickNotes} / 标签 {staged.manifest.counts.tags}
                  / 资源 {staged.manifest.counts.assets}（约 {formatBytes(staged.bytes)}）
                </div>
                <div className="mb-set-item__desc" role="alert">
                  将覆盖本机全部数据（含回收站），不支持合并；导入前的数据会保留一份回滚副本，导入成功后才删除。
                </div>
              </>
            )}
            {busy && (
              <div className="mb-set-item__desc" aria-live="polite">
                {progress ? PHASE_TEXT[progress.phase] + "：" + progress.detail : "导入中…"}
              </div>
            )}
            {error && <div className="mb-set-item__desc" role="alert">{error}</div>}
            {result && (
              <>
                <div className="mb-set-block__name">已导入</div>
                <div className="mb-set-item__desc">
                  笔记 {result.counts.notes} / 目录 {result.counts.folders} / 小记 {result.counts.quickNotes}
                  / 标签 {result.counts.tags} / 文件 {result.counts.assets}（{formatBytes(result.counts.bytes)}）
                </div>
                {result.skippedRows > 0 && <div className="mb-set-item__desc">跳过无法识别的行 {result.skippedRows} 行</div>}
                {result.warnings.length > 0 && (
                  <div className="mb-set-item__desc" role="alert">{result.warnings.join("；")}</div>
                )}
                <div className="mb-set-item__desc">
                  {result.hasCloudBaseline
                    ? "本机已标记为「与云端一致」。如需增量同步，请到「云端与同步」配置 S3（只需拉取后续变更）。"
                    : "这是纯离线包：本机未写入云端基线。之后配置 S3 时，空桶会按首次上传同步；若桶里已有数据则会先以云端为准拉取。"}
                </div>
              </>
            )}
          </div>
        </div>
      </MobileSheet>
    </div>
  );
}
