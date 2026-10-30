// 移动端整页计算值快照门禁：生成当前快照 → 与已提交的紧凑基线比对 → 有差异 exit 1。
//
// 用法：node scripts/mobile-audit/check-mobile-snap.mjs [--port 9335] [--tag mob-after] [--states a,b] [--from <snap.json>] [--write-baseline]
// 前置（见 scripts/mobile-audit/README.md）：模拟器 + emu-cdp 转发到 9335。
//   浏览器预览**跑不起来**（移动端启动依赖 Capacitor 原生 SQLite）⇒ 必须模拟器。
// 基线只存"每态元素数 + 全态合并哈希"（几 KB，可入 git）；详细快照留在 .css-audit/。
// 去抖：首次比对有差异时自动重跑一遍，只有两轮都差异才判失败（对齐桌面版）。
// 261030：取快照/折叠/比对逻辑抽到 snap-gate.mjs（与多维表专项快照共用），本文件只留 6 态配置。
import { runSnapGate } from "./snap-gate.mjs";

await runSnapGate({
  snapScript: "mobile-snap.mjs",
  baselineName: "mobile-snap.json",
  portDefault: 9335,
  tagDefault: "mob-after",
  label: "mgate",
  passStates: true,
  // 已知不稳定态（显式点名、不静默）：目前为空 —— 6 态在两轮独立运行中 0 差异。
  unstable: [],
});
