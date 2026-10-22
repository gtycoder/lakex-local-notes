import type {
  DrawingBoardAIRequest,
  DrawingBoardAIResponse,
} from "@dlient/lakex-doc-react";
import { mockDrawingBoardGenerate } from "./mockDrawingBoardAI";

export async function drawingBoardGenerate(
  request: DrawingBoardAIRequest,
): Promise<DrawingBoardAIResponse> {
  if (import.meta.env.VITE_LAKEX_AI_USE_MOCK === "true") {
    return mockDrawingBoardGenerate(request);
  }

  const response = await fetch("/api/ai/drawing-board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: request.description,
      systemPrompt: request.systemPrompt,
      contextPrompt: request.contextPrompt,
      locale: request.locale,
    }),
    signal: request.signal,
  });
  const result = (await response.json().catch(() => null)) as {
    json?: DrawingBoardAIResponse;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(result?.error || `AI request failed (${response.status})`);
  }
  if (result?.json === undefined) {
    throw new Error("AI response is empty");
  }
  return result.json;
}
