/**
 * 笔记本图标资源 —— 语雀 web「知识库设置 → 图标和名称」那套彩色插画（20×20 内联 SVG）。
 *
 * **来源**：语雀 web 知识库设置页，2026-10-20 用真实登录态从页面 DOM 抓取（用户点单「要语雀这种类型图标，
 * 且只给笔记本使用」）。17 个图形都是页面上的内联 `<svg>`，此处原样内联成组件：不引外部文件、不发网络请求，
 * Electron 与 Android WebView 两端同样成立。
 *
 * **只给容器**（`TreeNodeType = "notebook" | "group"`）：所有文档类型（文档/表格/多维表/画板）仍用表情符号。
 * 旧的 40 个 lucide 线性图标 + 8 档色板已于同批整体删除（用户 261020「彻底清除原来的图标这一块」）。
 * 这 17 个图形自带配色，所以渲染分支里没有色板 —— 再叠一层底块只会更脏。
 *
 * **落库值 = `n:<id>`**（短 id；整串 ≤ 16 字符，与 `i:<id>:<色号>` 同一套「只扩展值方言」约定，不动表与同步协议）。
 * 语雀图形标题（如「表格知识库」）只作 id 来源，界面文案用这里的中文 label。
 *
 *
 * ⚠️ **不含语雀品牌 logo**：那个「语雀」图标（BookIconYuque）涉及品牌标识，261020 用户要求彻底移除；
 * 旧值 `n:yuque` 只会被当作不认识的 id 画中性图形（不迁移、不回显原始串）。
 *
 * ⚠️ 图形版权属语雀，本项目自用；将来若要对外分发需换自有图形。
 */
import type { ReactElement } from "react";
import { useId } from "react";

export interface NotebookIconDef {
  /** 落库短 id（`n:<id>` 整串 ≤ 16 字符）。 */
  id: string;
  /** 面板里的中文名（也是无障碍名）。 */
  label: string;
  Svg: () => ReactElement;
}

/** 图标值的方言前缀（表情与 `i:` 线性图标都不含它，三种方言不会歧义）。 */
export const NOTEBOOK_ICON_PREFIX = "n:";

function NotebookIconDefault() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><path d="M4.75 1.267h10.5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2Z" fill="#C4DCFF"></path><path d="M4.75 1.267h2.215v18H5.75a3 3 0 0 1-3-3v-13a2 2 0 0 1 2-2Z" fill="#679FF4"></path><path stroke="#397ABD" d="M7.25 1.1v17.667"></path><path stroke="#397ABD" strokeLinecap="round" strokeLinejoin="round" d="M10.85 5.394h3.4"></path><path d="M4.25 1.267h11.5a1.5 1.5 0 0 1 1.5 1.5v14.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5v-14.5a1.5 1.5 0 0 1 1.5-1.5Z" stroke="#397ABD"></path></g>
    </svg>
  );
}

function NotebookIconSheet() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><g fill="#BBEBC4" stroke="#388D68" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.976"><path d="M2.4 10h1.5a1 1 0 0 1 1 1v7h0-3.5v-7a1 1 0 0 1 1-1ZM9.1 12.254h1.5a1 1 0 0 1 1 1V18h0-3.5v-4.746a1 1 0 0 1 1-1ZM15.8 6h1.5a1 1 0 0 1 1 1v11h0-3.5V7a1 1 0 0 1 1-1Z"></path></g><path d="m14.35.1 2.16.004c.305 0 .557.222.605.514l.009.099.003 2.11a.614.614 0 0 1-1.22.102l-.009-.1-.003-1.498-1.548-.002a.615.615 0 0 1-.605-.516l-.008-.1c0-.305.224-.558.516-.605l.1-.008Z" fill="#388D68" fillRule="nonzero"></path><path d="M15.4.998a.5.5 0 0 1 .778.621l-.056.07-5.073 5.305a2.527 2.527 0 0 1-2.789.59l-.177-.08-3.096-1.565a1.527 1.527 0 0 0-1.627.159l-.112.096-1.994 1.89a.5.5 0 0 1-.748-.657l.06-.068L2.56 5.47a2.527 2.527 0 0 1 2.708-.5l.17.078L8.534 6.61c.554.28 1.216.195 1.68-.202l.112-.106L15.399.998Z" fill="#388D68" fillRule="nonzero"></path></g>
    </svg>
  );
}

