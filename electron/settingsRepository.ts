import type { DbLike } from "./dbLike.js";
import type { SecretCipher } from "../src/core/secretCipher.js";
import type { S3Settings, SyncSettings, S3GcSettings, HistorySettings } from "./storeTypes.js";
import { defaultAiSettings, normalizeAiSettings, type AiSettings } from "../src/core/aiProviders.js";

/**
 * settings 表存取（S3 / 同步 / S3 GC / 历史保留策略 + 密钥加解密）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 * 红线：S3 密钥用 SecretCipher（桌面默认 Electron safeStorage）加密落盘，
 * exportS3SettingsRow 绝不解密成明文（A2 恢复 seed 密文直通）。
 */
export class SettingsRepository {
  private readonly db: DbLike;
  private readonly secretCipher: SecretCipher;

  constructor(db: DbLike, secretCipher: SecretCipher) {
    this.db = db;
    this.secretCipher = secretCipher;
  }

  private encryptSecret(value: string): string {
    return this.secretCipher.encrypt(value);
  }

  private decryptSecret(value: string): string {
    return this.secretCipher.decrypt(value);
  }

  getS3Settings(): S3Settings | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_settings'").get() as { value: string } | undefined;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value) as S3Settings;
      if (!parsed || typeof parsed.endpoint !== "string") return null;
      if (typeof parsed.secretAccessKey === "string") parsed.secretAccessKey = this.decryptSecret(parsed.secretAccessKey);
      return parsed;
    } catch {
      return null;
    }
  }

  /** A2 恢复 seed：导出 settings 表原始行（secretAccessKey 为 enc:v1: 密文，绝不解密成明文）。无配置 → null。 */
  exportS3SettingsRow(): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_settings'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** A2 恢复 seed：把密文行原样写回（不经 saveS3Settings，避免二次加密）。 */
  importS3SettingsRow(value: string): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(value);
  }

  saveS3Settings(settings: S3Settings): void {
    // 密钥用 Electron safeStorage（macOS Keychain）加密落盘；不可用时退回明文
    const stored = { ...settings, secretAccessKey: this.encryptSecret(settings.secretAccessKey) };
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(stored));
  }

  /**
   * AI 设置（P0）：apiKey 用同一个 SecretCipher 加密落盘（safeStorage 不可用时 fail-closed）。
   * 红线：ai_settings 是**独立的 settings key**，不参与 S3/同步/任何导出路径（A2 seed 只读 s3_settings）。
   */
  getAiSettings(): AiSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='ai_settings'").get() as { value: string } | undefined;
    if (!row) return defaultAiSettings();
    try {
      const normalized = normalizeAiSettings(JSON.parse(row.value) as unknown);
      for (const provider of Object.values(normalized.providers)) {
        if (!provider.apiKey) continue;
        try {
          provider.apiKey = this.decryptSecret(provider.apiKey);
        } catch {
          // 密文不可解（换机/Keychain 变更）：当作未配置，绝不落明文、也不阻断其它设置
          provider.apiKey = undefined;
        }
      }
      return normalized;
    } catch {
      return defaultAiSettings();
    }
  }

  saveAiSettings(settings: AiSettings): void {
    const stored: AiSettings = { version: 1, activeProviderId: settings.activeProviderId, providers: {} };
    for (const [id, provider] of Object.entries(settings.providers)) {
      stored.providers[id] = { ...provider, apiKey: provider.apiKey ? this.encryptSecret(provider.apiKey) : undefined };
    }
    this.db.prepare("INSERT INTO settings(key,value) VALUES('ai_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(stored));
  }

  /** 历史保留策略配置（P5）：读取，缺省返回默认值 */
  getHistorySettings(): HistorySettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='history_settings'").get() as { value: string } | undefined;
    const def: HistorySettings = { maxSnapshots: 100, retentionDays: 30, cleanupIntervalHours: 24, snapshotIntervalMinutes: 15 };
    if (!row) return def;
    try {
      const parsed = JSON.parse(row.value) as Partial<HistorySettings>;
      return {
        maxSnapshots: typeof parsed.maxSnapshots === "number" && parsed.maxSnapshots > 0 ? parsed.maxSnapshots : def.maxSnapshots,
        retentionDays: typeof parsed.retentionDays === "number" && parsed.retentionDays > 0 ? parsed.retentionDays : def.retentionDays,
        cleanupIntervalHours: typeof parsed.cleanupIntervalHours === "number" && parsed.cleanupIntervalHours >= 0 ? parsed.cleanupIntervalHours : def.cleanupIntervalHours,
        snapshotIntervalMinutes: typeof parsed.snapshotIntervalMinutes === "number" && parsed.snapshotIntervalMinutes >= 0 ? parsed.snapshotIntervalMinutes : def.snapshotIntervalMinutes,
      };
    } catch {
      return def;
    }
  }

  saveHistorySettings(settings: HistorySettings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('history_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
  }

  getS3GcSettings(): S3GcSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='s3_gc_settings'").get() as { value: string } | undefined;
    const def: S3GcSettings = { gcRetentionDays: 7, gcIntervalHours: 24, trashAutoPurgeDays: 60 };
    if (!row) return def;
    try {
      const parsed = JSON.parse(row.value) as Partial<S3GcSettings>;
      return {
        gcRetentionDays: typeof parsed.gcRetentionDays === "number" && parsed.gcRetentionDays >= 0 ? parsed.gcRetentionDays : def.gcRetentionDays,
        gcIntervalHours: typeof parsed.gcIntervalHours === "number" && parsed.gcIntervalHours >= 0 ? parsed.gcIntervalHours : def.gcIntervalHours,
        trashAutoPurgeDays: typeof parsed.trashAutoPurgeDays === "number" && parsed.trashAutoPurgeDays >= 0 ? parsed.trashAutoPurgeDays : def.trashAutoPurgeDays,
      };
    } catch {
      return def;
    }
  }

  saveS3GcSettings(settings: S3GcSettings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('s3_gc_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
  }

  /** 是否已配置 S3（只判存在性、不解密密钥）：全新安装没有任何 S3 配置时，「启用云同步」默认关闭。 */
  private hasS3Settings(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM settings WHERE key='s3_settings'").get());
  }

  getSyncSettings(): SyncSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='sync_settings'").get() as { value: string } | undefined;
    // 261022（用户点单）：**默认开关 = 是否已配置 S3** —— 没配置时「启用云同步」默认关闭
    // （没配置与关掉在语义上等价：cloudStateOf ⇒ unconfigured ⇒ 一律不出网）；
    // 已配置的旧库仍默认开着（不回归）；显式存过的值永远优先。
    const def: SyncSettings = { enabled: this.hasS3Settings(), autoMode: "manual", autoIntervalMinutes: 15 };
    if (!row) return def;
    try {
      const parsed = JSON.parse(row.value) as Partial<SyncSettings>;
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : def.enabled,
        autoMode: parsed.autoMode === "interval" || parsed.autoMode === "onOpenClose" || parsed.autoMode === "manual" ? parsed.autoMode : def.autoMode,
        autoIntervalMinutes: typeof parsed.autoIntervalMinutes === "number" && parsed.autoIntervalMinutes >= 1 ? Math.floor(parsed.autoIntervalMinutes) : def.autoIntervalMinutes,
      };
    } catch {
      return def;
    }
  }

  saveSyncSettings(settings: SyncSettings): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES('sync_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify(settings));
  }
}
