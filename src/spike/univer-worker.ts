/**
 * Univer worker 线程入口（spike 专用，经 ?worker&url 打包）。
 * 注意：@univerjs/preset-sheets-core/worker 只 **导出** UniverSheetsCoreWorkerPreset 工厂，
 * 不会自举 worker 线程；必须在这里用 createUniver 真正创建，主线程的 UniverRPCMainThreadPlugin
 * 才能通过 workerURL 与它建立 RPC 通道。否则 worker 加载后什么都不做、公式永不计算。
 */
import { createUniver, LocaleType } from "@univerjs/presets";
import { UniverSheetsCoreWorkerPreset } from "@univerjs/preset-sheets-core/worker";

createUniver({
  locale: LocaleType.ZH_CN,
  locales: {},
  presets: [UniverSheetsCoreWorkerPreset()],
});
