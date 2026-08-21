/** Shared Quick Note domain types are defined in src/lib for mobile reuse. */
export type {
  QuickNoteContent,
  QuickNoteDocument,
  QuickNoteImage,
  QuickNoteSummary,
  SaveQuickNoteInput,
} from "../src/lib/types.js";

export interface QuickNoteImageInput {
  bytes: number[];
  filename: string;
}

export interface QuickNoteDeleted {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  conversionTargetNoteId: string | null;
  readyToSync: boolean;
}

export interface QuickNoteConversion {
  sourceQuickNoteId: string;
  targetNoteId: string;
  targetNotebookId: string;
  state: "prepared" | "target_created" | "source_deleted_waiting_sync" | "complete";
  createdAt: string;
  updatedAt: string;
}
