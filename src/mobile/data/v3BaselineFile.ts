/**
 * 移动端同步基线落文件（261113 D1-C）。
 *
 * 背景：baseline 是**设备本地账本**（绝不上云，SYNC-PROTOCOL I7），此前与 `sync_v3_state` 同一条
 * JSON 落盘 ⇒ 每次读写都要把整行 2.28MB JSON 过 Capacitor 桥（5000 文档实测 129–207ms/次；
 * 一次「保存并同步」3 读 1 写）。现在：JS 侧 gzip（WebView 自带 CompressionStream；Node 测试同一实现，
 * 也可注入）→ base64 → BodyStore 原子写（临时文件 + fsync + rename）。过桥只剩「路径/压缩后字节」。
 *
 * 文件内容 = base64(gzip(UTF-8 JSON))：BodyStore 的文本写是 UTF-8，二进制用 base64 承载。
 * **不用** BodyStore.writeSnapshot（原生 gzip）——那样整份明文 JSON 依旧要过桥，失去本改动的意义。
 *
 * 兼容与兜底（都不是「格式兼容分支」）：
 *  - 旧 WebView 缺 CompressionStream/DecompressionStream ⇒ 退化为明文 JSON 落文件；读取按 gzip magic
 *    自动识别。能力兜底，不影响任何同步判据。
 *  - 文件缺失/损坏的语义由调用方（data/v3StateRepository）决定：这里是纯存储层，只如实回报状态。
 */
import { getBodyStore } from "../native/bodyStore.js";
import type { MobileV3Baseline } from "./v3StateRepository.js";

/**
 * 相对 App 私有 Data 目录（BodyStore 根）。与桌面 `sync-v3/baseline.json.gz` 同构；base64 后缀标明承载格式。
 * 生产固定此路径（一个 App 进程 = 一个设备 = 一个账本）；同进程多设备（测试）可用构造参数注入不同路径隔离。
 */
export const MOBILE_BASELINE_FILE_PATH = "sync-v3/baseline.json.gz.b64";

/**
 * 测试注入：同进程多 DB（多设备收敛用例）为每个库绑定独立的 baseline 文件路径。
 * 生产固定 MOBILE_BASELINE_FILE_PATH（一个 App 进程 = 一个设备 = 一本账），不要在产品代码调用。
 */
const testBaselineFiles = new WeakMap<object, string>();
export function setBaselineFileForDbForTest(db: object, filePath: string | null): void {
  if (filePath) testBaselineFiles.set(db, filePath);
  else testBaselineFiles.delete(db);
}
export function baselineFileForDb(db: object): string | undefined {
  return testBaselineFiles.get(db);
}

/** gzip 魔数：读侧据此区分「压缩字节」与「明文 JSON 兜底」。 */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** 压缩实现端口（默认 = WebView/Node 全局 CompressionStream；测试可注入以模拟旧 WebView 或坏数据）。 */
export interface BaselineGzipCodec {
  gzip(bytes: Uint8Array): Promise<Uint8Array>;
  gunzip(bytes: Uint8Array): Promise<Uint8Array>;
}

function streamCodec(): BaselineGzipCodec | null {
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") return null;
  return {
    async gzip(bytes) { return await pipeThrough(bytes, new CompressionStream("gzip")); },
    async gunzip(bytes) { return await pipeThrough(bytes, new DecompressionStream("gzip")); },
  };
}