function NotebookIconBlog() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd" stroke="#397ABD"><path d="M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9.268a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5V7.5A1.5 1.5 0 0 1 7.5 6Z" fill="#679FF4"></path><path d="M3.5 2h9A1.5 1.5 0 0 1 14 3.5v13.268a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5V3.5A1.5 1.5 0 0 1 3.5 2Z" fill="#C4DCFF"></path><path strokeLinecap="round" d="M5.5 7.5h5M5.5 12.6h5"></path></g>
    </svg>
  );
}

function NotebookIconTopic() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g stroke="#55629D" fill="none" fillRule="evenodd"><path d="M9.04 1.8c4.441 0 8.04 3.657 8.04 8.168 0 4.511-3.599 8.168-8.04 8.168a8.05 8.05 0 0 1-.357-.008h-6.48a.5.5 0 0 1-.401-.8l1.344-1.804A8.21 8.21 0 0 1 1 9.968C1 5.457 4.6 1.8 9.04 1.8Z" fill="#91A1DF"></path><path d="M18.863 18.98a.3.3 0 0 0 .217-.507l-1.179-1.237A5.127 5.127 0 0 0 19.034 14c0-2.761-2.134-5-4.767-5C11.634 9 9.5 11.239 9.5 14s2.134 5 4.767 5c.142 0 .283-.007.422-.02h4.174Z" fill="#BBC7ED" strokeLinejoin="round"></path></g>
    </svg>
  );
}

function NotebookIconProject() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><path d="M9.5 2.517a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z" stroke="#9D553E" fill="#F6D4C6" strokeLinejoin="round"></path><path d="M7.73 6.123a.5.5 0 0 1 .43.903c-1.381.657-2.247 2.066-2.17 3.592.107 2.073 1.904 3.665 4.018 3.552a3.844 3.844 0 0 0 3.433-2.552.5.5 0 1 1 .944.33 4.844 4.844 0 0 1-4.324 3.22c-2.663.143-4.934-1.87-5.069-4.498-.1-1.936.997-3.718 2.738-4.547Z" fill="#DFA087" fillRule="nonzero"></path><path d="M9.858 9.12 13.58.972a.556.556 0 0 1 1.056.153l.518 3.66c.031.217.187.396.397.456l3.552 1.023a.556.556 0 0 1 .005 1.068l-8.587 2.552a.556.556 0 0 1-.664-.764Z" stroke="#9D553E" fill="#DE815A" strokeLinejoin="round"></path></g>
    </svg>
  );
}

function NotebookIconManual() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g transform="translate(1.25 1)" stroke="#8F6333" fill="none" fillRule="evenodd"><path d="M16.261 7.146 8.714 1.75 1.167 7.146"></path><path d="M1.5 5.75H16a1.5 1.5 0 0 1 1.5 1.5v8.817a1.5 1.5 0 0 1-1.5 1.5H1.5a1.5 1.5 0 0 1-1.5-1.5V7.25a1.5 1.5 0 0 1 1.5-1.5Z" fill="#F5DD9C" strokeLinecap="round" strokeLinejoin="round"></path><g strokeLinecap="round" strokeLinejoin="round"><path d="M4.25 10.2h9M4.25 13.7h5"></path></g><circle fill="#E39631" cx="8.75" cy="2" r="2"></circle></g>
    </svg>
  );
}

