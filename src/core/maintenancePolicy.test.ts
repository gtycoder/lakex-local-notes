import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_OPS,
  NONE_OPS,
  PRIORITY_OPS,
  WRITE_OPS,
  classifyOp,
  isMaintenanceOp,
  isPriorityOp,
  isWriteOp,
  lockDomainOf,
} from "./maintenancePolicy.js";

const ALL = [...WRITE_OPS, ...MAINTENANCE_OPS, ...PRIORITY_OPS, ...NONE_OPS];

describe("互斥域判据（F16 红线化）", () => {
  it("每个操作只属于一个类别（表内不重叠）", () => {
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it("计数基线：改动分类表必须是有意的（改这里 = 改架构判据）", () => {
    // 与 cssLayers 的基线同理：只允许"显式改基线"来变更，防无声漂移。
    // 261024 方案 B：+setQuickNoteTags（小记 ↔ 标签关联表整组替换，独立于保存正文）
    // 261028 +restoreFromCloud（从云端恢复：清本机 v3 同步账本；整轮网络由 syncNow 维护域跑）
    expect(WRITE_OPS.length).toBe(37);
    // 261026 +ensureSearchIndex（派生索引后台补建；按需资产补拉复用 ensureTrashNoteAssets）。
    expect(MAINTENANCE_OPS.length).toBe(4);
    // 261013：syncQuickNote（小记单条推送）；261027：+ensureNoteAssets / +ensureQuickNoteAssets（占位图点击补拉）。
    expect(PRIORITY_OPS.length).toBe(3);
    // 261020 移动端批：+createUsheet / +createBoard / +createBitable（委托型写：内部调 saveNote 由写域取锁）
    // 261022 query API 收口：旧 listTreeNodes/listNotes/listQuickNotes/listNotebookTree 已删除；
    // 新 getHomeSnapshot/getWorkspaceSnapshot/getQuickNotePage 均为只读 none。
    // 261028 +getSyncDiagnostics（只读最近 3 轮同步诊断，device_state/localStorage）。
    // 261029 Del-6：-markTombstonesPublished（移动 bridge 该记账方法随 published_at 一并删除；发布判据改 waterline）
    expect(NONE_OPS.length).toBe(42);
    expect(ALL.length).toBe(86); // 37 写 + 4 维护 + 3 高优 + 42 none
  });

  it("I1（F16）：写域与维护域必须是不同互斥域", () => {
    expect(lockDomainOf(classifyOp("saveNote"))).toBe("write");
    expect(lockDomainOf(classifyOp("syncNow"))).toBe("maintenance");
    expect(lockDomainOf(classifyOp("saveNote"))).not.toBe(lockDomainOf(classifyOp("syncNow")));
  });

  it("I1：用户当场发起的写全部落在写域，绝不落维护域", () => {
    // 这些是实测里"被同步阻塞 152s"的实际受害者。
    for (const op of ["saveNote", "saveQuickNote", "createNotebook", "renameTreeNode",
      "trashNote", "restoreTreeItem", "purgeTreeItem", "snapshotNote"]) {
      expect(lockDomainOf(classifyOp(op))).toBe("write");
    }
  });

  it("I1：单发网络操作不得串进维护域（否则「插图 / 测连通」会等满一轮同步）", () => {
    for (const op of ["testS3Connection", "uploadResource"]) {
      expect(classifyOp(op)).toBe("none");
    }
  });

  it("只读操作不取锁", () => {
    for (const op of ["getHomeSnapshot", "getWorkspaceSnapshot", "getQuickNotePage", "readNote", "searchNotes", "getS3Settings"]) {
      expect(lockDomainOf(classifyOp(op))).toBeNull();
    }
  });

  it("委托型写自身不取锁（由被委托方取锁，避免同域嵌套自锁）", () => {
    // createNote → saveNote；restoreNote → restoreTreeItem；restoreHistory → saveNote
    for (const op of ["createNote", "createUsheet", "createBoard", "createBitable", "restoreNote", "restoreHistory"]) {
      expect(classifyOp(op)).toBe("none");
    }
  });

  it("未登记操作抛错（新增方法必须登记）", () => {
    expect(() => classifyOp("saveNoteV2")).toThrow(/未登记的桥操作/);
  });

  it("类型守卫与分类一致", () => {
    expect(isWriteOp("saveNote")).toBe(true);
    expect(isWriteOp("syncNow")).toBe(false);
    expect(isMaintenanceOp("syncNow")).toBe(true);
    expect(isMaintenanceOp("saveNote")).toBe(false);
  });

  it("I3：维护域里没有「用户当场发起」的操作（轮次级才允许串行等待）", () => {
    // ensureSearchIndex（261026）也是轮次级：后台自检补齐 FTS，用户不用等它。
    expect([...MAINTENANCE_OPS].sort()).toEqual(["ensureSearchIndex", "ensureTrashNoteAssets", "gcDeepCleanup", "syncNow"]);
  });

  it("高优先域（261013）：用户当场发起的单条推送既不排在整轮同步后面，也不与彼此并发", () => {
    // 用户点单：长按小记 → 写完点「保存并同步」→ 桌面端要及时看到。若与 syncNow 同域，
    // 撞上冷启动/回前台触发的整轮同步就要排队等它跑完（弱网可到分钟级）⇒ 必须另立一域。
    expect([...PRIORITY_OPS].sort()).toEqual(["ensureNoteAssets", "ensureQuickNoteAssets", "syncQuickNote"]);
    expect(isPriorityOp("syncQuickNote")).toBe(true);
    expect(lockDomainOf(classifyOp("syncQuickNote"))).toBe("priority");
    expect(lockDomainOf(classifyOp("syncQuickNote"))).not.toBe(lockDomainOf(classifyOp("syncNow")));
    // 它仍然是"取锁"的（不是 none）：连点两下会两颗请求交叉读改写同一份无 CAS 清单。
    expect(lockDomainOf(classifyOp("syncQuickNote"))).not.toBeNull();
  });
});
