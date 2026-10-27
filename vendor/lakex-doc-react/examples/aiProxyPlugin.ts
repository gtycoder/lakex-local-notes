import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

interface AIProxyOptions {
  apiKey?: string;
  endpoint: string;
  model: string;
  stream?: boolean;
  requestTimeoutMs?: number;
  idleTimeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
}

const MAX_REQUEST_BYTES = 128 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 6 * 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_MAX_TOKENS = 8192;

class AIProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

const isRetryableStatus = (status: number) =>
  status === 408 ||
  status === 409 ||
  status === 425 ||
  status === 429 ||
  status >= 500;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const readProviderJson = (text: string) => {
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new AIProviderError(
      "AI provider returned a non-JSON response",
      true,
    );
  }
};

const readMessageContent = (payload: Record<string, any>) => {
  const content =
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text;
  return typeof content === "string" ? content : "";
};

const readStreamContent = async (
  upstreamResponse: Response,
  onActivity: () => void,
) => {
  if (!upstreamResponse.body) {
    throw new AIProviderError("AI provider returned an empty stream", true);
  }

  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finished = false;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      finished = true;
      return;
    }
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    const chunk =
      payload?.choices?.[0]?.delta?.content ??
      payload?.choices?.[0]?.message?.content ??
      payload?.choices?.[0]?.text;
    if (typeof chunk === "string") content += chunk;
  };

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(consumeLine);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  return content;
};

const writeJson = (
  response: ServerResponse,
  statusCode: number,
  value: Record<string, unknown>,
) => {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
};

const readJsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
};

/**
 * Development-only AI proxy. It keeps the provider key in the Vite Node
 * process and exposes only the narrow board-generation endpoint to the demo.
 */
export function drawingBoardAIProxy({
  apiKey,
  endpoint,
  model,
  stream = true,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  maxTokens = DEFAULT_MAX_TOKENS,
}: AIProxyOptions): Plugin {
  return {
    name: "lakex-drawing-board-ai-proxy",
    configureServer(server) {
      server.middlewares.use(
        "/api/ai/drawing-board",
        async (request, response) => {
          if (request.method !== "POST") {
            writeJson(response, 405, { error: "Method not allowed" });
            return;
          }
          if (!apiKey) {
            writeJson(response, 503, {
              error:
                "Missing LAKEX_AI_API_KEY. Copy examples/.env.example to examples/.env.local.",
            });
            return;
          }

          try {
            const body = await readJsonBody(request);
            const description =
              typeof body.description === "string"
                ? body.description.trim()
                : "";
            const systemPrompt =
              typeof body.systemPrompt === "string"
                ? body.systemPrompt.trim()
                : "";
            const contextPrompt =
              typeof body.contextPrompt === "string"
                ? body.contextPrompt.trim()
                : "";
            if (!description || !systemPrompt) {
              writeJson(response, 400, {
                error: "description and systemPrompt are required",
              });
              return;
            }

            let clientAborted = false;
            let activeController: AbortController | null = null;
            const onClientClose = () => {
              clientAborted = true;
              activeController?.abort();
            };
            request.once("aborted", onClientClose);
            response.once("close", onClientClose);
            try {
              let lastError: unknown;
              const attempts = Math.max(1, Math.min(3, maxRetries + 1));
              for (let attempt = 0; attempt < attempts; attempt += 1) {
                if (clientAborted) return;
                const controller = new AbortController();
                activeController = controller;
                let timeoutReason: "request" | "idle" | null = null;
                let idleTimer: ReturnType<typeof setTimeout> | null = null;
                const abortForTimeout = (reason: "request" | "idle") => {
                  timeoutReason = reason;
                  controller.abort();
                };
                const resetIdleTimeout = () => {
                  if (idleTimer) clearTimeout(idleTimer);
                  idleTimer = setTimeout(
                    () => abortForTimeout("idle"),
                    idleTimeoutMs,
                  );
                };
                const requestTimer = setTimeout(
                  () => abortForTimeout("request"),
                  requestTimeoutMs,
                );
                resetIdleTimeout();

                try {
                  const upstreamResponse = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${apiKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      model,
                      stream,
                      temperature: 0.2,
                      max_tokens: maxTokens,
                      messages: [
                        { role: "system", content: systemPrompt },
                        {
                          role: "user",
                          content: contextPrompt || description,
                        },
                      ],
                    }),
                    signal: controller.signal,
                  });
                  resetIdleTimeout();

                  if (!upstreamResponse.ok) {
                    const upstreamText = await upstreamResponse.text();
                    let upstream: Record<string, any> = {};
                    try {
                      upstream = JSON.parse(upstreamText);
                    } catch {
                      // Preserve the HTTP status when an upstream gateway
                      // returns an HTML or plain-text error page.
                    }
                    const providerMessage =
                      upstream?.error?.message ||
                      upstream?.message ||
                      `AI provider returned HTTP ${upstreamResponse.status}`;
                    throw new AIProviderError(
                      providerMessage,
                      isRetryableStatus(upstreamResponse.status),
                    );
                  }

                  const contentType =
                    upstreamResponse.headers.get("content-type") || "";
                  const content =
                    stream && contentType.includes("text/event-stream")
                      ? await readStreamContent(
                          upstreamResponse,
                          resetIdleTimeout,
                        )
                      : readMessageContent(
                          readProviderJson(await upstreamResponse.text()),
                        );
                  if (!content) {
                    throw new AIProviderError(
                      "AI provider response has no message content",
                      true,
                    );
                  }
                  writeJson(response, 200, { json: content });
                  return;
                } catch (error) {
                  if (clientAborted) return;
                  if (
                    error instanceof Error &&
                    error.name === "AbortError" &&
                    timeoutReason
                  ) {
                    const seconds = Math.round(
                      (timeoutReason === "idle"
                        ? idleTimeoutMs
                        : requestTimeoutMs) / 1000,
                    );
                    lastError = new AIProviderError(
                      timeoutReason === "idle"
                        ? `AI provider stopped sending data for ${seconds} seconds`
                        : `AI provider request exceeded ${seconds} seconds`,
                      false,
                    );
                  } else if (error instanceof AIProviderError) {
                    lastError = error;
                  } else {
                    lastError = new AIProviderError(
                      error instanceof Error
                        ? `AI provider network error: ${error.message}`
                        : "AI provider network error",
                      true,
                    );
                  }
                } finally {
                  clearTimeout(requestTimer);
                  if (idleTimer) clearTimeout(idleTimer);
                  activeController = null;
                }

                if (
                  !(lastError instanceof AIProviderError) ||
                  !lastError.retryable ||
                  attempt === attempts - 1
                ) {
                  throw lastError;
                }
                await delay(800 * 2 ** attempt);
              }
              throw lastError;
            } finally {
              request.off("aborted", onClientClose);
              response.off("close", onClientClose);
            }
          } catch (error) {
            if (request.aborted || response.destroyed) return;
            const message =
              error instanceof Error &&
              error.message === "REQUEST_TOO_LARGE"
                  ? "Request body is too large"
                  : error instanceof Error
                    ? error.message
                    : "AI proxy request failed";
            writeJson(
              response,
              message === "Request body is too large" ? 413 : 502,
              { error: message },
            );
          }
        },
      );
    },
  };
}
