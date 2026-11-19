/**
 * 移动端提示文案常量（轻量共享模块；261119 双写收口）。
 *
 * 「速记内容准备失败」原先在 MobileApp 的动态 import catch 与 captureModeFlow 的取数 catch
 * 各写一份字面量（两处文案会各自漂）⇒ 收成单一来源。两处都在**动态 import 链**上：
 * 本文件必须保持纯常量、零依赖（连 toastBus 都不要 import），谁引用都只多带几十字节。
 * 已登记进 vite.mobile.config.ts 的 mobile-ui-shared 共享块（与 toastBus 同块）——
 * 否则「入口 + 懒 chunk 双引」的模块会被 rolldown 提升成独立共享块、多一条 modulepreload（超预算）。
 */

/** 速记（capture）内容准备失败：分包加载失败 / 相机取数抛错 / 照片字节读取失败。 */
export const QUICK_NOTE_PREPARE_FAILED_TEXT = "速记内容准备失败";
