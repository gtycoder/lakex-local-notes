import React from "react";
import ReactDOM from "react-dom/client";
import { MobileApp } from "./MobileApp";
import "../features/editor/image-lightbox.css";
import "../features/attachment/attachment-preview.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>
);
