export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;

/**
 * 附件协议硬上限（桌面/移动端同步、上传 IPC、下载护栏统一使用）。
 * 单对象 PutObject 上限 5GB，本上限远低于此；Multipart/断点续传不在本迭代范围
 * （对齐思源 dejavu：整对象 PutObject + 幂等重传，失败下次同步自动重传）。
 */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** 附件上传配置默认值（MiB；用户可在设置里调大，见 settings.maxAttachmentBytes）。 */
export const DEFAULT_MAX_ATTACHMENT_MB = 25;
export const DEFAULT_MAX_ATTACHMENT_BYTES = DEFAULT_MAX_ATTACHMENT_MB * 1024 * 1024;

/** 设置面板可选档位（MiB）；协议上限必须 >= 最大档位，保证任意端配置都能同步。 */
export const MAX_ATTACHMENT_MB_OPTIONS = [25, 50, 100] as const;
