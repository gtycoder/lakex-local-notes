/**
 * 首启默认小记（Android）：把与桌面欢迎文档**同一份**欢迎页写进一条小记。
 *
 * 规则（261029 用户点单）：
 *  - 只在**全新库**（没有任何小记、也没有任何文档）时创建一次；固定 id 与桌面 welcome-note 同理，
 *    多端首启同步不会产生重复；
 *  - 标记 `welcome_quick_note_initialized` 一旦写入，用户删除后**不复活**（与 seed_initialized 同口径）；
 *  - 已有数据的库只补标记、不插入（避免给老用户塞内容）；
 *  - 失败只 warn、不阻断启动（欢迎页不是核心数据）。
 */
import { WELCOME_QUICK_NOTE_ID, welcomeLakeBody, welcomeQuickNoteText } from "../../core/lakeDocForm.js";
import type { MobileDb } from "./sqliteDb";
import { saveQuickNoteContent } from "./quickNotesRepository";

export const WELCOME_QUICK_NOTE_FLAG = "welcome_quick_note_initialized";

/** 纯判据：新库 + 没有任何小记/文档 + 没种过 ⇒ 建欢迎小记。 */
export function shouldSeedWelcomeQuickNote(input: { seeded: boolean; quickNoteCount: number; noteCount: number }): boolean {
  return !input.seeded && input.quickNoteCount === 0 && input.noteCount === 0;
}

export async function seedWelcomeQuickNote(d: MobileDb): Promise<boolean> {
  try {
    const flag = await d.prepare("SELECT value FROM device_state WHERE key=?").get(WELCOME_QUICK_NOTE_FLAG) as { value?: string } | undefined;
    if (flag?.value) return false;
    const quick = await d.prepare("SELECT COUNT(*) AS c FROM quick_notes").get() as { c: number };
    const notes = await d.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    const seeded = shouldSeedWelcomeQuickNote({
      seeded: false,
      quickNoteCount: Number(quick.c),
      noteCount: Number(notes.c),
    });
    if (seeded) {
      // 正文用内核 HTML（含 Gitee/GitHub 使用说明链接），text 是同一份内容的纯文本镜像（预览/搜索用）。
      await saveQuickNoteContent(d, WELCOME_QUICK_NOTE_ID, {
        text: welcomeQuickNoteText(),
        body: welcomeLakeBody(),
        images: [],
      });
    }
    await d.prepare("INSERT INTO device_state(key,value) VALUES(?, '1') ON CONFLICT(key) DO NOTHING").run(WELCOME_QUICK_NOTE_FLAG);
    return seeded;
  } catch (error) {
    console.warn("[welcome] 默认小记初始化失败（不阻断启动）：", error);
    return false;
  }
}
