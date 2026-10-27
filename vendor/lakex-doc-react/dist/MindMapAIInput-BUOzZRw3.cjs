const e=require("./icons-D6VGYpGo.cjs");let t=require("react"),n=require("react/jsx-runtime");var r=`#Role
You are a professional Mind Map Generator specializing in hierarchical information architecture. Your objective is to deconstruct complex topics into a robust, visual Markdown outline.

#Logic and Structure
- Primary Branches: Use the MECE (Mutually Exclusive, Collectively Exhaustive) principle to ensure no overlap and complete coverage of the topic.
- Branching Density: Aim for 3-5 primary branches. For narrow topics that do not naturally yield five branches, provide at least 3 branches and prioritize hierarchical depth over breadth.
- Hierarchical Depth: The structure must not exceed a maximum depth of the Root + 3 levels.
- Logical Flow: Organize the sequence of branches and sub-nodes based on priority, moving from foundational concepts to advanced applications.

#Formatting Standards
- Root Node: Place the root node on the first line of the response with no prefix (no hyphen, bullet, or number).
- Indentation: Use exactly two spaces per level of hierarchy to define the structure.
- Child Node Prefix: Every child node must start with a hyphen followed by a space ("- ").
- Text Constraints: Each node must contain between 2 and 6 visible words. Markdown formatting characters (e.g., **, ==, \`) do not count toward this 2-6 word limit.
- Remarks: Insert contextual notes or brief explanations immediately after relevant nodes using the "> " prefix.
- Inline Styling: Use Obsidian-compatible Markdown for emphasis: **bold**, *italic*, \`code\`, ~~strikethrough~~, and ==highlighting==.

#Extended Syntax (Optional)
Use these features only when they naturally enhance the mind map's clarity or structure. Do not force them into every response.
- Dotted Lines: Use "-." instead of "-" for weak, optional, or tentative relationships. Example: "-. Optional Step"
- Multi-line Content: Use "|" prefix lines to append additional display lines to a node. Example:
  - Main Point
    | Supporting detail line 1
    | Supporting detail line 2
- Tags: Add "#tag" at the end of node text for categorization. Example: "- React #frontend #framework"
- Cross-links: Define anchors with "{#id}" and link with "-> {#id}" to connect nodes across branches. Example:
  - Node A {#a}
  - Node B
    -> {#a} "references"
- Folding: Use "+" instead of "-" to mark a node as initially collapsed (children hidden by default). Example: "+ Collapsed Section"
- LaTeX: Use "$...$" for inline math and "$$...$$" for display math. Example: "- Energy: $E = mc^2$"
- Frontmatter: Use a "---" block at the very top to set layout direction or theme:
  ---
  direction: right
  theme: dark
  ---

#Example Output
Project Management
- **Foundational Concepts** #core
  - Project Life Cycle
    > Initiation through closing phases
    | Planning, executing, monitoring
  - Stakeholder Identification
- *Execution Frameworks*
  - ==Agile Methodologies==
  -. Hybrid Approaches
- Advanced Optimization
  - Resource Load Balancing
    > Optimizing team allocation
  - Portfolio Risk Mitigation

#Constraints
- Provide the raw Markdown output only.
- Do not include any introductory text, conversational fillers, or explanations.
- Do not include any concluding remarks or summaries.
- Use extended syntax features (dotted lines, tags, multi-line, cross-links, etc.) only when they genuinely improve the mind map's clarity or structure. Default to basic syntax.
- FINAL NEGATIVE CONSTRAINT: Do not wrap the output in markdown code fences. Provide the response as raw, plain text.`;function i(e){if(!e||e.length===0)return``;let t=[];for(let n of e)n===`text`?t.push(`text/*,.json,.js,.ts,.xml,.yaml,.yml,.sql,.sh,.md`):n===`image`?t.push(`image/*`):n===`pdf`&&t.push(`application/pdf`);return t.join(`,`)}var a=5242880;function o(e,t){if(t.length===0)return e;let n=[{type:`text`,text:e}];for(let e of t)if(e.type.startsWith(`image/`))n.push({type:`image_url`,image_url:{url:e.base64}});else if(e.type===`application/pdf`)n.push({type:`text`,text:`[File: ${e.name}]\nPDF attachment (${e.base64.length} base64 characters). If the provider supports PDFs, handle this attachment in a custom request adapter.`});else{let t=atob(e.base64.split(`,`)[1]||``);n.push({type:`text`,text:`[File: ${e.name}]\n${t}`})}return n}function s(e,t){return!t||t.length===0?!1:t.includes(`image`)&&e.type.startsWith(`image/`)||t.includes(`pdf`)&&e.type===`application/pdf`?!0:t.includes(`text`)?e.type.startsWith(`text/`)||/\.(json|js|ts|xml|ya?ml|sql|sh|md)$/i.test(e.name):!1}function c(e){let t=e.replace(/<think>[\s\S]*?<\/think>/g,``);return t=t.replace(/<think>[\s\S]*$/,``),t}async function*l(e){let t=new TextDecoder,n=``;for(;;){let{done:r,value:i}=await e.read();if(r)break;n+=t.decode(i,{stream:!0});let a=n.split(`
`);n=a.pop()||``;for(let e of a){let t=e.trim();if(t===`data: [DONE]`)return;if(t.startsWith(`data: `))try{let e=JSON.parse(t.slice(6)).choices?.[0]?.delta?.content;e&&(yield e)}catch{}}}}function u({config:u,theme:d,messages:f,currentMarkdown:p,onMarkdownStream:m,onComplete:h,onError:g}){let[_,v]=(0,t.useState)(``),[y,b]=(0,t.useState)(!1),[x,S]=(0,t.useState)([]),[C,w]=(0,t.useState)(null),T=(0,t.useRef)(null),E=(0,t.useRef)(null),D=(0,t.useRef)(0),O=u.attachments&&u.attachments.length>0,k=(0,t.useCallback)(async()=>{let e=_.trim();if(!e&&x.length===0||y)return;b(!0),w(null);let t=new AbortController;T.current=t;try{let n=o(e,x),i=u.systemPrompt||r,a=[{role:`system`,content:p?.trim()?`${i}\n\n#Current Mind Map\nThe user already has the following mind map. They may ask you to modify, expand, or optimize it. If the user's request is about the existing content, use it as the base and output the updated version. If the request is about a new topic, generate a fresh mind map.\n\n\`\`\`\n${p.trim()}\n\`\`\``:i},{role:`user`,content:n}],s=JSON.stringify({model:u.model,messages:a,stream:!0}),d={...u.headers,...u.apiKey?{Authorization:`Bearer ${u.apiKey}`}:{},"Content-Type":`application/json`},f=u.request?await u.request({apiUrl:u.apiUrl,apiKey:u.apiKey,model:u.model,messages:a,headers:d,body:s,signal:t.signal}):await fetch(u.apiUrl,{method:`POST`,headers:d,body:s,signal:t.signal});if(!f.ok)throw Error(`API error: ${f.status}`);let g=f.body?.getReader();if(!g)throw Error(`No response body`);let _=``,y=!1;for await(let e of l(g))if(_+=e,!y){y=!0;let e=c(_);D.current=requestAnimationFrame(()=>{m(e),y=!1})}cancelAnimationFrame(D.current),_&&m(c(_)),v(``),S([]),h()}catch(e){if(e.name===`AbortError`)h();else{let t=e.message||f.aiError;w(t),g(t),setTimeout(()=>w(null),4e3)}}finally{b(!1),T.current=null}},[_,x,y,u,p,f,m,h,g]),A=(0,t.useCallback)(()=>{T.current?.abort()},[]),j=(0,t.useCallback)(e=>{e.key===`Enter`&&!e.shiftKey&&(e.preventDefault(),k())},[k]),M=(0,t.useCallback)(e=>{let t=e.target.files;if(!t)return;let n=u.maxAttachmentSize??a;Array.from(t).forEach(e=>{if(!s(e,u.attachments)){let t=`${f.aiUnsupportedFile}: ${e.name}`;w(t),g(t);return}if(e.size>n){let t=`${f.aiFileTooLarge}: ${e.name}`;w(t),g(t);return}let t=new FileReader;t.onload=()=>{S(n=>[...n,{name:e.name,type:e.type,base64:t.result}])},t.readAsDataURL(e)}),e.target.value=``},[u.attachments,u.maxAttachmentSize,f,g]),N=(0,t.useCallback)(e=>{S(t=>t.filter((t,n)=>n!==e))},[]);return(0,n.jsxs)(`div`,{className:`mindmap-ai-input`,children:[x.length>0&&(0,n.jsx)(`div`,{className:`mindmap-ai-file-previews`,children:x.map((t,r)=>(0,n.jsxs)(`span`,{className:`mindmap-ai-file-chip`,children:[(0,n.jsx)(`span`,{className:`mindmap-ai-file-name`,children:t.name}),(0,n.jsx)(`button`,{className:`mindmap-ai-file-remove`,onClick:()=>N(r),children:(0,n.jsx)(e.a,{size:12})})]},r))}),(0,n.jsxs)(`div`,{className:`mindmap-ai-input-row`,children:[O&&(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(`button`,{className:`mindmap-ai-attach-btn`,onClick:()=>E.current?.click(),disabled:y,title:f.aiPlaceholder,children:(0,n.jsx)(e.c,{size:18})}),(0,n.jsx)(`input`,{ref:E,type:`file`,accept:i(u.attachments),multiple:!0,style:{display:`none`},onChange:M})]}),(0,n.jsx)(`input`,{className:`mindmap-ai-input-field`,type:`text`,value:y?``:_,onChange:e=>v(e.target.value),onKeyDown:j,placeholder:y?f.aiGenerating:f.aiPlaceholder,disabled:y}),(0,n.jsx)(`button`,{className:`mindmap-ai-send-btn${y?` mindmap-ai-send-btn--loading`:``}`,onClick:y?A:k,disabled:!y&&!_.trim()&&x.length===0,style:{background:y?`transparent`:!_.trim()&&x.length===0?d.controls.hoverBg:d.root.bgColor,color:y||!_.trim()&&x.length===0?d.controls.textColor:d.root.textColor},children:y?(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(`span`,{className:`mindmap-ai-spinner`,children:(0,n.jsx)(e.n,{size:20})}),(0,n.jsx)(`span`,{className:`mindmap-ai-stop-icon`,children:(0,n.jsx)(e.d,{size:16})})]}):(0,n.jsx)(e.t,{size:16})})]}),C&&(0,n.jsx)(`div`,{className:`mindmap-ai-error`,children:C})]})}exports.MindMapAIInput=u;