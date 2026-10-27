import type { PlaitBoard, PlaitElement } from "@plait/core";
import { StrokeStyle } from "@plait/common";
export declare const DRAWING_BOARD_AI_SYSTEM_PROMPT: string;
type Anchor = "top" | "right" | "bottom" | "left";
interface AIBoardNodeStyle {
    fill?: string;
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
    fontSize?: number;
    textColor?: string;
}
interface AIBoardNode {
    id: string;
    shape: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    style: AIBoardNodeStyle;
}
interface AIBoardEdgeStyle {
    lineType?: "straight" | "elbow" | "curve";
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: StrokeStyle;
    endMarker?: "arrow" | "none";
}
interface AIBoardEdge {
    id: string;
    source: string;
    target: string;
    sourceAnchor?: Anchor;
    targetAnchor?: Anchor;
    label: string;
    style: AIBoardEdgeStyle;
}
export interface AIBoardDocument {
    version: 1;
    diagramType?: AIBoardDiagramType;
    title?: string;
    nodes: AIBoardNode[];
    edges: AIBoardEdge[];
}
export type AIBoardDiagramType = "board" | "flowchart" | "uml" | "smart" | "er";
export type ParsedAIBoardResponse = {
    kind: "intermediate";
    document: AIBoardDocument;
} | {
    kind: "native";
    elements: PlaitElement[];
};
export declare function parseAIBoardResponse(response: unknown): ParsedAIBoardResponse;
export declare function parseAIBoardDocument(response: unknown): AIBoardDocument;
/**
 * Serializes only the latest editable board state into the stable AI format.
 * Previous AI JSON is deliberately not retained; manual edits made between
 * prompts therefore become the source of truth for the next request.
 */
export declare function serializeBoardToAIDocument(board: PlaitBoard): AIBoardDocument;
export interface NativeMindBoardDocument {
    plaitValue: PlaitElement[];
}
export type AIBoardContextDocument = AIBoardDocument | NativeMindBoardDocument;
/** Keeps native mind trees native when they are sent back to the model. */
export declare function serializeBoardToAIContext(board: PlaitBoard): AIBoardContextDocument;
export declare function countAIBoardContextNodes(document: AIBoardContextDocument): number;
export declare function buildAIBoardContextPrompt({ description, history, currentBoard, mode, }: {
    description: string;
    history: readonly string[];
    currentBoard: AIBoardContextDocument;
    mode: "replace" | "append";
}): string;
export declare function convertAIBoardDocument(document: AIBoardDocument, board?: PlaitBoard): PlaitElement[];
export {};
