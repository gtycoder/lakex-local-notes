> 来源: https://www.yuque.com/yuque/developer/wr034t6x3kk8whz5
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

:::color1
`1.48.0` 后支持

:::

在完成阅读器的创建之后，您可以使用 markdownStream 命令来实现 markdown 的流展示。如果接入了 AI 则可以通过此命令来展示 AI 的输出结果。

下面是 **demo**

```typescript
const markdown = `高等数学是大学数学的一个基础而重要的分支，它涵盖了微积分、级数、多元函数微分学、常微分方程等多个部分。以下是一些高数中常用的数学公式，这些公式在解决各种数学问题时非常关键：

### 微积分基础

1. **导数的基本公式**：
   - $ (x^n)' = nx^{n-1} $ （$ n $为常数）
   - $ (e^x)' = e^x $
   - $ (\\ln|x|)' = \\frac{1}{x} $
   - $ (\\sin{x})' = \\cos{x} $
   - $ (\\cos{x})' = -\\sin{x} $
   - $ (\\tan{x})' = \\sec^2{x} $

2. **不定积分的基本公式**：
   - $ \\int x^n dx = \\frac{x^{n+1}}{n+1} + C $ （$ n \\neq -1 $）
   - $ \\int e^x dx = e^x + C $
   - $ \\int \\frac{1}{x} dx = \\ln|x| + C $
   - $ \\int \\sin{x} dx = -\\cos{x} + C $
   - $ \\int \\cos{x} dx = \\sin{x} + C $
   - $ \\int \\sec^2{x} dx = \\tan{x} + C $

3. **定积分的计算**：
   - 基本定理：如果函数 $ f(x) $ 在区间 $[a, b]$ 上连续，则 $\\int_{a}^{b} f(x) dx = F(b) - F(a)$，其中 $F(x)$ 是 $f(x)$ 的一个原函数。

4. **微分方程**：
   - 一阶线性微分方程：$ \\frac{dy}{dx} + P(x)y = Q(x) $，其解的形式为 $ y = e^{-\\int P(x)dx} \\left[ \\int Q(x)e^{\\int P(x)dx} dx + C \\right] $

### 级数

1. **几何级数**：
   - $ \\sum_{n=0}^{\\infty} ar^n = \\frac{a}{1-r} $，当 $ |r| < 1 $

2. **调和级数**（不收敛）：
   - $ \\sum_{n=1}^{\\infty} \\frac{1}{n} $

3. **泰勒级数与麦克劳林级数**：
   - $ f(x) = f(a) + f'(a)(x-a) + \\frac{f''(a)}{2!}(x-a)^2 + \\cdots $

### 多元函数微分学

1. **偏导数**：
   - $ \\frac{\\partial}{\\partial x}f(x,y) $，$ \\frac{\\partial}{\\partial y}f(x,y) $

2. **梯度**：
   - $ \\nabla f = \\left( \\frac{\\partial f}{\\partial x}, \\frac{\\partial f}{\\partial y}, \\ldots \\right) $

3. **多元函数的链式法则**：
   - 若 $ z = f(x, y), x = g(t), y = h(t) $，则 $ \\frac{dz}{dt} = \\frac{\\partial z}{\\partial x}\\frac{dx}{dt} + \\frac{\\partial z}{\\partial y}\\frac{dy}{dt} $

这只是高数中的一部分常用公式，实际上还有更多复杂的概念和公式，如重积分、曲线积分、曲面积分、级数的敛散性判断等。掌握这些基本公式是学习高等数学的基础，通过练习和应用可以更深入地理解它们。`;

let i = 0;
const loop = () => {
  i++;
  viewer.execCommand('markdownStream', markdown.slice(0, i));
  if (i < markdown.length) {
    requestAnimationFrame(loop);
  }
};

requestAnimationFrame(loop);
```

:::warning
如果需要多次展示，也不用重新创建阅读器，只要 markdown 内容有变动，markdownStream 命令可以让阅读器跟着 markdown 更新。

:::

