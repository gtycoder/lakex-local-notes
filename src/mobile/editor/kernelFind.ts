/**
 * 移动端「文档内查找」的内核适配层（261029，MOB-04）。
 *
 * 背景：桌面工具栏查找走内核 search 插件（ISearchService：onSearch(query) → 命中 context）。
 * 移动端关掉了 toolbar 插件，但**编辑器实例内部仍挂着同一个 search 服务**：路径为
 * `editor._$commandUnderlay._renderer._$services.ISearchService`（owner 261029 运行时实测）。
 * 因此移动端保留自建查找条 UI，命中计数与定位改由内核同一套逻辑计算（不再扫 DOM）。
 *
 * ⚠️ 这是内核私有路径（非官方公开 API，见 yuque-re/kernel/LAKEX-CAPABILITY-MAP.md「查找替换」：
 * 没有公开的命中定位 API）。取不到服务时必须**优雅降级**，不能抛错/白屏。
 */

/** 内核查找 context（实测形状；只依赖我们真正调用到的方法）。 */
export interface KernelFindSession {
  /** 当前命中总数（getter）。 */
  readonly count: number;
  /** 跳到第 index 个命中（内核负责高亮与滚动）。 */
  jumpTo(index: number, focus?: boolean): boolean;
  /** 释放本轮搜索状态。 */
  destroy(): void;
}

export interface KernelFindService {
  /** 以关键词发起一轮搜索；无命中/空词时返回的 context.count = 0。 */
  onSearch(query: string): KernelFindSession | null;
}

interface EditorInternals {
  _$commandUnderlay?: {
    _renderer?: {
      getService?: (token: { value: string }) => unknown;
    };
  };
}

/** 从编辑器实例取内核 search 服务；取不到（内核版本变化/该实例无编辑器）返回 null。 */
export function getKernelFindService(editor: unknown): KernelFindService | null {
  if (!editor || typeof editor !== "object") return null;
  const underlay = (editor as EditorInternals)._$commandUnderlay;
  const renderer = underlay?._renderer;
  if (!renderer || typeof renderer.getService !== "function") return null;
  let service: unknown;
  try {
    service = renderer.getService({ value: "ISearchService" });
  } catch {
    return null;
  }
  if (!service || typeof (service as KernelFindService).onSearch !== "function") return null;
  return service as KernelFindService;
}
