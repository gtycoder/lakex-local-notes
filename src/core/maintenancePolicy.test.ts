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
    expect(WRITE_OPS.length).toBe(30);
    expect(MAINTENANCE_OPS.length).toBe(3);
    expect(PRIORITY_OPS.length).toBe(1); // 261013：syncQuickNote（小记单条推送；理由见它自己的用例）
    expect(NONE_OPS.length).toBe(39); // 261013 +getCloudState（UI 用它给「保存并同步」置灰）
    expect(ALL.length).toBe(73); // = 移动端 bridge 的操作总数（261010 删死方法 uploadObject；261013 +syncQuickNote / +getCloudState）
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
    for (const op of ["listTreeNodes", "readNote", "listNotes", "searchNotes", "getS3Settings"]) {
      expect(lockDomainOf(classifyOp(op))).toBeNull();
    }
  });

  it("委托型写自身不取锁（由被委托方取锁，避免同域嵌套自锁）", () => {
    // createNote → saveNote；restoreNote → restoreTreeItem；restoreHistory → saveNote
    for (const op of ["createNote", "restoreNote", "restoreHistory"]) {
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
    expect([...MAINTENANCE_OPS].sort()).toEqual(["ensureTrashNoteAssets", "gcDeepCleanup", "syncNow"]);
  });

  it("高优先域（261013）：用户当场发起的单条推送既不排在整轮同步后面，也不与彼此并发", () => {
    // 用户点单：长按小记 → 写完点「保存并同步」→ 桌面端要及时看到。若与 syncNow 同域，
    // 撞上冷启动/回前台触发的整轮同步就要排队等它跑完（弱网可到分钟级）⇒ 必须另立一域。
    expect(PRIORITY_OPS).toEqual(["syncQuickNote"]);
    expect(isPriorityOp("syncQuickNote")).toBe(true);
    expect(lockDomainOf(classifyOp("syncQuickNote"))).toBe("priority");
    expect(lockDomainOf(classifyOp("syncQuickNote"))).not.toBe(lockDomainOf(classifyOp("syncNow")));
    // 它仍然是"取锁"的（不是 none）：连点两下会两颗请求交叉读改写同一份无 CAS 清单。
    expect(lockDomainOf(classifyOp("syncQuickNote"))).not.toBeNull();
  });
});
