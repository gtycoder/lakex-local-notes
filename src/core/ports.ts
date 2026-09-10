/**
 * 共享端口接口（Phase 0A：移动端方案 §4.1/§6.3/§6.4/§17.5）。
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
 * 目录树 Repository（移动端方案 §4.1）。
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
 * 平台安全密钥存储（移动端方案 §17.5）。
 * 平台实现：Electron → safeStorage（Keychain）；Android → Keystore-backed storage；测试 → memory fake。
 * Secret 不进入 SQLite 主表/IndexedDB 普通 kv/manifest/日志。
 */
export interface SecretStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 缓存分类统计（移动端方案 §17.4）：按类别报告可清理字节，UI 区分"能清/不能清"。 */
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
 * 派生缓存端口（移动端方案 §6.3）：只清理可重建数据。
 * 永远不可清理：SQLite 主库/正文/未同步修改/.lake/历史快照/待上传资源/仍被引用的本地资源。
 */
export interface CachePort {
  getCacheSummary(): Promise<CacheSummary>;
  clearDerivedCaches(): Promise<ClearCacheResult>;
}

/** 应用信息（移动端方案 §6.4）：Android 读 Capacitor/App 原生版本，桌面读 Electron/package 元数据。 */
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
