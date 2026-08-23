/**
 * M0 POC 页面（移动端最小闭环）：
 * 浏览列表 → 打开（LakeEditor 渲染）→ 编辑 → 保存（sql.js + IndexedDB）→ S3 通路验证。
 * 不复用 App.tsx（依赖完整 IPC）；直接复用 LakeEditor（纯 Web 组件，零 native 依赖）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LakeEditor } from "../features/editor/LakeEditor";
import { bridge, type POCNote, type S3Config } from "./bridge";
import { injectAssetBlobs } from "./blobInject";
import { createCardBlobInjector } from "./cardBlobInject";
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";
import { parseLocalAssetUrl } from "../core/assetUrl.js";
import "lakex-editor-react-component/style.css";
import "./mobile.css";

const EMPTY_NOTE: POCNote = { id: "", title: "", content: "", updatedAt: "" };

export function MobilePocApp() {
  const [phase, setPhase] = useState<"booting" | "ready">("booting");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<POCNote[]>([]);
  const [active, setActive] = useState<POCNote | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [saveState, setSaveState] = useState("");
  const [s3Status, setS3Status] = useState("");
  const [showS3Form, setShowS3Form] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [trashed, setTrashed] = useState<POCNote[]>([]);
  const [s3Cfg, setS3Cfg] = useState<S3Config>(() => bridge.getS3Settings() ?? {
    endpoint: "https://s3.cn-north-1.qiniucs.com",
    region: "cn-north-1",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: false,
  });
  const dirtyRef = useRef(false);
  const cardInjectorRef = useRef<ReturnType<typeof createCardBlobInjector> | null>(null);
  const editorRef = useRef<LakeEditorInstance | null>(null);


  const refreshList = useCallback(async () => {
    setNotes(await bridge.listNotes());
    setTrashed(await bridge.listTrashed());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await bridge.init();
        // 挂 window.lakeNative（uploadResource 等）：让 LakeEditor 的 native 调用（图片上传）走移动端实现
        (window as unknown as Record<string, unknown>).lakeNative = {
          uploadResource: (input: { bytes: number[]; filename: string }, noteId: string) =>
            bridge.uploadResource(input, noteId),
        };
        await refreshList();
        setPhase("ready");
      } catch (e) {
        setError(`初始化失败: ${(e as Error).message}`);
      }
    })();
  }, [refreshList]);

  // D8：viewer 内容 = 注入 blob 后的显示内容（setDocument 前改 src=blob → qH 挂载即用 blob）。
  // 实测（真机）：注入后 cardData.src=blob + status=done 被保留（originalType=link 需顶层设置），
  // setCardValue 命令作为 backup（onEditorReady 后注入）。
  const { displayContent: viewerContent, revoke, restore } = useMemo(() => {
    if (active) return injectAssetBlobs(active.content);
    return { displayContent: "", revoke: () => {}, restore: (c) => c };
  }, [active]);
  // 基于当前文档内容建立卡片注入器（setCardValue 命令 backup）
  const cardInjector = useMemo(
    () => (active ? createCardBlobInjector(active.content) : null),
    [active]
  );
  // 关文档/切 tab 时 revoke blob URLs
  useEffect(() => () => { revoke(); cardInjector?.revoke(); }, [revoke, cardInjector]);


  const save = async () => {
    if (!active) return;
    setSaveState("保存中…");
    try {
      await bridge.saveNote(active.id, draftTitle.trim() || active.title, draft);
      dirtyRef.current = false;
      setSaveState("已保存 ✓");
      await refreshList();
    } catch (e) {
      setSaveState(`保存失败: ${(e as Error).message}`);
    }
  };

  const uploadToS3 = async () => {
    setSaveState("上传中…");
    try {
      const bytes = await bridge.exportSnapshotBytes();
      const key = `poc/mobile-snapshot-${Date.now()}.sqlite`;
      const uploaded = await bridge.uploadObject(key, bytes);
      setSaveState(`已上传 → ${uploaded}`);
    } catch (e) {
      setSaveState(`上传失败: ${(e as Error).message}`);
    }
  };

  const openNote = (n: POCNote) => {
    setActive(n);
    setDraft(n.content);
    setDraftTitle(n.title);
    setEditing(false);
    dirtyRef.current = false;
    setSaveState("");
  };

  const createNew = async () => {
    const n = await bridge.createNote(`新笔记 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    await refreshList();
    openNote(n);
    setEditing(true);
  };

  const testS3 = async () => {
    bridge.saveS3Settings(s3Cfg);
    setS3Status("测试中…");
    setS3Status(await bridge.testS3Connection());
  };

  const trashIt = async (id: string) => {
    try {
      await bridge.trashNote(id);
      setSaveState("已移入回收站（同步后上传墓碑）");
      await refreshList();
    } catch (e) {
      setSaveState(`删除失败: ${(e as Error).message}`);
    }
  };
  const restoreIt = async (id: string) => {
    await bridge.restoreNote(id);
    setShowTrash(false);
    await refreshList();
  };

  const syncAll = async () => {
    setSaveState("同步中…");
    try {
      const msg = await bridge.syncNow();
      setSaveState(`同步: ${msg}`);
      await refreshList();
    } catch (e) {
      setSaveState(`同步失败: ${(e as Error).message}`);
    }
  };

  if (phase === "booting") {
    return <div className="poc-center">启动中…（加载 WASM SQLite）</div>;
  }
  if (error) return <div className="poc-center poc-error">{error}</div>;

  // ---- 列表视图 ----
  if (!active) {
    return (
      <div className="poc-shell">
        <header className="poc-topbar">
          <strong>Lake Notes · POC</strong>
          <span className="poc-topbar-actions">
            <button onClick={createNew}>＋ 新建</button>
            <button onClick={() => void syncAll()}>同步</button>
            <button onClick={() => setShowTrash((v) => !v)}>回收站</button>
            <button onClick={() => setShowS3Form((v) => !v)}>S3</button>
          </span>
        </header>
        <div className="poc-status">{saveState}</div>
        {showS3Form && (
          <section className="poc-s3form">
            <input placeholder="Endpoint" value={s3Cfg.endpoint} onChange={(e) => setS3Cfg({ ...s3Cfg, endpoint: e.target.value })} />
            <input placeholder="Region" value={s3Cfg.region} onChange={(e) => setS3Cfg({ ...s3Cfg, region: e.target.value })} />
            <input placeholder="Bucket" value={s3Cfg.bucket} onChange={(e) => setS3Cfg({ ...s3Cfg, bucket: e.target.value })} />
            <input placeholder="AccessKeyId" value={s3Cfg.accessKeyId} onChange={(e) => setS3Cfg({ ...s3Cfg, accessKeyId: e.target.value })} />
            <input placeholder="SecretAccessKey" type="password" value={s3Cfg.secretAccessKey} onChange={(e) => setS3Cfg({ ...s3Cfg, secretAccessKey: e.target.value })} />
            <div className="poc-s3form-actions">
              <button onClick={testS3}>测试连接</button>
              <span>{s3Status}</span>
            </div>
          </section>
        )}
        {showTrash ? (
          <ul className="poc-list">
            {trashed.length === 0 && <li className="poc-empty">回收站为空</li>}
            {trashed.map((n) => (
              <li key={n.id} className="poc-note-item">
                <span className="poc-note-title">{n.title}</span>
                <span className="poc-note-time">{new Date(n.updatedAt).toLocaleString("zh-CN")}</span>
                <button className="poc-restore-btn" onClick={() => void restoreIt(n.id)}>恢复</button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="poc-list">
            {notes.length === 0 && <li className="poc-empty">暂无笔记，点「＋ 新建」创建</li>}
            {notes.map((n) => (
              <li key={n.id} className="poc-note-item">
                <span className="poc-note-title" onClick={() => openNote(n)}>{n.title}</span>
                <span className="poc-note-time">{new Date(n.updatedAt).toLocaleString("zh-CN")}</span>
                <button className="poc-restore-btn" onClick={() => void trashIt(n.id)}>删除</button>
              </li>
            ))}
          </ul>
        )}
        <footer className="poc-foot">sql.js(WASM) + IndexedDB + S3 POC</footer>
      </div>
    );
  }

  // ---- 文档视图 ----
  return (
    <div className="poc-shell">
      <header className="poc-topbar">
        <button onClick={() => { if (dirtyRef.current && !confirm("有未保存修改，放弃？")) return; setActive(null); }}>‹ 列表</button>
        <input className="poc-title-input" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
        <span className="poc-topbar-actions">
          {!editing ? (
            <button onClick={() => setEditing(true)}>编辑</button>
          ) : (
            <>
              <button onClick={save}>保存</button>
              <button onClick={() => { void bridge.trashNote(active.id); setActive(null); }}>删除</button>
              <button onClick={uploadToS3}>上传 S3</button>
            </>
          )}
        </span>
      </header>
      <div className="poc-status">{saveState}</div>
      <section className="poc-document">
        <LakeEditor
          noteId={active.id}
          content={viewerContent}
          mode={editing ? "editor" : "viewer"}
          tocEnabled={false}
          onChange={(content) => {
            // 保存前还原：blob → canonical（内容注入 + cardInjector 注入的 blob 都要还原）
            const restored = cardInjector ? cardInjector.restore(restore(content)) : restore(content);
            setDraft(restored);
            dirtyRef.current = true;
          }}
          onEditorReady={(noteId, editor) => {
            editorRef.current = editor;
            // editor 就绪后延迟注入 blob（等卡片创建）；resetCardValue+sync 可在卡片 error 后救活，
            // 故用稍长延迟 + 重试确保卡片已挂载
            if (editor && cardInjector) {
              let attempts = 0;
              const tryInject = () => {
                const n = cardInjector.inject(editor);
                if (n === 0 && attempts < 4) {
                  attempts++;
                  window.setTimeout(tryInject, 400);
                }
              };
              window.setTimeout(tryInject, 800);
            }
          }}
          prefs={{ fontSize: 18, showToolbar: true }}
        />
      </section>
    </div>
  );
}
