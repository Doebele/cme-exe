import { getApiKey } from "./apiKey";

// ---------------------------------------------------------------------------
// Types — mirror docs/speedrun-contract.md sections 3 & 4.
// ---------------------------------------------------------------------------

export type Section = "hero" | "about" | "works" | "career" | "skills";
export type ActionType = "navigate" | "observe" | "done";

export interface SpeedrunAction {
  type: ActionType;
  target?: Section;
  item?: string | null;
}

export interface SpeedrunStep {
  step: number;
  thought: string;
  action: SpeedrunAction;
  done: boolean;
  latencyMs: number;
}

export interface StartInitialState {
  section: Section;
  item: string | null;
  availableSections: Section[];
  availableItems: Partial<Record<Section, string[]>>;
}

export interface StartSpeedrunResponse {
  runId: string | null;
  initialState?: StartInitialState;
  // Present when the hybrid-mode recording shortcut fired (visitor without
  // API key). The frontend plays back the recorded history instead of
  // running a live step loop.
  recordingId?: string;
  recording?: RecordingData;
  kind?: "recording";
}

export interface StepResponse extends SpeedrunStep {}

export interface ManifestResponse {
  manifest: string;
}

export interface HistoryEntry {
  step: number;
  thought: string;
  action: SpeedrunAction;
  timestamp: string;
  latencyMs: number;
}

export interface SpeedrunRun {
  id: string;
  kind?: "speedrun" | "url-speedrun";
  status: "running" | "complete";
  startedAt: string;
  completedAt: string | null;
  sourceUrl?: string;
  currentLocation: { section: Section; item: string | null };
  history: HistoryEntry[];
  manifest: string | null;
  externalPageState?: ExternalPageState;
}

// ---------------------------------------------------------------------------
// URL-Speedrun types — mirror docs/url-speedrun-contract.md sections 3 & 4.
// The /url/start initialState carries subject + flat section/item ids; the
// rich titles/descriptions live on the run record's externalPageState
// (fetched via GET /api/runs/:id).
// ---------------------------------------------------------------------------

export interface ExternalImage {
  src: string;
  alt?: string;
  kind: "avatar" | "logo" | "header";
  ascii?: string;
}

export interface ExternalSubject {
  name: string;
  role: string;
  location: string | null;
  images?: ExternalImage[];
}

export interface ExternalItem {
  id: string;
  title: string;
  description?: string;
  href?: string;
}

export interface ExternalSection {
  id: string;
  title: string;
  items: ExternalItem[];
}

export interface ExternalPageState {
  source: "external";
  sourceUrl: string;
  finalUrl?: string;
  title?: string;
  description?: string;
  subject: ExternalSubject;
  sections: ExternalSection[];
}

export interface UrlStartResponse {
  runId: string;
  initialState: {
    kind: "url-speedrun";
    sourceUrl: string;
    sourceHost?: string;
    section: Section;
    item: string | null;
    subject: ExternalSubject;
    availableSections: string[];
    availableItems: Record<string, string[]>;
  };
}

// ---------------------------------------------------------------------------
// Recording types — permanent, admin-curated Speedrun sessions. In Hybrid
// mode (visitor without API key) the /start endpoint may shortcut to a
// pre-recorded session instead of spending tokens on a fresh LLM run.
// ---------------------------------------------------------------------------

export interface RecordingHistoryEntry {
  step: number;
  thought: string;
  action: {
    type: "navigate" | "observe" | "done";
    target?: string;
    item?: string | null;
  };
  timestamp: string;
  latencyMs?: number;
}

export interface RecordingData {
  id: string;
  kind?: "recording";
  sourceKind: "claus" | "url";
  sourceUrl: string | null;
  subject: ExternalSubject | null;
  sections: ExternalSection[] | null;
  history: RecordingHistoryEntry[];
  manifest: string | null;
  recordedAt: string;
}

export interface RecordingMeta {
  id: string;
  kind?: string;
  sourceKind: "claus" | "url";
  sourceUrl: string | null;
  title: string;
  recordedAt: string;
  featured: boolean;
  historyLength: number;
}

export interface RecordingPromoteBody {
  runId: string;
  title?: string;
  featured?: boolean;
}

export interface RecordingPatchBody {
  title?: string;
  featured?: boolean;
}

// ---------------------------------------------------------------------------
// Error type — carries HTTP status + parsed body so callers can branch on
// specific conditions (503 hybridDisabled, 404 expired, 409 already complete,
// URL-specific codes INVALID_URL / BLOCKED / TIMEOUT / FETCH_FAILED / RATE_LIMIT).
// ---------------------------------------------------------------------------

export type UrlErrorCode =
  | "INVALID_URL"
  | "BLOCKED"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "FETCH_FAILED"
  | "RATE_LIMIT";

