/** S3 v3 运行时的端口定义（Node 侧；纯接口）。 */

export interface RemoteObjectInfo {
  key: string;
  size: number;
  lastModified?: number;
}
export interface S3v3Remote {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  list(prefix: string): Promise<RemoteObjectInfo[]>;
  deleteMany(keys: string[]): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
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
