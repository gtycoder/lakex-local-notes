import { useCallback, useEffect, useRef, useState } from "react";
import type { S3Settings } from "../../lib/types";
import { decodeS3ConfigTransfer, decodeS3ConfigTransferFile, encodeS3ConfigTransfer } from "../../core/s3ConfigTransfer";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import { bridge } from "../bridge";
import { pickLocalFile } from "../ui/pickFile";
import { showToast } from "../ui/toastBus";

/** 对齐桌面 registerSync 的 S3_SECRET_MASK：get 不回显明文，保存时掩码则保留旧值。 */
export const S3_SECRET_MASK = "********";

export interface S3FormValues {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const EMPTY_FORM: S3FormValues = {
  endpoint: "https://s3.cn-north-1.qiniucs.com",
  region: "cn-north-1",
  bucket: "",
  prefix: "lakex-local-notes",
  accessKeyId: "",
  secretAccessKey: S3_SECRET_MASK,
};

function formFromSettings(settings: S3Settings): S3FormValues {
  return {
    endpoint: settings.endpoint,
    region: settings.region,
    bucket: settings.bucket,
    prefix: settings.prefix,
    accessKeyId: settings.accessKeyId,
    secretAccessKey: S3_SECRET_MASK,
  };
}

/** 设置页 S3 表单状态：持久化配置、草稿字段、掩码 Secret、测试与迁移码。 */
export function useS3SettingsForm(open: boolean) {
  const [settings, setSettings] = useState<S3Settings | null>(null);
  const [form, setForm] = useState<S3FormValues>(EMPTY_FORM);
  const [testText, setTestText] = useState("");
  const [exportState, setExportState] = useState<{ code: string; msg: string } | null>(null);
  const transferRef = useRef<HTMLTextAreaElement | null>(null);

  const updateForm = useCallback((patch: Partial<S3FormValues>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (!open) return;
    void bridge.getS3Settings().then((cfg) => {
      setSettings(cfg);
      if (cfg) setForm(formFromSettings(cfg));
    }).catch((error) => reportNativeActionError("读取 S3 设置", error));
  }, [open]);

  const save = useCallback(async (): Promise<boolean> => {
    const prev = await bridge.getS3Settings().catch((error) => {
      reportNativeActionError("保存前读取 S3 设置", error);
      return null;
    });
    const secret = form.secretAccessKey === S3_SECRET_MASK ? (prev?.secretAccessKey ?? "") : form.secretAccessKey;
    // D2 261017：移动端只支持虚拟托管（阿里云/腾讯云/AWS/七牛）。
    const cfg: S3Settings = {
      endpoint: form.endpoint,
      region: form.region,
      bucket: form.bucket,
      prefix: form.prefix,
      accessKeyId: form.accessKeyId,
      secretAccessKey: secret,
      forcePathStyle: false,
    };
    try {
      // D3/D7：桥内统一 normalizeEndpoint + validateS3Settings + region 缺省。
      await bridge.saveS3Settings(cfg);
      const saved = await bridge.getS3Settings();
      if (saved) {
        setSettings(saved);
        setForm((current) => ({ ...current, endpoint: saved.endpoint, region: saved.region }));
      }
      setTestText("已保存");
      return true;
    } catch (error) {
      setTestText("保存失败：" + (error as Error).message);
      return false;
    }
  }, [form]);

  const testConnection = useCallback(async () => {
    if (!(await save())) return;
    setTestText("测试中…");
    try {
      setTestText(await bridge.testS3Connection());
    } catch (error) {
      setTestText("测试失败：" + (error as Error).message);
    }
  }, [save]);

  const openExport = useCallback(async () => {
    setTestText("");
    try {
      const cfg = await bridge.getS3Settings();
      if (!cfg || !cfg.secretAccessKey.trim()) {
        setTestText("本机还没有可导出的 S3 配置（Secret Key 为空）");
        return;
      }
      const code = await encodeS3ConfigTransfer(cfg);
      let msg = "迁移码已生成：点「复制迁移码」后发送到另一台设备。";
      try {
        await navigator.clipboard.writeText(code);
        msg = "已复制到剪贴板（含密钥，请只发给自己）。";
      } catch {
        // 剪贴板不可用：面板里可长按全选复制。
      }
      setExportState({ code, msg });
    } catch (error) {
      setTestText("导出失败：" + getNativeErrorMessage(error));
    }
  }, []);

  const copyExport = useCallback(async () => {
    if (!exportState) return;
    try {
      await navigator.clipboard.writeText(exportState.code);
      setExportState({ ...exportState, msg: "迁移码已复制到剪贴板" });
    } catch {
      transferRef.current?.focus();
      transferRef.current?.select();
      setExportState({ ...exportState, msg: "无法写入剪贴板：已全选，请长按复制" });
    }
  }, [exportState]);

  /** 导入落地（两份入口共用）：强制虚拟托管（D2），成功后回填表单；返回 Path-style 提示后缀。 */
  const applyImported = useCallback(async (imported: S3Settings): Promise<string> => {
    const pathStyleNote = imported.forcePathStyle
      ? "（该配置使用 Path-style 访问，移动端只支持虚拟主机方式，已按虚拟主机方式保存）"
      : "";
    await bridge.saveS3Settings({ ...imported, forcePathStyle: false });
    const saved = await bridge.getS3Settings();
    if (saved) {
      setSettings(saved);
      setForm(formFromSettings(saved));
    }
    return pathStyleNote;
  }, []);

  const importFromFile = useCallback(async () => {
    setTestText("");
    try {
      const file = await pickLocalFile(".json,.txt,application/json,text/plain");
      if (!file) return;
      if (file.size > 64 * 1024) {
        setTestText("导入失败：文件过大，不像 S3 配置文件");
        return;
      }
      const text = await file.text();
      const imported = await decodeS3ConfigTransferFile(text);
      const pathStyleNote = await applyImported(imported);
      setTestText("S3 配置已从文件导入，请点「测试连接」确认" + pathStyleNote);
      showToast("S3 配置已导入");
    } catch (error) {
      setTestText("导入失败：" + getNativeErrorMessage(error));
    }
  }, [applyImported]);

  /**
   * 粘贴迁移码导入（与桌面 S3ConfigImportDialog 同形同构的备用路径）。
   * 失败直接抛出可读原因，由调用方（S3ConfigImportSheet）就地展示。
   */
  const importFromCode = useCallback(async (code: string): Promise<void> => {
    setTestText("");
    const imported = await decodeS3ConfigTransfer(code.trim());
    const pathStyleNote = await applyImported(imported);
    setTestText("S3 配置已从迁移码导入，请点「测试连接」确认" + pathStyleNote);
    showToast("S3 配置已导入");
  }, [applyImported]);

  return {
    settings,
    form,
    updateForm,
    testText,
    exportState,
    transferRef,
    save,
    testConnection,
    openExport,
    copyExport,
    importFromFile,
    importFromCode,
    closeExport: () => setExportState(null),
  };
}