export interface SpeedrunErrorBody {
  error?: string;
  hybridDisabled?: boolean;
  manifest?: string;
  retryAfterSec?: number;
  code?: UrlErrorCode;
}

export class SpeedrunHttpError extends Error {
  status: number;
  body: SpeedrunErrorBody;
  constructor(status: number, body: SpeedrunErrorBody, message?: string) {
    super(message || body?.error || `Speedrun request failed (${status})`);
    this.name = "SpeedrunHttpError";
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Fetch wrapper.
// ---------------------------------------------------------------------------

const SPEEDRUN_BASE = "/api/speedrun";
const RUNS_BASE = "/api/runs";
const RECORDINGS_BASE = "/api/recordings";

function authHeaders(visitorApiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = visitorApiKey ?? getApiKey();
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  visitorApiKey?: string | null,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(visitorApiKey),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new SpeedrunHttpError(0, {}, err instanceof Error ? err.message : "Network error");
  }
  return parseJson<T>(res);
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (err) {
    throw new SpeedrunHttpError(0, {}, err instanceof Error ? err.message : "Network error");
  }
  return parseJson<T>(res);
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!res.ok) {
    throw new SpeedrunHttpError(res.status, (body || {}) as SpeedrunErrorBody);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// API functions — Claus-mode speedrun.
// ---------------------------------------------------------------------------

export function startSpeedrun(
  visitorApiKey?: string | null,
): Promise<StartSpeedrunResponse> {
  return postJson<StartSpeedrunResponse>(
    `${SPEEDRUN_BASE}/start`,
    { visitorApiKey: visitorApiKey ?? null },
    visitorApiKey,
  );
}

export function stepSpeedrun(
  runId: string,
  visitorApiKey?: string | null,
): Promise<StepResponse> {
  return postJson<StepResponse>(
    `${SPEEDRUN_BASE}/step`,
    { runId },
    visitorApiKey,
  );
}

export function getManifest(
  runId: string,
  visitorApiKey?: string | null,
): Promise<ManifestResponse> {
  return postJson<ManifestResponse>(
    `${SPEEDRUN_BASE}/manifest`,
    { runId },
    visitorApiKey,
  );
}

export function getRun(runId: string): Promise<SpeedrunRun> {
  return getJson<SpeedrunRun>(`${RUNS_BASE}/${runId}`);
}

// ---------------------------------------------------------------------------
// API functions — URL-Speedrun (external URLs). Step + manifest share the
// runId namespace with Claus-mode but use dedicated /url/* routes per the
// backend for clarity.
// ---------------------------------------------------------------------------

export function startUrlSpeedrun(
  url: string,
  visitorApiKey?: string | null,
): Promise<UrlStartResponse> {
  return postJson<UrlStartResponse>(
    `${SPEEDRUN_BASE}/url/start`,
    { url, visitorApiKey: visitorApiKey ?? null },
    visitorApiKey,
  );
}

export function stepUrlSpeedrun(
  runId: string,
  visitorApiKey?: string | null,
): Promise<StepResponse> {
  return postJson<StepResponse>(
    `${SPEEDRUN_BASE}/url/step`,
    { runId },
    visitorApiKey,
  );
}

export function getManifestForUrl(
  runId: string,
  visitorApiKey?: string | null,
): Promise<ManifestResponse> {
  return postJson<ManifestResponse>(
    `${SPEEDRUN_BASE}/url/manifest`,
    { runId },
    visitorApiKey,
  );
}
// ---------------------------------------------------------------------------
// API functions — Recordings (admin-curated permanent sessions).
// Public reads (list/get) need no auth; writes (promote/patch/delete) rely
// on the admin session cookie, so they send credentials.
// ---------------------------------------------------------------------------

export function listRecordings(featuredOnly = false): Promise<RecordingMeta[]> {
  const url = featuredOnly
    ? `${RECORDINGS_BASE}?featured=true`
    : RECORDINGS_BASE;
  return getJson<RecordingMeta[]>(url);
}

export function getRecording(id: string): Promise<RecordingData> {
  return getJson<RecordingData>(`${RECORDINGS_BASE}/${id}`);
}

export async function promoteRecording(
  body: RecordingPromoteBody,
): Promise<RecordingMeta> {
  const res = await fetch(RECORDINGS_BASE, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJson<RecordingMeta>(res);
}

export async function updateRecording(
  id: string,
  patch: RecordingPatchBody,
): Promise<RecordingMeta> {
  const res = await fetch(`${RECORDINGS_BASE}/${id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return parseJson<RecordingMeta>(res);
}

export async function deleteRecording(id: string): Promise<void> {
  const res = await fetch(`${RECORDINGS_BASE}/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new SpeedrunHttpError(res.status, await parseErrorBody(res));
  }
}

async function parseErrorBody(res: Response): Promise<SpeedrunErrorBody> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as SpeedrunErrorBody;
  } catch {
    return { error: text };
  }
}
