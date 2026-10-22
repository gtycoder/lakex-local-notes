import React from 'react';
import { createPortal } from 'react-dom';
import { saveAsPng, saveAsSvg } from 'lakex-drawnix';
import type { PlaitBoard } from '@plait/core';

interface Props {
  board: PlaitBoard | null;
  locale: 'zh-CN' | 'en-US';
  toolbarHost: HTMLElement | null;
}

const ExportIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4" />
  </svg>
);

export default function LakexExportMenu({ board, locale, toolbarHost }: Props) {
  const [open, setOpen] = React.useState(false);
  const labels = locale === 'zh-CN'
    ? { export: '导出', svg: '导出 SVG', png: '导出 PNG' }
    : { export: 'Export', svg: 'Export SVG', png: 'Export PNG' };

  const runExport = (action: (target: PlaitBoard) => void | Promise<void>) => {
    if (!board) return;
    setOpen(false);
    void action(board);
  };

  if (!toolbarHost) return null;

  return createPortal(
    (
      <div className="lakex-drawnix-export" data-lakex-export-menu>
        <button
          type="button"
          className="lakex-drawnix-export__trigger"
          title={labels.export}
          aria-label={labels.export}
          aria-expanded={open}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((current) => !current)}
        >
          <ExportIcon />
        </button>
        {open && (
          <div className="lakex-drawnix-export__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => runExport(saveAsSvg)}>
              {labels.svg}
            </button>
            <button type="button" role="menuitem" onClick={() => runExport(saveAsPng)}>
              {labels.png}
            </button>
          </div>
        )}
      </div>
    ),
    toolbarHost,
  );
}
