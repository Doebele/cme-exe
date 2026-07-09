import { useEffect, useState } from "react";
import Navigation from "./components/Navigation";
import Footer from "./components/Footer";
import BootSection from "./sections/BootSection";
import OracleSection from "./sections/OracleSection";
import SpeedrunSection from "./sections/SpeedrunSection";
import SketchSection from "./sections/SketchSection";
import QuestSection from "./sections/QuestSection";
import BootSequence from "./components/BootSequence";

type BootMode = "always" | "first-visit" | "off";

interface SettingsBehavior {
  behavior?: { bootMode?: BootMode };
}

const BOOTED_KEY = "cme_exe_booted";

// Module-scope cache so the boot-mode probe runs at most once per session.
let cachedBootMode: BootMode | null = null;
let bootModePromise: Promise<BootMode> | null = null;
// Guard: ensures the boot-mode effect fires at most once even under StrictMode.
let bootModeResolved = false;

function fetchBootMode(): Promise<BootMode> {
  if (cachedBootMode) return Promise.resolve(cachedBootMode);
  if (bootModePromise) return bootModePromise;
  bootModePromise = fetch("/api/content/settings")
    .then((r) => (r.ok ? r.json() : null))
    .then((data: SettingsBehavior | null) => {
      const mode = data?.behavior?.bootMode ?? "first-visit";
      cachedBootMode = mode;
      return mode;
    })
    .catch(() => {
      cachedBootMode = "first-visit";
      return cachedBootMode;
    });
  return bootModePromise;
}

function shouldBootInitially(mode: BootMode): boolean {
  if (mode === "off") return false;
  if (mode === "always") return true;
  try {
    return localStorage.getItem(BOOTED_KEY) !== "1";
  } catch {
    return true;
  }
}

export default function Lab() {
  const [booting, setBooting] = useState<boolean>(false);

  // Resolve initial boot state from settings. Uses a module-level guard so
  // StrictMode's double-invoke is harmless — booting is set at most once.
  useEffect(() => {
    if (bootModeResolved) return;
    bootModeResolved = true;
    void fetchBootMode().then((mode) => {
      if (shouldBootInitially(mode)) setBooting(true);
    });
  }, []);

  // Replay button (in Footer) dispatches a custom event to re-trigger boot
  // regardless of the cme_exe_booted flag.
  useEffect(() => {
    const onReplay = () => setBooting(true);
    window.addEventListener("cme-exe:replay-boot", onReplay);
    return () => window.removeEventListener("cme-exe:replay-boot", onReplay);
  }, []);



  // On load and on hash change, smooth-scroll to the matching section.
  // Hashes may carry a sub-path (e.g. #observer/r-abc123) — we scroll to the
  // section id (first segment) and let the owning section read any extra params.
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash;
      if (!hash) return;
      const sectionSlug = hash.slice(1).split("/")[0];
      if (!sectionSlug) return;
      const el = document.getElementById(sectionSlug);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    };
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {booting && <BootSequence onDone={() => setBooting(false)} />}
      <Navigation />
      <main className="flex-1">
        <BootSection />
        <SpeedrunSection />
        <OracleSection />
        <SketchSection />
        <QuestSection />
      </main>
      <Footer />
    </div>
  );
}
