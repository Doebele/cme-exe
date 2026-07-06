/**
 * Streaming chat helper for the dual-mode AI routes.
 *
 * Both `/api/ai/claude` (Hybrid, server key, rate-limited) and `/api/ai/proxy`
 * (Full, visitor key) accept `{ systemPrompt, messages, stream }` and emit an
 * SSE stream of:
 *   data: { type: "token", text }
 *   data: { type: "done", usage, model }
 *   data: { type: "error", message }   (mid-stream failure)
 *
 * Pre-stream failures (429 / 400 / 401) come back as ordinary JSON with a
 * non-200 status. Mid-stream failures — notably "Hybrid mode is disabled" when
 * the server has no ANTHROPIC_API_KEY — arrive as a 200 SSE error event, so we
 * surface them as a StreamHttpError whose body.hybridDisabled flag is derived
 * from the message text.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface SSEEvent {
  type: string;
  text?: unknown;
  message?: unknown;
}

export interface StreamErrorBody {
  error?: string;
  hybridDisabled?: boolean;
  retryAfterSec?: number;
}

export class StreamHttpError extends Error {
  status: number;
  body: StreamErrorBody;
  constructor(status: number, body: StreamErrorBody, message?: string) {
    super(message || body?.error || `Stream request failed (${status})`);
    this.name = "StreamHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Yields parsed JSON events from an SSE response body. Tolerates blank lines
 * and minor "data:" formatting variants.
 */
export async function* parseSSE(
  response: Response,
): AsyncGenerator<SSEEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response has no readable body");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!raw.startsWith("data:")) continue;
      const payload = raw.slice(5).trimStart();
      if (!payload) continue;
      try {
        yield JSON.parse(payload) as SSEEvent;
      } catch {
        /* ignore malformed event lines */
      }
    }
  }
}

export interface StreamChatOptions {
  systemPrompt: string;
  messages: ChatMessage[];
  visitorApiKey: string | null;
  signal?: AbortSignal;
  onToken: (text: string) => void;
}

const HYBRID_DISABLED_RE = /hybrid mode is disabled/i;

/**
 * POSTs a streaming chat request to the AI route (Hybrid or Full depending on
 * whether a visitor key is present) and pumps token deltas into `onToken`.
 * Resolves when the stream emits `done`. Throws `StreamHttpError` for any
 * pre-stream HTTP failure or mid-stream SSE error. Aborts cleanly when the
 * caller's AbortSignal fires (rethrows the AbortError).
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const { systemPrompt, messages, visitorApiKey, signal, onToken } = opts;
  const endpoint = visitorApiKey ? "/api/ai/proxy" : "/api/ai/claude";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (visitorApiKey) headers["Authorization"] = `Bearer ${visitorApiKey}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ systemPrompt, messages, stream: true }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new StreamHttpError(
      0,
      {},
      err instanceof Error ? err.message : "Network error",
    );
  }

  if (!res.ok) {
    let body: StreamErrorBody = {};
    try {
      body = (await res.json()) as StreamErrorBody;
    } catch {
      /* keep empty body */
    }
    const retryAfter = res.headers.get("Retry-After");
    const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
    const retryAfterSec = Number.isFinite(parsed) ? parsed : body.retryAfterSec;
    throw new StreamHttpError(res.status, { ...body, retryAfterSec });
  }

  for await (const evt of parseSSE(res)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (evt.type === "token" && typeof evt.text === "string") {
      onToken(evt.text);
    } else if (evt.type === "done") {
      return;
    } else if (evt.type === "error") {
      const msg =
        typeof evt.message === "string" ? evt.message : "Stream failed.";
      throw new StreamHttpError(200, {
        error: msg,
        hybridDisabled: HYBRID_DISABLED_RE.test(msg),
      });
    }
  }
  // Stream closed without an explicit done event — treat as complete.
}
