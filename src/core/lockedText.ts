/**
 * 「加密文本」卡片 —— **密码学原语 + 落盘值模型**（纯逻辑，无 React / 无 DOM / 无 node:）。
 *
 * 产品口径（用户 261023 定稿）：
 *   ① 加密存储：正文只以密文落盘；② 无密码不可见正文；③ 多端同一个密码即可解开。
 *
 * 安全模型（这是本文件存在的全部理由，改之前先读完）：
 * - **端到端**：密钥只在本机由用户密码经 PBKDF2-SHA256 派生（salt 随机、参数随密文一起存），
 *   密码与派生密钥**从不写入正文、不进 S3、不进日志**。云端（S3 私有桶）只看得到密文。
 * - **不是"防误读"**：与 `s3ConfigTransfer` 的内置固定种子不同，这里没有内置密钥；忘记密码 = 永久不可解。
 * - **不防"已经拿到明文的人"**：解锁后明文只活在组件内存里。任何把明文写回 cardValue / setDocument /
 *   自动保存的路径都会让"加密存储"变成假话 —— 渲染层必须只调用 `encryptLockedText` 后再 `updateCardValue`。
 * - **弱密码可被离线爆破**：密文随用户自己的 S3 备份，攻击者拿到后可离线尝试；KDF 迭代数就是为了抬高成本。
 *
 * 落盘形态（cardValue，内核会额外补 `$name` 字段）：
 * ```json
 * { "v":1, "alg":"A256GCM", "kdf":"PBKDF2-SHA256", "iter":210000,
 *   "salt":"<base64url 16B>", "iv":"<base64url 12B>", "ct":"<base64url 密文+tag>" }
 * ```
 * 版本化：`v`/参数全部随值存，未来换算法或加迭代数都不需要迁移旧数据（旧值仍按自己的参数解）。
 */

/** 卡片名（持久化在 cardValue.`$name` 上，**必须唯一且不要改**：改了旧正文就不再渲染本卡）。 */
export const LOCKED_TEXT_CARD_NAME = "lake-locked-text";
/** 当前密文格式版本。 */
export const LOCKED_TEXT_SCHEMA_VERSION = 1 as const;
/** KDF 参数（PBKDF2-SHA256 迭代数）。数值随密文一起存 ⇒ 调大只影响新加密的内容。 */
export const LOCKED_TEXT_KDF_ITERATIONS = 210_000;
/** KDF 允许区间：读别人（或未来）写的值时防止被要求做无界工作。 */
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 1_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** GCM tag 16B ⇒ 密文至少这么长。 */
const MIN_CIPHERTEXT_BYTES = 16;

/** 明文长度上限（卡片是"一段文本"，不是长文档；超限明确报错，不静默截断）。 */
export const LOCKED_TEXT_MAX_CHARS = 200_000;
/** 密文上界：base64url 之后约 4/3 明文长度 + tag；给脏值一个天花板，避免 atob 吃掉任意大字符串。 */
const MAX_CIPHERTEXT_BYTES = Math.ceil((LOCKED_TEXT_MAX_CHARS * 4 + 16) / 3) + 64;
/** 密码最短长度（下限提示；不做强度评估 —— 单用户本地场景）。 */
export const LOCKED_TEXT_MIN_PASSWORD_CHARS = 6;
/** 密码是否满足最低要求（UI 与测试共用同一判据，避免"UI 说 6 位、core 说 4 位"）。 */
export function isValidLockedTextPassword(password: string): boolean {
  return password.normalize("NFC").length >= LOCKED_TEXT_MIN_PASSWORD_CHARS;
}
/** AAD：协议/版本域隔离（不同版本、不同卡型互不通用）。**注意它不含卡 id/文档 id**，
 *  所以同密码下把 A 卡的密文贴到 B 卡仍能解开——那属于"持有密文+密码"的攻击面，不在本层拦。 */
const AAD = new TextEncoder().encode("lake-locked-text:v1");
/** 导出 / 复制 / 搜索索引里唯一允许出现的占位（绝不返回明文）。 */
export const LOCKED_TEXT_PLACEHOLDER = "［加密文本］";

export type LockedTextErrorCode =
  /** 密码错（GCM 认证失败）。 */
  | "bad-password"
  /** 密文结构非法（被截断 / 不是本卡的格式 / 参数越界）。 */
  | "invalid-value"
  /** 环境不支持 WebCrypto（理论上两端都有）。 */
  | "crypto-unavailable"
  /** 明文超限 / 空密码。 */
  | "invalid-input";

export class LockedTextError extends Error {
  readonly code: LockedTextErrorCode;
  constructor(code: LockedTextErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LockedTextError";
    this.code = code;
  }
}

