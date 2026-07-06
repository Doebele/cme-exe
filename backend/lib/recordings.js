/**
 * Recordings library — permanent, admin-curated Speedrun sessions.
 *
 * A "recording" is a completed run-state (history + manifest + page-state)
 * that has been promoted from the ephemeral `runs/` directory into the
 * permanent `recordings/` directory by an admin. The frontend replays them
 * in Hybrid mode (when no visitor API key is set) so that:
 *
 *   - Cost stays bounded: thousands of visitors can replay the same recording
 *     without spending a single Claude token.
 *   - Latency stays low: the recording is on disk, no LLM round-trip.
 *   - Quality stays high: only the best runs get promoted to "featured".
 *
 * Storage:
 *   data/recordings/
 *     ├─ index.json     — { version, recordings: RecordingMeta[] }
 *     └─ {id}.json      — full recording record (history, manifest, etc.)
 *
 * RecordingMeta (in index.json):
 *   { id, kind, sourceKind, sourceUrl?, title, recordedAt, featured }
 */

import { readJson, writeJson, RECORDINGS_DIR, RECORDINGS_INDEX_FILE } from "./storage.js";
import { join } from "path";

/**
 * List all recordings (metadata only — not full history).
 * Optional filter for "featured" only.
 * @param {{ featuredOnly?: boolean }} [opts]
 * @returns {Promise<RecordingMeta[]>}
 */
export async function listRecordings(opts = {}) {
  const index = await readJson(RECORDINGS_INDEX_FILE);
  const recordings = (index && Array.isArray(index.recordings)) ? index.recordings : [];
  if (opts.featuredOnly) return recordings.filter((r) => r.featured);
  return recordings;
}

/**
 * Fetch a single recording by id (full record incl. history).
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function getRecording(id) {
  if (!/^rec-[a-z0-9]{12}$/.test(id)) return null;
  return readJson(join(RECORDINGS_DIR, `${id}.json`));
}

/**
 * Pick the best recording to play in Hybrid mode. Prefers featured recordings
 * of the requested source kind (claus/url). Falls back to any recording of
 * that kind, then any recording at all. Random selection among equals so
 * different visitors see different runs over time.
 *
 * @param {{ sourceKind?: "claus" | "url" }} [opts]
 * @returns {Promise<object | null>} — the full recording record, or null.
 */
export async function pickHybridRecording(opts = {}) {
  const all = await listRecordings();
  if (all.length === 0) return null;

  const wantedKind = opts.sourceKind;
  const featuredOfKind = all.filter(
    (r) => r.featured && (!wantedKind || r.sourceKind === wantedKind),
  );
  const pool = featuredOfKind.length > 0
    ? featuredOfKind
    : all.filter((r) => !wantedKind || r.sourceKind === wantedKind);
  const finalPool = pool.length > 0 ? pool : all;
  const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
  if (!pick) return null;
  return getRecording(pick.id);
}

/**
 * Promote an ephemeral run into a permanent recording.
 * @param {object} runRecord — full run record from data/runs/{id}.json
 * @param {{ title?: string, featured?: boolean }} [meta]
 * @returns {Promise<object>} the new recording's metadata
 */
export async function promoteRunToRecording(runRecord, meta = {}) {
  if (!runRecord || !runRecord.id) throw new Error("Invalid run record");
  // Generate a recording id (rec-{12 chars}).
  const recId = "rec-" + Math.random().toString(36).slice(2, 14);
  const recordedAt = new Date().toISOString();

  // Build the full recording record. We persist everything from the run.
  const recording = {
    id: recId,
    kind: "recording",
    sourceKind: runRecord.kind === "url-speedrun" ? "url" : "claus",
    sourceRunId: runRecord.id,
    sourceUrl: runRecord.sourceUrl || null,
    subject: runRecord.subject || null,
    sections: runRecord.sections || runRecord.externalPageState?.sections || null,
    history: runRecord.history || [],
    manifest: runRecord.manifest || null,
    status: runRecord.status || "complete",
    recordedAt,
  };

  await writeJson(join(RECORDINGS_DIR, `${recId}.json`), recording);

  // Update index with the metadata entry.
  const index = (await readJson(RECORDINGS_INDEX_FILE)) || { version: "0.1.0", recordings: [] };
  const metaEntry = {
    id: recId,
    kind: recording.kind,
    sourceKind: recording.sourceKind,
    sourceUrl: recording.sourceUrl,
    title: meta.title || defaultTitleFor(recording),
    recordedAt,
    featured: !!meta.featured,
    historyLength: recording.history.length,
  };
  index.recordings = [metaEntry, ...index.recordings];
  await writeJson(RECORDINGS_INDEX_FILE, index);
  return metaEntry;
}

/**
 * Update a recording's metadata (title, featured flag).
 * @param {string} id
 * @param {{ title?: string, featured?: boolean }} patch
 * @returns {Promise<object | null>} updated metadata entry
 */
export async function updateRecordingMeta(id, patch) {
  if (!/^rec-[a-z0-9]{12}$/.test(id)) return null;
  const index = (await readJson(RECORDINGS_INDEX_FILE)) || { version: "0.1.0", recordings: [] };
  const entry = index.recordings.find((r) => r.id === id);
  if (!entry) return null;
  if (typeof patch.title === "string") entry.title = patch.title;
  if (typeof patch.featured === "boolean") entry.featured = patch.featured;
  await writeJson(RECORDINGS_INDEX_FILE, index);
  return entry;
}

/**
 * Permanently delete a recording (metadata + full record file).
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteRecording(id) {
  if (!/^rec-[a-z0-9]{12}$/.test(id)) return false;
  const index = (await readJson(RECORDINGS_INDEX_FILE)) || { version: "0.1.0", recordings: [] };
  const before = index.recordings.length;
  index.recordings = index.recordings.filter((r) => r.id !== id);
  if (index.recordings.length === before) return false;
  await writeJson(RECORDINGS_INDEX_FILE, index);
  try {
    const { unlink } = await import("fs/promises");
    await unlink(join(RECORDINGS_DIR, `${id}.json`));
  } catch {
    /* file may already be gone */
  }
  return true;
}

function defaultTitleFor(recording) {
  const subject = recording.subject;
  if (subject && subject.name) {
    return subject.name + (recording.sourceKind === "url" ? " (URL)" : "");
  }
  if (recording.sourceUrl) return recording.sourceUrl;
  return "Untitled recording";
}
