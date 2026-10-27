/** S3 v3 运行时的端口定义（Node 侧；纯接口）。 */

export interface RemoteObjectInfo {
  key: string;
  size: number;
  lastModified?: number;
}
/** 原生流式下载结果：字节不经过 JS（移动端 OkHttp → 文件，校验也在原生做）。 */
export type NativeGetStatus = "ok" | "missing" | "corrupt" | "unsupported";

export interface S3v3Remote {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  list(prefix: string): Promise<RemoteObjectInfo[]>;
  deleteMany(keys: string[]): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;

  /**
   * 原生/流式下载到本地文件（可选，P0-4）：只传 key + 目标相对路径 + 期望 size/sha256；
   * 字节不经过 JS（移动端原生 OkHttp 直写、原生校验）。返回 "unsupported" 时调用方回退字节路径。
   * destPath 语义由设备端口决定（移动端 = note-assets 根下的相对路径）。
   */
  getToFile?(key: string, destPath: string, expected: { size: number; sha256: string }): Promise<NativeGetStatus>;
  /** 原生/流式上传本地文件（可选）：字节不经过 JS。返回 false/throw 由调用方按失败处理。 */
  putFromFile?(key: string, localPath: string, opts?: { gzip?: boolean }): Promise<boolean>;

  /**
   * 分片下载（可选，261027）：大对象按 byte 区间并发 GET（end 为开区间），由引擎负责拼接与 sha256 校验。
   * 桌面实现走 S3 Range 头；移动端优先原生 getToFile（流式整对象），不实现时回退整对象 GET。
   */
  getRange?(key: string, start: number, end: number): Promise<Uint8Array | null>;
}

export interface S3v3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 对象前缀（不带末尾斜杠）。 */
  prefix: string;
  forcePathStyle?: boolean;
}
