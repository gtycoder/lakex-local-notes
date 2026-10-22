import { useState } from "react";
import { LakexEditor, BlockMenuAction } from "@dlient/lakex-doc-react";
import { drawingBoardGenerate } from "./drawingBoardAI";
// @ts-ignore
import "./App.css";

function App() {
  const [isDark, setIsDark] = useState(false);
  const [language, setLanguage] = useState<"zh-cn" | "en-us">("zh-cn");
  const [content, setContent] = useState("{}");
  const [lastAction, setLastAction] = useState<string>("");

  const handleContentChange = (contents: any[]) => {
    const jsonContent = contents.find((c) => c.type === "json")?.text;
    if (jsonContent) {
      setContent(jsonContent);
    }
  };

  // 块操作回调（用于测试右键菜单动作）
  const handleBlockAction = (action: BlockMenuAction, data: any) => {
    const actionText = `${action} -> ${data.blockType}${data.payload ? ` (${data.payload})` : ""}`;
    setLastAction(actionText);
    console.log("[BlockAction]", actionText, data);
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%" }}>
      <div className={`app-container ${isDark ? "dark" : ""}`}>
        <div className="floating-controls">
          <button className="control-button" onClick={() => setIsDark(!isDark)}>
            {isDark ? "Light Mode" : "Dark Mode"}
          </button>
          <select
            className="control-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as "zh-cn" | "en-us")}
          >
            <option value="zh-cn">中文</option>
            <option value="en-us">English</option>
          </select>
        </div>
        {/* 显示最后一次块操作 */}
        {lastAction && (
          <div className="action-toast">
            操作: {lastAction}
            <button className="action-close" onClick={() => setLastAction("")}>
              ×
            </button>
          </div>
        )}
        <div className="editor-container">
          <LakexEditor
            dark={isDark}
            language={language}
            config={{
              drawingBoardAI: {
                generate: drawingBoardGenerate,
              },
            }}
            onContentChange={handleContentChange}
            onBlockAction={handleBlockAction}
          />
        </div>
      </div>
      <div style={{ width: 500, height: "100vh" }}>
        <pre
          lang="json"
          style={{ height: "100%", overflowY: "scroll" }}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(content, null, 2) }}
        ></pre>
      </div>
    </div>
  );
}

export default App;
