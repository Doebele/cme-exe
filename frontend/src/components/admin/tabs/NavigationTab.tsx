import { useEffect, useMemo, useState } from "react";
import { useSections } from "../../../hooks/useAdminData";
import type { NavSection } from "../AdminShared";
import { ErrorBanner, SaveRow } from "../AdminShared";

function reorder(items: NavSection[], from: number, to: number): NavSection[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next.map((it, i) => ({ ...it, order: i }));
}

export default function NavigationTab() {
  const { data, isLoading, isSaving, error, save } = useSections();
  const [draft, setDraft] = useState<NavSection[] | null>(null);

  // Keep the working copy in sync with server data.
  useEffect(() => {
    if (data) {
      setDraft(
        data
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((it) => ({ ...it })),
      );
    }
  }, [data]);

  const sorted = useMemo(
    () => (draft ?? []).slice().sort((a, b) => a.order - b.order),
    [draft],
  );

  const dirty = useMemo(() => {
    if (!draft || !data) return false;
    const serverSorted = data.slice().sort((a, b) => a.order - b.order);
    if (draft.length !== serverSorted.length) return true;
    return draft.some((d, i) => {
      const s = serverSorted[i];
      if (!s) return true;
      return d.visible !== s.visible || d.order !== s.order;
    });
  }, [draft, data]);

  if (isLoading || !draft) {
    return <p className="admin-loading font-display">Loading navigation…</p>;
  }

  const move = (idx: number, dir: -1 | 1) => {
    setDraft((cur) => (cur ? reorder(cur, idx, idx + dir) : cur));
  };

  const toggle = (id: string) => {
    setDraft((cur) =>
      cur
        ? cur.map((it) =>
            it.id === id ? { ...it, visible: !it.visible } : it,
          )
        : cur,
    );
  };

  const handleSave = () => {
    if (!draft) return;
    void save(draft);
  };

  return (
    <section className="admin-tab">
      <header className="admin-tab__header">
        <h2 className="admin-tab__heading font-display crt-glow">NAVIGATION</h2>
        <p className="admin-tab__lede font-display">
          Reorder with the arrows, toggle to show/hide in the nav.
        </p>
      </header>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <ul className="admin-nav-list">
        {sorted.map((item, idx) => (
          <li key={item.id} className="admin-nav-item">
            <span className="admin-nav-item__grip font-display" aria-hidden>
              ⇅
            </span>
            <label className="admin-nav-item__check">
              <input
                type="checkbox"
                checked={item.visible}
                onChange={() => toggle(item.id)}
              />
              <span className="admin-nav-item__title font-display">
                {item.title}
              </span>
              <span className="admin-nav-item__id font-display">{item.id}</span>
            </label>
            <span className="admin-nav-item__arrows">
              <button
                type="button"
                className="admin-arrow"
                onClick={() => move(idx, -1)}
                disabled={idx === 0 || isSaving}
                aria-label={`Move ${item.title} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className="admin-arrow"
                onClick={() => move(idx, 1)}
                disabled={idx === sorted.length - 1 || isSaving}
                aria-label={`Move ${item.title} down`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>

      <SaveRow
        onSave={handleSave}
        saveLabel="Save navigation"
        isSaving={isSaving}
        dirty={dirty}
        hint="Changes apply on next page load."
      />
    </section>
  );
}
