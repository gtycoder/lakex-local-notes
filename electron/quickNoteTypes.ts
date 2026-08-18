/** Shared Quick Note domain types are defined in src/lib for mobile reuse. */
export type {
  QuickNoteContent,
  QuickNoteDocument,
  QuickNoteImage,
  QuickNoteSummary,
} from "../src/lib/types.js";

export interface QuickNoteImageInput {
  bytes: number[];
  filename: string;
}

export interface SaveQuickNoteInput {
  text: string;
  draftId: string;
  stagedImageIds: string[];
  retainedImageIds?: string[];
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
