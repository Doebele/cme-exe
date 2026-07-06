export default function Footer() {
  const replayBoot = () => {
    window.dispatchEvent(new CustomEvent("cme-exe:replay-boot"));
  };

  return (
    <footer className="border-t border-text-secondary/15 py-8 mt-8">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4 text-center">
        <div className="flex items-center gap-3">
          <p className="font-display text-xs uppercase tracking-[0.1em] text-text-secondary">
            © 2026 CME.exe — Authored by Claus Medvesek
          </p>
          <button
            type="button"
            onClick={replayBoot}
            title="Replay boot sequence"
            aria-label="Replay boot sequence"
            className="font-display text-[0.6rem] uppercase tracking-[0.15em] text-text-secondary/60 hover:text-text-primary border border-text-secondary/20 hover:border-text-secondary/50 px-2 py-1 transition-colors"
          >
            ⟲ Replay Boot
          </button>
        </div>
        <p className="font-display text-xs text-text-secondary/80">
          <a
            href="https://portfolio.medvesek.com"
            className="hover:text-text-primary transition-colors"
          >
            portfolio.medvesek.com
          </a>
          <span className="mx-2 text-text-secondary/40">·</span>
          <a
            href="https://design.medvesek.com"
            className="hover:text-text-primary transition-colors"
          >
            design.medvesek.com
          </a>
        </p>
      </div>
    </footer>
  );
}
