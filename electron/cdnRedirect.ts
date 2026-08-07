/**
 * 仅把项目实际镜像到 public/dist/vendor/cdn 的 Lake 运行时资源改写到本地。
 * 不能按 host 全量拦截 gw.alipayobjects.com：该域名也承载用户粘贴的远程图片。
 */
export function resolveMirroredCdnRedirect(
  requestUrl: string,
  assetPort: number,
  hasMirroredAsset: (relativePath: string) => boolean,
): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.hostname !== "gw.alipayobjects.com") return null;

    // 保持百分号编码，与落盘的镜像路径一致；拒绝目录穿越及空片段。
    const relativePath = url.pathname.replace(/^\/+/, "");
    if (!relativePath || relativePath.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
      return null;
    }
    if (!hasMirroredAsset(relativePath)) return null;

    return `http://127.0.0.1:${assetPort}/vendor/cdn/${relativePath}`;
  } catch {
    return null;
  }
}
