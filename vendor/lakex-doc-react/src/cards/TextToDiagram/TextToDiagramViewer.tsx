import React from 'react';
import type { ICardProps } from '../types';
import type { ITextToDiagramCardValue } from './types';
import TextToDiagramCore from './TextToDiagramCore';
import Doc from '../../components/lakex/lakex';

class TextToDiagramViewer extends React.Component<
  ICardProps<ITextToDiagramCardValue>
> {
  render() {
    const { cardValue, editor } = this.props;
    const locale =
      Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US';
    const theme =
      editor?.theme?.currentThemeSchema?.colorScheme === 'dark'
        ? 'dark'
        : 'light';

    return (
      <div style={{ width: '100%', height: cardValue?.cardHeight || 500 }}>
        <TextToDiagramCore
          value={cardValue || ({} as ITextToDiagramCardValue)}
          readOnly={true}
          locale={locale}
          theme={theme}
        />
      </div>
    );
  }
}

export default TextToDiagramViewer;
