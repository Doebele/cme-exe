import { useState } from "react";
import { useSketch } from "../hooks/useSketch";
import CodeViewer from "../components/sketch/CodeViewer";
import SketchGallery from "../components/sketch/SketchGallery";
import SketchPreview from "../components/sketch/SketchPreview";

const EXAMPLE_PROMPTS = [
  "A field of particles drifting like leaves in wind.",
  "Concentric circles pulsing to imagined music.",
  "A vector arrow chasing the mouse.",
  "A grid of cells that light up randomly.",
];

const PRESETS = ["Vector", "Geometric", "Particle", "Wave"];

export default function SketchSection() {
  const {
    current,
    gallery,
    status,
    partialCode,
    error,
    generate,
    rerun,
    reset,
    removeFromGallery,
    clearGallery,
    getSketch,
  } = useSketch();

  const [input, setInput] = useState("");
  const [preset, setPreset] = useState<string | null>(null);

  /** Load a gallery sketch's prompt back into the textarea for re-editing. */
  const reusePrompt = (sketchId: string) => {
    const found = getSketch(sketchId);
    if (!found) return;
    setInput(found.prompt);
    setPreset(null);
    const form = document.querySelector("#sketch .sketch-form");
    if (form) (form as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const isGenerating = status === "generating";
  const showPreview = status === "running" && current !== null;
  const showCode = isGenerating || (status === "running" && current !== null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isGenerating) return;
    setInput("");
    void generate(trimmed, preset ?? undefined);
  };

  return (
    <section
      id="sketch"
      className="relative min-h-screen flex flex-col items-center justify-center px-4 md:px-6 py-20"
    >
      <header className="text-center mb-6 md:mb-8">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-text-secondary">
          THE MACHINE // SKETCH
        </p>
        <h2 className="font-display text-[clamp(1.8rem,5vw,3.5rem)] leading-none crt-glow mt-2">
          PROMPT → SKETCH
        </h2>
      </header>

      <div className="w-full max-w-[1100px] sketch-layout">
        {/* Input panel */}
        <div className="sketch-input-panel">
          {status === "idle" && (
            <div className="sketch-welcome">
              <p className="sketch-welcome__line">
                Describe a sketch. The Machine will draw it.
              </p>
              <div className="oracle-chips">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="oracle-chip"
                    onClick={() => setInput(prompt)}
                    disabled={isGenerating}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form className="sketch-form" onSubmit={submit}>
            <textarea
              className="sketch-textarea"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isGenerating}
              placeholder="e.g. a swarm of dots orbiting the cursor…"
              rows={3}
              spellCheck={false}
            />
            <div className="sketch-presets">
              {PRESETS.map((p) => {
                const active = preset === p;
                return (
                  <button
                    key={p}
                    type="button"
                    className={`oracle-chip sketch-preset${active ? " is-active" : ""}`}
                    onClick={() => setPreset(active ? null : p)}
                    disabled={isGenerating}
                    aria-pressed={active}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            <div className="sketch-form__actions">
              <button
                type="submit"
                className="sketch-generate"
                disabled={isGenerating || !input.trim()}
              >
                {isGenerating ? "drawing…" : "▶ generate sketch"}
              </button>
              {status !== "idle" && (
                <button
                  type="button"
                  className="sketch-reset"
                  onClick={reset}
                  disabled={isGenerating}
                >
                  reset
                </button>
              )}
            </div>
          </form>

        </div>

        {/* Preview panel */}
        <div className="sketch-preview-panel">
          {error && (
            <div className="sketch-error" role="alert">
              <span>⚠ {error}</span>
            </div>
          )}

          {showCode && (
            <CodeViewer
              code={current?.code ?? ""}
              partial={partialCode}
              generating={isGenerating}
            />
          )}

          {showPreview && current && <SketchPreview sketch={current} />}

          {status === "idle" && !error && (
            <div className="sketch-placeholder">
              <p>
                Your generated sketch will run here. Describe one on the left to
                begin.
              </p>
            </div>
          )}

          {status === "error" && !showPreview && (
            <div className="sketch-placeholder">
              <p>Nothing to show yet — try another prompt.</p>
            </div>
          )}
        </div>
      </div>

      {gallery.length > 0 && (
        <div className="sketch-gallery-outer">
          <p className="sketch-gallery__heading">Previous sketches</p>
          <SketchGallery
            gallery={gallery}
            currentId={current?.id ?? null}
            onSelect={rerun}
            onRemove={removeFromGallery}
            onReuse={reusePrompt}
            onClearAll={clearGallery}
            disabled={isGenerating}
          />
        </div>
      )}

      <p className="oracle-disclaimer sketch-disclaimer">
        Sketches run in a sandboxed iframe. The Machine writes p5.js from your
        prompt.
      </p>
    </section>
  );
}
