/**
 * 探针：Lake 内核（@dlient/lakex-doc-react 内嵌的闭源内核 bundle）图片 URL 协议白名单行为复刻。
 *
 * 目的：验证「图片/附件能否用比 HTTP 更轻量（无 TCP 三次握手/四次挥手）的协议」的可行性。
 * 证据来源：vendor/lakex-doc-react/src/components/lakex/lakex.js（内核 ESM 转换产物；行号为本版本采样位置，升级内核后需复核）
 *   - L53900-53905 / L95009-95014  协议白名单数组（http:/https:/blob:/data:/dingtalk:/ftp:/mailto:/fleamarket:/alipays:/qinpai:）
 *   - L53802-53808  isBase64ImageURL / isFullHttpURL
 *   - L53858-53860  sanitizeImageSrc(e)（data:image/ 直接放行，其余过 URL 校验）
 *   - L72227 / L75681  图片/markdown 渲染处对 isBase64ImageURL / isFullHttpURL 的判定
 */
import { describe, expect, it } from "vitest";

/** 复刻 L41567-41578：Lake 内核放行的 URL 协议前缀白名单。 */
const LAKE_PROTOCOL_WHITELIST = [
  "http:",
  "https:",
  "blob:",
  "data:",
  "dingtalk:",
  "ftp:",
  "mailto:",
  "fleamarket:",
  "alipays:",
  "qinpai:",
];

/**
 * 复刻内核 URL 合法性判定（lakex.js 采样：L53858 附近 sanitize 链）。
 * 返回 true 表示该 URL 被 Lake 接受（不会在 sanitize 时被清空）。
 */
function lakeValidUrl(raw: string): boolean {
  if (typeof raw !== "string" || (raw = raw.toLowerCase()).startsWith("data:text/html")) return false;
  const withoutFragment = raw.split("#")[0];
  return !/\s/.test(withoutFragment)
    && (LAKE_PROTOCOL_WHITELIST.some((prefix) => raw.startsWith(prefix))
      || raw.startsWith("./")
      || raw.startsWith("/")
      || raw.indexOf(":") < 0);
}

/** 复刻内核 sanitize：合法则保留原 URL，否则返回空串。 */
function lakeSanitizeUrl(raw: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  return lakeValidUrl(trimmed) ? trimmed : "";
}

/** 复刻内核 sanitizeImageSrc(e)（lakex.js L53858）—— 图片 src 专用清洗。 */
function lakeSanitizeImageSrc(raw: string): string {
  return /^data:image\//i.test(raw) ? raw : lakeSanitizeUrl(raw);
}

/** 当前生产形态（基线）：本地 assetServer URL。 */
const HTTP_ASSET = "http://127.0.0.1:19876/note123/1735000000000_abcd1234.png";

