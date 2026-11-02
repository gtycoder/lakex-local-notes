import { useCallback, useEffect } from "react";
import InkPad, { type InkPadProps } from "../../features/ink/InkPad";
import { importInkImagePages, pickInkImageFiles } from "../../features/ink/inkImageImport";
import { bridge } from "../bridge";
import { setStylusHandwritingEnabled } from "../native/stylusInput";
import "./inkPad.shared.css";
import "./inkPad.mobile.css";

export type MobileInkPadProps = Omit<InkPadProps, "variant"> & {
  /** 当前手写板 noteId：v2「导入图片」需要它把资产落到本笔记目录。 */
  noteId?: string;
};

export function MobileInkPad({ noteId, active = false, readOnly = false, ...props }: MobileInkPadProps) {
  useEffect(() => {
    if (!active || readOnly) return;
    void setStylusHandwritingEnabled(false);
    return () => { void setStylusHandwritingEnabled(true); };
  }, [active, readOnly]);

  // v2 图片页：移动端入口 = 全局预览面板里的「导入图片」（编辑态）。上传走 bridge 资产通道。
  const onImportImages = useCallback(async () => {
    if (!noteId) return null;
    const files = await pickInkImageFiles();
    if (files.length === 0) return null; // 用户取消
    return importInkImagePages(files, {
      upload: (input) => bridge.uploadResource(input, noteId),
    });
  }, [noteId]);

  return (
    <InkPad
      {...props}
      active={active}
      readOnly={readOnly}
      variant="mobile"
      onImportImages={noteId ? onImportImages : undefined}
    />
  );
}

export default MobileInkPad;
