import { validateVisitorKey } from "./providers.js";

/**
 * Read a visitor-supplied key (+ provider chosen in the widget) from a request.
 * Key: body.visitorApiKey, `Authorization: Bearer`, or `X-Visitor-Key`.
 * Provider hint: body.visitorProvider or `X-Visitor-Provider`.
 *
 * @param {import('express').Request} req
 * @returns {{ key: string, provider: string | null } | null}
 */
export function extractVisitor(req) {
  const fromBody = req.body?.visitorApiKey;
  const key =
    (typeof fromBody === "string" && fromBody.trim()) ||
    (req.get("authorization") || "").replace(/^bearer\s+/i, "").trim() ||
    (req.get("x-visitor-key") || "").trim();
  if (!key) return null;
  const hint = req.body?.visitorProvider || req.get("x-visitor-provider") || null;
  return { key, provider: typeof hint === "string" && hint.trim() ? hint.trim() : null };
}

/**
 * extractVisitor + validation. `error` is set when the key can't be used.
 * @param {import('express').Request} req
 * @returns {{ visitor: {key:string, provider:string|null} | null, error?: string }}
 */
export function readVisitor(req) {
  const visitor = extractVisitor(req);
  if (!visitor) return { visitor: null };
  const v = validateVisitorKey(visitor.key, visitor.provider);
  return "error" in v ? { visitor: null, error: v.error } : { visitor };
}