/** 卡片的落盘值（内核负责补 `$name`）。**除这几个字段外不要往里加东西**。 */
export interface LockedTextCipher {
  v: typeof LOCKED_TEXT_SCHEMA_VERSION;
  alg: "A256GCM";
  kdf: "PBKDF2-SHA256";
  iter: number;
  /** base64url，16B */
  salt: string;
  /** base64url，12B */
  iv: string;
  /** base64url，密文 + 16B tag */
  ct: string;
}

/** 值分类：UI 据此在"设置密码 / 输入密码 / 格式损坏"之间选态。
 *  （语雀 App 的 `lockedtext` 是**内核内置节点名**，由内核按节点名分派到 unknown-card fallback；
 *    它不会走到本卡的 `lake-locked-text` 节点上，所以这里没有"语雀旧卡"态——别把防御分支当功能。） */
export type LockedTextKind = "empty" | "cipher" | "unknown";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle) throw new LockedTextError("crypto-unavailable");
  return c.subtle;
}

function randomBytes(length: number) {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.getRandomValues) throw new LockedTextError("crypto-unavailable");
  const bytes = new Uint8Array(length);
  c.getRandomValues(bytes);
  return bytes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 值是不是"本应用写的密文"。结构校验包含**长度与区间**，避免读到一个畸形值后去做无界 KDF。
 */
export function isLockedTextCipher(value: unknown): value is LockedTextCipher {
  if (!isPlainObject(value)) return false;
  const v = value as Partial<LockedTextCipher>;
  if (v.v !== LOCKED_TEXT_SCHEMA_VERSION) return false;
  if (v.alg !== "A256GCM" || v.kdf !== "PBKDF2-SHA256") return false;
  if (typeof v.iter !== "number" || !Number.isInteger(v.iter)) return false;
  if (v.iter < MIN_ITERATIONS || v.iter > MAX_ITERATIONS) return false;
  if (typeof v.salt !== "string" || typeof v.iv !== "string" || typeof v.ct !== "string") return false;
  const salt = base64UrlToBytes(v.salt);
  const iv = base64UrlToBytes(v.iv);
  const ct = base64UrlToBytes(v.ct);
  if (!salt || salt.length !== SALT_BYTES) return false;
  if (!iv || iv.length !== IV_BYTES) return false;
  if (!ct || ct.length < MIN_CIPHERTEXT_BYTES || ct.length > MAX_CIPHERTEXT_BYTES) return false;
  return true;
}

/**
 * 判断卡片当前处于哪种状态。
 * - `empty`：还没设密码（全新卡）。**不允许写正文**（否则就没有"加密存储"可言）。
 * - `cipher`：本应用的密文。
 * - `legacy-yuque`：语雀 App 的加密文本卡（`{originData, cryptoData, locked}`，服务端加解密）——本机解不开，只能提示。
 */
export function lockedTextKind(value: unknown): LockedTextKind {
  if (value === null || value === undefined) return "empty";
  if (!isPlainObject(value)) return "unknown";
  if (value.ct !== undefined || value.salt !== undefined || value.iv !== undefined) {
    return isLockedTextCipher(value) ? "cipher" : "unknown";
  }
  const foreign = value as { cryptoData?: unknown; originData?: unknown };
  // 防御：万一值里出现语雀字段（正常不会：那是另一个节点名），按不可识别处理，绝不当空卡覆盖。
  if (typeof foreign.cryptoData === "string" && foreign.cryptoData.length > 0) return "unknown";
  if (typeof foreign.originData === "string" && foreign.originData.length > 0) return "unknown";
  // 我们自己的新卡 = {$name, $htmlStr?, id?}（内核自动补 $name/id）⇒ "还没设密码"。
  return "empty";
}

/**
 * 密码归一：macOS 与部分输入法给的是 NFD（`é` = e + 组合重音），Android/多数输入法给 NFC。
 * 不归一 ⇒ 同一串"看起来一样"的密码在两端派生出不同密钥 ⇒ "多端同一个密码"失效。
 */
