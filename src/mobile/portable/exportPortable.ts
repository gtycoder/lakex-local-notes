/**
 * 261117 D 项（用户已批准）：移动端**导出便携包到用户可见文件**（卸载/换机前的 100% 可靠备份）。
 *
 * 链路（每一步都可单独失败并给出可执行错误）：
 *   ① 关闭 SQLite 连接（复用便携包导入的 closeDbForPortableImport，保证 DB/WAL 一致）；
 *   ② 原生 exportSnapshot：把「数据库 + 全部正文/资产/历史/草稿」打成快照 zip 到 App 私有目录；
 *   ③ 原生 inspectSnapshot 自检：校验 portable.json、只读打开包内 SQLite 数行数、抽查文档正文齐全
 *      —— 导出即验证「可恢复」，避免用户拿到一个坏包却不自知；
 *   ④ OpenFile.saveAs(toDownloads=true)：Android 10+ 直接落到系统「下载」目录（文件管理器可见、
 *      卸载 App 后仍留存；不弹系统选择器）；低版本自动回退 SAF；
 *   ⑤ finally 重开数据库。
 *
 * 包 = 明文全量数据（含历史快照/草稿），UI 必须提醒用户妥善保管。
 */
import { closeDbForPortableImport, reopenDbForPortableImport } from "../bridge/context";
import { saveFileToUserVisible } from "../native/openFileSave";
import { nativeExportPortableSnapshot, nativeInspectPortableSnapshot, type PortableSnapshotCounts } from "../native/portablePackage";

export interface PortableExportOutcome {
  ok: boolean;
  /** 用户在系统面板里取消（低版本 SAF） */
  canceled?: boolean;
  name?: string;
  /** 用户可见位置：Android 10+ 为 "Download" */
  location?: string;
  bytes?: number;
  entries?: number;
  counts?: PortableSnapshotCounts;
  missingBodies?: number;
  error?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "未知错误");
}

/** 导出入口（UI 只调它）：所有失败都返回 ok:false + 可执行 error，不向上抛。 */
export async function exportPortableSnapshotToDownloads(): Promise<PortableExportOutcome> {
  let dbClosed = false;
  try {
    try {
      await closeDbForPortableImport();
      dbClosed = true;
    } catch (error) {
      // 关不掉也继续：原生复制的是文件，SQLite 的 WAL 可能让快照少最后几条；自检会暴露不完整。
      console.warn("[portable-export] 关闭数据库失败（继续导出）", error);
    }
    const exported = await nativeExportPortableSnapshot();
    if (!exported.ok || !exported.path) {
      return { ok: false, error: exported.error || "导出失败：原生没有返回快照文件" };
    }
    // 解析校验（导出即验证可恢复）：包不合法/正文缺失 ⇒ 不交给用户。
    const inspected = await nativeInspectPortableSnapshot(exported.path);
    if (!inspected.ok) {
      return { ok: false, error: "导出的备用包自检失败：" + (inspected.error || "未知原因") };
    }
    const missing = inspected.missingBodies ?? 0;
    if (missing > 0) {
      return {
        ok: false,
        missingBodies: missing,
        error: "自检发现 " + missing + " 篇文档缺少正文文件，这个包恢复出来会缺内容。请先到「资源管理」处理「缺正文」，再重新导出。",
      };
    }
    const saved = await saveFileToUserVisible({
      path: exported.path,
      name: exported.name || "lakex-portable-mobile.zip.lln",
      // 自定义 MIME：若用 application/zip，MediaStore 会给 "….zip.lln" 再追加 ".zip"（实测 API36），
      // 变成 ".zip.lln.zip" 后系统文件选择器的 .zip.lln 筛选就找不到它。未知 MIME 不会被追加扩展名。
      mime: "application/x-lakex-portable",
      toDownloads: true,
    });
    if (!saved.ok) {
      return { ok: false, error: "保存到用户可见目录失败：" + (saved.error || "未知原因") + "（可改用桌面版导出便携包）" };
    }
    return {
      ok: true,
      name: saved.name ?? exported.name,
      location: saved.dir ?? "下载",
      bytes: saved.bytes ?? exported.bytes,
      entries: exported.entries ?? inspected.entries,
      counts: inspected.counts ?? exported.counts,
      missingBodies: 0,
    };
  } catch (error) {
    return { ok: false, error: "导出便携包失败：" + messageOf(error) };
  } finally {
    if (dbClosed) {
      try { await reopenDbForPortableImport(); } catch (error) { console.warn("[portable-export] 重开数据库失败（下次访问会惰性重开）", error); }
    }
  }
}

/** UI 摘要行：成功时显示「已保存到 下载：filename（大小，N 篇文档 / M 条小记）」。 */
export function portableExportSummary(outcome: PortableExportOutcome): string {
  if (!outcome.ok) return outcome.error ?? "导出失败";
  const size = typeof outcome.bytes === "number" ? formatBytes(outcome.bytes) : "大小未知";
  const notes = outcome.counts?.notes ?? 0;
  const quickNotes = outcome.counts?.quickNotes ?? 0;
  return "已保存到「" + (outcome.location ?? "下载") + "」：" + (outcome.name ?? "便携包") + "（" + size + "，" + notes + " 篇文档 / " + quickNotes + " 条小记）";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return (unit === 0 ? value.toFixed(0) : value.toFixed(1)) + " " + units[unit];
}