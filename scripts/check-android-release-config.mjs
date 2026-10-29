#!/usr/bin/env node
/**
 * SEC-03 静态门禁：Android 发布产物必须是 release 变体（debuggable=false），且失败即失败。
 *
 * 为什么是静态的：本机不能跑 gradle（耗时且非必要），而「CI 用哪个 gradle 任务 / 有没有容错 /
 * 有没有 aapt 断言 / release 签名配置 / 有没有明文密钥」全是纯文本事实。本脚本只读文件，不构建、
 * 不联网、不写盘。实际 APK 的 debuggable 断言在 .github/workflows/release.yml 的
 * "Assert APK is not debuggable" 步骤里用 aapt dump badging 完成；本脚本传 --apk 可在本地对
 * 已有 release APK 做同一断言（debug APK 预期 debuggable=true，不能当 release 验收）。
 *
 * 用法：
 *   node scripts/check-android-release-config.mjs
 *   node scripts/check-android-release-config.mjs --apk android/app/build/outputs/apk/release/app-release.apk
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW = path.join(ROOT, ".github/workflows/release.yml");
const GRADLE = path.join(ROOT, "android/app/build.gradle");

const passed = [];
const failed = [];
const notes = [];
const ok = (msg) => passed.push(msg);
const fail = (msg) => failed.push(msg);
const note = (msg) => notes.push(msg);

/** 去掉 YAML 行注释与行尾注释（只用于断言，不用于执行；避免「注释里提到」被当成事实）。 */
function stripYamlComments(text) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith("#") ? "" : line.replace(/\s+#.*$/, "")))
    .join("\n");
}

/** 按 jobs: 下的两空格缩进切出每个 job 的行。 */
function parseJobs(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (start < 0) return new Map();
  const jobs = new Map();
  let current = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // 顶层下一个 key
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      jobs.set(current, []);
    } else if (current) {
      jobs.get(current).push(line);
    }
  }
  return jobs;
}

