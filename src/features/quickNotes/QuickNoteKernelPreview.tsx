/**
 * 小记卡片的**内核只读视图**（兜底渲染，261010 用户定稿方向）。
 *
 * 为什么需要：小记正文是标准 lake 标记，而内核的格式集合是**开放的** —— 内核每加一种卡，
 * 自研快路径解析器就欠一笔债（日期/表情只是第一笔）。所以这里把"格式覆盖度"这个问题
 * **还给内核**：只要快路径判不出来，整条卡片就由内核自己的只读渲染器画。
 * ⇒ 不存在"我们没实现所以显示不出来"的格式（格式全量 = 内核全量）。
 *
 * 代价可控的两个前提：
 * ① 只有快路径判不出来的正文才走这里（普通文字小记 = 零内核实例，移动端冷开不受影响）；
 * ② 只给**进入视口**的卡片挂实例（提前 ${PREMOUNT_MARGIN_PX}px 预挂载，离开视口即销毁）——
 *    实例数 = 屏幕内条数，与库里小记总数无关（实例创建 ≈80ms，见 261010 预热/实测）。
 *
 * 与编辑态的关系：同一份正文、同一个内核，只是 `mode="viewer"`（只读）——
 * 预览与编辑不再有两套渲染口径（旧的自研解析器就是第二套，必然漂移）。
 */
import { useEffect, useRef, useState } from "react";
import { addAssetAccessToken } from "../../lib/assetPort";
import { createLakeDocument, destroyLakeEditor, type LakeEditorInstance } from "../editor/lakeRuntime";

/** 视口预挂载余量：提前这么多像素建实例，滚到时已渲染好（避免滚动途中出现白块）。 */
const PREMOUNT_MARGIN_PX = 400;

interface QuickNoteKernelPreviewProps {
  /** 内核形态正文（与 `.lake` 同构）。 */
  body: string;
  /** 小记 id：内核解析正文里的资源/卡片时要用（与编辑态同一个 id）。 */
  noteId: string;
}

export function QuickNoteKernelPreview({ body, noteId }: QuickNoteKernelPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // 没有 IntersectionObserver 的环境（老 WebView / 测试）直接挂，保证功能不丢。
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: `${PREMOUNT_MARGIN_PX}px 0px` },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const host = hostRef.current;
    if (!host) return;
    let editor: LakeEditorInstance | null = null;
    try {
      editor = createLakeDocument(host, "viewer", () => {}, false, noteId, null, {
        // 与编辑态同款：小记没有 Lake 自己的滚动容器，虚拟渲染会量错视口（260919 踩坑）；阅读态也不需要大纲。
        disableNativeToc: true,
        disableVirtualRendering: true,
      });
      editor.setDocument("text/lake", addAssetAccessToken(body));
    } catch {
      // 渲染失败不留白块：外层卡片仍有标题/时间等元信息，点开即编辑态。
    }
    return () => { destroyLakeEditor(editor); };
  }, [inView, body, noteId]);

  return <div className="quick-note-kernel-preview" ref={hostRef} data-note-id={noteId} />;
}
