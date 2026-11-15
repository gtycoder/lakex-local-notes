/**
 * ES2023 / ES2024 运行时补齐（261115，A21 收口）。
 *
 * 为什么需要：`tsconfig` 的 lib 已提到 ES2024，源码用 `toSorted` / `toReversed` /
 * `Promise.withResolvers`（只读副本、不就地改数组）。桌面 Chromium 152 原生支持；
 * Android `minSdk 24` 允许老 WebView（< Chrome 110/119）⇒ 入口处按需补齐，幂等。
 *
 * 只补**我们真的用到**的三个，不引入 polyfill 依赖、不碰别的方法。
 */
type Comparator = ((a: never, b: never) => number) | undefined;

interface FallbackTarget {
  Array?: { prototype: Record<string, unknown> };
  Promise?: Record<string, unknown>;
}

function installArrayMethod(target: FallbackTarget, name: "toSorted" | "toReversed", impl: (this: unknown[]) => unknown[]): void {
  const proto = target.Array?.prototype;
  if (!proto || typeof proto[name] === "function") return;
  Object.defineProperty(proto, name, { configurable: true, writable: true, value: impl });
}

/** 幂等安装；返回是否真的打过补丁（测试用）。 */
export function installEs2024Fallbacks(target: FallbackTarget = globalThis as unknown as FallbackTarget): boolean {
  let patched = false;
  const arrProto = target.Array?.prototype;
  if (arrProto && typeof arrProto["toSorted"] !== "function") patched = true;
  installArrayMethod(target, "toSorted", function (this: unknown[], compare?: Comparator) {
    return Array.prototype.slice.call(this).sort(compare as never);
  });
  installArrayMethod(target, "toReversed", function (this: unknown[]) {
    return Array.prototype.slice.call(this).reverse();
  });
  const promise = target.Promise;
  if (promise && typeof promise["withResolvers"] !== "function") {
    patched = true;
    Object.defineProperty(promise, "withResolvers", {
      configurable: true,
      writable: true,
      value: function withResolvers<T>() {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      },
    });
  }
  return patched;
}