async function pipeThrough(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // DOM 类型把 BlobPart 收窄成 ArrayBufferView<ArrayBuffer>；这里的 Uint8Array 可能来自 ArrayBufferLike 视图。
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** undefined = 未注入（用全局实现）；null = 强制禁用（模拟旧 WebView 的明文兜底）。 */
let injectedCodec: BaselineGzipCodec | null | undefined;
/** 测试注入压缩实现；传 undefined 恢复默认。仅测试使用，产品代码不要调用。 */
export function setBaselineGzipCodecForTest(next: BaselineGzipCodec | null | undefined): void {
  injectedCodec = next;
}

function activeCodec(): BaselineGzipCodec | null {
  return injectedCodec === undefined ? streamCodec() : injectedCodec;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** 基线结构最小校验（坏文件不得当成可用 baseline；字段判据与 MobileV3Baseline 对齐）。 */
export function isPlausibleBaseline(value: unknown): value is MobileV3Baseline {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  const lake = b.lake as { notes?: unknown } | undefined;
  const quick = b.quickNotes as { items?: unknown } | undefined;
  return typeof b.epoch === "string"
    && typeof b.generation === "number" && Number.isFinite(b.generation)
    && typeof b.lakeCommit === "string"
    && typeof b.quickNotesCommit === "string"
    && !!lake && typeof lake === "object" && Array.isArray(lake.notes)
    && !!quick && typeof quick === "object" && Array.isArray(quick.items);
}

export type BaselineFileRead =
  | { status: "ok"; baseline: MobileV3Baseline; fileBytes: number; gzipped: boolean }
  | { status: "missing" }
  | { status: "corrupt"; reason: string };

/**
 * 读 baseline 文件（永不抛错）：缺失 = missing，读/解码/校验失败 = corrupt（调用方决定语义——
 * 同步路径必须把它当「基线丢失」硬失败，绝不静默降级成「无基线」去跑 pull-all）。
 */
export async function readBaselineFile(filePath: string = MOBILE_BASELINE_FILE_PATH): Promise<BaselineFileRead> {
  let text: string | null;
  try {
    text = await getBodyStore().readText(filePath);
  } catch (error) {
    return { status: "corrupt", reason: "读取失败: " + errorText(error) };
  }
  if (text == null || text === "") return { status: "missing" };
  try {
    const packed = base64ToBytes(text);
    const gzipped = packed.length >= 2 && packed[0] === GZIP_MAGIC_0 && packed[1] === GZIP_MAGIC_1;
    let json = packed;
    if (gzipped) {
      const codec = activeCodec();
      if (!codec) return { status: "corrupt", reason: "文件是 gzip，但当前环境没有解压能力" };
      json = await codec.gunzip(packed);
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(json));
    if (!isPlausibleBaseline(parsed)) return { status: "corrupt", reason: "基线结构不合法" };
    return { status: "ok", baseline: parsed, fileBytes: text.length, gzipped };
  } catch (error) {
    return { status: "corrupt", reason: "解码失败: " + errorText(error) };
  }
}

export interface BaselineWriteStats {
  /** JSON 明文字节（压缩前）。 */
  jsonBytes: number;
  /** 落盘文件字节（base64 后）。 */
  fileBytes: number;
  gzipped: boolean;
}

/** 写 baseline 文件（BodyStore 原子写）。失败上抛——调用方**不得**在写失败后标 synced。 */
export async function writeBaselineFile(baseline: MobileV3Baseline, filePath: string = MOBILE_BASELINE_FILE_PATH): Promise<BaselineWriteStats> {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(baseline));
  const codec = activeCodec();
  const packed = codec ? await codec.gzip(jsonBytes) : jsonBytes;
  const encoded = bytesToBase64(packed);
  await getBodyStore().writeText(filePath, encoded);
  return { jsonBytes: jsonBytes.length, fileBytes: encoded.length, gzipped: !!codec };
}

/** 删除 baseline 文件（不存在时静默）。清空账本 / 便携包覆盖导入用。 */
export async function deleteBaselineFile(filePath: string = MOBILE_BASELINE_FILE_PATH): Promise<void> {
  try {
    await getBodyStore().remove(filePath);
  } catch { /* 文件不存在/删除失败都不影响调用方语义（下次读为 missing） */ }
}

/** 文件是否存在（迁移/诊断用；不读内容）。 */
export async function baselineFileExists(filePath: string = MOBILE_BASELINE_FILE_PATH): Promise<boolean> {
  try {
    const stat = await getBodyStore().stat(filePath);
    return stat.exists && stat.size > 0;
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
