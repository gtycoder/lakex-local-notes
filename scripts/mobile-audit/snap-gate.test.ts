import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
let directory: string; let runner: string; let snapshot: string; let baseline: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "lake-snap-scope-")); runner = join(directory, "runner.mjs"); snapshot = join(directory, "current.json"); baseline = join(directory, "baseline.json");
  const module = pathToFileURL(resolve("scripts/mobile-audit/snap-gate.mjs")).href;
  const name = relative(resolve("scripts/mobile-audit/baseline"), baseline);
  writeFileSync(runner, `import {runSnapGate} from ${JSON.stringify(module)}; await runSnapGate({snapScript:'mobile-snap.mjs',baselineName:${JSON.stringify(name)},portDefault:0,tagDefault:'test',label:'test',passStates:true});`);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const save = (changed = false, only = false) => writeFileSync(snapshot, JSON.stringify({ states: {
  a: { n: 1, rows: [["a", changed ? "changed" : "same"]] }, ...(!only ? { b: { n: 1, rows: [["b", "same"]] } } : {}),
} }));
const run = (...args: string[]) => spawnSync(process.execPath, [runner, "--from", snapshot, ...args], { encoding: "utf8" });
it("定点比较不误报未采集态；全量仍拒绝缺失态，未知请求态明确失败", () => {
  save(); expect(run("--write-baseline").status).toBe(0); save(false, true);
  expect(run("--states", "a").status).toBe(0); expect(run().status).toBe(1); expect(run("--states", "missing").status).toBe(2);
  save(true, true); expect(run("--states", "a").status).toBe(1);
});
it("局部重烤只更新指定态，不删除其他基线", () => {
  save(); expect(run("--write-baseline").status).toBe(0); const previous = JSON.parse(readFileSync(baseline, "utf8"));
  save(true, true); expect(run("--states", "a", "--write-baseline").status).toBe(0); const next = JSON.parse(readFileSync(baseline, "utf8"));
  expect(next.states.b).toEqual(previous.states.b); expect(next.states.a.hash).not.toBe(previous.states.a.hash); expect(run("--states", "a").status).toBe(0);
});
