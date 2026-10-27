import { CustomCard, CustomCardConfig } from '../../components/lakex/types';
import TextToDiagramEditor from './TextToDiagramEditor';
import TextToDiagramViewer from './TextToDiagramViewer';
import type { ITextToDiagramCardValue } from './types';

const defaultCode = `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E[End]
    D --> E`;

export const textToDiagramCardConfig: CustomCardConfig = {
  name: 'text-to-diagram',
  cardType: 'block',
  editorComponent: TextToDiagramEditor,
  viewerComponent: TextToDiagramViewer,
  initValue: {
    code: defaultCode,
    type: 'mermaid',
    cardHeight: 500,
    showEditor: true,
    showPreview: true,
  },
  slash: {
    icon: 'editor-main-text-drawing',
    mainSearch: '/textdiagram',
    label: () => ({
      zhCN: '文本绘图',
      enUS: 'Text Diagram',
    }),
    description: () => ({
      zhCN: '支持Mermaid/PlantUML等',
      enUS: 'Generate diagrams by code',
    }),
    keywords: [
      'diagram',
      'chart',
      'flowchart',
      'mermaid',
      'plantuml',
      'graphviz',
      '文本绘图',
      '流程图',
      '图表',
    ],
  },
  writeText: (value: ITextToDiagramCardValue | null) => value?.code || '',
  writeHtml: (value: ITextToDiagramCardValue | null) => {
    if (!value?.code) return '<div>文本绘图</div>';
    return `<div style="padding:12px;background:#fafafa;border-radius:8px;">
      <pre style="margin-top:8px;font-size:12px;color:#666;">${value.code}</pre>
    </div>`;
  },
};

export const textToDiagramCard: CustomCard = {
  config: textToDiagramCardConfig,
};

export { TextToDiagramEditor, TextToDiagramViewer };
export type { ITextToDiagramCardValue, DiagramType } from './types';