/** 按 "      - name:/uses:" 六空格缩进切 steps。 */
function splitSteps(jobLines) {
  const steps = [];
  let current = null;
  for (const line of jobLines) {
    if (/^ {6}- (?:name|uses):/.test(line)) {
      current = [line];
      steps.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return steps;
}

/** 在文本里找 header 对应的 {...} 块内容（简单花括号配对，够用于 build.gradle）。 */
function findBlock(text, headerRe) {
  const m = headerRe.exec(text);
  if (!m) return null;
  const open = text.indexOf("{", m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** 明文凭据扫描（只看 release.yml；命中即失败）。 */
const SECRET_PATTERNS = [
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "私钥块", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", re: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b/ },
  { name: "OpenAI/API key 字面量", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "Bearer 字面量", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/ },
  {
    name: "secret/password/token 字面量",
    re: /\b(?:secret|password|passwd|token|access[_-]?key|secret[_-]?key|api[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9+/_=-]{16,})["']?/i,
  },
];

function checkWorkflow() {
  const raw = readFileSync(WORKFLOW, "utf8");
  const text = stripYamlComments(raw);
  const jobs = parseJobs(text);

  const android = jobs.get("android");
  if (!android) {
    fail("workflow 缺少 android job");
  } else {
    const androidText = android.join("\n");
    if (/\.\/gradlew\s+assembleRelease\b/.test(androidText)) ok("android job 用 ./gradlew assembleRelease 出包");
    else fail("android job 未运行 ./gradlew assembleRelease（仍是 debug 包）");

    if (/(?:^|\s)assembleDebug(?:\s|$)/.test(androidText)) fail("android job 仍在跑 assembleDebug");
    else ok("android job 不再跑 assembleDebug");

    if (/continue-on-error/.test(androidText)) fail("android job 含 continue-on-error（构建失败会被吞掉）");
    else ok("android job 无 continue-on-error（失败即失败）");

    const steps = splitSteps(android);
    const stepText = (s) => (s ? s.join("\n") : "");
    const assembleIdx = steps.findIndex((s) => /\.\/gradlew\s+assembleRelease\b/.test(stepText(s)));
    const assertIdx = steps.findIndex(
      (s) => /dump\s+badging/i.test(stepText(s)) && /application-debuggable/.test(stepText(s)),
    );
    if (assembleIdx < 0 || assertIdx < 0) {
      fail("workflow 缺 aapt dump badging 的 application-debuggable 断言（或未与 assembleRelease 同 job）");
    } else if (assertIdx < assembleIdx) {
      fail("aapt debuggable 断言在 assembleRelease 之前，跑不到实际产物");
    } else {
      ok("aapt dump badging 断言位于 assembleRelease 之后");
      const qa = stepText(steps[assertIdx]);
      if (/exit\s+1/.test(qa)) ok("aapt 断言命中 application-debuggable 时 exit 1（不会静默通过）");
      else fail("aapt 断言步骤没有失败退出");
      if (/continue-on-error/.test(qa) || /^\s{8}if:/m.test(qa)) fail("aapt 断言步骤被 continue-on-error/if 绕过");
      else ok("aapt 断言步骤未被 if/continue-on-error 绕过");
    }
  }

  const release = jobs.get("release");
  if (!release) {
    fail("workflow 缺少 release job");
  } else {
    const releaseText = release.join("\n");
    const needsLine = releaseText.split("\n").find((line) => /^ {4}needs:/.test(line)) ?? "";
    if (!/android/.test(needsLine) || !/macos/.test(needsLine)) {
      fail("release job 的 needs 未同时包含 macos 与 android");
    } else {
      ok("release job 依赖 macos + android");
    }
    // 261029 用户裁决「放宽」：Android 失败只阻断自己的产物，不阻断 macOS/Windows 发版。
    // 仍要求：release 以 macOS 成功为前提 + 不被 android 结果门控（且无 android 时 artifact 自然缺失）。
    const ifLine = releaseText.split("\n").find((line) => /^ {4}if:/.test(line)) ?? "";
    if (!/needs\.macos\.result\s*==\s*'success'/.test(ifLine)) {
      fail("release job 未把 macOS 成功作为发版前提");
    } else if (/needs\.android\.result/.test(ifLine)) {
      fail("release job 仍被 android 结果门控（与 261029「放宽」裁决相反：Android 失败不应阻断发版）");
    } else {
      ok("release job 只以 macOS 成功为前提（Android 失败不阻断发版——放宽口径）");
    }
    if (/GITEE_TOKEN/.test(raw)) {
      if (/GITEE_TOKEN:\s*\$\{\{\s*secrets\.GITEE_TOKEN\s*\}\}/.test(raw)) {
        ok("GITEE_TOKEN 只来自 GitHub secrets");
      } else {
        fail("GITEE_TOKEN 未从 secrets 注入");
      }
    }
  }

  const lines = raw.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(lines[i])) hits.push({ line: i + 1, name: pattern.name, text: lines[i].trim() });
    }
  }
  if (hits.length) {
    for (const hit of hits) fail(`workflow 第 ${hit.line} 行疑似明文凭据（${hit.name}）：${hit.text}`);
  } else {
    ok("workflow 无明文凭据（token/私钥/AK 字面量）");
  }
}

function checkGradle() {
  const raw = readFileSync(GRADLE, "utf8").split(/\r?\n/);
  const gradle = raw.map((line) => (line.trimStart().startsWith("//") ? "" : line)).join("\n");
  const buildTypes = findBlock(gradle, /\bbuildTypes\s*\{/);
  if (!buildTypes) {
    fail("android/app/build.gradle 缺少 buildTypes 块");
    return;
  }
  const release = findBlock(buildTypes, /\brelease\s*\{/);
  if (!release) {
    fail("buildTypes 缺少 release 变体");
    return;
  }
  const signing = /signingConfig\s*(?:=\s*)?(signingConfigs\.(?:debug|release|getByName\(\s*["'](?:debug|release)["']\s*\)))/.exec(release);
  if (!signing) {
    fail("release 变体没有 signingConfig（无签名只能回退 debug 包）");
  } else if (signing[1].includes("debug")) {
    ok("release 变体用 debug keystore 签（SEC-03 保守方案：debuggable=false 立即生效）");
  } else {
    ok("release 变体配了 release signingConfig");
  }
  if (/debuggable\s*(?:=|\s)\s*true/.test(release)) fail("release 变体显式开启 debuggable");
  else ok("release 变体未显式开启 debuggable（AGP 默认 false）");
}

function findAapt() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    "/opt/homebrew/share/android-commandlinetools",
    path.join(os.homedir(), "Library/Android/sdk"),
    "/usr/local/lib/android/sdk",
  ].filter(Boolean);
  for (const sdk of roots) {
    const buildTools = path.join(sdk, "build-tools");
    if (!existsSync(buildTools)) continue;
    const versions = readdirSync(buildTools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
    for (const version of versions) {
      const candidate = path.join(buildTools, version, "aapt");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function checkApk(apkPath) {
  if (!existsSync(apkPath)) {
    fail(`--apk 文件不存在：${apkPath}`);
    return;
  }
  const aapt = findAapt();
  if (!aapt) {
    fail("找不到 aapt（设置 ANDROID_HOME/ANDROID_SDK_ROOT）");
    return;
  }
  const badging = execFileSync(aapt, ["dump", "badging", apkPath], { encoding: "utf8" });
  if (badging.includes("application-debuggable")) {
    fail(`APK 仍是 debuggable（application-debuggable）：${apkPath}`);
  } else {
    ok(`APK 非 debuggable：${path.relative(ROOT, apkPath)}`);
  }
}

checkWorkflow();
checkGradle();

const apkIdx = process.argv.indexOf("--apk");
if (apkIdx >= 0) checkApk(path.resolve(process.argv[apkIdx + 1] ?? ""));
else note("未传 --apk：跳过实际 APK 的 aapt 断言（CI 的 release.yml 会在 assembleRelease 后实测）");

for (const line of passed) console.log(`[ok] ${line}`);
for (const line of notes) console.log(`[skip] ${line}`);
for (const line of failed) console.log(`[fail] ${line}`);
if (failed.length) {
  console.error(`\nSEC-03 静态断言失败：${failed.length} 项`);
  process.exit(1);
}
console.log(`\nSEC-03 静态断言通过：${passed.length} 项`);
