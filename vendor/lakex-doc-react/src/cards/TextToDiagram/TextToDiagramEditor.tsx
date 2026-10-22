import React from 'react';
import type { ICardProps } from '../types';
import type { ITextToDiagramCardValue } from './types';
import TextToDiagramCore from './TextToDiagramCore';
import CardResizer from '../../components/CardResizer';
import findCardId from '../utils';
import Doc from '../../components/lakex/lakex';

class TextToDiagramEditor extends React.Component<
  ICardProps<ITextToDiagramCardValue>
> {
  private handleChange = (value: Partial<ITextToDiagramCardValue>) => {
    const { cardValue, updateCardValue } = this.props;
    if (typeof updateCardValue === 'function') {
      updateCardValue({ ...cardValue, ...value });
    }
  };

  private handleResize = (height: number) => {
    this.handleChange({ cardHeight: height });
  };

  render() {
    const { cardValue, editor } = this.props;
    const locale =
      Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US';
    const theme =
      editor?.theme?.currentThemeSchema?.colorScheme === 'dark'
        ? 'dark'
        : 'light';

    return (
      <CardResizer
        height={cardValue?.cardHeight || 500}
        min={200}
        onResize={this.handleResize}
        onDelete={(target) => {
          const cardId = findCardId(target);
          if (cardId && editor && typeof editor.execCommand === 'function') {
            editor.execCommand('deleteCard', cardId);
          }
        }}
      >
        <TextToDiagramCore
          value={cardValue || ({} as ITextToDiagramCardValue)}
          readOnly={false}
          locale={locale}
          theme={theme}
          onChange={this.handleChange}
        />
      </CardResizer>
    );
  }
}

export default TextToDiagramEditor;
