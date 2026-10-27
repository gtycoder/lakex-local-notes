import type {
  CustomCard,
  CustomCardConfig,
} from '../../components/lakex/types';
import DrawingBoardEditor from './DrawingBoardEditor';
import DrawingBoardViewer from './DrawingBoardViewer';
import type { DrawingBoardPreset, IDrawingBoardCardValue } from './types';

const defaultViewport = { x: 0, y: 0, zoom: 1 };

const serializeDrawnixValue = (value: IDrawingBoardCardValue | null) =>
  JSON.stringify({
    type: 'drawnix',
    version: 1,
    source: 'lakex',
    elements: value?.plaitValue || [],
    viewport: value?.plaitViewport || defaultViewport,
  });

interface DrawingBoardCardDefinition {
  name: string;
  icon: string;
  preset: DrawingBoardPreset;
  label: { zhCN: string; enUS: string };
  description: { zhCN: string; enUS: string };
  keywords: string[];
}

const createDrawingBoardCardConfig = ({
  name,
  icon,
  preset,
  label,
  description,
  keywords,
}: DrawingBoardCardDefinition): CustomCardConfig<IDrawingBoardCardValue> => ({
  name,
  cardType: 'block',
  editorComponent: DrawingBoardEditor,
  viewerComponent: DrawingBoardViewer,
  initValue: {
    version: 2,
    engine: 'drawnix',
    preset,
    plaitValue: [],
    plaitViewport: defaultViewport,
    cardHeight: 560,
  },
  slash: {
    icon,
    mainSearch: '/hb',
    label: () => label,
    description: () => description,
    keywords,
  },
  writeText: (value: IDrawingBoardCardValue | null) => {
    return serializeDrawnixValue(value);
  },
  writeHtml: (value: IDrawingBoardCardValue | null) => {
    if (value?.previewImage) {
      // Lakex's parser keeps quote characters in quoted data URIs. A PNG data
      // URL only contains unquoted-attribute-safe characters and avoids
      // injecting serialized SVG back into the editor DOM on each edit.
      return `<img src=${value.previewImage} alt="Drawing Board" />`;
    }
    return '<div></div>';
  },
});

export const drawingBoardCardConfig = createDrawingBoardCardConfig({
  name: 'drawing-board',
  icon: 'editor-main-drawing-board',
  preset: 'drawing',
  label: { zhCN: '画板', enUS: 'Drawing Board' },
  description: { zhCN: '可插入图形、连线和图片等', enUS: 'Insert shapes, connectors, text and images' },
  keywords: ['board', 'drawing', 'whiteboard', 'canvas', 'hb', '画板', '白板', '绘图'],
});

export const flowchartBoardCardConfig = createDrawingBoardCardConfig({
  name: 'flowchart-board',
  icon: 'editor-main-flowchart',
  preset: 'flowchart',
  label: { zhCN: '流程图', enUS: 'Flowchart' },
  description: { zhCN: '插入可编辑的流程图模板', enUS: 'Insert an editable flowchart template' },
  keywords: ['flowchart', 'process', '流程图', '流程'],
});

export const umlBoardCardConfig = createDrawingBoardCardConfig({
  name: 'uml-board',
  icon: 'editor-main-uml',
  preset: 'uml',
  label: { zhCN: 'UML 图', enUS: 'UML Diagram' },
  description: { zhCN: '插入可编辑的 UML 图模板', enUS: 'Insert an editable UML diagram template' },
  keywords: ['uml', 'class diagram', '用例图', '类图'],
});

export const mindmapBoardCardConfig = createDrawingBoardCardConfig({
  name: 'drawing-mindmap-board',
  icon: 'editor-main-mind-map',
  preset: 'mindmap',
  label: { zhCN: '思维导图', enUS: 'Mind Map' },
  description: { zhCN: '插入可编辑的思维导图模板', enUS: 'Insert an editable mind map template' },
  keywords: ['mindmap', 'mind map', '思维导图', '脑图'],
});

export const drawingBoardCard: CustomCard<IDrawingBoardCardValue> = {
  config: drawingBoardCardConfig,
};

export const flowchartBoardCard: CustomCard<IDrawingBoardCardValue> = {
  config: flowchartBoardCardConfig,
};

export const umlBoardCard: CustomCard<IDrawingBoardCardValue> = {
  config: umlBoardCardConfig,
};

export const mindmapBoardCard: CustomCard<IDrawingBoardCardValue> = {
  config: mindmapBoardCardConfig,
};

export { DrawingBoardEditor, DrawingBoardViewer };
export type { DrawingBoardPreset, IDrawingBoardCardValue } from './types';
