import React from 'react';
import type { PlaitBoard } from '@plait/core';
interface Props {
    board: PlaitBoard | null;
    locale: 'zh-CN' | 'en-US';
    toolbarHost: HTMLElement | null;
}
export default function LakexExportMenu({ board, locale, toolbarHost }: Props): React.ReactPortal;
export {};
