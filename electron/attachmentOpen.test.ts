import { describe, expect, it } from "vitest";
import { ATTACHMENT_OPEN_TEMP_DIR } from "../src/core/attachmentOpen.js";
import { prepareAttachmentOpen, type AttachmentOpenFs } from "./attachmentOpen.js";

const recorder = (linkFails = false) => {
  const calls: string[] = [];
  const fs: AttachmentOpenFs = {
    removeDir: (p) => { calls.push("rm:" + p); },
    makeDir: (p) => { calls.push("mkdir:" + p); },
    link: (from, to) => { calls.push("link:" + from + "->" + to); if (linkFails) throw new Error("EXDEV"); },
    copy: (from, to) => { calls.push("copy:" + from + "->" + to); },
  };
  return { calls, fs };
};

describe("用系统应用打开附件（261020：压缩包先挪到临时目录）", () => {
  it("普通附件原地打开，不碰临时目录", async () => {
    const { calls, fs } = recorder();
    const plan = await prepareAttachmentOpen({ noteId: "n1", filename: "合同.pdf", fullPath: "/data/note-assets/n1/合同.pdf" }, "/tmp", fs);
    expect(plan).toEqual({ openPath: "/data/note-assets/n1/合同.pdf", mode: "direct" });
    expect(calls).toEqual([]);
  });

  it("压缩包：清掉上次的解压产物 → 硬链接到临时目录 → 打开临时副本（note-assets 不再堆目录）", async () => {
    const { calls, fs } = recorder();
    const plan = await prepareAttachmentOpen({ noteId: "n1", filename: "icon_set.zip", fullPath: "/data/note-assets/n1/icon_set.zip" }, "/tmp", fs);
    const dir = "/tmp/" + ATTACHMENT_OPEN_TEMP_DIR + "/n1";
    expect(plan).toEqual({ openPath: dir + "/icon_set.zip", mode: "temp-copy" });
    expect(calls).toEqual(["rm:" + dir, "mkdir:" + dir, "link:/data/note-assets/n1/icon_set.zip->" + dir + "/icon_set.zip"]);
  });

  it("跨卷（硬链接抛错）回落复制（复制走异步，避免主进程卡死）", async () => {
    const { calls, fs } = recorder(true);
    const plan = await prepareAttachmentOpen({ noteId: "n1", filename: "a.7z", fullPath: "/ext/a.7z" }, "/tmp", fs);
    const dir = "/tmp/" + ATTACHMENT_OPEN_TEMP_DIR + "/n1";
    expect(plan.mode).toBe("temp-copy");
    expect(calls).toEqual(["rm:" + dir, "mkdir:" + dir, "link:/ext/a.7z->" + dir + "/a.7z", "copy:/ext/a.7z->" + dir + "/a.7z"]);
  });

  it("每篇笔记各用一个临时子目录（不同笔记互不干扰）", async () => {
    const a = await prepareAttachmentOpen({ noteId: "n1", filename: "x.zip", fullPath: "/d/n1/x.zip" }, "/tmp", recorder().fs);
    const b = await prepareAttachmentOpen({ noteId: "n2", filename: "x.zip", fullPath: "/d/n2/x.zip" }, "/tmp", recorder().fs);
    expect(a.openPath).not.toBe(b.openPath);
  });
});
