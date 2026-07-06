import type { Sketch } from "../../hooks/useSketch";

interface SketchGalleryProps {
  gallery: Sketch[];
  currentId: string | null;
  onSelect: (sketchId: string) => void;
  onRemove: (sketchId: string) => void;
  /** Load this sketch's prompt back into the input for re-editing. */
  onReuse: (sketchId: string) => void;
  /** Empty the entire gallery. */
  onClearAll: () => void;
  disabled?: boolean;
}

/**
 * Lightweight gallery of previously generated sketches. MVP uses prompt-text
 * cards (timestamped) rather than live mini-iframes to keep the page smooth
 * with up to 20 entries; live thumbnail iframes are a Phase 1b.2 refinement.
 */
export default function SketchGallery({
  gallery,
  currentId,
  onSelect,
  onRemove,
  onReuse,
  onClearAll,
  disabled = false,
}: SketchGalleryProps) {
  if (gallery.length === 0) {
    return (
      <p className="sketch-gallery__empty">
        No sketches yet. Generate one above.
      </p>
    );
  }

  return (
    <div className="sketch-gallery-wrap" role="group" aria-label="Previous sketches">
      <div className="sketch-gallery__header">
        <span className="sketch-gallery__count">
          {gallery.length} / 20
        </span>
        <button
          type="button"
          className="sketch-gallery__clear"
          onClick={onClearAll}
          disabled={disabled || gallery.length === 0}
          title="Clear all sketches"
        >
          Clear all
        </button>
      </div>
      <div className="sketch-gallery" role="list">
        {gallery.map((sketch) => {
          const isActive = sketch.id === currentId;
          return (
            <div
              key={sketch.id}
              role="listitem"
              className={`sketch-gallery__item${isActive ? " is-active" : ""}`}
            >
              <button
                type="button"
                className="sketch-gallery__select"
                onClick={() => onSelect(sketch.id)}
                disabled={disabled}
                title={sketch.prompt}
              >
                <span className="sketch-gallery__prompt">{sketch.prompt}</span>
                <span className="sketch-gallery__meta">
                  {new Date(sketch.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
              <div className="sketch-gallery__actions">
                <button
                  type="button"
                  className="sketch-gallery__action"
                  onClick={() => onReuse(sketch.id)}
                  disabled={disabled}
                  aria-label={`Edit prompt: ${sketch.prompt}`}
                  title="Edit prompt again"
                >
                  ↩
                </button>
                <button
                  type="button"
                  className="sketch-gallery__action sketch-gallery__action--danger"
                  onClick={() => onRemove(sketch.id)}
                  disabled={disabled}
                  aria-label={`Delete sketch: ${sketch.prompt}`}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