function NotebookIconThread() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g stroke="#388D68" fill="none" fillRule="evenodd"><path d="M2 1.4h11.124a1.5 1.5 0 0 1 1.5 1.5v7.046a1.5 1.5 0 0 1-1.5 1.5H3.942a2 2 0 0 0-1.24.431l-1.392 1.1a.5.5 0 0 1-.81-.392V2.9A1.5 1.5 0 0 1 2 1.4Z" strokeWidth="0.976" fill="#75CA97"></path><path d="M17.624 6.446H7.371a1.5 1.5 0 0 0-1.5 1.5v8.1a1.5 1.5 0 0 0 1.5 1.5h8.403a2 2 0 0 1 1.106.334l1.468.974a.5.5 0 0 0 .776-.416V7.946a1.5 1.5 0 0 0-1.5-1.5Z" strokeWidth="0.976" fill="#BBEBC4" strokeLinecap="round" strokeLinejoin="round"></path><g strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 10.75h4M10.5 13.75h4"></path></g></g>
    </svg>
  );
}

function NotebookIconInterest() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd" stroke="#55629D"><g strokeLinejoin="round"><path d="M2.77 6.624 10 7.948V19.3l-7.77-1.422A1.5 1.5 0 0 1 1 16.402V8.1a1.5 1.5 0 0 1 1.77-1.476Z" fill="#BBC7ED"></path><path d="M17.23 6.624 10 7.948V19.3l7.77-1.422A1.5 1.5 0 0 0 19 16.402V8.1a1.5 1.5 0 0 0-1.77-1.476Z" fill="#91A1DF"></path></g><path d="M9.992.7A2.833 2.833 0 0 0 7.15 3.524a2.833 2.833 0 0 0 2.842 2.823 2.833 2.833 0 0 0 2.842-2.823A2.833 2.833 0 0 0 9.992.7Z" fill="#91A1DF"></path></g>
    </svg>
  );
}

function NotebookIconTravel() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><ellipse fill="#EFF0F0" cx="10" cy="7.188" rx="3.048" ry="3.04"></ellipse><path d="M15.55 13.51c2.453.52 3.95 1.343 3.95 2.485 0 .933-1.1 1.697-2.877 2.22l-.44.121c-.074.02-.15.039-.228.057l-.476.107-.5.097c-.084.016-.17.03-.257.045l-.53.082-.55.072-.283.032-.577.056c-.098.009-.196.017-.295.024l-.602.04-.615.029-.63.017L10 19l-.64-.006-.63-.017-.615-.029-.602-.04a28.905 28.905 0 0 1-.295-.024l-.577-.056c-.095-.01-.189-.02-.282-.032l-.55-.072-.531-.082c-.087-.014-.173-.03-.258-.045l-.499-.097-.476-.107a14.776 14.776 0 0 1-.229-.057l-.44-.12C1.6 17.691.5 16.927.5 15.994c0-1.05 1.262-1.827 3.368-2.35l.521-.121a.5.5 0 0 1 .21.977c-1.958.423-3.099 1.056-3.099 1.494 0 .5 1.091 1.037 2.817 1.43l.445.094c.152.03.309.06.469.088l.493.081.514.074.534.064.553.055c.094.009.188.017.283.024l.578.04c.097.007.196.012.294.017l.6.024.61.012L10 18l.31-.002.61-.012.6-.024.585-.035a28.7 28.7 0 0 0 .57-.046l.553-.055.534-.064.514-.074.493-.08c.16-.029.317-.058.47-.089l.444-.095c1.726-.392 2.817-.93 2.817-1.43 0-.443-1.165-1.083-3.158-1.505a.5.5 0 0 1 .118-.989l.09.01Z" fill="#9D553E" fillRule="nonzero"></path><path d="M10 1c3.314 0 6 2.63 6 5.874 0 1.82-1.368 5.22-4.105 8.202l-.27.29a2.028 2.028 0 0 1-2.78.154l-.114-.104C5.578 12.276 4 8.762 4 6.874 4 3.63 6.686 1 10 1Z" stroke="#9D553E" fill="#DE815A" strokeLinejoin="round"></path><circle stroke="#9D553E" fill="#F1CFC2" strokeLinejoin="round" cx="10" cy="7" r="2.5"></circle></g>
    </svg>
  );
}

