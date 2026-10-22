import type { TreeNode } from "../../lib/types";
import type { LocalNoteSummary } from "../data/noteRepository";
import type { QuickNoteListItem } from "../data/quickNotesRepository";
import * as noteRepository from "../data/noteRepository.js";
import * as quickNotesRepository from "../data/quickNotesRepository.js";
import * as treeRepository from "../data/treeRepository.js";
import { ensureDb } from "./context";

/** 首页当前需要的只读投影；先复现现有行为，后续再把三块数据拆成独立 query。 */
export interface HomeSnapshot {
  treeNodes: TreeNode[];
  notes: LocalNoteSummary[];
  quickNotes: QuickNoteListItem[];
}

export const homeDomain = {
  async getHomeSnapshot(): Promise<HomeSnapshot> {
    const db = await ensureDb();
    const [treeNodes, notes, quickNotes] = await Promise.all([
      treeRepository.listTreeNodes(db),
      noteRepository.listNotes(db),
      quickNotesRepository.listQuickNotes(db),
    ]);
    return { treeNodes, notes, quickNotes };
  },
};
