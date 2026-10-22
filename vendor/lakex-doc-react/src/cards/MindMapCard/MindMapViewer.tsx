// src/editor/cards/MindMapCard/MindMapViewer.tsx
import React from 'react';
import { MindMapViewer } from '@xiangfa/mindmap/viewer';
import type { ICardProps } from '../types';
import type { IMindMapCardValue } from './types'
import '@xiangfa/mindmap/style.css';
import Doc from '../../components/lakex/lakex';

class MindMapViewerComponent extends React.Component<ICardProps<IMindMapCardValue>> {
    
  render() {
    const { cardValue } = this.props;

    // if (!cardValue?.markdown) {
    //   return <div style={{ padding: '20px', color: '#999' }}></div>;
    // }

    return (
      <div style={{width: '100%', height: this.props.cardValue.cardHeight}}>
        <MindMapViewer
            markdown={cardValue.markdown}
            defaultDirection="both"
            theme={this.props.editor.theme.currentThemeSchema.colorScheme || 'auto'}
            locale={Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US'}
            toolbar={{ zoom: true, history: false, search: false, tags: false }}
        />
      </div>
    );
  }
}

export default MindMapViewerComponent;
