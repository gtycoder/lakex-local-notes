import { describe, expect, it } from "vitest";
import {
  LOCKED_TEXT_CARD_NAME,
  LOCKED_TEXT_KDF_ITERATIONS,
  LOCKED_TEXT_MAX_CHARS,
  LOCKED_TEXT_MIN_PASSWORD_CHARS,
  LOCKED_TEXT_PLACEHOLDER,
  LockedTextError,
  createLockedTextSession,
  decryptLockedText,
  encryptLockedText,
  isLockedTextCipher,
  isValidLockedTextPassword,
  lockedTextExportHtml,
  lockedTextExportText,
  lockedTextKind,
  openLockedTextSession,
  openLockedTextWithSession,
  sealLockedText,
} from "./lockedText.js";

const PASSWORD = "correct horse battery staple";
const SECRET = "这里是正文：银行密码 123456，以及一段不该出现在磁盘上的内容。";

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(LockedTextError);
  await promise.catch((err: LockedTextError) => expect(err.code).toBe(code));
}

describe("加密文本：落盘值", () => {
  it("加密→解密逐字一致（中文 / emoji / 换行）", async () => {
    const plain = "第一行\n第二行 🎉\n\t缩进\n";
    const value = await encryptLockedText(plain, PASSWORD);
    await expect(decryptLockedText(value, PASSWORD)).resolves.toBe(plain);
  });

  it("落盘值里没有任何明文片段，且字段只有约定这几个", async () => {
    const value = await encryptLockedText(SECRET, PASSWORD);
    const json = JSON.stringify(value);
    expect(json).not.toContain("银行密码");
    expect(json).not.toContain("123456");
    expect(json).not.toContain(SECRET.slice(0, 6));
    expect(Object.keys(value).sort()).toEqual(["alg", "ct", "iter", "iv", "kdf", "salt", "v"]);
    expect(isLockedTextCipher(JSON.parse(json))).toBe(true);
  });

  it("每次加密的 salt / iv / ct 都不同（同一明文同一密码）", async () => {
    const a = await encryptLockedText("same", PASSWORD, { iterations: 10_000 });
    const b = await encryptLockedText("same", PASSWORD, { iterations: 10_000 });
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("密码错与密文被篡改都只报 bad-password（不泄漏「密文有效」这一信息）", async () => {
    const value = await encryptLockedText(SECRET, PASSWORD, { iterations: 10_000 });
    await expectCode(decryptLockedText(value, "wrong password"), "bad-password");
    const tampered = { ...value, ct: value.ct.slice(0, -4) + "AAAA".slice(0, 4) };
    await expectCode(decryptLockedText(tampered, PASSWORD), "bad-password");
  });

  it("迭代数随值存：用 10k 生成的值，即使默认常量改了也能解", async () => {
    const value = await encryptLockedText("legacy-proof", PASSWORD, { iterations: 10_000 });
    expect(value.iter).toBe(10_000);
    expect(value.iter).not.toBe(LOCKED_TEXT_KDF_ITERATIONS);
    await expect(decryptLockedText(value, PASSWORD)).resolves.toBe("legacy-proof");
  });

  it("空密码 / 超长正文 / 越界迭代数 ⇒ invalid-input", async () => {
    await expectCode(encryptLockedText("x", ""), "invalid-input");
    await expectCode(encryptLockedText("x".repeat(LOCKED_TEXT_MAX_CHARS + 1), PASSWORD), "invalid-input");
    await expectCode(encryptLockedText("x", PASSWORD, { iterations: 1 }), "invalid-input");
  });

  it("密码按 NFC 归一：macOS(NFD) 写入、Android(NFC) 读出仍能解（多端同一密码）", async () => {
    const nfd = "cafe\u0301";          // e + 组合重音
    const nfc = nfd.normalize("NFC");    // é
    expect(nfc).not.toBe(nfd);
    const value = await encryptLockedText("跨端密码", nfd, { iterations: 10_000 });
    await expect(decryptLockedText(value, nfc)).resolves.toBe("跨端密码");
  });
});

describe("加密文本：会话密钥（解锁后免重跑 KDF）", () => {
  it("同一会话多次加密 salt 不变、iv 每次不同；都能用密码解开", async () => {
    const session = await createLockedTextSession(PASSWORD, { iterations: 10_000 });
    const a = await sealLockedText(session, "第一段");
    const b = await sealLockedText(session, "第二段");
    expect(a.salt).toBe(session.salt);
    expect(b.salt).toBe(session.salt);
    expect(a.iv).not.toBe(b.iv);
    await expect(decryptLockedText(a, PASSWORD)).resolves.toBe("第一段");
    await expect(decryptLockedText(b, PASSWORD)).resolves.toBe("第二段");
  });

  it("openLockedTextSession 解出明文并带回 key/salt/iter", async () => {
    const session = await createLockedTextSession(PASSWORD, { iterations: 10_000 });
    const value = await sealLockedText(session, "会话");
    const opened = await openLockedTextSession(value, PASSWORD);
    expect(opened.plain).toBe("会话");
    expect(opened.salt).toBe(session.salt);
    await expect(sealLockedText(opened, "再写一段").then((v) => decryptLockedText(v, PASSWORD))).resolves.toBe("再写一段");
  });

  it("外部写进来的值：同 salt 能用会话 key 解；换了 salt（别处改过密码）报 bad-password", async () => {
    const session = await createLockedTextSession(PASSWORD, { iterations: 10_000 });
    const sameSaltValue = await sealLockedText(session, "外部改动");
    await expect(openLockedTextWithSession(session, sameSaltValue)).resolves.toBe("外部改动");
    const other = await createLockedTextSession("another-password", { iterations: 10_000 });
    const otherValue = await sealLockedText(other, "别处的密文");
    await expectCode(openLockedTextWithSession(session, otherValue), "bad-password");
  });
});

describe("加密文本：结构校验与状态判定", () => {
  it("isLockedTextCipher 拒绝畸形值（越界/缺字段/长度不对/超大/类型不对）", async () => {
    const ok = await encryptLockedText("x", PASSWORD, { iterations: 10_000 });
    expect(isLockedTextCipher(ok)).toBe(true);
    expect(isLockedTextCipher({ ...ok, v: 2 })).toBe(false);
    expect(isLockedTextCipher({ ...ok, alg: "AES-CBC" })).toBe(false);
    expect(isLockedTextCipher({ ...ok, iter: 1 })).toBe(false);
    expect(isLockedTextCipher({ ...ok, iter: 9_999_999 })).toBe(false);
    expect(isLockedTextCipher({ ...ok, salt: "AAAA" })).toBe(false);
    expect(isLockedTextCipher({ ...ok, iv: ok.iv.slice(2) })).toBe(false);
    expect(isLockedTextCipher({ ...ok, ct: "" })).toBe(false);
    // 脏值上界：不能靠超长 ct 让 atob 吃任意大字符串
    expect(isLockedTextCipher({ ...ok, ct: "A".repeat(400_000) })).toBe(false);
    expect(isLockedTextCipher(null)).toBe(false);
    expect(isLockedTextCipher("nope")).toBe(false);
  });

  it("状态判定：空值 / 本应用密文 / 未知格式（含语雀字段的防御值）", async () => {
    expect(lockedTextKind(null)).toBe("empty");
    expect(lockedTextKind(undefined)).toBe("empty");
    expect(lockedTextKind({ originData: "", cryptoData: "" })).toBe("empty");
    expect(lockedTextKind(await encryptLockedText("x", PASSWORD, { iterations: 10_000 }))).toBe("cipher");
    // 新插入的自定义卡在"还没设密码"时，值里只有内核补的 $name / $htmlStr / id（实测形态）
    expect(lockedTextKind({ $name: "lake-locked-text" })).toBe("empty");
    expect(lockedTextKind({ $name: "lake-locked-text", $htmlStr: "<span>［加密文本］</span>", id: "aVq7R" })).toBe("empty");
    // 防御：带明文/密文的陌生值 ⇒ 不可识别（绝不覆盖）
    expect(lockedTextKind({ originData: "明文", cryptoData: "" })).toBe("unknown");
    expect(lockedTextKind({ cryptoData: "U2FsdGVkX1+..." })).toBe("unknown");
    expect(lockedTextKind({ ct: "not-base64!" })).toBe("unknown");
  });

  it("密码下限判据单一来源", () => {
    expect(LOCKED_TEXT_MIN_PASSWORD_CHARS).toBe(6);
    expect(isValidLockedTextPassword("12345")).toBe(false);
    expect(isValidLockedTextPassword("123456")).toBe(true);
    expect(isValidLockedTextPassword("中文密码够长")).toBe(true);
  });
});

describe("加密文本：导出与复制永不泄漏明文", () => {
  it("writeText / writeHtml 只给占位", () => {
    expect(lockedTextExportText()).toBe(LOCKED_TEXT_PLACEHOLDER);
    expect(lockedTextExportHtml()).toContain(LOCKED_TEXT_PLACEHOLDER);
    expect(lockedTextExportHtml()).not.toContain("银行密码");
  });

  it("卡片名是持久化契约，不许改", () => {
    expect(LOCKED_TEXT_CARD_NAME).toBe("lake-locked-text");
  });
});
