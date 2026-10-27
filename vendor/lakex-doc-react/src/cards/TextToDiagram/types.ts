export type DiagramType = 'mermaid' | 'flowchart' | 'plantuml' | 'graphviz';

export interface ITextToDiagramCardValue {
  /** 当前图表源码 */
  code: string;
  /** 图表类型 */
  type: DiagramType;
  /** 卡片高度（px） */
  cardHeight: number;
  /** 是否显示左侧代码编辑器 */
  showEditor?: boolean;
  /** 是否显示右侧 SVG 预览 */
  showPreview?: boolean;
}
