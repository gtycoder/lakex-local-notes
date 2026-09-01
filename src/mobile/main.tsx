import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import "../features/editor/image-lightbox.css";
import "../features/attachment/attachment-preview.css";
import "../styles/tokens.css"; // 复用桌面设计令牌（--lake-*）+ focus-visible + reduced-motion
import "./editor/editor-dock.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
