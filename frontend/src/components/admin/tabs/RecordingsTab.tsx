import { useCallback, useEffect, useState } from "react";
import {
  deleteRecording,
  listRecordings,
  promoteRecording,
  updateRecording,
} from "../../../lib/speedrunApi";
import type {
  RecordingMeta,
  RecordingPromoteBody,
} from "../../../lib/speedrunApi";
import {
  AdminButton,
  AdminCard,
  AdminTextInput,
  CheckboxField,
  ErrorBanner,
} from "../AdminShared";

const RUN_ID_RE = /^r-[a-z0-9]{12}$/;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function RecordingsTab() {
  const [recordings, setRecordings] = useState<RecordingMeta[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Promote form
  const [runIdInput, setRunIdInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [featuredInput, setFeaturedInput] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promoteSuccess, setPromoteSuccess] = useState<string | null>(null);

  const runIdValid = RUN_ID_RE.test(runIdInput.trim());

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await listRecordings();
      setRecordings(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load recordings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePromote = async () => {
    const runId = runIdInput.trim();
    if (!RUN_ID_RE.test(runId)) return;
    setPromoting(true);
    setPromoteError(null);
    setPromoteSuccess(null);
    const body: RecordingPromoteBody = { runId };
    if (titleInput.trim()) body.title = titleInput.trim();
    body.featured = featuredInput;
    try {
      const meta = await promoteRecording(body);
      await refresh();
      setRunIdInput("");
      setTitleInput("");
      setFeaturedInput(false);
      setPromoteSuccess(`Promoted as "${meta.title}".`);
    } catch (err) {
      setPromoteError(err instanceof Error ? err.message : "Promotion failed");
    } finally {
      setPromoting(false);
    }
  };

  const handleFeatureToggle = async (rec: RecordingMeta) => {
    try {
      await updateRecording(rec.id, { featured: !rec.featured });
      await refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Update failed");
    }
  };

  const handleDelete = async (rec: RecordingMeta) => {
    try {
      await deleteRecording(rec.id);
      await refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">RECORDINGS</h2>
        <p className="admin-tab__lede font-display">
          Pre-recorded speedrun sessions. In Hybrid mode (visitor without API
          key), a random featured recording plays instead of a live Claude run —
          saving tokens while keeping the experience alive.
        </p>
      </header>

      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}

      {/* Promote form */}
      <AdminCard title="Promote a run">
        <div className="admin-provider">
          <div className="admin-field-row">
            <label className="admin-field-row__label font-display" htmlFor="rec-run-id">
              Run ID
            </label>
            <div className="admin-field-row__control">
              <AdminTextInput
                id="rec-run-id"
                type="text"
                value={runIdInput}
                onChange={(e) => setRunIdInput(e.target.value)}
                disabled={promoting}
                placeholder="r-xxxxxxxxxxxx"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <p className="admin-field-row__hint">
              Get this from a completed run&rsquo;s share URL or the speedrun
              section&rsquo;s footer (&ldquo;r-xxx &middot; step N&rdquo; line).
            </p>
          </div>

          <div className="admin-field-row">
            <label className="admin-field-row__label font-display" htmlFor="rec-title">
              Title
            </label>
            <div className="admin-field-row__control">
              <AdminTextInput
                id="rec-title"
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                disabled={promoting}
                placeholder="Optional title for the recording"
              />
            </div>
          </div>

          <CheckboxField
            label="Show in random Hybrid-mode rotation (featured)"
            checked={featuredInput}
            onChange={setFeaturedInput}
            disabled={promoting}
          />

          {promoteError && <ErrorBanner>{promoteError}</ErrorBanner>}
          {promoteSuccess && (
            <p
              className="admin-meta font-display"
              style={{ color: "var(--color-accent)" }}
            >
              {promoteSuccess}
            </p>
          )}

          <div className="admin-save-row">
            <AdminButton
              type="button"
              variant="accent"
              onClick={handlePromote}
              disabled={promoting || !runIdValid}
            >
              {promoting ? "Promoting…" : "Promote to recording"}
            </AdminButton>
            {!runIdValid && runIdInput.length > 0 && (
              <span className="admin-hint font-display">
                Must match r-[12 chars]
              </span>
            )}
          </div>
        </div>
      </AdminCard>

      {/* Recordings list */}
      <AdminCard
        title={`Existing recordings${recordings ? ` (${recordings.length})` : ""}`}
      >
        {isLoading ? (
          <p className="admin-loading font-display">Loading recordings…</p>
        ) : !recordings || recordings.length === 0 ? (
          <p className="admin-meta font-display">No recordings yet.</p>
        ) : (
          <ul className="admin-recording-list">
            {recordings.map((rec) => (
              <RecordingRow
                key={rec.id}
                rec={rec}
                onFeatureToggle={() => void handleFeatureToggle(rec)}
                onDelete={() => void handleDelete(rec)}
                onTitleSave={async (title) => {
                  try {
                    await updateRecording(rec.id, { title });
                    await refresh();
                  } catch (err) {
                    setLoadError(err instanceof Error ? err.message : "Update failed");
                  }
                }}
              />
            ))}
          </ul>
        )}
      </AdminCard>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Single recording row — supports inline title edit, feature toggle, delete.
// ---------------------------------------------------------------------------

interface RecordingRowProps {
  rec: RecordingMeta;
  onFeatureToggle: () => void;
  onDelete: () => void;
  onTitleSave: (title: string) => Promise<void>;
}

function RecordingRow({
  rec,
  onFeatureToggle,
  onDelete,
  onTitleSave,
}: RecordingRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(rec.title);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const startEdit = () => {
    setDraftTitle(rec.title);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftTitle(rec.title);
  };

  const saveTitle = async () => {
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === rec.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onTitleSave(trimmed);
    setSaving(false);
    setEditing(false);
  };

  const sourceLabel =
    rec.sourceKind === "url" ? "URL RECORDING" : "PRE-RECORDED";

  return (
    <li className="admin-recording">
      <div className="admin-recording__head">
        {editing ? (
          <div className="admin-recording__edit">
            <AdminTextInput
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              disabled={saving}
              autoFocus
            />
            <AdminButton
              type="button"
              variant="accent"
              onClick={saveTitle}
              disabled={saving || !draftTitle.trim()}
            >
              {saving ? "…" : "Save"}
            </AdminButton>
            <AdminButton
              type="button"
              variant="ghost"
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancel
            </AdminButton>
          </div>
        ) : (
          <>
            <span className="admin-recording__star" aria-hidden>
              {rec.featured ? "★" : ""}
            </span>
            <span className="admin-recording__title font-display">
              {rec.title}
            </span>
            <span
              className={`admin-recording__badge ${rec.featured ? "is-featured" : ""}`}
            >
              {sourceLabel}
            </span>
          </>
        )}
      </div>

      <p className="admin-recording__meta font-display">
        {rec.id} · {rec.historyLength} step{rec.historyLength === 1 ? "" : "s"} ·
        {" "}recorded {formatDate(rec.recordedAt)}
        {rec.sourceUrl ? ` · ${rec.sourceUrl}` : ""}
      </p>

      <div className="admin-recording__actions">
        {!editing && (
          <>
            <AdminButton type="button" variant="ghost" onClick={startEdit}>
              Edit title
            </AdminButton>
            <AdminButton
              type="button"
              variant={rec.featured ? "ghost" : "accent"}
              onClick={onFeatureToggle}
            >
              {rec.featured ? "Unfeature" : "★ Feature"}
            </AdminButton>
            {!confirmingDelete ? (
              <AdminButton
                type="button"
                variant="danger"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </AdminButton>
            ) : (
              <>
                <AdminButton
                  type="button"
                  variant="danger"
                  onClick={onDelete}
                >
                  Confirm delete
                </AdminButton>
                <AdminButton
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </AdminButton>
              </>
            )}
          </>
        )}
      </div>
    </li>
  );
}
