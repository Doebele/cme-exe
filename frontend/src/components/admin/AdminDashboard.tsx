import { useState } from "react";
import { Link } from "react-router-dom";
import ApiProvidersTab from "./tabs/ApiProvidersTab";
import NavigationTab from "./tabs/NavigationTab";
import ThemeTab from "./tabs/ThemeTab";
import AudioTab from "./tabs/AudioTab";
import BehaviorTab from "./tabs/BehaviorTab";
import PersonasTab from "./tabs/PersonasTab";
import RecordingsTab from "./tabs/RecordingsTab";
import ContentTab from "./tabs/ContentTab";
import AnalyticsTab from "./tabs/AnalyticsTab";

export type AdminTabId =
  | "providers"
  | "navigation"
  | "theme"
  | "audio"
  | "behavior"
  | "personas"
  | "recordings"
  | "content"
  | "analytics";

interface TabDef {
  id: AdminTabId;
  label: string;
}

const TABS: TabDef[] = [
  { id: "providers", label: "AI Providers" },
  { id: "navigation", label: "Navigation" },
  { id: "theme", label: "Theme" },
  { id: "audio", label: "Audio" },
  { id: "behavior", label: "Behavior" },
  { id: "personas", label: "Personas" },
  { id: "recordings", label: "Recordings" },
  { id: "content", label: "Content" },
  { id: "analytics", label: "Analytics" },
];

export interface AdminDashboardProps {
  onLogout: () => Promise<void>;
}

export default function AdminDashboard({ onLogout }: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTabId>("providers");
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await onLogout();
  };

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar__inner">
          <p className="font-display admin-topbar__brand crt-glow">
            CME.exe // Admin
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="admin-btn admin-btn--ghost font-display"
          >
            {loggingOut ? "…" : "Logout"}
          </button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        <div className="admin-tabs__inner">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id}
              className={`admin-tab font-display ${tab === t.id ? "is-active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="admin-main">
        <div className="admin-main__inner">
          {tab === "providers" && <ApiProvidersTab />}
          {tab === "navigation" && <NavigationTab />}
          {tab === "theme" && <ThemeTab />}
          {tab === "audio" && <AudioTab />}
          {tab === "behavior" && <BehaviorTab />}
          {tab === "personas" && <PersonasTab />}
          {tab === "recordings" && <RecordingsTab />}
          {tab === "content" && <ContentTab />}
          {tab === "analytics" && <AnalyticsTab />}
        </div>
      </main>

      <footer className="admin-footer">
        <Link to="/" className="admin-footer__link font-display">
          view site →
        </Link>
      </footer>
    </div>
  );
}
