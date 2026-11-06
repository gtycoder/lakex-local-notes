> 来源: https://www.yuque.com/yuque/developer/nsq0b5sgow9z384p
> 抓取: 2026-09-16 · 语雀开发者文档（本地参考副本，勿再分发）

---

## autoSpacing
当配置成 true 的时候，输入过程中，中英文之间会自动追加空格。

```typescript
createOpenEditor(document.querySelector('#root'), {
  input: {
    autoSpacing: true,
  },
});
```

## autoClosing<font style="background:#F8CED3;color:#70000D">1.34.0</font>
当配置成 true 的时候，非闭合选区输入特定成对符号，会自动补全。

```typescript
createOpenEditor(document.querySelector('#root'), {
  input: {
    autoClosing: true,
  },
});
```

成对符号

```typescript
export const CLOSING_PAIR: Record<string, string> = {
  "'": "'",
  '"': '"',
  '(': ')',
  '[': ']',
  '{': '}',
  '【': '】',
  '‘': '’',
  '“': '”',
  '《': '》',
  '〈': '〉',
  '「': '」',
  '『': '』',
};
```

