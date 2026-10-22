// src/editor/cards/MindMapCard/MindMapEditor.tsx
import React from 'react';
import { allPlugins, MindMap, MindMapTextEditor } from '@xiangfa/mindmap';
import type { MindMapRef, ThemeMode } from '@xiangfa/mindmap';
import type { ICardProps } from '../types';
import type { IMindMapCardValue } from './types'
import Doc from "../../components/lakex/lakex";
import '@xiangfa/mindmap/style.css';
import CardResizer from '../../components/CardResizer';
import findCardId from '../utils';

const defaultMarkdown = `Mindmap
  - New Node 1
  - New Node 2
  - New Node 3`;


interface MindMapEditorState {
  markdown: string;
  height: number;
  theme: ThemeMode;
}

class MindMapEditor extends React.Component<
  ICardProps<IMindMapCardValue>,
  MindMapEditorState
> {
  private mindMapRef = React.createRef<MindMapRef>();

  constructor(props: ICardProps<IMindMapCardValue>) {
    super(props);
    this.state = {
      markdown: props.cardValue?.markdown || defaultMarkdown,
      height: props.cardValue.cardHeight || 400,
      // 主题只捕获一次，避免每次渲染都换 theme prop 引发组件抖动
      theme: (props.editor.theme.currentThemeSchema.colorScheme as ThemeMode) || 'auto',
    };
    this.saveData = this.saveData.bind(this);
  }

  // 保存当前数据到卡片
  // 注意：这里【不能】再 setState({ markdown })，否则会把 getMarkdown() 重新序列化后的
  // 字符串再次传给 <MindMap markdown={...}>，触发库内部重新解析 nodes → autoFit effect
  // 重跑 → 把缩放级别重置为"适配整图"，表现为"双击/编辑后自动缩放"。
  // 只把最新 markdown 持久化到卡片值即可；<MindMap> 用初始化时的 markdown（state，不再变）
  // 渲染，库内部自己维护编辑态，不会重新解析，zoom 也就不会被重置。
  private saveData() {
    const instance = this.mindMapRef.current;
    if (instance && typeof instance.getMarkdown === 'function') {
      
      const { updateCardValue } = this.props;
      if (typeof updateCardValue === 'function') {
        const markdown = instance.getMarkdown();
        const svg = instance.exportToSVG().replace(/\r?\n|\r/g, "")
        console.log(svg)
        updateCardValue({markdown, svg, cardHeight: this.state.height });
      }
    }
  }

  // 组件卸载时保存
  componentWillUnmount() {
    this.saveData();
  }

  render() {
    const { markdown, height } = this.state;
    return (
      <CardResizer
        height={height}
        min={30}
        onResize={(h) => {
          this.setState({
            height: h
          }, () => {
            this.saveData()
          })
        }}
        onDelete={(target) => {
          // 选中态下按 Delete 删除当前卡片：
          // 从触发按键的 DOM 向上找到框架卡片节点（class 含 ne-card 且有 id），
          // 再调用框架命令 editor.execCommand("deleteCard", cardId) 删除。
          // 注：框架的 editor.activeCardId 只对内置卡片生效（依赖 hot-key 选中集合），
          // 自定义卡片需从 DOM 取 id，故这里用 findCardId 定位。
          const cardId = findCardId(target);
          const { editor } = this.props;
          if (cardId && editor && typeof editor.execCommand === 'function') {
            editor.execCommand('deleteCard', cardId);
          }
        }}
      >
        <MindMap
          ref={this.mindMapRef}
          markdown={markdown}
          plugins={allPlugins}
          defaultDirection="both"
          // 关键：首次挂载自动适配整图，之后编辑/增删节点不再自动重适配，
          // 解决"双击编辑节点时视图被自动缩放跳动"的问题。
          // @ts-ignore 当前 @xiangfa/mindmap 类型声明未暴露该 prop，但运行时支持。
          disableAutoFit={true}
          theme={this.state.theme}
          toolbar={true}
          readonly={false}
          locale={Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US'}
          textEditor={MindMapTextEditor}
          onDataChange={() => {
            setTimeout(this.saveData, 0);
          }}
          onEvent={(event) => {
            console.log('mindmap event:', event.type, event);
          }}
        />
      </CardResizer>
    );
  }
}

export default MindMapEditor;