/**
 * `src/mobile` 目录结构护栏（B3/C3-1，261016）。
 *
 * ## 背景
 * `src/mobile` 根目录曾平铺 **52 个源码文件**（仓储 9 / 原生桥 5 / 持久化 4 / hooks 7 / 杂项），
 * 新人无法从目录判断"该放哪"。261016 按职责分成四个桶（纯搬迁，零行为改动）：
 *   · `data/`   仓储 + 持久化 + 搜索索引 + 端口实现
 *   · `native/` 原生/平台适配（Capacitor 插件、密钥、资产、HTTP、S3、系统栏、快捷键、契约、预热）
 *   · `hooks/`  React hooks + `viewportShell` + `gestureCore`
 *   · `sync/`   同步状态与互斥
 *
 * ## 本护栏守什么
 * ① 根目录只留**应用外壳/入口**（`main.tsx` / `MobileApp.tsx` / `bridge.ts` / `testSetup.ts` / `wasm-url.d.ts`）
 *   与**横切护栏测试**；新增根级源码文件必须放进对应桶或登记进白名单（否则会长回平铺）。
 * ② 四个桶必须存在且非空（防止有人把桶清空后忘了它已经没用了）。
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MOBILE = path.dirname(fileURLToPath(import.meta.url));

/** 允许留在 src/mobile 根级的源码（应用外壳/入口 + vitest setup + 环境声明）。 */
const ROOT_ALLOWED = new Set(["main.tsx", "MobileApp.tsx", "bridge.ts", "testSetup.ts", "wasm-url.d.ts"]);
/** 按职责分的四个桶。 */
const BUCKETS = ["data", "native", "hooks", "sync"];

describe("src/mobile 目录结构（B3/C3-1）", () => {
  it("根目录只留应用外壳/入口；其余源码必须进 data|native|hooks|sync", () => {
    const offenders = readdirSync(MOBILE)
      .filter((name) => /\.(ts|tsx|d\.ts)$/.test(name))
      .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
      .filter((name) => !ROOT_ALLOWED.has(name));
    expect(
      offenders,
      "以下源码文件平铺在 src/mobile 根目录（请按职责放进 data/ native/ hooks/ sync/，或登记进 ROOT_ALLOWED）：\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("四个职责桶都存在且非空", () => {
    const bad: string[] = [];
    for (const bucket of BUCKETS) {
      const dir = path.join(MOBILE, bucket);
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) { bad.push(bucket + "/ 不存在"); continue; }
      const n = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f)).length;
      if (n === 0) bad.push(bucket + "/ 里没有源文件");
    }
    expect(bad, "目录分桶缺失或为空：\n  " + bad.join("\n  ")).toEqual([]);
  });
});