function NotebookIconDefault2() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g stroke="#397ABD" fill="none" fillRule="evenodd"><g fill="#679FF4"><path d="M11.895 11.476h4.737A2.368 2.368 0 0 1 19 13.845v3.24a.79.79 0 0 1-.79.79h-7.894a.79.79 0 0 1-.79-.79v-3.24a2.368 2.368 0 0 1 2.369-2.369ZM14.618 4.324a2.36 2.36 0 0 0-2.368 2.352 2.36 2.36 0 0 0 2.368 2.353 2.36 2.36 0 0 0 2.369-2.353 2.36 2.36 0 0 0-2.369-2.352Z"></path></g><g fill="#C4DCFF"><path d="M4.079 9.469h6.158c1.7 0 3.079 1.378 3.079 3.079v4.301c0 .567-.46 1.026-1.027 1.026H2.026C1.46 17.875 1 17.415 1 16.85v-4.301c0-1.7 1.378-3.08 3.079-3.08ZM6.684 1.8a2.833 2.833 0 0 0-2.842 2.824 2.833 2.833 0 0 0 2.842 2.823 2.833 2.833 0 0 0 2.842-2.823A2.833 2.833 0 0 0 6.684 1.8Z"></path></g></g>
    </svg>
  );
}

function NotebookIconReports() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><g transform="translate(1.483 3.01)"><rect fill="#F6D4C6" x="0.517" y="0.517" width="16" height="14.973" rx="2"></rect><path d="M2 0h13.023a2 2 0 0 1 2 2v2.441H0V2a2 2 0 0 1 2-2Z" fill="#DE815A"></path><path stroke="#9D553E" strokeLinecap="square" d="M.591 4.441h15.67"></path></g><path stroke="#9D553E" strokeLinecap="round" d="M5.959 1.235v1.68M13.959 1.235v1.68"></path><rect stroke="#9D553E" strokeLinecap="round" x="2" y="3.093" width="16" height="15.407" rx="1.5"></rect><path d="M7.054 10.28a.5.5 0 0 1 .763.339l.007.082v5a.5.5 0 0 1-.992.09l-.008-.09-.001-4.084-.553.355a.5.5 0 0 1-.635-.079l-.056-.071a.5.5 0 0 1 .08-.636l.07-.055 1.325-.85ZM14 10.2a.5.5 0 0 1 .492.588l-.022.082-1.794 4.99a.5.5 0 0 1-.964-.251l.023-.088 1.553-4.321h-2.717a.5.5 0 0 1-.492-.41l-.008-.09a.5.5 0 0 1 .41-.491l.09-.008H14Z" fill="#9D553E" fillRule="nonzero"></path></g>
    </svg>
  );
}

function NotebookIconImport() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><path d="M2.53 2.5h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5V4a1.5 1.5 0 0 1 1.5-1.5Z" stroke="#5B6461" strokeWidth="0.941" fill="#BBC7ED" strokeLinecap="round" strokeLinejoin="round"></path><path d="M3.03 2.5h14a2 2 0 0 1 2 2v2.667h-18V4.5a2 2 0 0 1 2-2Z" fill="#91A1DF"></path><path d="M2.53 2.5h15a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5V4a1.5 1.5 0 0 1 1.5-1.5Z" stroke="#55629D" strokeLinecap="round" strokeLinejoin="round"></path><path fill="#55629D" fillRule="nonzero" d="M19.03 6.438v1H.983v-1zM11.185 9.534a.5.5 0 0 1 .31.56l-.024.086-1.805 4.667a.5.5 0 0 1-.957-.274l.025-.086 1.804-4.667a.5.5 0 0 1 .647-.286Zm-4.56 1.38a.5.5 0 0 1-.136.626l-.076.049-1.679.876 1.68.878a.5.5 0 0 1 .246.59l-.035.084a.5.5 0 0 1-.591.247l-.083-.035-1.73-.903a.97.97 0 0 1-.1-1.66l.1-.06 1.73-.903a.5.5 0 0 1 .674.211Zm6.732 0a.5.5 0 0 1 .675-.211l1.729.902.101.062a.97.97 0 0 1-.101 1.66l-1.73.902-.083.035a.5.5 0 0 1-.591-.247l-.035-.083a.5.5 0 0 1 .247-.591l1.679-.878-1.68-.876-.075-.049a.5.5 0 0 1-.136-.626Z"></path></g>
    </svg>
  );
}

