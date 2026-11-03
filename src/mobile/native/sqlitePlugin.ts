/**
 * 懒加载 @capacitor-community/sqlite（P8 · 261103）。
 *
 * 为什么：这个包在本仓库只被 nativeSqliteDb / nativeSqlite 两处使用，却因为顶层 import 被
 * 打进移动端**首屏 preload 图**（实测 bridge chunk 97,164B gzip，其中含插件桥）——首屏预算只量
 * 入口 chunk 时看不出来，check-arch 的首屏资源图会把它算进去。
 *
 * 语义：首次真正打开数据库时才 import（Capacitor 的 registerPlugin 在模块求值时执行，推迟到第一次
 * DB 操作没有副作用；所有 DB 访问都经过 NativeSqliteDb / spike，二者都会先 await 本函数）。
 * 失败不缓存（下次重试），成功后复用同一个 Promise。
 */
export type CapacitorSqlitePlugin = typeof import("@capacitor-community/sqlite").CapacitorSQLite;

type PluginBox = { plugin: CapacitorSqlitePlugin };

let pluginPromise: Promise<PluginBox> | null = null;

/**
 * 返回 **{ plugin } 盒子**而不是直接返回代理对象：Capacitor 插件代理自带一个会 throws 的 `then`
 * （`CapacitorSQLite.then() is not implemented on android`）。如果 Promise 的 resolve 值就是代理，
 * ES Promise 会把它当 thenable 去调 `.then()` ⇒ 启动直接卡死（261103 设备实测「正在打开本地知识库」）。
 * 包一层普通对象即可避开 thenable 采用。
 */
export function loadCapacitorSqlite(): Promise<PluginBox> {
  pluginPromise ??= import("@capacitor-community/sqlite")
    .then((module) => ({ plugin: module.CapacitorSQLite }))
    .catch((error: unknown) => {
      pluginPromise = null;
      throw error;
    });
  return pluginPromise;
}