describe("Lake 内核协议白名单探针（复刻 lakex 内核，lakex.js L53900/L95009 白名单）", () => {
  it("基线：http assetServer URL 被放行", () => {
    expect(lakeSanitizeImageSrc(HTTP_ASSET)).toBe(HTTP_ASSET);
  });

  it("data:image/ base64 URL 被放行（Lake 原生支持 data 协议）", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(lakeSanitizeImageSrc(dataUrl)).toBe(dataUrl);
  });

  it("blob: URL 被放行（渲染进程内零网络）", () => {
    const blobUrl = "blob:http://127.0.0.1:1421/uuid-uuid-uuid";
    expect(lakeSanitizeImageSrc(blobUrl)).toBe(blobUrl);
  });

  it("相对路径 ./ 被放行", () => {
    expect(lakeSanitizeImageSrc("./images/x.png")).toBe("./images/x.png");
  });

  it("根相对路径 / 被放行", () => {
    expect(lakeSanitizeImageSrc("/vendor/cdn/x.png")).toBe("/vendor/cdn/x.png");
  });

  it("无协议前缀（裸文件名）被放行", () => {
    expect(lakeSanitizeImageSrc("x.png")).toBe("x.png");
  });

  it("自定义 scheme（lake-asset://）被 Lake 白名单拒绝（核心发现）", () => {
    expect(lakeSanitizeImageSrc("lake-asset://note123/x.png")).toBe("");
    expect(lakeSanitizeImageSrc("lakeimg://note123/x.png")).toBe("");
    expect(lakeSanitizeImageSrc("local-file:///x.png")).toBe("");
  });

  it("file:// 被拒绝（Electron 渲染层也默认禁 file 跨域）", () => {
    expect(lakeSanitizeImageSrc("file:///Users/x.png")).toBe("");
  });

  it("data:text/html 被拒绝（XSS 防护）", () => {
    expect(lakeSanitizeImageSrc("data:text/html,<script>")).toBe("");
  });

  it("编辑态 markdown 图片识别只认 base64 或完整 http(s)（lakex.js L72227/L75681）", () => {
    const mdUrl = (raw: string) => {
      const m = /!\[([^\]]*?)\]\(([^\]]+?)\)$/.exec("![](" + raw + ")");
      if (!m) return null;
      return /^data:image\//i.test(m[2]) || (() => {
        try { const p = new URL(m[2]).protocol; return p === "http:" || p === "https:"; } catch { return false; }
      })() ? m : null;
    };
    expect(mdUrl(HTTP_ASSET)).not.toBeNull();
    expect(mdUrl("data:image/png;base64,xxx")).not.toBeNull();
    expect(mdUrl("lake-asset://n/x.png")).toBeNull();
    expect(mdUrl("blob:http://127.0.0.1:1421/u")).toBeNull();
  });

  it("isCaptureImageURL 已把 data:/blob:/本地 asset URL 排除在抓取转存外（lakeRuntime L451）", () => {
    const isCapture = (url: string) => !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("http://127.0.0.1:19876/");
    expect(isCapture(HTTP_ASSET)).toBe(false);
    expect(isCapture("data:image/png;base64,x")).toBe(false);
    expect(isCapture("blob:http://127.0.0.1:1421/u")).toBe(false);
    expect(isCapture("https://example.test/a.png")).toBe(true);
    expect(isCapture("lake-asset://n/x.png")).toBe(true); // 若用自定义协议需在 isCapture 排除，否则 Lake 会反复下载上传
  });
});
/**
 * 复制/导出路径对 lake-asset:// 的识别探针（V5 轻量协议调研补充）。
 * 结论：clipboardHtml.normalizeImage 与 store 导出正则均只认 http://127.0.0.1:{port}/
 * → lake-asset:// 在复制/导出时会丢失，需要 AssetUrlResolver 统一解析。
 */

const LOCAL_ASSET_PREFIX = "http://127.0.0.1:19876/";

/** 复刻 clipboardHtml.ts normalizeImage 的判定分支（L85-102）。 */
function clipboardNormalize(src: string): string | null {
  if (src.startsWith(LOCAL_ASSET_PREFIX)) {
    // assetUrlToDataUrlSync 分支：http 才转 data URL
    return "data:image/png;base64,<converted>";
  }
  const normalized = src;
  if (!normalized.startsWith("data:image/") && !/^https?:\/\//i.test(normalized)) return null;
  return normalized;
}

/** 复刻 store.ts 导出正则（L102-107）：http 形态才识别。 */
function exportRegexMatches(content: string): number {
  const htmlRe = /<img[^>]*src="(http:\/\/127\.0\.0\.1:19876\/([^/]+)\/([^/"\s]+))"/g;
  const mdRe = /!\[[^\]]*\]\((http:\/\/127\.0\.0\.1:19876\/([^/)]+)\/([^/)]+))\)/g;
  return (content.match(htmlRe) || []).length + (content.match(mdRe) || []).length;
}

describe("lake-asset:// 复制/导出识别探针", () => {
  it("http URL 复制时转 data URL（现状正常）", () => {
    expect(clipboardNormalize("http://127.0.0.1:19876/n1/a.png")).toBe("data:image/png;base64,<converted>");
  });

  it("lake-asset:// 复制时被跳过（返回 null → 图片丢失）", () => {
    expect(clipboardNormalize("lake-asset://n1/a.png")).toBeNull();
  });

  it("http 导出正则识别（现状正常）", () => {
    expect(exportRegexMatches('<img src="http://127.0.0.1:19876/n1/a.png">')).toBe(1);
    expect(exportRegexMatches("![](http://127.0.0.1:19876/n1/a.png)")).toBe(1);
  });

  it("lake-asset:// 导出正则不识别（导出漏图）", () => {
    expect(exportRegexMatches('<img src="lake-asset://n1/a.png">')).toBe(0);
    expect(exportRegexMatches("![](lake-asset://n1/a.png)")).toBe(0);
  });
});
