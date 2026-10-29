import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readVersionsFromPackageJson, resolveDataFolder } from "./registerSystemInfo.js";
import { IpcInputError } from "../ipcLimits.js";

const UD = "/Users/x/Library/Application Support/lakex-local-notes-dev";
const WS = path.join(UD, "workspace-default");

describe("关于页 IPC 白名单与版本读取", () => {
  it("kind 白名单：只接受枚举目录，logs 定位到文件本身", () => {
    expect(resolveDataFolder(UD, WS, "data")).toEqual({ dir: UD, revealTarget: UD });
    expect(resolveDataFolder(UD, WS, "workspace").dir).toBe(WS);
    expect(resolveDataFolder(UD, WS, "assets").dir).toBe(path.join(WS, "note-assets"));
    expect(resolveDataFolder(UD, WS, "history").dir).toBe(path.join(WS, "history"));
    expect(resolveDataFolder(UD, WS, "quickNotes").dir).toBe(path.join(WS, "quick-notes"));
    expect(resolveDataFolder(UD, WS, "logs").revealTarget).toBe(path.join(UD, "logs", "lakex-local-notes.log"));
  });

  it("未知 kind 一律拒绝（渲染层不得传任意路径）", () => {
    for (const bad of ["", "../../etc", "workspace/../logs", "secrets"]) {
      expect(() => resolveDataFolder(UD, WS, bad)).toThrowError(IpcInputError);
    }
  });

  it("readVersionsFromPackageJson：取 pin 的内核与关键依赖，缺文件时降级不抛", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-sysinfo-"));
    const file = path.join(dir, "package.json");
    fs.writeFileSync(file, JSON.stringify({
      name: "lakex-local-notes", version: "0.1.0", description: "本地优先",
      dependencies: { "@dlient/lakex-doc-react": "0.1.3", "better-sqlite3": "^13.0.0" },
      devDependencies: { electron: "43.4.0", typescript: "^5.9.0" },
    }));
    const r = readVersionsFromPackageJson(file);
    expect(r.app).toEqual({ name: "lakex-local-notes", version: "0.1.0", description: "本地优先" });
    expect(r.deps["@dlient/lakex-doc-react"]).toBe("0.1.3");
    expect(r.deps.electron).toBe("43.4.0");
    expect(r.deps["not-listed"]).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(readVersionsFromPackageJson(path.join(dir, "missing.json")).deps).toEqual({});
  });
});
