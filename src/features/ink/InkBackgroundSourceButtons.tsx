/**
 * 背景来源按钮（261104 二十二批）：导入图片 / 导入 PDF 都是「给本页加背景」，所以放在底栏、
 * 排在纸张（空白/横线/网格/点阵）后面，用文字说明它们是背景 —— 不再和画笔工具挤在顶部工具条。
 *
 * 独立成文件的原因同 InkExportMenu / InkOutlinePanel / InkImageSelection：
 * 跨端样式护栏只检查 SHARED 名单里的组件（InkPad 在内），桌面专属控件放进独立文件，
 * 就不用为了过护栏给移动端补一份用不到的样式。
 */
export interface InkBackgroundSourceButtonsProps {
  disabled: boolean;
  onImportImages?: () => void;
  onImportPdf?: () => void;
}

export function InkBackgroundSourceButtons({ disabled, onImportImages, onImportPdf }: InkBackgroundSourceButtonsProps) {
  if (!onImportImages && !onImportPdf) return null;
  return (
    <div className="ink-bg-source" role="group" aria-label="背景来源">
      {onImportImages && (
        <button
          onClick={onImportImages}
          disabled={disabled}
          aria-label="导入图片"
          title="导入图片作为背景页"
        >背景图</button>
      )}
      {onImportPdf && (
        <button
          onClick={onImportPdf}
          disabled={disabled}
          aria-label="导入 PDF"
          title="导入 PDF 作为背景页（每页一页）"
        >背景 PDF</button>
      )}
    </div>
  );
}

export default InkBackgroundSourceButtons;
