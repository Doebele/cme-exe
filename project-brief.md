# Project Brief — CME.exe (AI × Design Lab)

> **Hinweis:** Dieser Brief wurde migriert aus `cme-lab/project-brief.md` Abschnitt 13 (2026-06-29). cme-lab bleibt das klassische Portfolio/Freelance-Repo; cme-exe ist das eigenständige experimental Lab.

---

## 1. Projekt
- Name: **CME.exe** — AI × Design Lab
- Kurzbeschreibung: Eigenständige, experimentelle, „award-aimed" Website für Claus Medvesek. Full Art Piece (D1-c) über Computational Design, AI als Co-Creator, und die Meta-Frage was es bedeutet, wenn eine Maschine dein Lebenswerk „besucht".
- Ziel: Eine herausragende, preiswürdige (Awwwards/FWA/CSSDA) experimentelle Site, die Claus als Computational Thinker zeigt — nicht als klassisches Portfolio.
- Nutzer / Zielgruppe:
  - Design-Peers, Award-Juroren, Creative-Coding-Community.
  - Power-User mit eigenem AI-API-Key (für „Full Experience").
  - Nicht: Recruiter oder Bank-Kunden (die gehen zu portfolio./design.medvesek.com).
- Erfolgskriterien:
  - Visuell atemberaubend, konzeptionell kohärent, performant.
  - AI ist sichtbar Co-Autor, nicht nur Feature.
  - Dual-Mode (Hybrid vs. Full Experience) funktioniert seamless.
  - Mobile ist eigene Erfahrung, nicht schlechter Desktop.

## 2. Scope
### In Scope
- Combo α+ „The Machine as Co-Author": A (Oracle) + H (Speedrun-Agent) + B (Prompt→Sketch) + C (ASCII-Boot) + E (Asteroids-Game) + Chiptune-Soundlayer.
- Multi-Theme-System (Vector-Green default, CRT-Amber, Y2K-Vaporwave) via Admin.
- Admin-Bereich `/admin` mit 6 Tabs (Theme, Audio, Personas, Content, Behavior, Analytics).
- Dual-Mode AI Experience: Hybrid (default, rate-limited) + Full (visitor's own key, Maeda-style inline widget).
- Maeda-Quote-Bank (kuratiert, ~30–50 Einträge).
- Cross-Links zu portfolio./design. (beide Richtungen).
- Docker-Deployment auf Strato, Domain lab.medvesek.com.

### Out of Scope (v1)
- Webcam/Mic-Permission-Features (Phase 2+, siehe D5-b).
- Co-Drawing (D), Diffusion-Kamera (I) — phasenweise später.
- Multi-User / Rollensystem (nur ein Admin).
- Echte Datenbank (JSON-Storage wie cme-lab).
- i18n (Default Englisch).
- CI/CD-Pipeline (manuelles Docker-Deploy).

## 3. Leitplanken
- **Tech-Stack:**
  - Frontend: React 19 + TypeScript + Vite + Tailwind v4 + three.js + p5.js + Tone.js + xterm.js + react-router-dom.
  - Backend: Node 20 + Express + bcrypt + express-session + JSON-Storage.
  - AI: Hybrid (D2-c) — Browser-AI für Perzeption, Claude API via Backend-Proxy für Reasoning.
- **Architekturprinzipien:**
  - React Router mit Hash-Routen für Stücke (`#oracle`, `#observer`, `#sketch`, `#quest`), Path-Route für Admin (`/admin`).
  - Code-Splitting: Jedes Stück als eigenes Modul, lazy-loaded via React.lazy.
  - Token-basiertes Theme-System (CSS-Variablen) für Multi-Theme-Swappability.
  - JSON file storage (gleiche Pattern wie cme-lab) für Settings, Personas, Fakten-Sheet.
  - Run-State (für Per-Run-Sharing) in `data/runs/` mit 24h TTL.
- **Design-/UX-Prinzipien:**
  - Default Theme: Vector-Green (D10-b).
  - Mobile = eigene Erfahrung (D4-b), nicht „kleiner Desktop".
  - Sound immer opt-in (Guardrail: kein Autoplay).
  - `prefers-reduced-motion` und `prefers-data-saver` immer respektieren.
- **Qualitätsanforderungen:**
  - 60 fps oder bewusst cinematic 24 fps.
  - Lighthouse mobile ≥ 90 (Performance, A11y, Best Practices, SEO).
  - Keine Console-Fehler im Default-Rendering.
  - Three.js/p5.js-Ressourcen disposen.
- **Was der Agent nie tun soll:**
  - Keine Secrets hart-codieren oder committen (Admin-Passwort, Session-Secret, Anthropic-Key).
  - Keine externen API-Keys im Frontend-Code — Visitor-Key nur in localStorage.
  - Kein Autoplay-Sound, kein Autoplay-Video — alle Medien user-initiiert.
  - Keine Webcam/Mic ohne expliziten User-Klick + klare Info.
  - Keine Hallucinations: KI bleibt innerhalb des Fakten-Sheets und der Negative Liste.
  - Keine Maeda-Quotes erfinden — nur kuratierte, verifizierte.
  - Kein Tailwind v3 (cme-exe ist grüne Wiese → Tailwind v4).

## 4. Source of Truth
- Repo: `/Users/clausmedvesek/Developer/projects/cme-exe`
- Hauptpfade:
  - `frontend/src/sections/` — BootSection, OracleSection, SpeedrunSection, SketchSection, QuestSection (die α+ Stücke).
  - `frontend/src/components/` — Navigation, Footer, ApiKeyWidget (Maeda-style), ThemeToggle, SoundToggle, BootSequence, AdminLogin, AdminDashboard.
  - `frontend/src/lib/` — apiKey, aiClient, themes, audio.
  - `frontend/src/hooks/` — useApiKey, useTheme, useContent.
  - `frontend/src/admin/` — ThemeTab, AudioTab, PersonasTab, ContentTab, BehaviorTab, AnalyticsTab.
  - `backend/server.js` + `backend/routes/` (auth, ai dual-mode, content, admin).
  - `data/` — lab-facts.json, personas.json, settings.json, maeda-quotes.json, runs/.
- Wichtige Referenzen:
  - Maeda-Original für API-Key UX: https://dit-2026-app.john-04e.workers.dev/ (Inline-Widget, Auto-Provider-Detection, Status-Badge).
  - cme-lab-Repo: `/Users/clausmedvesek/Developer/projects/cme-lab` (Auth-Pattern, JSON-Storage-Pattern, career.json/works.json als Fakten-Sheet-Quelle).
- Relevante Commands:
  - Frontend-Dev: `cd frontend && npm install && npm run dev` (Port 5173).
  - Backend-Dev: `cd backend && npm install && npm run dev` (Port 8093).
  - Docker: `docker-compose up --build -d` (Port 8093).
  - Neues Admin-Passwort: `cd backend && node -e "const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('NEUES-PASSWORT', 10));"` → in `data/settings.json` (oder Env) eintragen.

## 5. Entscheidungen (alle gültig, D1–D11 + Dual-Mode)

- **D1 Tonalität: D1-c Full Art Piece.** Eigenständige Site, Recruiter-Tauglichkeit kein Kriterium.
- **D2 KI-Budget: D2-c Hybrid.** Browser-AI für Perzeption, Claude API via Backend-Proxy für Reasoning. Dual-Mode (Hybrid + Full) siehe unten.
- **D3 Konzept: Combo α+.** A (Oracle) + H (Speedrun-Agent) + B (Prompt→Sketch) + C (ASCII-Boot) + E (Asteroids) + Chiptune.
- **D4 Plattform: D4-b Mobile = eigene Erfahrung.** Mobile ist bewusst andere Perspektive.
- **D5 Permissions: D5-b opt-in pro Feature.** Default: keine Permissions. Tür offen für Phase 2.
- **D6 Sound: D6-b Kuratierte Chiptune-Score via Higgsfield.** 8 Tracks, opt-in.
- **D7 Content: D7-b Hybrid.** Kuratierte Guardrails + LLM-Improvisation.
- **D8 URL: D8-b One-Page + Deep-Links + Per-Run-Sharing.** Domain lab.medvesek.com.
- **D9 Branding: D9-b CME.exe + Personas (Observer/Machine/Curator).**
- **D10 Art Direction: D10-b Vector-Green default + Multi-Theme (CRT-Amber, Y2K) via Admin.**
- **D11 Codebase: D11-a Neues Repo `cme-exe`.** Hosting Strato, Domain lab.medvesek.com.
- **+ Dual-Mode Experience: Hybrid (default, rate-limited) vs. Full (eigener Key, Maeda-style Widget).**

---

# Current State

## 6. Status
- Phase: **Phase 1 (Combo α+) VOLLSTÄNDIG** — alle 5 Stücke gebaut + Docker-deployed. Admin-Erweiterungen (Content + Analytics) gebaut.
- Gesamtstatus: **on track** — 9 Admin-Tabs, Invaders-Tempo skaliert mit Browserbreite, Docker live auf Port 8093.
- Aktiver Branch: `main` auf GitHub (`git@github.com:Doebele/cme-exe.git`).
- Zuletzt aktualisiert am: 2026-07-07.

## 7. Was zuletzt gemacht wurde
- Repo `cme-exe` lokal angelegt unter `/Users/clausmedvesek/Developer/projects/cme-exe`.
- Multi-Site-Ökosystem geklärt: portfolio. / design. / lab. (cme-exe).
- Alle 11 Entscheidungen (D1–D11) durchgespielt und im Brief dokumentiert.
- Maeda-API-Key-Pattern analysiert (https://dit-2026-app.john-04e.workers.dev/) — Inline-Widget, Auto-Detection, Status-Badge.
- Brief von cme-lab § 13 migriert in diesen eigenständigen `project-brief.md`.
- Repo-Scaffold gebaut: Root-Files, Frontend-Grundgerüst, Backend-Grundgerüst, Data-Files, Dockerfile.
- **Frontend** (28 Dateien): Vite + React 19 + TS + Tailwind v4 + drei themes (Vector-Green/CRT-Amber/Y2K) + ApiKeyWidget (Maeda-style mit Auto-Detection, Save/Clear, Provider-Badge) + 5 Section-Stubs + ThemeToggle + SoundToggle + Navigation/Footer. **`tsc -b` clean, `vite build` clean (77 kB gzipped JS, 3.8 kB gzipped CSS).**
- **Backend** (12 Dateien): Express + ES Modules + bcrypt + session + Anthropic SDK + JSON-Storage. Dual-Mode AI: `/api/ai/claude` (Hybrid, rate-limited) + `/api/ai/proxy` (Full, visitor-key, zero logging). Health-Route `/api/health`. Per-Run-State in `/api/runs/{id}` (24h TTL). **Boots clean, alle Routes validiert.**
- **Docker-Setup finalisiert**: Port **8093** (frei, angrenzend an 8091 ntfy + 8092 cme-lab = Medvesek-Cluster), Healthcheck via wget, `.env` als read-only Volume, `container_name: cme-exe`, `image: cme-exe:latest`.
- **Data-Files initialisiert**: `lab-facts.json` (Claus' Karriere + Works aus cme-lab migriert), `personas.json` (Observer/Machine/Curator mit System-Prompts), `maeda-quotes.json` (10 seed Quotes), `settings.json` (Theme/Audio/Behavior/Experience Defaults).

## 8. Nächste Schritte
- [x] Frontend installieren + dev testen.
- [x] Backend installieren + dev testen.
- [x] ApiKeyWidget in Browser testen (Provider-Detection, Save, Clear) — **Maeda-style verified ✓**.
- [x] Theme-Switching testen (Vector-Green ↔ CRT-Amber ↔ Y2K) — **alle 3 Themes schaltbar ✓**.
- [x] **Phase 1a — Speedrun-Agent (H) als MVP gebaut** (First Wow).
  - [x] Backend: `/api/speedrun/{start,step,manifest}` + Observer/Curator-Loop.
  - [x] Frontend: Stage, VirtualCursor (GSAP), ThoughtStream (Typewriter), ManifestCard, Replay, Share.
  - [x] End-to-End getestet: Provider-Detection, Hybrid-Disabled-503, Fallback bei Claude-Fehler, Hash-Replay.
  - [x] **Phase 1a Polish (Option C):**
    - [x] Mobile TikTok-Format: `flex-col md:flex-row` Layout, Stage `h-[55vh]` mobil, ThoughtStream als Caption-Overlay, VirtualCursor 12px mobil, ManifestCard full-screen mobil, Step-Cap 10 mobil / 13 desktop.
    - [x] Marginalia-Overlay: Neue `Marginalia.tsx` (~220 Zeilen), fade+slide via GSAP, edge-aware Flipping, auto-dismiss nach 4s, positioniert via `getBoundingClientRect` der aktiven Station.
    - [x] Discovery-Sting Sound: `lib/audio.ts` (Tone.js Cmaj7 Arpeggio), `hooks/useAudio.ts`, SoundToggle persistiert via localStorage, Aha-Detection (Regex + `!`/`?`), 5s Rate-Limit.
  - [x] **Phase 1b — Oracle (A) + Prompt→Sketch (B) gebaut:**
    - [x] Oracle: `useOracle.ts` Hook, `OracleSection.tsx` (ersetzt Stub), `TerminalWindow.tsx` (CRT-Look mit Scanlines + Phosphor-Glow), 5 Beispiel-Prompts, SSE-Streaming via `lib/sse.ts`.
    - [x] Sketch: `useSketch.ts` Hook, `SketchSection.tsx`, `SketchPreview.tsx` (sandboxed iframe, theme via `window.THEME` injection), `CodeViewer.tsx` (kollabierbar), `SketchGallery.tsx` (localStorage, max 20), 4 Style-Presets (Vector/Geometric/Particle/Wave).
    - [x] Persona-Addons (`ORACLE_OUTPUT_INSTRUCTION`, `SKETCH_SYSTEM_PROMPT_ADDON`) in `lib/personaAddons.ts`.
    - [x] Shared SSE-Parser in `lib/sse.ts` (für Oracle + Sketch).
    - [x] Error-Handling verifiziert: Hybrid-Disabled-Error wird korrekt in beiden Sections angezeigt.
    - [x] Theme-Switching während Error/Stream funktioniert live.
  - [x] **Phase 1c — ASCII-Boot (C) + Asteroids (E) + Sound-Layer gebaut:**
    - [x] Boot: `BootSequence.tsx` (~310 Zeilen), 4-Phasen CRT-Power-On + BIOS-POST-Typewriter + ASCII-Logo-Matrix-Decode + Fade. Hybrid-Status + Theme live angezeigt. Skip via Key/Click/Button. Replay-Button im Footer. `bootMode` aus settings.json (always/first-visit/off).
    - [x] Asteroids: `QuestSection.tsx` + `GameCanvas.tsx` (~750 Zeilen pure-canvas engine) + `useAsteroids.ts` Hook. Vector-Grafik mit Glow, Asteroiden mit Design-Problem-Labels (Stakeholder, Scope Creep, etc.), Splitting large→medium→small, Maeda-Quote-Drops bei ~30% der kleinen Treffer, High-Score in localStorage, Mobile-Touch-Controls, Theme-Awareness via MutationObserver.
    - [x] Sound: 5 neue Tone.js-Funktionen in `lib/audio.ts` (Boot-Glitch, Hover-Blip, Shoot-Laser, Explosion-Noise, Game-BGM-Chiptune). Verdrahtet in BootSequence (Boot-Sound) und GameCanvas (Shoot/Explosion/BGM).
    - [x] Echte Live-Tests verifiziert: Boot-Sequenz spielt + setzt `cme_exe_booted=1`, Asteroids-Canvas rendert mit 800x600 + Context + Pixel-Content, Theme-Switch during Boot zeigt korrekte BIOS-Zeile, Footer Replay-Button auslösbar.
  - [x] **Polish Round 1 (User-Feedback):**
    - [x] **Sketch Bug-Fix:** `useSketch.ts` `stripFences()` robuster gemacht — extrahiert Code zwischen Fences egal wo im String, auch ohne Closing-Fence oder mit Prosa drumherum. Validierung akzeptiertCode ab 20 Zeichen Länge statt bisheriger strikter Regex.
    - [x] **Speedrun-Manifest:** Centered Overlay über der (abgeblendeten) Stage statt wie bisher rechts gequetscht (Stage wird full-width, Manifest nimmt 53% viewport breit ein).
    - [x] **Oracle-Antwort-Sichtbarkeit:** Page-Auto-Scroll zur Antwort während Streaming, leerere Antwort-Präsentation mit Fallback.
    - [x] **Asteroids Rebalancing:** 6 Level mit progressiver Difficulty (Level 1: 2 Asteroiden, ~34-80 px/s; Level 6: 7 Asteroiden, ~94-170 px/s). Größeres Canvas (1200×~375 via ResizeObserver, aspect-ratio 5:3). Controls-Legend Overlay während des Spiels (ROTATE/THRUST/FIRE/PAUSE). LEVEL in HUD. Level-Up-Announcement Overlay bei Wellen-Clear.
  - [x] **Polish Round 2 (User-Feedback):**
    - [x] **Maeda-Referenzen entfernt:** `data/maeda-quotes.json` → `data/design-quotes.json` mit 42 Quotes von 20 Designern (Jony Ive, Dieter Rams, Massimo Vignelli, Don Norman, Charles Eames, Paula Scher, Paul Rand, Saul Bass, Frank Lloyd Wright, Yves Béhar, Raymond Loewy, Bill Moggridge, etc.). Code umbenannt: `MaedaQuote` → `DesignQuote`, `/maeda-quotes` → `/design-quotes`, `MAEDA_QUOTES_FILE` → `DESIGN_QUOTES_FILE`. Persona „THE MACHINE" referenziert jetzt mehrere Designer statt nur Maeda. 5 thematisch wertvolle Maeda-Quotes bleiben in der Sammlung (als eine von vielen Quellen).
    - [x] **URL-Speedrun Backend:** `lib/urlFetcher.js` (~660 Zeilen) + neue Routes `/api/speedrun/url/{start,step,manifest}`. Besucher kann externe URL eingeben (LinkedIn-Profil, persönliche Website, GitHub-Page), Backend fetcht server-side mit SSRF-Schutz (private IPs blockiert), Timeout (8s), Size-Limit (1MB), Rate-Limit (10 fetches/h/IP). HTML-Extraktion via Regex (Title, Meta, Headings, Paragraphs, Links). Page-State wird aus extrahiertem Content gebaut, Observer navigiert externe Site. Caching 60min.
    - [x] **Asteroids Quote-Pause Feature:** Wenn ein Designer-Quote bei Asteroiden-Zerstörung dropped, pausiert das Spiel. Quote-Dauer = `2s + 70ms × text.length` (min 4s, max 10s). Subtiler Progress-Bar (degradierende horizontale Linie) zeigt verbleibende Zeit. Full-screen dim overlay während Pause. `⌘` (macOS) oder `Ctrl` skippt Timer sofort. Auto-Cleanup via Interval. Reduced-Motion-safe.
  - [x] **Polish Round 3 (User-Feedback):**
    - [x] **Sketch-Gallery UX:** Neue Action-Buttons pro Gallery-Eintrag: ↩ (Edit prompt again — lädt den alten Prompt ins Textarea für Modifikation) + ✕ (Delete). „Clear all" Button oben rechts. `clearGallery()` + `getSketch()` Methoden im `useSketch` Hook.
    - [x] **Sketch-Layout Umstrukturierung:** Gallery von Sidebar (neben Canvas) nach unten (full-width unter kombiniertem Prompt+Code-Container). Lange Prompts quetschen die Canvas nicht mehr. Preview-Panel jetzt 640px breit statt vorher oft gequetscht.
    - [x] **URL-Speedrun Frontend:** Vollständige UI im `#observer` Bereich: URL-Input + „▶ Visit URL" Button mit `^https?://` Validierung, Hybrid/Full-Mode wie gehabt. Stage rendert externe Sites (Wikipedia Don Norman verifiziert: 10 Stationen, korrekte Subject-Extraktion). URL-Badge oben im Stage zeigt `URL: ...`. Fehler-States für INVALID_URL/BLOCKED/TIMEOUT/FETCH_FAILED/RATE_LIMIT sauber gemappt. Manifest refrenziert die externe Site korrekt.
    - [x] **Progressive Reveal im Stage:** Stations starten hidden (opacity 0, scale 0.85) und enthüllen sich wenn der Agent ihre Section erreicht. HERO immer sichtbar als Startpunkt. CSS Transition 400ms ease-out. CSS nutzt opacity statt display:none (sonst bricht `getBoundingClientRect` für Cursor/Marginalia). Live verifiziert: 10 Stationen für Don Norman URL, 8 sichtbar nach部分-Navigation, Skills hidden bis Agent sie erreicht.
  - [x] **Polish Round 4 (User-Feedback):**
    - [x] **Oracle Past-Q&A De-emphasis:** Ältere Q&A-Paare verblassen (opacity 0.5, saturate 0.7, font-size 0.85em, dashed separator oben). Aktuelle Q&A bleibt full-strength mit Akzent-Farbe für Question + glow für Answer. Klassennamen: `oracle-qa--last` (current) vs `oracle-qa--past` (history).
    - [x] **56k Modem Boot Sound + Synced BIOS Reveal:** `playBootSound()` in `audio.ts` komplett neu als 5.5s 56k-Modem-Handshake-Synthese: pickup-click → line-hiss → 1100Hz Ring → 2100Hz CED-Answer-Tone (mit Wobble) → Training-Bursts (600/1800/1300/2400Hz) → Bandpass-Noise-Bursts → 600→2400Hz Frequency-Sweep → 2250Hz Final-Confirm. BIOS-Lines mit Modem-Metapher: INITIALIZING MODEM / ATDT 555-2300 / RING 1100 HZ / CARRIER DETECTED 2100 HZ / HANDSHAKE TRAINING / PROBE A 600 HZ / PROBE B 1800 HZ / NOISE FLOOR OK / SWEEP 600-2400 / NEGOTIATE V.90 / CONNECT 56000 BPS. Phase-2-Timing umgestellt von simplem per-Line-Interval auf timestamp-gesteuerte Reveals (`at`-Property pro Line), so Linien exakt dann erscheinen wenn die entsprechende Sound-Phase spielt. Phase-Dauer angepasst: power=500, bios=6900, decode=600, fade=250 (Total ~8.25s).
  - [x] **Polish Round 5 (User-Feedback):**
    - [x] **BootSection echten Inhalt statt Stub:** Zeigt jetzt Beschreibung des 56k-Modem-Rituals + „▶ Replay boot sequence" Button + „Skip to speedrun →" Link. Kein „(coming in Phase 1c)" mehr.
    - [x] **Admin-Bereich voll funktionsfähig:** Login (bcrypt + session), 6+1 Tabs: AI Providers (Anthropic/OpenAI Keys encrypted in `data/api-keys.json`, masked preview), Navigation (Section-Reihenfolge + Sichtbarkeit), Theme (Default + Slider), Audio (Sound/Volumen), Behavior (BootMode + Limits), Personas (System-Prompts editierbar), Recordings (siehe unten).
    - [x] **API-Key Backend-Speicherung:** Neue Routes `/api/admin/api-keys` (GET masked, PUT schreibend), in `data/api-keys.json` (gitignored). `lib/claude.js` liest diesen File als Override über env-var. `resetServerClient()` invalidiert Cache nach Key-Update. Sections.json für Nav-Verwaltung.
  - [x] **Polish Round 6 (Admin-Erweiterungen + Invaders-Skalierung):**
    - [x] **Space-Invaders horizontales Tempo skaliert mit Browserbreite:** `MARCH_STEP_X` war fix 8 px/Tick — auf breiten Screens brauchte die Formation zu lange für eine Traverse. Jetzt: `marchStepX(viewWidth)` berechnet den Schritt proportional zur View-Breite (Referenz 8 px bei 800 px → 1% der Breite pro Tick). Traverse-Zeit konstant über alle Fenstergrössen. `InvadersCanvas.tsx` + `GameCanvas.tsx` (Asteroids unverändert, dort ist Geschwindigkeit bereits px/s-basiert).
    - [x] **Neuer Admin-Tab „Content":** Vollständige CRUD-Oberfläche für Design-Quotes (`data/design-quotes.json`, 42 Quotes von Ive, Rams, Vignelli, Scher, Eames, Norman u.v.m.). Add/Edit/Delete, Reihenfolge per Pfeile, Save-Button mit Dirty-Indikator. `ContentTab.tsx` + `useDesignQuotes()` Hook.
    - [x] **Neuer Admin-Tab „Analytics":** Aggregierte Speedrun-Metriken aus `data/runs/*.json`: Runs Total/24h/Complete, Hybrid vs. Full Breakdown, Input/Output Tokens, Kosten-Estimate (Sonnet-Preise: $3/M input, $15/M output), Top analysierte Sites (Host-Count), 14-Tage-Sparkline + Detail-Tabelle. Backend-Route `GET /api/admin/analytics` liest und aggregiert alle Run-Files. `AnalyticsTab.tsx` + `useAnalytics()` Hook.
    - [x] **Admin-Dashboard:** 9 Tabs jetzt — AI Providers · Navigation · Theme · Audio · Behavior · Personas · Recordings · **Content** · **Analytics**.

    - [x] **Speedrun-Recording-Feature (Kosten-Optimierung):** Pre-recorded Sessions werden in Hybrid-Mode (Besucher ohne API-Key) statt Live-LLM-Run abgespielt. Implementiert via: `data/recordings/` (Permanent-Storage ohne TTL) + `lib/recordings.js` (CRUD + `pickHybridRecording()`) + `routes/recordings.js` (Public GET, Admin POST/PATCH/DELETE). Hybrid-Mode-Shortcut in `/api/speedrun/start`: wenn Recording featured+available → return recording statt live run. Frontend: `useSpeedrun.playRecording()` walks history step-by-step, Badge „⏺ PRE-RECORDED SESSION" in ThoughtStream, Idle-State Note „Hybrid mode plays a pre-recorded session. Add your API key for a fresh live run." Admin Tab „Recordings" mit Promote-Formular (runId → permanent recording), Inline-Edit, Feature-Toggle, Delete.
    - [x] **Oracle Past-Q&A De-emphasis:** Ältere Q&A-Paare verblassen (opacity 0.5, saturate 0.7, font-size 0.85em, dashed separator oben). Aktuelle Q&A bleibt full-strength.
  - [x] **Polish Round 6 (User-Feedback):**
    - [x] **Speedrun Mini-Console Volle Breite:** ThoughtStream-floating-Panel von `w-[400px] max-w-[60%]` auf `left-3 right-3` (volle Console-Breite) umgestellt. Live verifiziert: 1196px Mini-Console in 1222px Stage, „spans_almost_full_width: true". Ganzer Thought-Text jetzt sichtbar statt abgeschnitten.
    - [x] **Speedrun Analyse-Sound-Layer:** Vier neue Tone.js-Funktionen in `lib/audio.ts`: (1) `playTypewriterClick()` — kurzer Square-Wave-Pluck pro Buchstabe während Typewriter (~25ms, rate-limited auf ~28/sec), (2) `startAnalysisNoise()` / `stopAnalysisNoise()` — kontinuierlicher Pink-Noise mit Lowpass(900Hz) als „Analyse-Hum" während Observer läuft, (3) `playRandomBlip()` — Random Electronic-Blip aus Palette von 5 Frequenzen (660-1760Hz), layerd über Typewriter-Stream. ThoughtStream wired: Typewriter-Clicks während isTyping, Random-Blips alle 280ms mit 35% Wahrscheinlichkeit während Live+Typing, Analysis-Noise startet bei isLive, stoppt beim Verlassen. Respektiert sound-enabled State.
  - [x] **Polish Round 7 (User-Feedback): Speedrun Manifest-Loading Gap Fix.** Bug behoben: zwischen Step-Loop-Ende und Manifest-Load verschwand bisher die Stage (leerer Screen mit nur Start-Screen). Jetzt: showStage schliesst status === "manifest" mit ein, sodass Stage durchgehend sichtbar bleibt. Zusammlich neuer manifestLoading State mit "THE CURATOR IS WRITING / manifest synthesizing..." Overlay (pulse-dot + glow) fuer die 2-5 Sekunden Manifest-Load. Danach nahtloser Fade zum Manifest-Card.
  - [x] **Polish Round 8 (User-Feedback): Speedrun Rate-Limit Bug Fix.** Rate-Limit wurde pro /step gezaehlt (10-12 Hits pro Run), nicht pro /start. Bei Limit 20/Hour war nach 1-2 Live-Runs Schluss. Fix: /step und /manifest rufen resolveMode() nicht mehr auf, nur /start zaehlt. Besucher kann jetzt 20 Runs/Starter. Live verifiziert.

- [ ] **Echten `ANTHROPIC_API_KEY` setzen und Live-Run testen** (nächster Schritt vom User).
- [x] **Phase 1a Polish (Option C)** — Mobile TikTok + Marginalia + Discovery-Sting ✓.
- [x] **Phase 1b — Oracle (A) + Prompt→Sketch (B)** ✓ (Docker-deployed, error-handling verifiziert).
- [x] **Phase 1c — ASCII-Boot + Asteroids + Sound-Layer** ✓ (Docker-deployed, Browser-verifiziert).
- [ ] Performance: Code-Splitting mit `React.lazy` für Speedrun-Sektion (Tone.js lädt ~140 kB extra, derzeit im Initial-Bundle).
- [x] Admin-Bereich mit allen 9 Tabs ausbauen (AI Providers, Navigation, Theme, Audio, Behavior, Personas, Recordings, Content, Analytics).
- [ ] Maeda-Quote-Bank kuratieren (~30–50 Quotes).
- [ ] Higgsfield-Tracks generieren (sonilo_music + mirelo_text_to_audio).
- [ ] Initial Git-Commit + auf GitHub pushen.
- [ ] Strato-Deployment einrichten (Subdomain lab.medvesek.com).

## 9. Offene Punkte
- **Sicherheit:** Admin-Passwort + Session-Secret + Anthropic-Key vor Prod-Deploy setzen.
- **Maeda-Quotes:** Kuratierung ausstehend (Default: Agent recherchiert, Claus freigibt).
- **Voice-Output für Oracle:** Noch offen (Default: Text, Voice optional via Toggle).
- **Higgsfield-Lizenz:** Kommercial-Rechte für Awards/Public Deployment prüfen.
- **Kosten-Limit:** Spend-Limit bei Anthropic setzen vor Public Launch.

## 10. Blocker / Risiken
- Blocker: **keine** — Grundgerüst steht, kann direkt mit Phase 1a starten.
- Risiko: Speedrun-Agent Performance (LLM-Latenz pro Step).
  - Auswirkung: Run dauert evtl. länger als 60–75s, Besucher springt ab.
  - Nächste Aktion: Hybrid-Variante (Live-LLM für Thoughts, semi-scripted Actions).
- Risiko: Visitor-Key in localStorage XSS-vulnerable.
  - Auswirkung: Bei XSS-Lücke könnte Key geleakt werden.
  - Nächste Aktion: Strikte CSP, klare Kommunikation an User, optional Direkt-Browser-zu-Provider-Modus.

## 11. Wie ein neuer Agent übernehmen soll
1. Diese Datei komplett lesen.
2. Relevante Pfade prüfen (siehe Abschnitt 4).
3. Branch / offenen Stand prüfen.
4. Lokal starten: Frontend `npm run dev` (5173), Backend `npm run dev` (8093).
5. Mit nächstem Schritt aus Abschnitt 8 beginnen (meistens: Phase 1a Speedrun-Agent).
6. Vor Verlassen diese Datei aktualisieren.

## 12. Übergabe-Notiz
- Falls an anderes Tool übergeben wird: Übergib diese `project-brief.md` + `README.md` + cme-lab-Repo (für career.json/works.json als Fakten-Sheet-Quelle).
- Woran das nächste Tool direkt anschließen soll: Phase 1a (Speedrun-Agent H).
- Was auf keinen Fall neu entschieden werden soll: Stack (React + Vite + Tailwind v4 + Three.js + p5.js + Tone.js + Express + JSON-Storage bleibt); Combo α+ bleibt; CME.exe-Branding bleibt; Dual-Mode AI Experience bleibt.

---

# Appendix — Vollständige Specs aus dem Entscheidungs-Loop

(Diese Inhalte wurden aus cme-lab § 13 migriert und sind die verbindliche Ausführungsspezifikation.)

## A.1 Konzept-Richtungen (alle Kandidaten A–J)
| # | Idee | Hook | Tech | Aufwand | Award-Potenz |
|---|------|------|------|---------|--------------|
| A | „The Machine Designs Back" — Terminal-Oracle | Besucher stellt Design-Frage, KI antwortet *sichtbar denkend* in CRT-Terminal. | xterm.js + GLSL-CRT + LLM | Mittel | Hoch |
| B | „Prompt → Sketch" Live-Generator | Prompt → LLM generiert p5.js-Code → läuft live im iframe. Galerie aller Skizzen. | p5.js + iframe-sandbox + LLM | Mittel | Sehr hoch |
| C | ASCII-Hero / Boot-Sequenz | Boot-Intro beim Erstbesuch, ASCII-Rendering der Site. | ASCII-Renderer + Three.js/p5 | Mittel | Hoch |
| D | „Designer × Machine Co-Drawing" | Besucher malt, KI predictet nächste Striche, malt mit. | ml5.js / sketch-rnn | Hoch | Sehr hoch |
| E | Retro-Vector-Minigame „Designer's Quest" | Asteroids/Vectrex; schießen auf „Design-Probleme"; Treffer = Maeda-Micro-Quote. | p5.js + Web Audio | Mittel | Hoch |
| F | „Design × Tech × Business" als Physik-Toy | Maedas Venn als Matter.js-Spielzeug. | Matter.js + D3 | Niedrig-Mittel | Mittel |
| G | Generatives Type-Portrait | Name/Tagline als Partikel. | Three.js + LLM | Mittel | Hoch |
| H | **„AI Speedruns Your Portfolio"** | KI-Agent „besucht" die Site live, scrollt, klickt, reflektiert. Meta. | Eigenes Agent-Skript + DOM-Overlay + LLM | Hoch | **Sehr hoch (frisch!)** |
| I | Diffusion-Kamera (Browser) | Webcam-Bild live in Sketch-Stil via kleinem Diffusion-Modell. | WebGPU + ONNX/transformers.js | Hoch | Hoch |
| J | „Site remixt sich selbst" | Bei Reload wählt seeded KI kohärente Variante. | Custom tokens + seeded RNG | Mittel | Hoch |

**Combo α+ gebaut aus:** A + H + B (getragen) + C + E (Erweiterungen) + Sound.

## A.2 Tech-Stack (freigegeben)
- **p5.js** — Retro/Vector-Sketches, Asteroids-Game, generative 2D.
- **ml5.js** — Browser-AI ohne Server (Pose, Stroke-RNN, Classifier).
- **transformers.js** — Small LLMs lokal im Browser (WebGPU).
- **Anthropic Claude API** — Für smarte Antworten (Oracle, Prompt→Sketch, Speedrun).
- **Matter.js** — Physik-Spielzeug (für optionale zukünftige Stücke).
- **xterm.js** — Echtes Terminal-Feeling für Oracle.
- **GLSL Shader** (in Three.js) — CRT, Glitch, ASCII-Postprocessing.
- **Web Audio API + Tone.js** — Chiptune, Sound-Reaktiv.
- **D3.js** *(optional)* — Daten-getriebene Vis.

## A.3 KI-Architektur (D2-c Hybrid + Dual-Mode)

**Aufgabenverteilung:**
- **Browser-seitig** (TF.js, ml5.js, transformers.js): Pose, Stroke-RNN, Style-Transfer, Klassifikation, Sound-Reaktiv, kleine Diffusion.
- **API-seitig** (Backend-Proxy → Claude API): LLM-Antworten, Code-Generierung, Agent-Reflexion, Text-Rewriting.

**Dual-Mode (Hybrid vs. Full) — Maeda-style Widget:**

**Modus 1: Hybrid (Default)**
- Powered by CME.exe's eigener Claude API (via Backend-Proxy).
- Rate-limited (Default: ~20 Requests/Visitor/Stunde, im Admin konfigurierbar).
- Kosten trägt Claus.
- Privacy: Prompts über Claus' Backend (anonymes Logging möglich).

**Modus 2: Full Experience mit eigenem Modell**
- Besucher bringt eigenen API-Key mit (initial: Anthropic; optional OpenAI).
- Key client-side in `localStorage`, niemals an CME.exe-Backend außer als Pass-through.
- Kein Rate-Limit, höhere Qualität (Besucher wählt Modell).
- Privacy: CME.exe loggt nichts im Full-Modus.

**ApiKeyWidget-UX (Maeda-style, verpflichtend):**
- Inline expand in Navigation (kein Modal).
- Ein einziges Textfeld, Placeholder `sk-ant-… or sk-…` (Auto-Provider-Detection).
- Nach Save: Status-Badge mit Provider + ✓ (z. B. `Anthropic ✓`).
- Key wird nie angezeigt; Placeholder wird zu `(key set — paste to replace)`.
- Ein-Klick „Clear key".
- Referenz: https://dit-2026-app.john-04e.workers.dev/

**Backend-Endpunkte:**
- `/api/ai/claude` — verwendet Claus' Key (Hybrid-Modus, rate-limited, mit Caching).
- `/api/ai/proxy` — akzeptiert Visitor-Key im `Authorization`-Header (Full-Modus). **Logging aus.**
- Provider-Support initial: Anthropic Claude (Default), OpenAI (optional).

## A.4 Plan (Phasen)
- **Phase 0 — Direction (erledigt 2026-06-28/29):** Alle 11 Entscheidungen geklärt.
- **Phase 1 — First Wow:**
  - 1a: Speedrun-Agent (H) als MVP (~2 Wochen).
  - 1b: Oracle (A) + Prompt→Sketch (B) (~2 Wochen).
  - 1c: ASCII-Boot (C) + Asteroids (E) + Sound-Layer (~1 Woche).
- **Phase 2 — Companions (optional):** Co-Drawing (D), Diffusion-Kamera (I), Voice-Output.
- **Phase 3 — Polish:** A11y, Performance, Easter Eggs.
- **Phase 4 — Submit:** Awwwards / FWA / CSSDA.

## A.5 Award-Faktor-Checkliste (verbindlich ab Phase 1)
- [ ] Eine starke Idee, konsequent durch.
- [ ] Art Direction vor Tech (Referenzen: Lusion, Active Theory, Resn, Bruno Simon, variable.io).
- [ ] Sound opt-in, aber vorhanden.
- [ ] Mobile = eigene Erfahrung, kein 1:1 vom Desktop.
- [ ] 60 fps oder bewusst cinematic 24 fps.
- [ ] Easter Eggs & Tiefe.
- [ ] Persönliche Stimme („how Claus thinks", nicht „what tech can do").

## A.6 Plattform-spezifische Umsetzung (D4-b)
| Stück | Desktop | Mobile |
|-------|---------|--------|
| C (ASCII-Boot) | Full CRT-Boot mit Scanlines (~3 Sek) | Kompaktere Boot-Sequence |
| A (Oracle) | Side-Panel mit großer Typo | Vollbild-Terminal, typewriter |
| H (Speedrun-Agent) | Side-Panel + Marginalia + virtueller Cursor | Vertikales TikTok-Format (~45s), Commentary als Captions |
| B (Prompt→Sketch) | Große Canvas, Code sichtbar streaming | Canvas full-width, kompakter Output |
| E (Asteroids) | Maus/Tastatur | Touch + optional Gyro |
| Sound | Desktop-Lautsprecher | Kopfhörer-optimiert |

## A.7 Permission-UX (D5-b)
- Default: keine Permissions.
- Nie auto-prompt auf Page-Load.
- Permission-Features nur in Phase 2 (Mic für Voice-Input, Webcam für Co-Drawing/Diffusion).
- Klarer CTA + Info + Graceful Fallback bei Verweigerung.

## A.8 Sound-Design (D6-b)
**Tracks (via Higgsfield):**
- Boot-Glitch (~2 Sek), Oracle-Drone (Loop ~30 Sek), Speedrun-Base (Loop ~60 Sek), Discovery-Sting (1 Sek Arpeggio), Sketch-Glitter (~3 Sek), Game-BGM (Loop ~90 Sek), Pause-Ambient-Pad (Loop ~20 Sek), Click/Hover/Quit-SFX.
- Higgsfield Backends: `sonilo_music` (längere Tracks), `mirelo_text_to_audio` (SFX).
- Stack: Web Audio API + Tone.js, lazy-load nach erstem User-Click.
- Sound-Toggle default OFF (Guardrail: kein Autoplay).

## A.9 Content-Generierung (D7-b)
- **Fakten-Sheet:** Aus cme-lab `career.json`/`works.json` (Default: übernehmen).
- **Personas:** „The Observer" (Speedrun), „The Machine" (Oracle), „The Curator" (Manifest).
- **Maeda-Quote-Bank:** Echt kuratiert (~30–50), nicht KI-generiert.
- **Negative Liste:** Keine Claus-Claims, keine Fakten-Erfindung, keine polit/religiös/sexuellen Statements, keine Konkurrenz-Bewertungen, keine Spekulation über Privates.
- **Tone:** Theoretisch verspielt, kein Marketing-Sprech, gelegentlich self-aware Meta-Witz. Default Englisch.
- **Caching:** Häufige Oracle-Antworten gecacht; Speedrun-Thoughts live via SSE.

## A.10 URL-Struktur (D8-b)
- `/` — Full Flow.
- `/#oracle`, `/#observer`, `/#sketch`, `/#quest` — Deep-Links.
- `/#observer/r-{ID}` — Per-Run-Share (Server speichert 24h).
- `/admin` — Path-Route (kein Konflikt).
- React Router mit Hash-Routen; Boot-Skip via localStorage bei Re-Visit.

## A.11 Branding (D9-b)
- **Lab-Brand:** `CME.exe` in Fira Mono mit CRT-Glow.
- **Tagline:** „A Medvesek Experiment in AI × Design."
- **Footer:** „© 2026 CME.exe — Authored by Claus Medvesek. Cross-links: portfolio.medvesek.com · design.medvesek.com."
- **Personas:** THE OBSERVER (H), THE MACHINE (A), THE CURATOR (Manifest).

## A.12 Art Direction (D10-b default + Multi-Theme)
**Default Vector-Green:**
- bg `#0a0e0a`, primary `#39ff14`, accent `#4ECDC4`, warm `#ffb000`.
- Fira Mono + Fira Sans. Vektor-Linien mit Glow, dezente CRT-Vignette.

**Multi-Theme-System (swappable via Admin):**
1. Vector-Green (default)
2. CRT-Amber (amber-on-black, stärkere Scanlines)
3. Y2K-Vaporwave (pink/blue/mint/lila, chrome)

**Token-System:**
- Farben: `--color-bg`, `--color-text-primary`, `--color-text-secondary`, `--color-accent`, `--color-accent-secondary`.
- Effekte: `--glow-strength`, `--scanline-opacity`, `--noise-opacity`, `--crt-curve-strength`.
- Typo: `--font-display`, `--font-body`.
- UI: `--cursor-style`.

Wechsel zur Laufzeit via CSS-Variablen, persistiert in localStorage.

## A.13 Admin-Bereich
**Route:** `/admin` (bcrypt + session auth).

**Tabs (9):**
1. **AI Providers** — Anthropic/OpenAI/Kimi/Z.AI/Gemini/Cursor Keys (masked preview), Default Provider für Hybrid-Mode.
2. **Navigation** — Section-Reihenfolge + Sichtbarkeit (Pfeile + Checkboxen).
3. **Theme** — Default-Theme (Vector-Green/CRT-Amber/Y2K), CRT-Intensitäts-Slider (Glow/Scanlines/Noise/Curve).
4. **Audio** — Sound default on/off, Master-Volume, Per-Track-Lautstärke.
5. **Behavior** — Boot-Modus, Speedrun-Dauer, Per-Run-Sharing, Mobile-Variante, Game-Variant (Asteroids/Invaders), Hybrid-Rate-Limit, Allowed Providers.
6. **Personas** — Observer/Machine/Curator System-Prompts editierbar, Tone-Parameter.
7. **Recordings** — Speedrun-Recordings verwalten (Promote/Feature/Edit/Delete).
8. **Content** — Design-Quotes CRUD (Add/Edit/Delete/Reorder), 42 kuratierte Quotes.
9. **Analytics** — Runs Total/24h/Complete, Hybrid vs. Full, Token-Usage, Kosten-Estimate, Top Sites, 14-Tage-Sparkline.

## A.14 Multi-Site-Ökosystem
| Domain | Zweck |
|--------|-------|
| portfolio.medvesek.com | Klassisches Portfolio |
| design.medvesek.com | Freelance-Projekte (cme-lab Repo) |
| **lab.medvesek.com** | **CME.exe — dieses Repo** |

Cross-Links in beide Richtungen erwünscht.

