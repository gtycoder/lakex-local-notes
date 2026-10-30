// 多维表专项快照门禁（261030）：表单 / 内容·表格 / 内容·卡片 三态。
//
// 用法：node scripts/mobile-audit/check-bitable-snap.mjs [--port 9336] [--tag bitable-after] [--from <snap.json>] [--write-baseline]
// 前置：同上（模拟器 + emu-cdp 转发 9336）。夹具由快照脚本自建、跑完即删（不污染 6 态/走查的共享夹具）。
import { runSnapGate } from "./snap-gate.mjs";

await runSnapGate({
  snapScript: "mobile-bitable-snap.mjs",
  baselineName: "bitable-snap.json",
  portDefault: 9336,
  tagDefault: "bitable-after",
  label: "mbgate",
});
