/**
 * Speedrun-Agent engine — pure module (no Express).
 *
 * Implements the run lifecycle, page-state builder, Observer + Curator Claude
 * calls, and run persistence described in docs/speedrun-contract.md (sections
 * 3, 5, 6, 7, 11). All HTTP concerns live in routes/speedrun.js.
 */
import { randomUUID } from "crypto";
import { join } from "path";
import { readJson, writeJson, LAB_FACTS_FILE, PERSONAS_FILE, RUNS_DIR } from "./storage.js";
import { callClaude } from "./claude.js";
import { fetchAndExtract, UrlValidationError, BlockedError, FetchTimeoutError, TooLargeError, FetchError, RateLimitError, hostnameForLog } from "./urlFetcher.js";

// ---- Constants --------------------------------------------------------

/** Runs are deleted after this TTL (24h). */
export const RUN_TTL_MS = 24 * 60 * 60 * 1000;

/** Section ids exposed to the agent — matches contract section 5. */
export const AVAILABLE_SECTIONS = ["hero", "about", "works", "career", "skills"];

/** Hard cap for MVP: backend forces `done` at this step (no Claude call). */
const HARD_STEP_CAP = 13;

/** First step at which the "Consider wrapping up soon." hint is injected. */
const WRAPUP_HINT_STEP = 8;

/** Approximate token budget per Observer turn. */
const OBSERVER_MAX_TOKENS = 512;
/** Approximate token budget for the Curator manifest. */
const CURATOR_MAX_TOKENS = 1024;

/**
 * Canonical career slugs, keyed by entry year. The contract (section 5) lists
 * these exact ids and the lab-facts career array is ordered chronologically,
 * so year is a stable key. Keep in sync with data/lab-facts.json.
 */
const CAREER_SLUGS_BY_YEAR = {
  "1995": "freelance-1995",
  "1996": "eclat",
  "2000": "metadesign",
  "2001": "nose",
  "2008": "namics",
  "2019": "ubs-design-systems",
  "2024": "ubs-lead",
};

// ---- Lab facts cache --------------------------------------------------

let _labFacts = null;
let _labFactsLoadedAt = 0;
const LAB_FACTS_TTL_MS = 60_000;

/**
 * Load lab-facts.json with a short in-memory TTL so the agent never re-reads
 * the file on every step but still picks up edits without a restart.
 * @returns {Promise<object>}
 */
async function getLabFacts() {
  const now = Date.now();
  if (_labFacts && now - _labFactsLoadedAt < LAB_FACTS_TTL_MS) return _labFacts;
  const data = await readJson(LAB_FACTS_FILE);
  if (!data) throw new Error("lab-facts.json missing or invalid");
  _labFacts = data;
  _labFactsLoadedAt = now;
  return data;
}

/**
 * Slug for a career entry. Prefer the curated map; fall back to year+company
 * slugification so newly added entries still get a stable, readable id.
 * @param {{year:string, title:string, company:string}} entry
 * @returns {string}
 */
