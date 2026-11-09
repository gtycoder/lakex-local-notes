/**
 * 更新日志解析（docs/RELEASE-NOTES.md 与清单里的 notes 共用一套行解析）。
 *
 * 为什么不渲染完整 Markdown：移动端没有 Markdown 渲染器，引一套是新的样式范式（AGENTS §3/§22）。
 * 这里只把「# 版本 / ## 小节 / - 条目 / 正文 / 代码块」拆成结构化行，由设置页用既有 mb-* 版式渲染。
 */
export type ReleaseNoteLineKind = "heading" | "subheading" | "bullet" | "text" | "code";

export interface ReleaseNoteLine {
  kind: ReleaseNoteLineKind;
  text: string;
}

export interface ReleaseNoteVersion {
  version: string;
  lines: ReleaseNoteLine[];
}

const VERSION_HEADING = /^#\s+LakexLocalNotes\s+v?(\d+\.\d+\.\d+)\s*$/;
const TICK = String.fromCharCode(96);
const FENCE = TICK + TICK + TICK;
const INLINE_CODE = new RegExp(TICK + "([^" + TICK + "]+)" + TICK, "g");

function normalizeInline(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(INLINE_CODE, "$1").trim();
}

/** 解析一段 Markdown 行为结构化行（空行丢弃；代码围栏收敛成 code 行）。 */
export function parseReleaseNoteLines(raw: string): ReleaseNoteLine[] {
  const lines: ReleaseNoteLine[] = [];
  let inFence = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith(FENCE)) {
      inFence = !inFence;
      continue;
    }
    if (!trimmed) continue;
    if (inFence) {
      lines.push({ kind: "code", text: rawLine.replace(/^\s{2}/, "") });
      continue;
    }
    const versionHeading = VERSION_HEADING.exec(trimmed);
    if (versionHeading) {
      lines.push({ kind: "heading", text: "v" + versionHeading[1] });
      continue;
    }
    const heading = /^#\s+(.+)$/.exec(trimmed);
    if (heading) {
      lines.push({ kind: "heading", text: normalizeInline(heading[1]) });
      continue;
    }
    const subheading = /^#{2,6}\s+(.+)$/.exec(trimmed);
    if (subheading) {
      lines.push({ kind: "subheading", text: normalizeInline(subheading[1]) });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      lines.push({ kind: "bullet", text: normalizeInline(bullet[1]) });
      continue;
    }
    lines.push({ kind: "text", text: normalizeInline(trimmed) });
  }
  return lines;
}

/** 整份 RELEASE-NOTES.md → 按版本分组（文件本身新的在前；版本标题之前的总述丢弃）。 */
export function parseReleaseNotes(raw: string): ReleaseNoteVersion[] {
  const versions: ReleaseNoteVersion[] = [];
  let current: ReleaseNoteVersion | null = null;
  let buffer: string[] = [];
  const flush = (): void => {
    if (current) {
      current.lines = parseReleaseNoteLines(buffer.join("\n"));
      versions.push(current);
    }
    buffer = [];
  };
  for (const rawLine of raw.split(/\r?\n/)) {
    const heading = VERSION_HEADING.exec(rawLine.trim());
    if (heading) {
      flush();
      current = { version: heading[1], lines: [] };
      continue;
    }
    if (current) buffer.push(rawLine);
  }
  flush();
  return versions;
}
