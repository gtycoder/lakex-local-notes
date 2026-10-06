/** Shared desktop rail geometry. Both sides use this value; panel widths remain independent. */
export const FIXED_RAIL_WIDTH = 38;
export const DOCK_GUTTER = 4;

/** 顶栏（= 标签条 `.tab-bar`）高度，**必须与** `src/styles/app/base.css` 的 `--topbar-height` 一致。
 *  两处同源关系由 `layoutMetrics.test.ts` 卡住 —— CSS 进不了 TS，所以用测试当胶水。
 *  主进程（`electron/main.ts`）用它把 macOS 红绿灯垂直居中到顶栏中心。 */
export const TOPBAR_HEIGHT = 34;
/** 顶栏与下方面板卡片之间的拼接缝（`.workspace`/`.sidebar` 的 margin-top 里那 4px）。
 *  顶栏透明且与缝同色 ⇒ 二者肉眼是一整块「可见头区」；头区内容（标签/红绿灯）在
 *  `TOPBAR_HEIGHT + TOPBAR_SEAM` 里居中（标签的 2px 下移在 styles/app/tabs.css 同步）。 */
export const TOPBAR_SEAM = 4;
/** macOS 红绿灯按钮直径（12pt）。红绿灯中心 = `trafficLightPosition.y` + 直径/2。 */
export const TRAFFIC_LIGHT_DIAMETER = 12;
