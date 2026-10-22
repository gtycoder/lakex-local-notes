import type { LakexEditorInstance } from './blockDoc.types';
export declare function readBlockDocument(editor: LakexEditorInstance): any | null;
export declare function writeBlockDocument(editor: LakexEditorInstance, doc: any): boolean;
export declare function moveBlock(editor: LakexEditorInstance, sourceId: string, targetId: string, insertAfter: boolean): boolean;
export declare function deleteBlock(editor: LakexEditorInstance, id: string): boolean;
export declare function duplicateBlock(editor: LakexEditorInstance, id: string, insertAfter?: boolean): boolean;
export declare function convertBlock(editor: LakexEditorInstance, id: string, targetName: string): boolean;
export declare function insertBlock(editor: LakexEditorInstance, referenceId: string, position: 'before' | 'after', newName: string): boolean;
