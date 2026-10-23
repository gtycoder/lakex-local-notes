/**
 * 会话消息里的存档图片（261023 P2.5）：按 {conversationId,imageRef} 懒加载 data URL。
 * 历史详情与当前聊天气泡共用；加载失败不占位、不崩（只留 [图片] 文本）。
 */
import { useEffect, useState } from "react";
import { readConversationImageDataUrl, type AiStoredImageRef } from "./aiImageStore";

const cache = new Map<string, string>();

export function AiMessageImages({ conversationId, images }: { conversationId: string | null; images: readonly AiStoredImageRef[] }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    if (!conversationId || images.length === 0) { setUrls([]); return; }
    let cancelled = false;
    void (async () => {
      const loaded: string[] = [];
      for (const image of images) {
        const key = conversationId + "/" + image.id;
        const cached = cache.get(key);
        if (cached) { loaded.push(cached); continue; }
        const dataUrl = await readConversationImageDataUrl(conversationId, image);
        if (dataUrl) { cache.set(key, dataUrl); loaded.push(dataUrl); }
      }
      if (!cancelled) setUrls(loaded);
    })();
    return () => { cancelled = true; };
  }, [conversationId, images]);
  if (urls.length === 0) return null;
  return (
    <div className="ai-msg__images">
      {urls.map((url, index) => <img key={index} src={url} alt="对话图片" />)}
    </div>
  );
}