function NotebookIconDepartment() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd" stroke="#397ABD"><path d="M3.7 1h12.55a1.5 1.5 0 0 1 1.5 1.5v2.955a1.5 1.5 0 0 1-1.5 1.5l-3.89-.001-1.9 1.903a.7.7 0 0 1-.98.01L7.5 6.953H3.7a1.5 1.5 0 0 1-1.5-1.499V2.5A1.5 1.5 0 0 1 3.7 1Z" fill="#679FF4" strokeLinejoin="round"></path><g fill="#C4DCFF"><g transform="translate(9.7 9.5)"><path d="m1.32 5.776 2.087-.753a3.429 3.429 0 0 1 2.33 0l2.085.753a2 2 0 0 1 1.32 1.882V9.5a.5.5 0 0 1-.5.5H0V7.658a2 2 0 0 1 1.32-1.882Z"></path><rect x="2.857" width="3.429" height="4.681" rx="1.714"></rect></g><g transform="translate(1.2 9.5)"><path d="m1.32 5.776 2.087-.753a3.429 3.429 0 0 1 2.33 0l2.085.753a2 2 0 0 1 1.32 1.882V10H.5a.5.5 0 0 1-.5-.5V7.658a2 2 0 0 1 1.32-1.882Z"></path><rect x="2.857" width="3.429" height="4.681" rx="1.714"></rect></g></g></g>
    </svg>
  );
}

function NotebookIconProject2() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd"><path d="M4.25 1.267h11.5a1.5 1.5 0 0 1 1.5 1.5v14.5a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5v-14.5a1.5 1.5 0 0 1 1.5-1.5Z" stroke="#8F6333" fill="#F5DD9C" strokeLinecap="round" strokeLinejoin="round"></path><path d="M6 1.304h8l-.675 2.205a1.5 1.5 0 0 1-1.434 1.06H8.109a1.5 1.5 0 0 1-1.434-1.06L6 1.304Z" stroke="#8F6333" fill="#E39631"></path><path d="M6.34 10.199c.354-.38.704-.445 1.052-.195.46.33 1.12 1.215 1.98 2.654 1.836-3.306 2.856-5.092 3.06-5.36.162-.214.53-.313 1.104-.296a.29.29 0 0 1 .245.43c-1.96 3.548-3.099 5.531-3.418 5.95-.495.65-1.607.765-2.102.45-.305-.194-.973-1.113-2.004-2.757h-.001a.727.727 0 0 1 .083-.878Z" fill="#E9B15A"></path></g>
    </svg>
  );
}

function NotebookIconNotes() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g stroke="#388D68" strokeWidth="0.976" fill="none" fillRule="evenodd" strokeLinejoin="round"><path d="M2.031 2.4H8a2 2 0 0 1 2 2v13.504H8.358a.2.2 0 0 1-.125-.044l-1.147-.913a.2.2 0 0 0-.125-.043h-4.93a1.5 1.5 0 0 1-1.5-1.5V3.9a1.5 1.5 0 0 1 1.5-1.5Z" fill="#75CA97"></path><path d="M17.969 2.4H12a2 2 0 0 0-2 2v13.504h1.642a.2.2 0 0 0 .125-.044l1.147-.913a.2.2 0 0 1 .125-.043h4.93a1.5 1.5 0 0 0 1.5-1.5V3.9a1.5 1.5 0 0 0-1.5-1.5Z" fill="#BBEBC4" strokeLinecap="round"></path></g>
    </svg>
  );
}

