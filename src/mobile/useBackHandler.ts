/**
 * Android 返回键处理（§9.2，Phase B1）。
 * 优先级：关闭 Sheet → 关闭 Drawer → 退出编辑态 → 文档页回笔记本 → 笔记本页回首页 → 首页交给系统。
 * 实现：@capacitor/app 的 backButton 监听；Web 浏览器环境（预览）无此插件时静默跳过（不注册）。
 */
import { useEffect } from "react";
import type { Route } from "./MobileApp";

export interface BackHandlerState {
  route: Route;
  editing: boolean;
  drawerOpen: boolean;
  createNbOpen: boolean;
  searchOpen: boolean;
  onExitEdit: () => void;
  onBackFromDocument: () => void;
  onBackFromNotebook: () => void;
  onBackFromTrash: () => void;
  onCloseDrawer: () => void;
  onCloseSheets: () => void;
  onAppExit: () => void;
}

/** 注册返回键监听。返回 true = 已消费（阻止系统退出）；false = 交给系统。 */
export function useBackHandler(state: BackHandlerState) {
  useEffect(() => {
    let cancelled = false;
    let listener: { remove(): void } | null = null;
    (async () => {
      try {
        const mod = await import("@capacitor/app");
        const l = await mod.App.addListener("backButton", () => {
          // 1) 最上层 Sheet（新建知识库/搜索）
          if (state.createNbOpen || state.searchOpen) { state.onCloseSheets(); return; }
          // 2) 设置 Drawer
          if (state.drawerOpen) { state.onCloseDrawer(); return; }
          // 3) 编辑态（文档页）
          if (state.route.kind === "document" && state.editing) { state.onExitEdit(); return; }
          // 4) 文档页 → 笔记本页
          if (state.route.kind === "document") { state.onBackFromDocument(); return; }
          // 5) 笔记本页 → 首页
          if (state.route.kind === "notebook") { state.onBackFromNotebook(); return; }
          // 5b) 回收站 → 首页
          if (state.route.kind === "trash") { state.onBackFromTrash(); return; }
          // 6) 首页：交给系统退出
          state.onAppExit();
        });
        // 竞态防护：async import 期间 effect 已 cleanup（依赖变化）→ 立即移除刚注册的监听
        if (cancelled) { void l.remove(); return; }
        listener = l;
      } catch {
        // 非 Capacitor 环境（Web 预览/测试）：不注册，浏览器 history 或物理键兜底
      }
    })();
    return () => {
      cancelled = true;
      void listener?.remove();
    };
    // 依赖：route.kind/editing 变化时重建监听（闭包拿最新状态）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.route.kind, state.editing, state.drawerOpen, state.createNbOpen, state.searchOpen]);
}
