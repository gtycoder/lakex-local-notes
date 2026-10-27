

export interface IMindMapCardValue {
  markdown: string;
  svg: string;
  /** 卡片高度（px），由 CardResizer 拖动写入 */
  cardHeight?: number;
}