function NotebookIconResource() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g stroke="#8F6333" fill="none" fillRule="evenodd"><path d="M4.952 3.152h10.714a1.5 1.5 0 0 1 1.5 1.5v2.435H5.75" fill="#E39631"></path><path d="M3.2 2.009h2.729a1.5 1.5 0 0 1 1.323.794l1.34 2.512a1.5 1.5 0 0 0 1.324.794h6.834a1.5 1.5 0 0 1 1.5 1.5v8.826a1.5 1.5 0 0 1-1.5 1.5H3.2a1.5 1.5 0 0 1-1.5-1.5V3.51a1.5 1.5 0 0 1 1.5-1.5Z" fill="#F5DD9C" strokeLinecap="round" strokeLinejoin="round"></path></g>
    </svg>
  );
}

/* 设计图标是唯一一个带 mask/use 的：改成 clipPath，并用 useId 让同页多实例的引用各自成立。 */
function NotebookIconDesign() {
  const uid = useId().replace(/[:]/g, "");
  const clip = "nb-design-" + uid;
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <g fill="none" fillRule="evenodd">
        <path d="m1.53 4.847 12.446-3.808a1.5 1.5 0 0 1 1.879 1.013l2.765 9.45a1.5 1.5 0 0 1-1.03 1.865L5.671 16.754l-2.398.69L.515 6.653a1.5 1.5 0 0 1 1.014-1.806Z" stroke="#9D553E" fill="#DE815A" strokeLinejoin="round" />
        <g transform="translate(3.302 5.888)">
          <clipPath id={clip}>
            <rect x="0" y="0" width="16" height="13" rx="1.5" />
          </clipPath>
          <rect x="0" y="0" width="16" height="13" rx="1.5" stroke="#9D553E" fill="#F6D4C6" strokeLinejoin="round" />
          <path d="m1.91 9.724 2.7-3.926a.8.8 0 0 1 1.243-.093l1.783 1.908a1.4 1.4 0 0 0 1.878.153l1.282-.989a.8.8 0 0 1 1.143.173l1.949 2.767a.8.8 0 0 1-.654 1.26H2.569a.8.8 0 0 1-.66-1.253Z" fill="#DFA087" clipPath={"url(#" + clip + ")"} transform="matrix(-1 0 0 1 15.824 0)" />
          <ellipse fill="#DFA087" clipPath={"url(#" + clip + ")"} cx="7.047" cy="3.728" rx="1.092" ry="1.116" />
        </g>
      </g>
    </svg>
  );
}

export const NOTEBOOK_ICONS: readonly NotebookIconDef[] = [
  { id: "book", label: "笔记本", Svg: NotebookIconDefault },
  { id: "sheet", label: "表格", Svg: NotebookIconSheet },
  { id: "blog", label: "博客", Svg: NotebookIconBlog },
  { id: "topic", label: "话题", Svg: NotebookIconTopic },
  { id: "group", label: "项目组", Svg: NotebookIconProject },
  { id: "manual", label: "手册", Svg: NotebookIconManual },
  { id: "design", label: "设计", Svg: NotebookIconDesign },
  { id: "thread", label: "讨论", Svg: NotebookIconThread },
  { id: "interest", label: "兴趣小组", Svg: NotebookIconInterest },
  { id: "travel", label: "旅行", Svg: NotebookIconTravel },
  { id: "team", label: "团队", Svg: NotebookIconDefault2 },
  { id: "report", label: "报告", Svg: NotebookIconReports },
  { id: "import", label: "导入", Svg: NotebookIconImport },
  { id: "dept", label: "部门", Svg: NotebookIconDepartment },
  { id: "project", label: "项目", Svg: NotebookIconProject2 },
  { id: "notes", label: "笔记", Svg: NotebookIconNotes },
  { id: "res", label: "资源", Svg: NotebookIconResource },
];

const BY_ID: ReadonlyMap<string, NotebookIconDef> = new Map(NOTEBOOK_ICONS.map((d) => [d.id, d]));

/** 按 id 取图形；目录里没有 ⇒ undefined（调用方画中性图形，绝不把 `n:xxx` 原串显示出来）。 */
export function notebookIconById(id: string): NotebookIconDef | undefined {
  return BY_ID.get(id);
}

export function encodeNotebookIcon(id: string): string {
  return NOTEBOOK_ICON_PREFIX + id;
}
