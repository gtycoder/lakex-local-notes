/**
 * 共享端口接口（跨端契约；移动端现状与边界见 docs/MOBILE-TECH-STACK.md）。
 * - 只定义接口与类型，不包含实现——平台 adapter 各自实现；
 * - 位于共享层 src/core（纯类型，零平台依赖），桌面与移动端从同一入口消费。
 */

/**
 * 平台安全密钥存储（桌面 safeStorage / 移动 native-SecretStore —— 见 src/mobile/native/secretStore.ts 头注释的现状与硬约束）。
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
