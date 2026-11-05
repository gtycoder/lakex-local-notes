/**
 * 资源管理里的「清理」明细面板（261105 用户点单）。
 *
 * 为什么单独一层：资源管理首页**不再外露任何删除按钮** —— 删除必须由用户先点「查看」
 * 进入本面板后才出现（缺正文/缺小记已经是这个口径，本组件把「未引用的本地文件 / 云端未引用文件」
 * 也收进同一模式）。避免在设置页扫一眼时误触删除。
 *
 * 版式复用 mb-sheet / mb-row / mb-btn / mb-set-* 原语，**不新增 CSS**；删除动作仍然直接调用宿主
 * 传入的回调（云清理的二次确认由宿主负责，和 MissingBodiesSheet 同口径）。
 */
import { Trash } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { formatBytes } from "../../lib/formatBytes";
import type { OrphanAsset } from "./useSettingsSectionData";

export type ResourceCleanupMode = "orphans" | "cloudGc";

export interface ResourceCleanupSheetProps {
  open: boolean;
  mode: ResourceCleanupMode;
  /** 未引用的本地文件（orphans 模式使用）。 */
  orphans: readonly OrphanAsset[];
  /** 清理动作进行中（禁用删除入口，避免重复提交）。 */
  busy: boolean;
  /** 云端是否可以清理（已配置 S3 且允许出网）。 */
  cloudReady: boolean;
  /** 云端不可清理时的原因（无 hover，要能直接看见）。 */
  cloudHint?: string;
  /** 上次云清理结果（成功/失败都留在面板里）。 */
  gcMessage?: string;
  onClose: () => void;
  onDeleteOrphan: (id: number) => void;
  onCleanOrphans: () => void;
  onCleanCloud: () => void;
}

export function ResourceCleanupSheet(props: ResourceCleanupSheetProps) {
  const isOrphans = props.mode === "orphans";
  const title = isOrphans ? "未引用的本地文件（" + props.orphans.length + "）" : "云端未引用文件";
  const footer = isOrphans
    ? (props.orphans.length > 0 ? (
        <div className="mb-sheet__foot">
          <button type="button" className="mb-btn mb-btn--primary" disabled={props.busy} onClick={props.onCleanOrphans}>
            清理全部（{props.orphans.length}）
          </button>
        </div>
      ) : undefined)
    : (
      <div className="mb-sheet__foot">
        <button type="button" className="mb-btn mb-btn--primary" disabled={props.busy || !props.cloudReady} onClick={props.onCleanCloud}>
          清理云端
        </button>
      </div>
    );
  return (
    <MobileSheet open={props.open} title={title} onClose={props.onClose} footer={footer}>
      {isOrphans ? (
        <div className="mb-set-items">
          {props.orphans.length === 0 && <div className="mb-empty mb-empty--inset">没有未引用的本地文件</div>}
          {props.orphans.map((item) => (
            <div key={item.id} className="mb-row">
              <span className="mb-row__title mb-ellipsis">{item.filename}</span>
              <span className="mb-row__meta">{formatBytes(item.size)}</span>
              <button
                type="button"
                className="mb-iconbtn mb-row__action"
                disabled={props.busy}
                onClick={() => props.onDeleteOrphan(item.id)}
                aria-label={"删除 " + item.filename}
              >
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-set-items">
          <div className="mb-set-item__desc">删除云端 7 天以上、没有被任何文档或历史版本引用的文件，删除后无法撤销。本机笔记与附件不受影响。</div>
          {(props.gcMessage || props.cloudHint) && <div className="mb-form__desc">{props.gcMessage || props.cloudHint}</div>}
        </div>
      )}
    </MobileSheet>
  );
}

export default ResourceCleanupSheet;
