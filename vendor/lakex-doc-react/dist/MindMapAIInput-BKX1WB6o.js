import { a as e, c as t, d as n, n as r, t as i } from "./icons-Cp9Z20_6.js";
import { useCallback as a, useRef as o, useState as s } from "react";
import { Fragment as c, jsx as l, jsxs as u } from "react/jsx-runtime";
//#region ../../node_modules/@xiangfa/mindmap/dist/esm/components/MindMapAIInput.js
var d = "#Role\nYou are a professional Mind Map Generator specializing in hierarchical information architecture. Your objective is to deconstruct complex topics into a robust, visual Markdown outline.\n\n#Logic and Structure\n- Primary Branches: Use the MECE (Mutually Exclusive, Collectively Exhaustive) principle to ensure no overlap and complete coverage of the topic.\n- Branching Density: Aim for 3-5 primary branches. For narrow topics that do not naturally yield five branches, provide at least 3 branches and prioritize hierarchical depth over breadth.\n- Hierarchical Depth: The structure must not exceed a maximum depth of the Root + 3 levels.\n- Logical Flow: Organize the sequence of branches and sub-nodes based on priority, moving from foundational concepts to advanced applications.\n\n#Formatting Standards\n- Root Node: Place the root node on the first line of the response with no prefix (no hyphen, bullet, or number).\n- Indentation: Use exactly two spaces per level of hierarchy to define the structure.\n- Child Node Prefix: Every child node must start with a hyphen followed by a space (\"- \").\n- Text Constraints: Each node must contain between 2 and 6 visible words. Markdown formatting characters (e.g., **, ==, `) do not count toward this 2-6 word limit.\n- Remarks: Insert contextual notes or brief explanations immediately after relevant nodes using the \"> \" prefix.\n- Inline Styling: Use Obsidian-compatible Markdown for emphasis: **bold**, *italic*, `code`, ~~strikethrough~~, and ==highlighting==.\n\n#Extended Syntax (Optional)\nUse these features only when they naturally enhance the mind map's clarity or structure. Do not force them into every response.\n- Dotted Lines: Use \"-.\" instead of \"-\" for weak, optional, or tentative relationships. Example: \"-. Optional Step\"\n- Multi-line Content: Use \"|\" prefix lines to append additional display lines to a node. Example:\n  - Main Point\n    | Supporting detail line 1\n    | Supporting detail line 2\n- Tags: Add \"#tag\" at the end of node text for categorization. Example: \"- React #frontend #framework\"\n- Cross-links: Define anchors with \"{#id}\" and link with \"-> {#id}\" to connect nodes across branches. Example:\n  - Node A {#a}\n  - Node B\n    -> {#a} \"references\"\n- Folding: Use \"+\" instead of \"-\" to mark a node as initially collapsed (children hidden by default). Example: \"+ Collapsed Section\"\n- LaTeX: Use \"$...$\" for inline math and \"$$...$$\" for display math. Example: \"- Energy: $E = mc^2$\"\n- Frontmatter: Use a \"---\" block at the very top to set layout direction or theme:\n  ---\n  direction: right\n  theme: dark\n  ---\n\n#Example Output\nProject Management\n- **Foundational Concepts** #core\n  - Project Life Cycle\n    > Initiation through closing phases\n    | Planning, executing, monitoring\n  - Stakeholder Identification\n- *Execution Frameworks*\n  - ==Agile Methodologies==\n  -. Hybrid Approaches\n- Advanced Optimization\n  - Resource Load Balancing\n    > Optimizing team allocation\n  - Portfolio Risk Mitigation\n\n#Constraints\n- Provide the raw Markdown output only.\n- Do not include any introductory text, conversational fillers, or explanations.\n- Do not include any concluding remarks or summaries.\n- Use extended syntax features (dotted lines, tags, multi-line, cross-links, etc.) only when they genuinely improve the mind map's clarity or structure. Default to basic syntax.\n- FINAL NEGATIVE CONSTRAINT: Do not wrap the output in markdown code fences. Provide the response as raw, plain text.";
function f(e) {
	if (!e || e.length === 0) return "";
	let t = [];
	for (let n of e) n === "text" ? t.push("text/*,.json,.js,.ts,.xml,.yaml,.yml,.sql,.sh,.md") : n === "image" ? t.push("image/*") : n === "pdf" && t.push("application/pdf");
	return t.join(",");
}
var p = 5242880;
function m(e, t) {
	if (t.length === 0) return e;
	let n = [{
		type: "text",
		text: e
	}];
	for (let e of t) if (e.type.startsWith("image/")) n.push({
		type: "image_url",
		image_url: { url: e.base64 }
	});
	else if (e.type === "application/pdf") n.push({
		type: "text",
		text: `[File: ${e.name}]\nPDF attachment (${e.base64.length} base64 characters). If the provider supports PDFs, handle this attachment in a custom request adapter.`
	});
	else {
		let t = atob(e.base64.split(",")[1] || "");
		n.push({
			type: "text",
			text: `[File: ${e.name}]\n${t}`
		});
	}
	return n;
}
function h(e, t) {
	return !t || t.length === 0 ? !1 : t.includes("image") && e.type.startsWith("image/") || t.includes("pdf") && e.type === "application/pdf" ? !0 : t.includes("text") ? e.type.startsWith("text/") || /\.(json|js|ts|xml|ya?ml|sql|sh|md)$/i.test(e.name) : !1;
}
function g(e) {
	let t = e.replace(/<think>[\s\S]*?<\/think>/g, "");
	return t = t.replace(/<think>[\s\S]*$/, ""), t;
}
async function* _(e) {
	let t = new TextDecoder(), n = "";
	for (;;) {
		let { done: r, value: i } = await e.read();
		if (r) break;
		n += t.decode(i, { stream: !0 });
		let a = n.split("\n");
		n = a.pop() || "";
		for (let e of a) {
			let t = e.trim();
			if (t === "data: [DONE]") return;
			if (t.startsWith("data: ")) try {
				let e = JSON.parse(t.slice(6)).choices?.[0]?.delta?.content;
				e && (yield e);
			} catch {}
		}
	}
}
function v({ config: v, theme: y, messages: b, currentMarkdown: x, onMarkdownStream: S, onComplete: C, onError: w }) {
	let [T, E] = s(""), [D, O] = s(!1), [k, A] = s([]), [j, M] = s(null), N = o(null), P = o(null), F = o(0), I = v.attachments && v.attachments.length > 0, L = a(async () => {
		let e = T.trim();
		if (!e && k.length === 0 || D) return;
		O(!0), M(null);
		let t = new AbortController();
		N.current = t;
		try {
			let n = m(e, k), r = v.systemPrompt || d, i = [{
				role: "system",
				content: x?.trim() ? `${r}\n\n#Current Mind Map\nThe user already has the following mind map. They may ask you to modify, expand, or optimize it. If the user's request is about the existing content, use it as the base and output the updated version. If the request is about a new topic, generate a fresh mind map.\n\n\`\`\`\n${x.trim()}\n\`\`\`` : r
			}, {
				role: "user",
				content: n
			}], a = JSON.stringify({
				model: v.model,
				messages: i,
				stream: !0
			}), o = {
				...v.headers,
				...v.apiKey ? { Authorization: `Bearer ${v.apiKey}` } : {},
				"Content-Type": "application/json"
			}, s = v.request ? await v.request({
				apiUrl: v.apiUrl,
				apiKey: v.apiKey,
				model: v.model,
				messages: i,
				headers: o,
				body: a,
				signal: t.signal
			}) : await fetch(v.apiUrl, {
				method: "POST",
				headers: o,
				body: a,
				signal: t.signal
			});
			if (!s.ok) throw Error(`API error: ${s.status}`);
			let c = s.body?.getReader();
			if (!c) throw Error("No response body");
			let l = "", u = !1;
			for await (let e of _(c)) if (l += e, !u) {
				u = !0;
				let e = g(l);
				F.current = requestAnimationFrame(() => {
					S(e), u = !1;
				});
			}
			cancelAnimationFrame(F.current), l && S(g(l)), E(""), A([]), C();
		} catch (e) {
			if (e.name === "AbortError") C();
			else {
				let t = e.message || b.aiError;
				M(t), w(t), setTimeout(() => M(null), 4e3);
			}
		} finally {
			O(!1), N.current = null;
		}
	}, [
		T,
		k,
		D,
		v,
		x,
		b,
		S,
		C,
		w
	]), R = a(() => {
		N.current?.abort();
	}, []), z = a((e) => {
		e.key === "Enter" && !e.shiftKey && (e.preventDefault(), L());
	}, [L]), B = a((e) => {
		let t = e.target.files;
		if (!t) return;
		let n = v.maxAttachmentSize ?? p;
		Array.from(t).forEach((e) => {
			if (!h(e, v.attachments)) {
				let t = `${b.aiUnsupportedFile}: ${e.name}`;
				M(t), w(t);
				return;
			}
			if (e.size > n) {
				let t = `${b.aiFileTooLarge}: ${e.name}`;
				M(t), w(t);
				return;
			}
			let t = new FileReader();
			t.onload = () => {
				A((n) => [...n, {
					name: e.name,
					type: e.type,
					base64: t.result
				}]);
			}, t.readAsDataURL(e);
		}), e.target.value = "";
	}, [
		v.attachments,
		v.maxAttachmentSize,
		b,
		w
	]), V = a((e) => {
		A((t) => t.filter((t, n) => n !== e));
	}, []);
	return /* @__PURE__ */ u("div", {
		className: "mindmap-ai-input",
		children: [
			k.length > 0 && /* @__PURE__ */ l("div", {
				className: "mindmap-ai-file-previews",
				children: k.map((t, n) => /* @__PURE__ */ u("span", {
					className: "mindmap-ai-file-chip",
					children: [/* @__PURE__ */ l("span", {
						className: "mindmap-ai-file-name",
						children: t.name
					}), /* @__PURE__ */ l("button", {
						className: "mindmap-ai-file-remove",
						onClick: () => V(n),
						children: /* @__PURE__ */ l(e, { size: 12 })
					})]
				}, n))
			}),
			/* @__PURE__ */ u("div", {
				className: "mindmap-ai-input-row",
				children: [
					I && /* @__PURE__ */ u(c, { children: [/* @__PURE__ */ l("button", {
						className: "mindmap-ai-attach-btn",
						onClick: () => P.current?.click(),
						disabled: D,
						title: b.aiPlaceholder,
						children: /* @__PURE__ */ l(t, { size: 18 })
					}), /* @__PURE__ */ l("input", {
						ref: P,
						type: "file",
						accept: f(v.attachments),
						multiple: !0,
						style: { display: "none" },
						onChange: B
					})] }),
					/* @__PURE__ */ l("input", {
						className: "mindmap-ai-input-field",
						type: "text",
						value: D ? "" : T,
						onChange: (e) => E(e.target.value),
						onKeyDown: z,
						placeholder: D ? b.aiGenerating : b.aiPlaceholder,
						disabled: D
					}),
					/* @__PURE__ */ l("button", {
						className: `mindmap-ai-send-btn${D ? " mindmap-ai-send-btn--loading" : ""}`,
						onClick: D ? R : L,
						disabled: !D && !T.trim() && k.length === 0,
						style: {
							background: D ? "transparent" : !T.trim() && k.length === 0 ? y.controls.hoverBg : y.root.bgColor,
							color: D || !T.trim() && k.length === 0 ? y.controls.textColor : y.root.textColor
						},
						children: D ? /* @__PURE__ */ u(c, { children: [/* @__PURE__ */ l("span", {
							className: "mindmap-ai-spinner",
							children: /* @__PURE__ */ l(r, { size: 20 })
						}), /* @__PURE__ */ l("span", {
							className: "mindmap-ai-stop-icon",
							children: /* @__PURE__ */ l(n, { size: 16 })
						})] }) : /* @__PURE__ */ l(i, { size: 16 })
					})
				]
			}),
			j && /* @__PURE__ */ l("div", {
				className: "mindmap-ai-error",
				children: j
			})
		]
	});
}
//#endregion
export { v as MindMapAIInput };
