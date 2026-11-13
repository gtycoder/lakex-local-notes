/**
 * 资源管理里的「清理」明细面板（261105 用户点单；261113 云清理改为「先预览再删」）。
 *
 * 为什么单独一层：资源管理首页**不再外露任何删除按钮** —— 删除必须由用户先点「查看」
 * 进入本面板后才出现（缺正文/缺小记已经是这个口径，本组件把「未引用的本地文件 / 云端未引用文件」
 * 也收进同一模式）。避免在设置页扫一眼时误触删除。
 *
 * 云清理（cloudGc）两步走：
 *   ① 「预览」= bridge.gcDeepCleanup({dryRun:true})，只统计不删（引擎 dryRun 不调 deleteMany、
 *      不写删除日志），面板显示「将删 N 个对象、共 M 字节」与保留窗口；
 *   ② 有预览且 N>0 才允许「清理 N 个对象」；确认与真删由宿主负责（与 MissingBodiesSheet 同口径）。
 * 计数口径：「候选（将删）」与「已删」分开显示，绝不把已删数当候选数。
 *
 * 版式复用 mb-sheet / mb-row / mb-btn / mb-set-* 原语，**不新增 CSS**。
 */
import type { KeyboardEvent } from "react";
import { Trash } from "lucide-react";
import { MobileSheet } from "../ui/MobileSheet";
import { SheetFooter } from "../ui/SheetFooter";
import { formatBytes } from "../../lib/formatBytes";
import type { OrphanAsset } from "./useSettingsSectionData";
import { EmptyState } from "../ui/EmptyState";
import { MOBILE_GC_RETENTION_DAYS } from "../sync/gcPolicy";

export type ResourceCleanupMode = "orphans" | "cloudGc";

/** 云清理预览结果：dryRun 只统计不删。 */
export interface GcPreview {
  /** 将删对象数（0 = 没有可清理的）。 */
  count: number;
  /** 将删对象总字节；null = 有对象拿不到体积（不显示字节）。 */
  bytes: number | null;
}

export interface ResourceCleanupSheetProps {
  open: boolean;
  mode: ResourceCleanupMode;
  /** 未引用的本地文件（orphans 模式使用）。 */
  orphans: readonly OrphanAsset[];
  /** 孤儿清理动作进行中（禁用孤儿删除入口，避免重复提交）。 */
  busy: boolean;
  /** 云清理（预览或真删）进行中：云面板两个按钮都禁用。 */
  cloudBusy?: boolean;
  /** 云端是否可以清理（已配置 S3 且允许出网）。 */
  cloudReady: boolean;
  /** 云端不可清理时的原因（无 hover，要能直接看见）。 */
  cloudHint?: string;
  /** 上一次云清理的结果/失败原因（成功/失败都留在面板里）。 */
  gcMessage?: string;
  /** 上一次「预览」结果；null = 尚未预览（此时不允许真删）。 */
  gcPreview?: GcPreview | null;
  onClose: () => void;
  /** 点击行预览内容（图片走应用内 Lightbox；其它附件交系统应用打开；文件缺失则不预览）。 */
  onPreviewOrphan?: (item: OrphanAsset) => void;
  onDeleteOrphan: (id: number) => void;
  onCleanOrphans: () => void;
  /** 「预览」：dryRun 只统计不删。 */
  onPreviewCloud?: () => void;
  /** 真删（调用方负责二次确认；只有已有非空预览时按钮才可用）。 */
  onCleanCloud: () => void;
}

export function ResourceCleanupSheet(props: ResourceCleanupSheetProps) {
  const isOrphans = props.mode === "orphans";
  const preview = props.gcPreview ?? null;
  const cloudBusy = props.cloudBusy === true;
  const cloudDisabled = cloudBusy || !props.cloudReady;
  // 真删的前置：已预览、命中数 > 0、云端可用且当前没有动作在跑。
  const canCleanCloud = !cloudDisabled && preview !== null && preview.count > 0;

  if (isOrphans) {
    const title = "未引用的本地文件（" + props.orphans.length + "）";
    const footer = props.orphans.length > 0 ? (
      <div className="mb-sheet__foot">
        <button type="button" className="mb-btn mb-btn--primary" disabled={props.busy} onClick={props.onCleanOrphans}>
          清理全部（{props.orphans.length}）
        </button>
      </div>
    ) : undefined;
    return (
      <MobileSheet open={props.open} title={title} onClose={props.onClose} footer={footer}>
        <div className="mb-set-items">
          {props.orphans.length === 0 && <EmptyState inset>没有未引用的本地文件</EmptyState>}
          {props.orphans.map((item) => (
            <div
              key={item.id}
              className="mb-row"
              {...(props.onPreviewOrphan
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": "预览 " + item.filename,
                    onClick: () => props.onPreviewOrphan?.(item),
                    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      props.onPreviewOrphan?.(item);
                    },
                  }
                : {})}
            >
              <span className="mb-row__title mb-ellipsis">{item.filename}</span>
              <span className="mb-row__meta">{formatBytes(item.size)}</span>
              <button
                type="button"
                className="mb-iconbtn mb-row__action"
                disabled={props.busy}
                onClick={(event) => { event.stopPropagation(); props.onDeleteOrphan(item.id); }}
                aria-label={"删除 " + item.filename}
              >
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      </MobileSheet>
    );
  }

  const cloudFooter = (
    <SheetFooter
      cancel={{
        label: "预览",
        onClick: props.onPreviewCloud,
        disabled: cloudDisabled,
      }}
      confirm={{
        label: cloudBusy
          ? "处理中…"
          : preview !== null && preview.count > 0
            ? "清理 " + preview.count + " 个对象"
            : "清理云端",
        onClick: props.onCleanCloud,
        disabled: !canCleanCloud,
      }}
    />
  );
  return (
    <MobileSheet open={props.open} title="云端未引用文件" onClose={props.onClose} footer={cloudFooter}>
      <div className="mb-set-items">
        <div className="mb-set-item__desc">
          删除云端超过 {MOBILE_GC_RETENTION_DAYS} 天、没有被任何文档或历史版本引用的文件，删除后无法撤销。本机笔记与附件不受影响。
        </div>
        {preview && (
          <div className="mb-set-item__desc" role="status">
            {preview.count === 0
              ? "预览结果：没有可清理的云端文件。"
              : "预览结果：将删除 " + preview.count + " 个对象" +
                (preview.bytes === null ? "" : "，共 " + formatBytes(preview.bytes)) +
                "（保留窗口 " + MOBILE_GC_RETENTION_DAYS + " 天）。"}
          </div>
        )}
        {(props.gcMessage || props.cloudHint) && <div className="mb-form__desc">{props.gcMessage || props.cloudHint}</div>}
      </div>
    </MobileSheet>
  );
}

export default ResourceCleanupSheet;
