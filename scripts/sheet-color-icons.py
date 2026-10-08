import json, re
cloud = json.load(open("scripts/sheet-icons.cloud.json", encoding="utf8"))["icons"]

def camel(k):
    return re.sub(r"-([a-z])", lambda m: m.group(1).upper(), k)

def attrs_to_jsx(attrs):
    return [("fillRule=" if k == "fill-rule" else camel(k) + "=") + json.dumps(v) for k, v in attrs.items() if k not in ("fill", "stroke")]

def emit(node, indent, bar_idx, counter, color_expr, out):
    pad = "  " * indent
    tag, attrs = node[0], node[1]
    kids = node[2] if len(node) > 2 else None
    parts = attrs_to_jsx(attrs)
    is_bar = tag == "path" and counter[0] == bar_idx
    if tag == "path":
        counter[0] += 1
        if is_bar:
            parts.append("fill={" + color_expr + " ?? " + json.dumps("none") + "}")
            parts.append("stroke={" + color_expr + " ?? " + json.dumps("none") + "}")
        else:
            parts.append("fill=" + json.dumps(attrs.get("fill", "currentColor")))
    a = " ".join(parts)
    if kids:
        out.append(pad + "<" + tag + (" " + a if a else "") + ">")
        for kid in kids:
            emit(kid, indent + 1, bar_idx, counter, color_expr, out)
        out.append(pad + "</" + tag + ">")
    else:
        out.append(pad + "<" + tag + (" " + a if a else "") + " />")

def icon(name, comp, bar_idx):
    nodes = cloud[name]["nodes"]
    wrapper, children = nodes[0], nodes[1:]
    counter = [0]
    body = []
    emit([wrapper[0], wrapper[1], children], 3, bar_idx, counter, "color", body)
    return [
        "/** " + name + "（云端字形）：字形 currentColor，色条按传入颜色上色。 */",
        "export function " + comp + "({ color }: { color?: string }) {",
        "  return (",
        "    <svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\">",
    ] + body + ["    </svg>", "  );", "}", ""]

header = [
    "/**",
    " * 表格工具栏「文字颜色 / 背景颜色」按钮的图标 = 云端 lakex 表格同一套字形（阿里 iconfont `lake-icon` + 云端内联 SVG）。",
    " *",
    " * 由 scripts/sheet-color-icons.py 从 scripts/sheet-icons.cloud.json 生成（与内核 sprite 同源），**勿手改**。",
    " * 护栏校验每条 path 的 d 与 JSON 一致、且包装组带 scale(0.09375)（漏了它 = 256 网格画进 24 viewBox = 看不见）。",
    " *",
    " * 为什么 host 侧自带一份、而不用内核 sprite：内核把这两个按钮的**色条**画在自己硬编码的 17×2 inline div 上",
    " * （bottom:8 / left:9），而云端字形**本身已含色条**（font-color 第 1 条 path，云端写死 #F5222D；background 第 3 条）",
    " * ⇒ 两层色条叠着、位置还差一截，选完颜色就「展示错乱」。这里只保留云端那一条，并按**当前格颜色**上色（未着色 = 透明）。",
    " */",
    "",
]
out = header + icon("font-color", "SheetTextColorIcon", 0) + icon("background", "SheetBgColorIcon", 2)
open("src/features/sheet/sheetColorIcons.tsx", "w", encoding="utf8").write(chr(10).join(out) + chr(10))
print("生成完成，行数:", len(out))