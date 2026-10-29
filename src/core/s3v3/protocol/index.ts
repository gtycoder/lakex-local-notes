/**
 * S3 协议 v3（纯逻辑层）：keys / index / declaration 编解码、pointer 状态分类、共享类型与校验。
 *
 * 分层（v4 RFC §6.1）：Protocol（本目录）→ Reconciler（plan/）→ Applier → Publisher。
 * 本层**不依赖 IO、不依赖 node/electron**（check:core 硬门禁）。
 * 旧 import 路径已迁到 `src/core/s3v3/protocol/*`；新代码一律从本 barrel 或具体模块导入。
 */
export * from "./s3v3Keys.js";
export * from "./s3v3Types.js";
export * from "./s3v3Index.js";
export * from "./s3v3Pointer.js";