function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  // 复制一份 ArrayBuffer 背书的视图：WebCrypto 的参数只接受 ArrayBuffer 视图（SharedArrayBuffer 不行），
  // 而 TS 的 Uint8Array 默认泛型是 ArrayBufferLike。复制代价可忽略（16 字节）。
  const saltBytes = new Uint8Array(salt);
  const material = await subtle().importKey("raw", new TextEncoder().encode(normalizePassword(password)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * 会话内缓存的派生密钥（解锁/设密码时算一次）。
 *
 * 为什么必须缓存：解锁后每次保存若都重跑 210k PBKDF2（≈70-90ms，移动端更慢），
 * 连续输入时"未落盘窗口"会被放大，关标签/锁文档前最后一段明文就更容易丢
 * （评审 B1）。缓存后每次保存只做一次 AES-GCM（<1ms），窗口缩到可忽略。
 */
export interface LockedTextSessionKey {
  key: CryptoKey;
  /** base64url 16B：会话固定（同一密码下换 salt 会改变密文，但只有"改密码"才换 salt）。 */
  salt: string;
  iter: number;
}

/** 新会话（设密码 / 改密码）：新 salt + 派生。 */
export async function createLockedTextSession(
  password: string,
  options: { iterations?: number } = {},
): Promise<LockedTextSessionKey> {
  if (!password) throw new LockedTextError("invalid-input", "密码不能为空");
  const iterations = options.iterations ?? LOCKED_TEXT_KDF_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new LockedTextError("invalid-input", "KDF 参数越界");
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, iterations);
  return { key, salt: bytesToBase64Url(salt), iter: iterations };
}

/** 打开已有密文（解锁）：按值里存的 salt/iter 派生，返回会话密钥 + 明文。 */
export async function openLockedTextSession(
  value: unknown,
  password: string,
): Promise<LockedTextSessionKey & { plain: string }> {
  if (!isLockedTextCipher(value)) throw new LockedTextError("invalid-value");
  if (!password) throw new LockedTextError("bad-password");
  const salt = base64UrlToBytes(value.salt);
  const iv = base64UrlToBytes(value.iv);
  const ct = base64UrlToBytes(value.ct);
  if (!salt || !iv || !ct) throw new LockedTextError("invalid-value");
  const key = await deriveKey(password, salt, value.iter);
  try {
    const plain = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, ct);
    return { key, salt: value.salt, iter: value.iter, plain: new TextDecoder().decode(plain) };
  } catch {
    // 密码错与密文被篡改在 GCM 下都是同一个认证失败 ⇒ 不区分（区分等于给攻击者一个探测口）。
    throw new LockedTextError("bad-password");
  }
}

/**
 * 用**已解锁的会话密钥**解开外部写进来的值（撤销/重做/他端同步覆盖/历史恢复）。
 * 不解密码（也不把密码留在 state 里）：salt/iter 不同 ⇒ 说明对方换了密码或换了卡，抛 bad-password 让 UI 锁回。
 */
export async function openLockedTextWithSession(
  session: LockedTextSessionKey,
  value: unknown,
): Promise<string> {
  if (!isLockedTextCipher(value)) throw new LockedTextError("invalid-value");
  if (value.salt !== session.salt || value.iter !== session.iter) throw new LockedTextError("bad-password");
  const iv = base64UrlToBytes(value.iv);
  const ct = base64UrlToBytes(value.ct);
  if (!iv || !ct) throw new LockedTextError("invalid-value");
  try {
    const plain = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: AAD }, session.key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    throw new LockedTextError("bad-password");
  }
}

/** 用会话密钥加密一段明文（每次新 iv；**不要在同一个 key 上复用 iv**）。 */
export async function sealLockedText(session: LockedTextSessionKey, plain: string): Promise<LockedTextCipher> {
  if (plain.length > LOCKED_TEXT_MAX_CHARS) throw new LockedTextError("invalid-input", "正文过长");
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    session.key,
    new TextEncoder().encode(plain),
  );
  return {
    v: LOCKED_TEXT_SCHEMA_VERSION,
    alg: "A256GCM",
    kdf: "PBKDF2-SHA256",
    iter: session.iter,
    salt: session.salt,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ct)),
  };
}

/**
 * 加密一段明文。每次调用都生成新的 salt 与 iv（**不要复用**：GCM 下 iv 复用会直接毁掉机密性）。
 * @throws LockedTextError("invalid-input") 空密码 / 超长明文；"crypto-unavailable" 无 WebCrypto。
 */
export async function encryptLockedText(
  plain: string,
  password: string,
  options: { iterations?: number } = {},
): Promise<LockedTextCipher> {
  const session = await createLockedTextSession(password, options);
  return sealLockedText(session, plain);
}

/**
 * 解密。密码错与密文被篡改在 GCM 下都是同一个认证失败 ⇒ 统一报 `bad-password`
 * （不要区分二者：区分等于给攻击者一个"密文有效但密码错"的探测口）。
 * @throws LockedTextError("invalid-value" | "bad-password")
 */
export async function decryptLockedText(value: unknown, password: string): Promise<string> {
  const session = await openLockedTextSession(value, password);
  return session.plain;
}

/** 复制 / 导出（text/plain）用的占位：**永远不返回明文**。 */
export function lockedTextExportText(): string {
  return LOCKED_TEXT_PLACEHOLDER;
}

/** 复制 / 导出（text/html）用的占位：**永远不返回明文**。 */
export function lockedTextExportHtml(): string {
  return `<span>${LOCKED_TEXT_PLACEHOLDER}</span>`;
}
