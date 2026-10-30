/**
 * Lake 正文「写入形态」的单一来源（260917 建立）。
 *
 * 背景：仓库里曾有 4 处各自手拼 Lake 正文（主进程建空文档 / 首启欢迎笔记 / 移动端初始正文 /
 * 小记转文档），格式全靠"抄对"。已经付过一次代价：手写**媒体**（裸 `<img>`）会让内核在打开时
 * 把图片当"远程图片"去抓 → 被主进程的本机/私网护栏拒（`INVALID_INPUT`）→ 内核回写**失败态卡片**
 * → 正文变化被当成用户编辑 → 自动保存 → `syncState` 变待同步 → 随下次同步上传（并把"图已失效"
 * 传播到其他端）。约定、反例与校验方法见 `docs/LAKE-CONTENT-WRITING.md`。
 *
 * 铁律：**媒体一律走 `<card>` 容器，绝不产出裸 `<img>`**（见本模块单测的回归围栏）。
 *
 * 本模块只做纯字符串拼装：不做 IO、**不引 `node:`**（红线③：`src/core` 禁 node 导入），
 * 随机 id 由调用方生成后传入。
 */

/** 新建空文档的正文。纯文本级、无媒体 —— 实测内核打开时原样保留（不重写 / 不脏 / 不上传）。 */
export function emptyLakeBody(noteId: string): string {
  return `<p id="${noteId}-body" class="ne-p"><br></p>`;
}

/** 首启欢迎页：桌面欢迎文档与 Android 默认小记共用同一份内容（固定标题/正文块）。 */
export const WELCOME_TITLE = "欢迎来到 LakexLocalNotes";
/** Android 首启默认小记的固定 id（与桌面 welcome-note 同理：全设备一致，同步不产生重复）。 */
export const WELCOME_QUICK_NOTE_ID = "welcome-quick-note";
/** 项目主页（使用说明放在 README 首屏的醒目位置；此前直接链 guide/README.md 在 Gitee 会 404）。 */
export const WELCOME_GUIDE_LINKS = [
  { label: "项目主页（Gitee）", url: "https://gitee.com/gtycoder/lakex-local-notes" },
  { label: "项目主页（GitHub）", url: "https://github.com/gtycoder/lakex-local-notes" },
] as const;

const WELCOME_INTRO = [
  "这是一个本地优先的笔记应用：笔记、表格、多维表、画板、手写板和小记都保存在本机，不依赖云端也能写作与检索。",
  "如果要在多台设备之间同步，可以在「设置」里填入你自己的 S3（七牛 Kodo、阿里云 OSS、Cloudflare R2 等）。S3 只作镜像，本地始终是真相。",
  "小提示：桌面按 ⌘K 全局搜索；Android 从首页胶囊搜索。删除的文档会先进回收站，默认 90 天后自动清理。",
] as const;

function lakeLinkParagraph(paragraphId: string, textId: string, label: string, url: string): string {
  return `<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><span data-lake-id="${textId}" id="${textId}"><a href="${escapeLakeHtml(url)}" target="_blank" rel="noreferrer">${escapeLakeHtml(label)}</a></span></p>`;
}

/** 首启欢迎笔记正文（Lake HTML）。固定 id：全设备一致，S3 同步不会产生重复。 */
export function welcomeLakeBody(): string {
  const parts = [
    `<h1 id="welcome" class="ne-h1">${WELCOME_TITLE}</h1>`,
    lakeTextParagraph("welcome-body", "welcome-body-text", WELCOME_INTRO[0]),
    lakeTextParagraph("welcome-sync", "welcome-sync-text", WELCOME_INTRO[1]),
    lakeTextParagraph("welcome-tips", "welcome-tips-text", WELCOME_INTRO[2]),
    lakeTextParagraph("welcome-guide", "welcome-guide-text", "使用说明与更新都在项目主页（README 首屏有用户手册入口）："),
  ];
  WELCOME_GUIDE_LINKS.forEach((link, index) => {
    parts.push(lakeLinkParagraph(`welcome-guide-${index + 1}`, `welcome-guide-${index + 1}-text`, link.label, link.url));
  });
  return parts.join("");
}

/** 首启欢迎小记的纯文本镜像（移动端预览/搜索用；正文 body 用 welcomeLakeBody）。 */
export function welcomeQuickNoteText(): string {
  return [
    WELCOME_TITLE,
    "",
    WELCOME_INTRO[0],
    WELCOME_INTRO[1],
    "",
    "使用说明与更新都在项目主页（README 首屏有用户手册入口）：",
    ...WELCOME_GUIDE_LINKS.map((link) => `${link.label}：${link.url}`),
    "",
    WELCOME_INTRO[2],
  ].join("\n");
}

export const WELCOME_NOTE_BODY = welcomeLakeBody();

/** Lake 正文里文本节点的最小转义（与内核写入时一致）。 */
export function escapeLakeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 一个带文本的段落（内核形态：`data-lake-id` + `id` + 内层 `span`）。 */
export function lakeTextParagraph(paragraphId: string, textId: string, text: string): string {
  return `<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><span data-lake-id="${textId}" id="${textId}">${escapeLakeHtml(text)}</span></p>`;
}

/** 一个空段落。 */
export function lakeEmptyParagraph(paragraphId: string): string {
  return `<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><br /></p>`;
}

/** 一张 inline 图片卡片所需的字段（见 docs/LAKE-CONTENT-WRITING.md §3 的内核自产样本）。 */
export interface LakeImageCardInput {
  /** 资源 URL：`http://127.0.0.1:<ASSET_PORT>/<noteId>/<filename>`，**不带 token**（token 由渲染侧按需加）。 */
  src: string;
  /** 卡片自身的 id（也用作 data-lake-id 段）。 */
  cardId: string;
  taskId: string;
  clientId: string;
  name: string;
  size: number;
  /** 写入者标记（如 `"quick-note"`）；缺省则不写该字段。 */
  from?: string;
  originWidth?: number;
  originHeight?: number;
}

/**
 * 构造图片卡片的 value 对象（字段顺序保持与既有小记转换产物一致，避免形态漂移）。
 * 注意：`undefined` 字段会被 `JSON.stringify` 省略 —— 这是刻意的（尺寸未知时不写）。
 */
export function buildLakeImageCardValue(input: LakeImageCardInput): Record<string, unknown> {
  return {
    src: input.src,
    taskId: input.taskId,
    clientId: input.clientId,
    originalType: "url",
    linkTarget: "_blank",
    name: input.name,
    size: input.size,
    from: input.from,
    originWidth: input.originWidth,
    originHeight: input.originHeight,
    ratio: 1,
    status: "done",
    style: "none",
    showTitle: false,
    title: "",
    rotation: 0,
    crop: [0, 0, 1, 1],
    id: input.cardId,
    margin: { top: true, bottom: true },
  };
}

/**
 * 把图片包成段落。**容器必须是 `<card type="inline" name="image">`**：
 * 裸 `<img>` 会被内核判为远程图片并触发下载（本机地址必被护栏拒），见模块头注释。
 */
export function lakeImageCardParagraph(paragraphId: string, cardValue: Record<string, unknown>): string {
  return `<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><card type="inline" name="image" value="data:${encodeURIComponent(JSON.stringify(cardValue))}"></card></p>`;
}
