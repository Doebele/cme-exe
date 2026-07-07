import { useEffect, useMemo, useState } from "react";
import { useDesignQuotes } from "../../../hooks/useAdminData";
import type { DesignQuote } from "../../../types";
import {
  AdminButton,
  AdminCard,
  AdminTextInput,
  AdminTextarea,
  ErrorBanner,
  SaveRow,
} from "../AdminShared";

interface QuoteDraft {
  id: string;
  text: string;
  source: string;
  year: string;
  themes: string;
}

function toDraft(q: DesignQuote): QuoteDraft {
  return {
    id: q.id,
    text: q.text,
    source: q.source,
    year: q.year ? String(q.year) : "",
    themes: "",
  };
}

function emptyDraft(): QuoteDraft {
  return { id: "", text: "", source: "", year: "", themes: "" };
}

function QuoteEditor({
  draft,
  onChange,
  onCancel,
}: {
  draft: QuoteDraft;
  onChange: (d: QuoteDraft) => void;
  onCancel: () => void;
}) {
  return (
    <div className="admin-quote-editor">
      <AdminTextInput
        placeholder="Source (e.g. Dieter Rams)"
        value={draft.source}
        onChange={(e) => onChange({ ...draft, source: e.target.value })}
        className="admin-input--source"
      />
      <AdminTextarea
        placeholder="Quote text"
        value={draft.text}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        rows={3}
      />
      <div className="admin-quote-editor__row">
        <AdminTextInput
          placeholder="Year (optional)"
          value={draft.year}
          onChange={(e) => onChange({ ...draft, year: e.target.value })}
        />
        <AdminTextInput
          placeholder="Themes (comma-separated, optional)"
          value={draft.themes}
          onChange={(e) => onChange({ ...draft, themes: e.target.value })}
        />
      </div>
      <div className="admin-save-row">
        <AdminButton type="submit" variant="accent">
          {draft.id ? "Update quote" : "Add quote"}
        </AdminButton>
        <AdminButton type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </AdminButton>
      </div>
    </div>
  );
}

export default function ContentTab() {
  const { data, isLoading, isSaving, error, save } = useDesignQuotes();
  const [quotes, setQuotes] = useState<DesignQuote[] | null>(null);
  const [editing, setEditing] = useState<QuoteDraft | null>(null);

  useEffect(() => {
    if (data) setQuotes(data.slice());
  }, [data]);

  const dirty = useMemo(() => {
    if (!quotes || !data) return false;
    if (quotes.length !== data.length) return true;
    const byId = new Map(data.map((q) => [q.id, q]));
    return quotes.some((q) => {
      const o = byId.get(q.id);
      return !o || o.text !== q.text || o.source !== q.source || String(o.year ?? "") !== String(q.year ?? "");
    });
  }, [quotes, data]);

  if (isLoading || !quotes) {
    return <p className="admin-loading font-display">Loading content…</p>;
  }

  const startNew = () => {
    setEditing({
      ...emptyDraft(),
      id: `q-${Date.now().toString(36)}`,
    });
  };

  const startEdit = (q: DesignQuote) => {
    setEditing(toDraft(q));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !quotes) return;
    const text = editing.text.trim();
    const source = editing.source.trim();
    if (!text || !source) return;
    const next: DesignQuote = {
      id: editing.id,
      text,
      source,
      year: editing.year.trim() || undefined,
    };
    const exists = quotes.some((q) => q.id === editing.id);
    const list = exists
      ? quotes.map((q) => (q.id === editing.id ? next : q))
      : [...quotes, next];
    setQuotes(list);
    setEditing(null);
  };

  const removeQuote = (id: string) => {
    if (!quotes) return;
    if (!window.confirm("Delete this quote?")) return;
    setQuotes(quotes.filter((q) => q.id !== id));
  };

  const moveQuote = (idx: number, dir: -1 | 1) => {
    if (!quotes) return;
    const to = idx + dir;
    if (to < 0 || to >= quotes.length) return;
    const next = quotes.slice();
    const [m] = next.splice(idx, 1);
    if (m) next.splice(to, 0, m);
    setQuotes(next);
  };

  const handleSave = () => {
    if (!quotes) return;
    void save(quotes);
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">CONTENT</h2>
        <p className="admin-tab__lede font-display">
          Design quotes shown in Designer's Quest when an invader is hit. Add
          voices from across design history — Ive, Rams, Vignelli, Scher, the
          Eameses, and beyond.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <AdminCard
        title="Add a quote"
        actions={
          !editing || editing.id.startsWith("q-") ? null : (
            <AdminButton type="button" variant="ghost" onClick={startNew}>
              + New
            </AdminButton>
          )
        }
      >
        {!editing && (
          <div className="admin-save-row">
            <AdminButton type="button" variant="accent" onClick={startNew}>
              + Add quote
            </AdminButton>
          </div>
        )}
        {editing && (
          <form onSubmit={handleSubmit}>
            <QuoteEditor
              draft={editing}
              onChange={setEditing}
              onCancel={() => setEditing(null)}
            />
          </form>
        )}
      </AdminCard>

      <AdminCard title={`All quotes (${quotes.length})`}>
        <ul className="admin-quote-list">
          {quotes.map((q, idx) => (
            <li key={q.id} className="admin-quote-item">
              <div className="admin-quote-item__body">
                <p className="admin-quote-item__text font-display">"{q.text}"</p>
                <p className="admin-quote-item__meta font-display">
                  — {q.source}
                  {q.year ? ` (${q.year})` : ""}
                </p>
              </div>
              <div className="admin-quote-item__actions">
                <button
                  type="button"
                  className="admin-arrow"
                  onClick={() => moveQuote(idx, -1)}
                  disabled={idx === 0 || isSaving}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="admin-arrow"
                  onClick={() => moveQuote(idx, 1)}
                  disabled={idx === quotes.length - 1 || isSaving}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="admin-arrow"
                  onClick={() => startEdit(q)}
                  disabled={isSaving}
                  aria-label="Edit"
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="admin-arrow admin-arrow--danger"
                  onClick={() => removeQuote(q.id)}
                  disabled={isSaving}
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {quotes.length === 0 && (
            <li className="admin-hint font-display">
              No quotes yet — add one above.
            </li>
          )}
        </ul>
      </AdminCard>

      <SaveRow
        onSave={handleSave}
        saveLabel="Save quotes"
        isSaving={isSaving}
        dirty={dirty}
        hint="Changes apply on next page load."
      />
    </section>
  );
}
