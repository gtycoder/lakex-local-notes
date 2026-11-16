/**
 * 261117 D 项（用户已批准）：设置「关于 → 卸载与换机」里的「导出便携包到文件」动作行。
 *
 * 为什么需要它：卸载会删掉 App 私有目录里的全部数据（正文/附件/历史/回收站都在里面），
 * S3 只是镜像。导出便携包 = 用户可见「下载」目录里的单个文件，卸载 App 后仍留存，重装后可再导入恢复。
 *
 * 状态机：idle → 进行中（按钮禁用 + 文案「正在导出…」）→ 成功（位置 + 文件名 + 文档/小记计数）/ 失败（可执行错误）。
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { exportPortableSnapshotToDownloads, portableExportSummary, type PortableExportOutcome } from "../portable/exportPortable";

export function PortableExportBlock() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PortableExportOutcome | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await exportPortableSnapshotToDownloads());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-set-block mb-set-block--actions-first">
      <div className="mb-set-block__name">导出便携包（卸载前最可靠）</div>
      <div className="mb-set-block__actions">
        <button type="button" className="mb-btn mb-btn--outlined" disabled={busy} onClick={() => void run()}>
          <Download size={16} aria-hidden="true" />
          {busy ? "正在导出…" : "导出便携包到文件"}
        </button>
      </div>
      <div className="mb-set-item__desc">
        导出到系统「下载」目录的一个 .zip.lln 文件，卸载 App 后仍然留存；换机或重装后可从「备份与恢复」再导入。包里是明文全量数据（含历史与回收站），请妥善保管，不要随意发给他人。
      </div>
      {outcome && outcome.ok && (
        <div className="mb-set-item__desc" role="status" aria-live="polite">{portableExportSummary(outcome)}</div>
      )}
      {outcome && !outcome.ok && (
        <div className="mb-set-item__error" role="alert">{outcome.error}</div>
      )}
    </div>
  );
}
