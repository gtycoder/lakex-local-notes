import type { DrawingBoardAIConfig } from '../../components/lakex/types';

export type DrawingBoardPreset = 'drawing' | 'flowchart' | 'uml' | 'mindmap';

export interface LakexDrawingBoardEditorHost {
  __lakexDrawingBoardAI?: DrawingBoardAIConfig;
}

export interface IDrawingBoardCardValue {
  /** Drawnix / Plait scene format used by all newly saved drawing cards. */
  version?: 2;
  engine?: 'drawnix';
  /** Determines the editable starter scene for a newly inserted card. */
  preset?: DrawingBoardPreset;
  /** Prevents a template from being recreated after the user clears it. */
  presetInitialized?: boolean;
  cardHeight?: number;
  /** Engine-owned serializable scene data. */
  plaitValue?: unknown[];
  plaitViewport?: unknown;
  /** PNG data URL used for clipboard HTML and document export. */
  previewImage?: string;
  /** Legacy SVG snapshot retained only for existing saved cards. */
  svg?: string;
}
