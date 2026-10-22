import fs from "node:fs";
import path from "node:path";

/**
 * W-5：镜像目录随包固定（不随运行变化），启动时一次性扫描成 Set，
 * onBeforeRequest 回调内纯内存判断——替代此前每请求 existsSync+statSync
 * 阻塞主进程事件循环的实现。
 */
export function scanMirroredCdnFiles(mirrorRoot: string): Set<string> {
  const files = new Set<string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.add(path.relative(mirrorRoot, full).split(path.sep).join("/"));
    }
  };
  walk(mirrorRoot);
  return files;
}

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
    // Windows 文件名不允许 `*` ⇒ 落盘镜像把 `*` 统一替换为 `_`（见 public/vendor/cdn/mdn/**）。
    const relativePath = url.pathname.replace(/^\/+/, "").replaceAll("*", "_");
    if (!relativePath || relativePath.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"))) {
      return null;
    }
    if (!hasMirroredAsset(relativePath)) return null;

    return `http://127.0.0.1:${assetPort}/vendor/cdn/${relativePath}`;
  } catch {
    return null;
  }
}
