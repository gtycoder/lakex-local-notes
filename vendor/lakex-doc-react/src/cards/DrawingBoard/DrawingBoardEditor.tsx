import React, { Suspense } from 'react';
import CardResizer from '../../components/CardResizer';
import findCardId from '../utils';
import Doc from '../../components/lakex/lakex';
import type { ICardProps } from '../types';
import type {
  IDrawingBoardCardValue,
  LakexDrawingBoardEditorHost,
} from './types';

// LOCAL-CHANGE: 画板内核（lakex-drawnix + @plait，数 MB）原为静态 import，
// 会让宿主每次启动都加载白板引擎；改为懒加载（配合 vendor 分包产出独立 chunk）。
const DrawnixBoardCore = React.lazy(() => import('./DrawnixBoardCore'));

class DrawingBoardEditor extends React.Component<
  ICardProps<IDrawingBoardCardValue>
> {
  private handleChange = (value: Partial<IDrawingBoardCardValue>) => {
    const { cardValue, updateCardValue } = this.props;
    updateCardValue({
      ...cardValue,
      ...value,
      version: 2,
      engine: 'drawnix',
    });
  };

  render() {
    const { cardValue, editor } = this.props;
    const locale =
      Doc.FrameworkInfra.Locale.getLanguage() === 'zhCN' ? 'zh-CN' : 'en-US';
    // Theme/language are owned by Lakex. The board intentionally reads the
    // current project value on every render instead of persisting a local mode.
    const hostTheme = editor?.theme?.currentThemeSchema?.colorScheme === 'dark' ? 'dark' : 'light';
    const theme = hostTheme;
    const ai = (editor as LakexDrawingBoardEditorHost | undefined)
      ?.__lakexDrawingBoardAI;

    return (
      <CardResizer
        className="drawing-board-resizer"
        height={cardValue?.cardHeight || 560}
        min={320}
        onResize={(cardHeight) => this.handleChange({ cardHeight })}
        shouldHandleDeleteShortcut={(event) => {
          // Drawnix owns Delete / Backspace while this card is selected.
          // Its keyboard listener is mounted on document, so the event target
          // is not guaranteed to be a descendant of `.lakex-drawnix-core`.
          // Prevent the editor's native deletion without stopping propagation:
          // Drawnix can still receive the event and delete the selected element.
          event.preventDefault();
          return false;
        }}
        onDelete={(target) => {
          const cardId = findCardId(target);
          if (cardId && editor?.execCommand) {
            editor.execCommand('deleteCard', cardId);
          }
        }}
      >
        <Suspense
          fallback={
            <div style={{ width: '100%', height: cardValue?.cardHeight || 560 }} />
          }
        >
          <DrawnixBoardCore
            value={cardValue}
            locale={locale}
            theme={theme}
            ai={ai}
            onChange={this.handleChange}
          />
        </Suspense>
      </CardResizer>
    );
  }
}

export default DrawingBoardEditor;
