import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { drawingBoardAIProxy } from "./aiProxyPlugin";

const readPositiveInteger = (
  value: string | undefined,
  fallback: number,
) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const readNonNegativeInteger = (
  value: string | undefined,
  fallback: number,
) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  return {
    root: __dirname,
    plugins: [
      react(),
      drawingBoardAIProxy({
        apiKey: env.LAKEX_AI_API_KEY,
        endpoint:
          env.LAKEX_AI_ENDPOINT || "https://api.edgefn.net/v1/chat/completions",
        model: env.LAKEX_AI_MODEL || "GLM-5.2",
        stream: env.LAKEX_AI_STREAM !== "false",
        requestTimeoutMs: readPositiveInteger(
          env.LAKEX_AI_REQUEST_TIMEOUT_MS,
          360_000,
        ),
        idleTimeoutMs: readPositiveInteger(
          env.LAKEX_AI_IDLE_TIMEOUT_MS,
          120_000,
        ),
        maxRetries: readNonNegativeInteger(env.LAKEX_AI_MAX_RETRIES, 1),
        maxTokens: readPositiveInteger(env.LAKEX_AI_MAX_TOKENS, 8192),
      }),
    ],
    resolve: {
      alias: {
        // 构建时发现 lakex-drawnix@0.1.0 的已发布 bundle 仍引用旧的包名 @plait-board/react-board / @plait-board/react-text
        "@dlient/lakex-doc-react": path.resolve(__dirname, "../src"),
        "@plait-board/react-board": "lakex-drawnix-react-board",
        "@plait-board/react-text": "lakex-drawnix-react-text",
      },
    },
  };
});
