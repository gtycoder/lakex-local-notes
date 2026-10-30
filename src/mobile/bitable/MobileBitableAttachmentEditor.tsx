/**
 * 移动端多维表：附件/图片**编辑**控件（261030 P1，单一来源）。
 *
 * 表单（填写态）与记录面板（编辑态）都要「看已选文件 + 上传 + 移除」，以前只有表单有、记录面板是只读文案。
 * 抽成一个控件后两端行为一致：系统选择器 → `bridge.uploadResource` → `bitableAttachments` 数组写回；
 * 映射与桌面 `BitableEditor.uploadFiles` 一致（见 mobileBitableAttachments.ts）。
 */
import { useState } from "react";
import { Paperclip, Plus, X } from "lucide-react";
import { bitableAttachments, type BitableAttachment, type BitableField } from "../../core/bitableDoc.js";
import { pickLocalFiles } from "../ui/pickFile";
import { bridge } from "../bridge";
import { showToast } from "../ui/toastBus";
import { uploadBitableAttachments } from "./mobileBitableAttachments";

export interface MobileBitableAttachmentEditorProps {
  noteId: string;
  field: BitableField;
  value: unknown;
  onChange: (next: BitableAttachment[]) => void;
}

export function MobileBitableAttachmentEditor({ noteId, field, value, onChange }: MobileBitableAttachmentEditorProps) {
  const files = bitableAttachments(value);
  /** 同一时刻只允许一个上传流程（原生选择器不能叠加）。 */
  const [uploading, setUploading] = useState(false);
  const imageOnly = field.type === "image";

  const add = async () => {
    if (uploading) return;
    const picked = await pickLocalFiles(imageOnly ? "image/*" : "*/*");
    if (picked.length === 0) return;
    setUploading(true);
    try {
      const uploaded = await uploadBitableAttachments(picked, (input) => bridge.uploadResource(input, noteId));
      onChange([...bitableAttachments(value), ...uploaded]);
    } catch (reason) {
      // 触屏没有 hover/内联气泡：失败必须给可见提示（父级不再统一兜底）。
      showToast("上传失败：" + (reason instanceof Error && reason.message ? reason.message : "请重试"), { type: "error" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mbt-files">
      {files.map((file) => (
        <div key={file.file} className="mbt-file">
          <Paperclip size={14} aria-hidden="true" />
          <span className="mbt-file__name mb-ellipsis" title={file.name}>{file.name}</span>
          <button type="button" className="mbt-file__x" aria-label={"移除 " + file.name}
            onClick={() => onChange(files.filter((item) => item.file !== file.file))}><X size={14} /></button>
        </div>
      ))}
      <button type="button" className="mbt-file-add" disabled={uploading} onClick={() => void add()}>
        {uploading ? "上传中…" : <><Plus size={14} />{imageOnly ? "上传图片" : "上传附件"}</>}
      </button>
    </div>
  );
}

export default MobileBitableAttachmentEditor;
