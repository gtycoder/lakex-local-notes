// src/editor/cards/MindMapCard/index.ts
import { CustomCard, CustomCardConfig } from '../../components/lakex/types';
import MindMapEditor from './MindMapEditor';
import MindMapViewer from './MindMapViewer';
import type { IMindMapCardValue } from './types';

const defaultMarkdown = `Mindmap
  - New Node 1
  - New Node 2
  - New Node 3`;

export const mindMapCardConfig: CustomCardConfig = {
  name: 'mindmap-card',
  cardType: 'block',
  editorComponent: MindMapEditor,
  viewerComponent: MindMapViewer,
  initValue: {
    markdown: defaultMarkdown,
    svg:"",
    cardHeight: 500,
  },
  slash: {
    /** 图标 */
    icon: 'editor-main-mind-map',
    /**
     * 斜杆面板的搜索提示，提示用户搜索，例如：/glk
     */
    mainSearch: '/mindmap',
    label: () => ({zhCN: '思维导图', enUS: 'Mindmap'}),
    description: () => ({zhCN: '用于梳理信息和头脑风暴', enUS: 'For ideas and brainstorm'}),
    keywords: ['mindmap', '思维导图', '脑图', 'map'],
  },
  writeText: (value: IMindMapCardValue | null) => {
    return value?.markdown || '';
  },
  writeHtml: (value: IMindMapCardValue | null) => {
    if (!value?.svg) return '<div></div>';
    const base64 = btoa(unescape(encodeURIComponent(value.svg)));
    return`<img src="${`data:image/svg+xml;base64,${base64}`}" />`
  },
};

export const mindMapCard: CustomCard = {
  config: mindMapCardConfig
}

//setTimeout(()=>navigator.clipboard.read().then(itms=>{itms.forEach(itm=>{itm.types.forEach(c => itm.getType(c).then(b => b.text().then(console.log)))})}),5000)



