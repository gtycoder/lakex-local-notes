#!/usr/bin/env node
/**
 * 双仓远端配置（入库脚本）：clone 后跑一次，恢复「一次 push 推 Gitee + GitHub」的能力。
 *
 * 为什么需要它：git 的 remote 配置存在每个 clone 自己的 .git/config 里，**不入库、不随 clone 走**。
 * 从 Gitee clone 出来的仓库只有 origin，直接 push 只会到 Gitee；GitHub（发版主仓 / Actions 所在仓）
 * 需要这台机器自己配一次。
 *
 * 行为（幂等，可重复跑）：
 *   1) origin.url = Gitee；2) github 远端 = GitHub（fetch 用，拉 PR 合并结果）；
 *   3) origin 的 pushurl = Gitee + GitHub（`git push origin` 一次推两处）。
 *
 * 用法：node scripts/setup-remotes.mjs   （或 npm run setup:remotes）
 *
 * 换仓库/换账号时**改这里的两行常量即可**（地址很少变，写死比再引入环境变量清楚）。
 */
import { spawnSync } from "node:child_process";

const GITEE_URL = "git@gitee.com:gtycoder/lakex-local-notes.git";
const GITHUB_URL = "https://github.com/gtycoder/lakex-local-notes.git";

/** 本机 /usr/local/bin/git 是坏的（Bad CPU type），优先绝对路径 /usr/bin/git（AGENTS §7）。 */
const GIT_BIN = (() => {
  try {
    const probe = spawnSync("/usr/bin/git", ["--version"], { stdio: "ignore" });
    if (probe.status === 0) return "/usr/bin/git";
  } catch { /* 回落 PATH */ }
  return "git";
})();

function git(args, opts = {}) {
  const res = spawnSync(GIT_BIN, args, { encoding: "utf8", ...opts });
  if (res.status !== 0 && !opts.allowFail) {
    const detail = (res.stderr || res.stdout || "").trim();
    console.error(`[setup-remotes] git ${args.join(" ")} 失败${detail ? ": " + detail : ""}`);
    process.exit(1);
  }
  return res;
}

function hasRemote(name) {
  return git(["remote", "get-url", name], { allowFail: true }).status === 0;
}

// 1) origin = Gitee（fetch 主入口）
if (hasRemote("origin")) git(["remote", "set-url", "origin", GITEE_URL]);
else git(["remote", "add", "origin", GITEE_URL]);

// 2) github = GitHub（pull PR 合并结果用；不设 pushurl，避免和 origin 双推重复）
if (hasRemote("github")) git(["remote", "set-url", "github", GITHUB_URL]);
else git(["remote", "add", "github", GITHUB_URL]);

// 3) origin 双 push：先清干净再加，保证顺序稳定（Gitee 先、GitHub 后）
git(["config", "--unset-all", "remote.origin.pushurl"], { allowFail: true });
git(["config", "--add", "remote.origin.pushurl", GITEE_URL]);
git(["config", "--add", "remote.origin.pushurl", GITHUB_URL]);

console.log("[setup-remotes] 已配置远端：");
console.log(git(["remote", "-v"]).stdout.trim());
console.log("");
console.log("[setup-remotes] 之后：`git push origin <branch>` 同时推 Gitee + GitHub；");
console.log("              GitHub 只在推 tag 时打包发版（.github/workflows/release.yml）。");
