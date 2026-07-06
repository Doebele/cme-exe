import { useEffect, useRef, useState } from "react";
import { useOracle } from "../hooks/useOracle";
import type { QAPair } from "../hooks/useOracle";
import TerminalWindow from "../components/oracle/TerminalWindow";

const EXAMPLE_PROMPTS = [
  "What is computational design?",
  "How does AI change creativity?",
  "Why does simplicity matter?",
  "What is the difference between UX and AX?",
  "Can a machine have taste?",
];

export default function OracleSection() {
  const { history, status, partialAnswer, error, ask, reset } = useOracle();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  const isBusy = status === "thinking" || status === "streaming";
  const isLive = status === "streaming";
  const showHistory = history.length > 0 || error !== null;

  // Keep the terminal's internal history scrolled to the latest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length, partialAnswer, status, error]);

  // Scroll the page itself so the streaming answer stays in view. The
  // terminal's internal scroll alone is not enough — long answers overflow
  // the section and the visitor may never see them otherwise.
  useEffect(() => {
    if (status !== "streaming" && status !== "thinking") return;
    const section = sectionRef.current;
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const viewportH = window.innerHeight;
    // If the section's bottom is well below the viewport, scroll it up.
    if (rect.bottom > viewportH - 16) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [partialAnswer, status]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    setInput("");
    void ask(trimmed);
  };

  const onExample = (prompt: string) => {
    if (isBusy) return;
    void ask(prompt);
  };

  const renderAnswer = (entry: QAPair, isLast: boolean) => {
    const streaming = isLast && isBusy;
    if (streaming) {
      if (status === "thinking" && partialAnswer === "") {
        return <span className="oracle-thinking">▒▒▒</span>;
      }
      return (
        <>
          {partialAnswer}
          <span className="oracle-caret" aria-hidden>
            ▋
          </span>
        </>
      );
    }
    return entry.answer || <span className="oracle-empty">(no answer)</span>;
  };

  return (
    <section
      id="oracle"
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center px-4 md:px-6 py-20"
    >
      <header className="text-center mb-6 md:mb-8">
        <p className="font-display text-xs uppercase tracking-[0.3em] text-text-secondary">
          THE MACHINE // ORACLE
        </p>
        <h2 className="font-display text-[clamp(1.8rem,5vw,3.5rem)] leading-none crt-glow mt-2">
          ASK THE MACHINE
        </h2>
      </header>

      <div className="w-full max-w-[820px]">
        <TerminalWindow
          title="THE MACHINE"
          live={isLive}
          footer={
            <form className="oracle-input-row" onSubmit={submit}>
              <span className="oracle-prompt" aria-hidden>
                &gt;
              </span>
              <input
                type="text"
                className="oracle-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isBusy}
                placeholder={isBusy ? "the machine is thinking…" : "ask the machine…"}
                aria-label="Ask the machine"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="submit"
                className="oracle-send"
                disabled={isBusy || !input.trim()}
              >
                {isBusy ? "…" : "send"}
              </button>
            </form>
          }
        >
          <div ref={scrollRef} className="oracle-history">
            {!showHistory && (
              <div className="oracle-welcome">
                <p className="oracle-welcome__line">
                  Ask the Machine about design, technology, or the spaces
                  between.
                </p>
                <div className="oracle-chips">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="oracle-chip"
                      onClick={() => onExample(prompt)}
                      disabled={isBusy}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {history.map((entry, i) => {
              const isLast = i === history.length - 1;
              return (
                <div
                  key={entry.id}
                  className={`oracle-qa${isLast ? " oracle-qa--last" : " oracle-qa--past"}`}
                >
                  <p className="oracle-question">
                    <span className="oracle-prompt" aria-hidden>
                      &gt;
                    </span>
                    <span>{entry.question}</span>
                  </p>
                  <p className="oracle-answer">{renderAnswer(entry, isLast)}</p>
                </div>
              );
            })}

            {error && (
              <div className="oracle-error">
                <span>⚠ {error}</span>
                <button type="button" className="oracle-error__retry" onClick={reset}>
                  clear
                </button>
              </div>
            )}
          </div>
        </TerminalWindow>

        <p className="oracle-disclaimer">
          THE MACHINE is a persona, not Claus. Curated responses within design ×
          tech × business scope.
        </p>
      </div>
    </section>
  );
}
