/**
 * 移动端 SecretStore 的 **原生 Keystore** 实现（261010；替换 WebView 存储的降级件）。
 *
 * 原生侧 = `android/.../SecureStorePlugin.kt`：AndroidKeyStore 生成/保管 AES-256-GCM 密钥，
 * 密文落应用私有 SharedPreferences。接口与 core 的 `SecretStore` 端口一对一。
 *
 * 为什么不是 WebCrypto + localStorage（原实现）：密钥材料是固定派生的，能拿到 WebView 存储就能解开，
 * 属"混淆"而非硬件级保护；且 261009 实测 Android WebView 的 IndexedDB 不跨重启（同一类坑）。
 * 降级实现仍保留为 Web/测试环境的后端（见 ./secretStore.ts 的 localStorageSecretStore）。
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SecretStore } from "../core/ports.js";

interface SecureStoreBridge {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value?: string }>;
  remove(options: { key: string }): Promise<void>;
}

/**
 * 懒注册：模块加载时不碰 Capacitor。
 * 理由：① 测试里 `vi.resetModules()` 会重复 import 本模块，立即注册会打
 * 「plugin already registered」告警；② Web/vitest 下根本不该注册原生插件。
 */
let bridge: SecureStoreBridge | null = null;
function secureStoreBridge(): SecureStoreBridge {
  bridge ??= registerPlugin<SecureStoreBridge>("SecureStore");
  return bridge;
}

/** 原生插件是否可用（Web / vitest 下不可用 ⇒ 调用方走 localStorage 降级实现）。 */
export function keystoreAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SecureStore");
}

export const keystoreSecretStore: SecretStore = {
  async read(key) {
    try {
      const result = await secureStoreBridge().get({ key });
      return result?.value ?? null;
    } catch {
      // 插件异常/密钥失效 ⇒ 视为未配置（原生侧已清掉该键，让用户重填）
      return null;
    }
  },
  async write(key, value) {
    // 写失败必须抛：调用方 saveS3Settings 需要知道"没存住"，绝不能静默降级成"看起来保存成功"。
    await secureStoreBridge().set({ key, value });
  },
  async remove(key) {
    try { await secureStoreBridge().remove({ key }); } catch { /* 幂等 */ }
  },
}