function careerSlug(entry) {
  const mapped = CAREER_SLUGS_BY_YEAR[String(entry.year).trim()];
  if (mapped) return mapped;
  const slug = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const companyFirst = (entry.company || "").split(/[,(]/)[0].trim();
  return `${slug(entry.year)}-${slug(companyFirst) || "role"}`;
}

/**
 * Build the `availableItems` index from lab-facts.
 * @param {object} facts
 * @returns {{works:string[], career:string[], skills:string[]}}
 */
function buildAvailableItems(facts) {
  return {
    works: (facts.works || []).map((w) => w.id),
    career: (facts.career || []).map(careerSlug),
    skills: (facts.skills || []).map((s) => s.name),
  };
}

/**
 * Resolve the human-readable details for the current item, if any.
 * @param {object} facts
 * @param {string} section
 * @param {string|null|undefined} item
 * @returns {object|null}
 */
function lookupItemDetails(facts, section, item) {
  if (!item) return null;
  if (section === "works") {
    const w = (facts.works || []).find((x) => x.id === item);
    if (!w) return null;
    return {
      title: w.title,
      category: w.category,
      year: String(w.year),
      description: w.description,
    };
  }
  if (section === "career") {
    const c = (facts.career || []).find((x) => careerSlug(x) === item);
    if (!c) return null;
    return {
      title: c.title,
      category: c.company,
      year: String(c.year),
      description: c.details,
    };
  }
  if (section === "skills") {
    const s = (facts.skills || []).find((x) => x.name === item);
    if (!s) return null;
    return {
      title: s.name,
      category: "Skill",
      year: null,
      description: `Proficiency: ${s.level}/100`,
    };
  }
  return null;
}

/**
 * Build the visited + step scaffolding shared by both run kinds. The kind-
 * specific section/item index is layered on by the caller.
 * @param {object} run
 * @returns {{ step:number, currentLocation:{section:string,item:null|string}, visitedThisRun:Array<{section:string,item:null|string}> }}
 */
function buildRunScaffold(run) {
  const last = run.history[run.history.length - 1];
  const step = last ? last.step + 1 : 0;
  const loc = run.currentLocation || { section: "hero", item: null };
  const visited = [{ section: "hero", item: null }];
  const seen = new Set(["hero|"]);
  for (const h of run.history) {
    if (h.action && h.action.type === "navigate") {
      const key = `${h.action.target || ""}|${h.action.item || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        visited.push({ section: h.action.target, item: h.action.item || null });
      }
    }
  }
  return { step, currentLocation: loc, visitedThisRun: visited };
}

/**
 * Build the observer page-state for a URL-Speedrun from its cached
 * externalPageState. Section ids + items come from the extracted content;
 * currentItemDetails is resolved by matching the current location.
 * @param {object} run
 * @returns {object}
 */
function buildUrlPageState(run) {
  const ext = run.externalPageState || { sections: [] };
  const sections = Array.isArray(ext.sections) ? ext.sections : [];
  const availableSections = sections.map((s) => s.id).filter(Boolean);
  const availableItems = {};
  for (const s of sections) {
    availableItems[s.id] = (s.items || []).map((it) => it.id).filter(Boolean);
  }
  const { step, currentLocation, visitedThisRun } = buildRunScaffold(run);

  let currentItemDetails = null;
  const sec = sections.find((s) => s.id === currentLocation.section);
  if (sec) {
    const it = (sec.items || []).find((x) => x.id === currentLocation.item);
    if (it) {
      currentItemDetails = {
        title: it.title,
        category: sec.title || "",
        year: null,
        description: it.description || null,
        href: it.href || null,
      };
    } else if (currentLocation.section === "hero") {
      currentItemDetails = {
        title: ext.subject?.name || ext.title || "",
        category: ext.subject?.role || "",
        year: null,
        description: ext.description || null,
      };
    }
  }
  return {
    step,
    currentLocation: { section: currentLocation.section, item: currentLocation.item ?? null },
    visitedThisRun,
    availableSections,
    availableItems,
    currentItemDetails,
  };
}

/**
 * Build the page-state object sent to the Observer (contract section 5). For
 * url-speedrun runs the section/item index comes from the cached external
 * page-state instead of lab-facts.
 * @param {object} run
 * @returns {Promise<object>}
 */
export async function buildPageState(run) {
  if (run && run.kind === "url-speedrun") {
    return buildUrlPageState(run);
  }
  const facts = await getLabFacts();
  const { step, currentLocation: loc, visitedThisRun: visited } = buildRunScaffold(run);

  return {
    step,
    currentLocation: { section: loc.section, item: loc.item ?? null },
    visitedThisRun: visited,
    availableSections: AVAILABLE_SECTIONS,
    availableItems: buildAvailableItems(facts),
    currentItemDetails: lookupItemDetails(facts, loc.section, loc.item),
  };
}

// ---- Run persistence --------------------------------------------------

function runFile(runId) {
  return join(RUNS_DIR, `${runId}.json`);
}

/**
 * Load a run record. Returns null when missing. Lazily deletes expired runs.
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
export async function getRun(runId) {
  const record = await readJson(runFile(runId));
  if (!record) return null;
  const age = Date.now() - new Date(record.startedAt || record.createdAt || 0).getTime();
  if (Number.isNaN(age) || age > RUN_TTL_MS) {
    try { await import("fs/promises").then((m) => m.unlink(runFile(runId))); } catch { /* gone */ }
    return null;
  }
  return record;
}

/**
 * Persist a run record.
 * @param {object} run
 * @returns {Promise<void>}
 */
async function saveRun(run) {
  await writeJson(runFile(run.id), run);
}

/**
 * Generate a short shareable run id: `r-` + first 12 hex chars of a uuid v4.
 * @returns {string}
 */
function newRunId() {
  return "r-" + randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Sweep and delete all run files older than RUN_TTL_MS. Safe to call on a
 * schedule or opportunistically. Returns the count deleted.
 * @returns {Promise<number>}
 */
export async function deleteExpiredRuns() {
  const { readdir, unlink, stat } = await import("fs/promises");
  let deleted = 0;
  let names = [];
  try {
    names = await readdir(RUNS_DIR);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = join(RUNS_DIR, name);
    try {
      const record = await readJson(file);
      const tsField = record && (record.startedAt || record.createdAt);
      const ts = tsField ? new Date(tsField).getTime() : (await stat(file)).mtimeMs;
      if (now - ts > RUN_TTL_MS) {
        await unlink(file);
        deleted += 1;
      }
    } catch {
      /* leave malformed files alone */
    }
  }
  return deleted;
}

// ---- Observer (agent step) -------------------------------------------

/**
 * Strip ```json fences and surrounding whitespace from a model response.
 * @param {string} text
 * @returns {string}
 */
function stripFences(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * Validate an observer action against the available sections/items.
 * Returns a normalized action or null if the type itself is invalid.
 * Drops unknown items but keeps valid navigates; never throws.
 * @param {any} raw
 * @param {{works:string[],career:string[],skills:string[]}} availableItems
 * @returns {{type:string,target?:string,item?:string|null}|null}
 */
function normalizeAction(raw, availableItems) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").toLowerCase();
  if (type === "done") return { type: "done" };
  if (type === "observe") return { type: "observe" };
  if (type !== "navigate") return null;

  const target = String(raw.target || "").toLowerCase();
  if (!AVAILABLE_SECTIONS.includes(target)) return null;

  const action = { type: "navigate", target };
  let item = raw.item ? String(raw.item) : null;
  if (item) {
    const allowed = availableItems[target] || [];
    if (!allowed.includes(item)) item = null; // drop unknown item, keep navigate
  }
  action.item = item || null;
  return action;
}

/**
 * Call THE OBSERVER to decide the next action. Handles JSON parsing, fence
 * stripping, 1 retry, and a safe fallback. Never throws.
 * @param {{pageState:object, hint?:string|null, visitorApiKey?:string}} opts
 * @returns {Promise<{thought:string, action:object, usage:any, model?:string, latencyMs:number, retried:boolean}>}
 */
async function callObserver({ pageState, hint, visitorApiKey, run }) {
  const personas = await readJson(PERSONAS_FILE);
  const observer = personas?.observer;
  if (!observer?.systemPrompt) {
    throw new Error("Observer persona not configured");
  }
  const contextPreamble = run && run.kind === "url-speedrun"
    ? `You are visiting an external website that the visitor chose: ${run.sourceUrl}. You've never seen it before. Explore what's actually on the page — what does this person, company, or project do? What's interesting, surprising, or noteworthy? Treat each detail as primary material. You are not comparing to anyone; you are simply visiting and observing. Reference the site's own words, headings, and links where useful.`
    : `You are visiting Claus Medvesek's experimental design website.`;
  const sectionList = (pageState.availableSections || []).join("|");
  const systemPrompt =
    contextPreamble +
    "\n\n" +
    observer.systemPrompt +
    "\n\nYou must respond as a single JSON object with this exact shape, and nothing else:\n" +
    '{\n  "thought": "1-2 sentences of inner monologue",\n' +
    '  "action": {\n' +
    '    "type": "navigate" | "observe" | "done",\n' +
    `    "target": "section id (${sectionList || 'hero|about|works|career|skills'})",\n` +
    '    "item": "optional item id within the section"\n' +
    "  }\n}\n" +
    "Respond as JSON only — no prose, no markdown fences.";

  const buildUser = (demandJson) => {
    const parts = [
      "Current page state (JSON):",
      "```json",
      JSON.stringify(pageState, null, 2),
      "```",
      "",
      "Decide your next action. Respond as JSON only, no prose, no markdown fences.",
    ];
    if (hint) parts.push(hint);
    if (demandJson) parts.push("Respond ONLY as valid JSON, no markdown.");
    return parts.join("\n");
  };

  const availableItems = pageState.availableItems || { works: [], career: [], skills: [] };
  const start = Date.now();
  let lastUsage = null;
  let lastModel = undefined;
  let retried = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callClaude({
        systemPrompt,
        messages: [{ role: "user", content: buildUser(attempt === 1) }],
        maxTokens: OBSERVER_MAX_TOKENS,
        visitorApiKey,
      });
      lastUsage = result.usage || null;
      lastModel = result.model;
      const cleaned = stripFences(result.text);
      const parsed = JSON.parse(cleaned);
      const action = normalizeAction(parsed.action, availableItems);
      if (action && typeof parsed.thought === "string") {
        return {
          thought: parsed.thought.trim() || "(observing)",
          action,
          usage: lastUsage,
          model: lastModel,
          latencyMs: Date.now() - start,
          retried: attempt > 0,
        };
      }
    } catch {
      // fall through to retry / fallback
    }
    retried = true;
  }

  // Safe fallback per contract section 6.
  return {
    thought: "(observer paused)",
    action: { type: "observe" },
    usage: lastUsage,
    model: lastModel,
    latencyMs: Date.now() - start,
    retried,
  };
}

// ---- Curator (manifest) ----------------------------------------------

/**
 * Call THE CURATOR to write the final manifest from the observer's thoughts.
 * @param {{history:Array, visitorApiKey?:string}} opts
 * @returns {Promise<{manifest:string, usage:any, model?:string, latencyMs:number}>}
 */
async function callCurator({ history, visitorApiKey, run }) {
  const personas = await readJson(PERSONAS_FILE);
  const curator = personas?.curator;
  if (!curator?.systemPrompt) {
    throw new Error("Curator persona not configured");
  }
  const thoughts = history
    .filter((h) => h && typeof h.thought === "string" && h.thought.trim())
    .map((h) => `- ${h.thought.trim()}`)
    .join("\n");
  const isUrl = run && run.kind === "url-speedrun";
  const intro = isUrl
    ? `Here is the observer's chronological inner monologue while visiting: ${run.sourceUrl}. Write the manifest — about the site itself, what it represents, what the observer noticed. Don't reference any other person or site.`
    : "Here is the observer's chronological inner monologue through Claus Medvesek's work. Write the manifest.";
  const userMessage = `${intro}\n\n${thoughts}`;

  const start = Date.now();
  const result = await callClaude({
    systemPrompt: curator.systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: CURATOR_MAX_TOKENS,
    visitorApiKey,
  });
  return {
    manifest: result.text.trim(),
    usage: result.usage || null,
    model: result.model,
    latencyMs: Date.now() - start,
  };
}

// ---- Usage accumulation ----------------------------------------------

/**
 * Add a usage block into the run's cumulative totals.
 * @param {object} run
 * @param {{inputTokens?:number, outputTokens?:number}|null} usage
 */
function accumulateUsage(run, usage) {
  if (!usage) return;
  const input = Number(usage.inputTokens ?? usage.input_tokens ?? 0) || 0;
  const output = Number(usage.outputTokens ?? usage.output_tokens ?? 0) || 0;
  run.usage = run.usage || { inputTokens: 0, outputTokens: 0 };
  run.usage.inputTokens += input;
  run.usage.outputTokens += output;
}

// ---- Public lifecycle -------------------------------------------------

/**
 * Start a new speedrun. Creates a run record at data/runs/{runId}.json and
 * returns the runId plus the initial page state the frontend needs.
 * @param {{visitorApiKey?:string|null}} opts
 * @returns {Promise<{runId:string, initialState:object}>}
 */
export async function startRun({ visitorApiKey = null } = {}) {
  const facts = await getLabFacts();
  const runId = newRunId();
  const now = new Date().toISOString();
  const run = {
    id: runId,
    kind: "speedrun",
    status: "running",
    startedAt: now,
    completedAt: null,
    visitorMode: visitorApiKey ? "full" : "hybrid",
    currentLocation: { section: "hero", item: null },
    history: [],
    manifest: null,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  await saveRun(run);

  const initialState = {
    section: run.currentLocation.section,
    item: run.currentLocation.item,
    availableSections: AVAILABLE_SECTIONS,
    availableItems: buildAvailableItems(facts),
  };
  return { runId, initialState };
}

/**
 * Start a URL-Speedrun: fetch + extract an external URL, build a page-state
 * from the extracted content, and persist a run record with
 * `kind: "url-speedrun"`. Throws urlFetcher error classes on failure; the
 * caller (route) maps them to HTTP responses.
 *
 * @param {{ url:string, visitorApiKey?:string|null, ip?:string }} opts
 * @returns {Promise<{runId:string, initialState:object}>}
 */
export async function startUrlRun({ url, visitorApiKey = null, ip = "" } = {}) {
  if (!url || typeof url !== "string" || !url.trim()) {
    throw new UrlValidationError("url is required");
  }
  const extracted = await fetchAndExtract(url, { ip });

  const runId = newRunId();
  const now = new Date().toISOString();
  const availableSections = (extracted.sections || []).map((s) => s.id);
  const availableItems = {};
  for (const s of extracted.sections || []) {
    availableItems[s.id] = (s.items || []).map((it) => it.id);
  }
  const run = {
    id: runId,
    kind: "url-speedrun",
    sourceUrl: extracted.url,
    sourceHost: hostnameForLog(extracted.url),
    externalPageState: {
      source: "external",
      sourceUrl: extracted.url,
      finalUrl: extracted.finalUrl,
      title: extracted.title,
      description: extracted.description,
      subject: extracted.subject,
      sections: extracted.sections,
      fetchedAt: extracted.fetchedAt,
      contentLengthBytes: extracted.contentLengthBytes,
      isHtml: extracted.isHtml === true,
    },
    status: "running",
    startedAt: now,
    completedAt: null,
    visitorMode: visitorApiKey ? "full" : "hybrid",
    currentLocation: { section: "hero", item: null },
    history: [],
    manifest: null,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  await saveRun(run);

  const initialState = {
    kind: run.kind,
    sourceUrl: run.sourceUrl,
    sourceHost: run.sourceHost,
    section: run.currentLocation.section,
    item: run.currentLocation.item,
    subject: extracted.subject,
    availableSections,
    availableItems,
  };
  return { runId, initialState };
}

/**
 * Advance the run by one step and return the new thought/action. Step 0 is a
 * forced navigate to `about` (no Claude call); step >= HARD_STEP_CAP forces
 * `done`; steps >= WRAPUP_HINT_STEP get a "wrap up soon" hint.
 * @param {{runId:string, visitorApiKey?:string|null}} opts
 * @returns {Promise<{step:number, thought:string, action:object, done:boolean, latencyMs:number}>}
 */
export async function stepRun({ runId, visitorApiKey = null } = {}) {
  const run = await getRun(runId);
  if (!run) return null;
  if (run.status === "complete") return { complete: true, run };

  const nextStep = run.history.length; // 0-based
  const start = Date.now();

  // Step 0: forced navigate to `about`, no Claude call.
  if (nextStep === 0) {
    const thought = run.kind === "url-speedrun"
      ? `Let me start by understanding who this is...`
      : "Let me start by understanding who Claus is...";
    const action = { type: "navigate", target: "about", item: null };
    run.currentLocation = { section: "about", item: null };
    run.history.push({
      step: 0,
      thought,
      action,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      usage: null,
    });
    await saveRun(run);
    return { step: 0, thought, action, done: false, latencyMs: Date.now() - start };
  }

  // Hard cap: force done without calling Claude.
  if (nextStep >= HARD_STEP_CAP) {
    const thought = "I've seen enough. Time to write the manifest.";
    const action = { type: "done" };
    run.history.push({
      step: nextStep,
      thought,
      action,
      timestamp: new Date().toISOString(),
      latencyMs: Date.now() - start,
      usage: null,
    });
    run.status = "complete";
    run.completedAt = new Date().toISOString();
    await saveRun(run);
    return { step: nextStep, thought, action, done: true, latencyMs: Date.now() - start };
  }

  const pageState = await buildPageState(run);
  const hint = nextStep >= WRAPUP_HINT_STEP ? "Consider wrapping up soon." : null;
  const result = await callObserver({ pageState, hint, visitorApiKey, run });

  const action = result.action;
  if (action.type === "navigate") {
    run.currentLocation = { section: action.target, item: action.item ?? null };
  }
  run.history.push({
    step: nextStep,
    thought: result.thought,
    action,
    timestamp: new Date().toISOString(),
    latencyMs: result.latencyMs,
    usage: result.usage
      ? {
          inputTokens: Number(result.usage.input_tokens ?? 0) || 0,
          outputTokens: Number(result.usage.output_tokens ?? 0) || 0,
        }
      : null,
    model: result.model || undefined,
    retried: result.retried || undefined,
  });
  accumulateUsage(run, result.usage);

  const done = action.type === "done";
  if (done) {
    run.status = "complete";
    run.completedAt = new Date().toISOString();
  }
  await saveRun(run);

  return {
    step: nextStep,
    thought: result.thought,
    action,
    done,
    latencyMs: result.latencyMs,
  };
}

/**
 * Generate (or return the cached) manifest for a run via THE CURATOR. Only
 * allowed once the run has at least one step.
 * @param {{runId:string, visitorApiKey?:string|null}} opts
 * @returns {Promise<{manifest:string}|null>} null when the run is missing.
 */
export async function generateManifest({ runId, visitorApiKey = null } = {}) {
  const run = await getRun(runId);
  if (!run) return null;

  if (run.manifest) return { manifest: run.manifest };

  const result = await callCurator({ history: run.history, visitorApiKey, run });
  run.manifest = result.manifest;
  accumulateUsage(run, result.usage);
  run.status = "complete";
  run.completedAt = run.completedAt || new Date().toISOString();
  await saveRun(run);
  return { manifest: run.manifest };
}
