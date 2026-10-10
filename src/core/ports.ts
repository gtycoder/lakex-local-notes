/**
 * 共享端口接口（跨端契约；移动端现状与边界见 docs/MOBILE-TECH-STACK.md）。
 * - 只定义接口与类型，不包含实现——桌面/移动端 adapter 各自实现；
 * - 位于共享层 src/core（纯类型，零平台依赖），桌面与移动端从同一入口消费；
 * - 桌面 IPC 契约不变：桌面 adapter 组合现有 store/noteMetadataRepository 方法实现这些接口。
 */
import type { TreeNode } from "./types.js";

/** 新建 notebook 的一次性输入（名称必填；icon 可空=默认图标）。 */
export interface CreateNotebookInput {
  title: string;
  icon: string | null;
}

/**
 * 目录树 Repository（两端各自实现：桌面 src/desktop/treeRepositoryAdapter.ts，移动 src/mobile/bridge.ts）。
 * 与桌面 noteMetadataRepository 方法对齐（createNotebook/createGroup/renameTreeNode/
 * setNodeIcon/moveTreeNodeOrdered），移动端不重新实现这些规则。
 */
export interface TreeRepository {
  listTreeNodes(): Promise<TreeNode[]>;
  createNotebook(input: CreateNotebookInput): Promise<TreeNode>;
  createGroup(parentId: string, title: string): Promise<TreeNode>;
  renameTreeNode(id: string, title: string): Promise<TreeNode>;
  setNodeIcon(id: string, icon: string | null): Promise<TreeNode>;
  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode>;
}

/**
 * 平台安全密钥存储（桌面 safeStorage / 移动 native-SecretStore —— 见 src/mobile/secretStore.ts 头注释的现状与硬约束）。
 * 平台实现：Electron → safeStorage（Keychain）；Android → Keystore-backed storage；测试 → memory fake。
 * Secret 不进入 SQLite 主表/IndexedDB 普通 kv/manifest/日志。
 */
export interface SecretStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 缓存分类统计：按类别报告可清理字节，UI 区分"能清/不能清"（当前仅移动端实现）。 */
export interface CacheSummary {
  runtimeBlobBytes: number;
  tempFileBytes: number;
  downloadableAssetBytes: number;
  pendingUploadBytes: number;
}

export interface ClearCacheResult {
  /** 实际清理的各分类字节数（供 UI 展示"清了多少"）。 */
  cleared: Partial<CacheSummary>;
}

/**
 * 派生缓存端口：只清理可重建数据（当前仅移动端实现）。
 * 永远不可清理：SQLite 主库/正文/未同步修改/.lake/历史快照/待上传资源/仍被引用的本地资源。
 */
export interface CachePort {
  getCacheSummary(): Promise<CacheSummary>;
  clearDerivedCaches(): Promise<ClearCacheResult>;
}

/** 应用信息：Android 读 Capacitor/App 原生版本，桌面读 Electron/package 元数据（当前仅移动端实现）。 */
export interface AppInfo {
  name: string;
  version: string;
  build: string;
  protocolVersion: string;
  platform: string;
}

export interface AppInfoPort {
  getAppInfo(): Promise<AppInfo>;
}
