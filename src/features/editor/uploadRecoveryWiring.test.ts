/**
 * 261114 图片上传自愈接线护栏（防回退到「下载成功但卡片永久 error」）。
 * 纯源码断言：内核 image 插件必须走我们可恢复的 createUploadTask；EditorTab 必须在挂载时
 * 回填日志结果并订阅晚到结果；下载预算必须收窄（15s×3）否则错误卡窗口又被拉长；
 * 失败图必须有「后台补拉 + 点击重试」通道（261114 二批：不到迫不得已不能直接判失败）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("图片上传自愈接线", () => {
  const runtime = read("./lakeRuntime.ts");
  const editorTab = read("./EditorTab.tsx");
  const resourceUpload = read("./resourceUpload.ts");

  it("文档编辑器 image 插件用 createUploadTask（可恢复）；必须清掉 vendor 默认 createUploadPromise 桩", () => {
    expect(runtime).toContain("createUploadTask:");
    expect(runtime).toContain("createImageUploadTask(");
    expect(runtime).toContain("journalImageUploads");
    expect(runtime).toContain("createUploadPromise: undefined");
    // 小记/导入等仍有自己的 createUploadPromise 分支（不是被整体删除）
    expect(runtime).toContain("createUploadPromise:");
  });

  it("EditorTab 挂载时按 taskId 回填正文，并订阅晚到结果触发重建", () => {
    expect(editorTab).toContain("repairUploadCards(latestDocumentRef.current, noteId)");
    expect(editorTab).toContain("resumePendingDocumentImageUploads(noteId)");
    expect(editorTab).toContain("subscribeUploadJournal");
    expect(editorTab).toContain("hasUnresolvedImageTask");
  });

  it("交互式远程图下载预算（15s×3）且渲染层不再叠加重试", () => {
    expect(resourceUpload).toContain("timeoutMs: 15_000, maxAttempts: 3");
    expect(resourceUpload).toContain("DOCUMENT_IMAGE_DOWNLOAD_LIMITS");
    expect(resourceUpload).toContain("options.downloadLimits ? 0 : 2");
    expect(resourceUpload).toContain("native.downloadRemoteResource(payload, noteId, options.downloadLimits)");
    // 移动端：原生直连下载优先（字节不过桥，绕过 WebView CORS/CSP）；旧 APK 才回退 fetch
    expect(resourceUpload).toContain("canDownloadRemoteAsset()");
    expect(resourceUpload).toContain("native.downloadRemoteAsset(");
    expect(resourceUpload).toContain("REMOTE_FETCH_ATTEMPTS = 3");
    expect(resourceUpload).toContain("PermanentRemoteError");
  });

  it("失败图有后台补拉与点击重试（attempts 预算 + 退避调度 + ne-image-error 点击）", () => {
    expect(editorTab).toContain("uploadRetryDelayForEntry");
    expect(editorTab).toContain("retryFailedDocumentImageUploads(noteId)");
    expect(runtime).toContain("retryFailedDocumentImageUploads");
    expect(runtime).toContain("forceRetryImageUploadTask(");
    expect(runtime).toContain("attachImageErrorRetryClick");
    expect(runtime).toContain("retryableUploadsForNote");
    // 打开文档时 pending + 可重试失败项都会恢复（不再「一次失败=永久失败」）
    expect(runtime).toContain("retryFailedDocumentImageUploads(noteId, perform)");
  });

  it("移动端文档编辑器接同一套可恢复上传（journalRecovery）", () => {
    const lakeEditor = read("./LakeEditor.tsx");
    const documentEditor = read("../../mobile/editor/DocumentEditor.tsx");
    expect(lakeEditor).toContain("journalRecovery");
    expect(lakeEditor).toContain("repairUploadCards(");
    expect(lakeEditor).toContain("resumePendingDocumentImageUploads(noteId)");
    expect(lakeEditor).toContain("subscribeUploadJournal");
    expect(documentEditor).toContain("journalRecovery");
  });
});
