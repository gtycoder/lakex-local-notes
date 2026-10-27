import { describe, expect, it } from "vitest";
import { mergeTagDirectory, mergeTagLinks, replaceTargetLinks, tagIdsFor, type Tag, type TagLink } from "./tags.js";

const t = (s: string) => "2026-10-25T00:00:0" + s + ".000Z";
const tag = (id: string, name: string, updatedAt: string, extra: Partial<Tag> = {}): Tag => ({ id, name, order: 0, pinned: false, createdAt: updatedAt, updatedAt, ...extra });
const link = (targetId: string, tagId: string, at: string, kind: "note" | "quickNote" = "quickNote"): TagLink => ({ targetKind: kind, targetId, tagId, position: 0, linksUpdatedAt: at });

describe("tags 目录/关联 LWW", () => {
  it("目录：远端更新改名生效、旧更新忽略、新增/墓碑", () => {
    const local = [tag("a", "灵感", t("1")), tag("b", "待办", t("1"))];
    const remote = [tag("a", "灵感库", t("2")), tag("b", "旧的待办", t("0")), tag("c", "项目", t("2")), tag("a2", "灵感库", t("0"))];
    const merged = mergeTagDirectory(local, remote);
    expect(merged.tags.find((x) => x.id === "a")!.name).toBe("灵感库");
    expect(merged.tags.find((x) => x.id === "b")!.name).toBe("待办");
    expect(merged.tags.find((x) => x.id === "c")!.name).toBe("项目");
    // a2 旧数据与 a 同名：较旧的 a2 被墓碑
    expect(merged.tags.find((x) => x.id === "a2")!.deletedAt).toBeTruthy();
    expect(merged.tombstoned.some((x) => x.loserId === "a2")).toBe(true);
  });

  it("目录：墓碑 LWW（远端墓碑较新则删；较旧则保留）", () => {
    const local = [tag("a", "灵感", t("3"))];
    const olderTomb = mergeTagDirectory(local, [tag("a", "灵感", t("2"), { deletedAt: t("2") })]);
    expect(olderTomb.tags.find((x) => x.id === "a")!.deletedAt ?? null).toBeNull();
    const newerTomb = mergeTagDirectory(local, [tag("a", "灵感", t("4"), { deletedAt: t("4") })]);
    expect(newerTomb.tags.find((x) => x.id === "a")!.deletedAt).toBe(t("4"));
  });

  it("关联：整体 LWW、墓碑 tag 过滤、顺序按 position", () => {
    const live = new Set(["a", "b", "c"]);
    const local = [link("q1", "a", t("2")), link("q1", "b", t("2"))];
    const remoteNewer = [link("q1", "c", t("3")), link("q1", "a", t("3"))];
    const links = mergeTagLinks(local, remoteNewer, { liveTagIds: live });
    expect(tagIdsFor(links, "quickNote", "q1")).toEqual(["c", "a"]);
    // 远端较旧：本地胜
    const older = mergeTagLinks(local, [link("q1", "c", t("1"))], { liveTagIds: live });
    expect(tagIdsFor(older, "quickNote", "q1")).toEqual(["a", "b"]);
    // 墓碑 tag 被剔除
    const withDead = mergeTagLinks([], [link("q2", "a", t("1")), link("q2", "dead", t("1"))], { liveTagIds: live });
    expect(tagIdsFor(withDead, "quickNote", "q2")).toEqual(["a"]);
  });

  it("replaceTargetLinks：整体替换 + 去重 + 剔除未知/墓碑 + 版本更新", () => {
    const live = new Set(["a", "b"]);
    const links = replaceTargetLinks([link("q1", "a", t("1")), link("q2", "a", t("1"))], "quickNote", "q1", ["b", "a", "b", "dead"], t("2"), live);
    expect(tagIdsFor(links, "quickNote", "q1")).toEqual(["b", "a"]);
    expect(tagIdsFor(links, "quickNote", "q2")).toEqual(["a"]);
  });
});
