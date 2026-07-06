import { useEffect, useState } from "react";

/**
 * Boot section — landing hero that explains the boot sequence and lets the
 * visitor replay it (and the modem handshake) without needing to scroll to the
 * footer. The actual overlay is rendered once on first visit, or via the
 * "⟲ Replay Boot" button in the footer / nav.
 *
 * This section is shown when the visitor navigates to #boot directly (e.g.
 * via the BOOT link in the nav). It is NOT the overlay itself.
 */
export default function BootSection() {
  const [soundOn, setSoundOn] = useState(false);

  // Read sound preference from localStorage to reflect toggle state.
  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem("cme_exe_sound_enabled") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const replay = () => {
    window.dispatchEvent(new CustomEvent("cme-exe:replay-boot"));
  };

  return (
    <section
      id="boot"
      className="relative min-h-screen flex flex-col items-center justify-center px-6 text-center"
    >
      <p
        className="font-display text-xs uppercase tracking-[0.3em] mb-6"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Combo α+ // The Machine as Co-Author
      </p>
      <h1
        className="font-display text-[clamp(2.5rem,9vw,7rem)] leading-none crt-glow"
        style={{ color: "var(--color-text-primary)" }}
      >
        CME.exe // BOOT
      </h1>

      <div
        className="mt-8 max-w-xl font-display text-sm leading-relaxed"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <p>
          Every session begins with a 56k modem handshake — a 5-second ritual
          that links the agent era to the dial-up era. The BIOS lines appear in
          sync with the sound: pickup, ring, 2100 Hz answer tone, training
          bursts, the final <em>CONNECT 56000</em>.
        </p>
        <p className="mt-3 text-xs uppercase tracking-[0.15em] opacity-70">
          Sound is currently {soundOn ? "ON" : "OFF"} · Toggle in the nav to
          hear the handshake
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={replay}
          className="font-display text-xs uppercase tracking-[0.2em] px-5 py-2.5 border"
          style={{
            borderColor: "var(--color-accent)",
            color: "var(--color-accent)",
          }}
        >
          ▶ Replay boot sequence
        </button>
        <a
          href="#observer"
          className="font-display text-xs uppercase tracking-[0.2em] px-5 py-2.5 border"
          style={{
            borderColor:
              "color-mix(in srgb, var(--color-text-secondary) 40%, transparent)",
            color: "var(--color-text-secondary)",
          }}
        >
          Skip to speedrun →
        </a>
      </div>

      <p
        className="mt-12 font-display text-[0.6rem] uppercase tracking-[0.2em] opacity-50"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Phase 1c complete · Boot + Oracle + Speedrun + Sketch + Quest live
      </p>
    </section>
  );
}
