# Speedrun-Agent (H) — Implementation Contract

> Bindend für Backend- und Frontend-Agent. Stand: 2026-06-29. Phase 1a MVP.

## 1. Was gebaut wird

Ein KI-Agent ("THE OBSERVER") "besucht" live die Seite. Besucher schaut zu, wie der Agent durch Claus' Werk navigiert und in Echtzeit darüber nachdenkt. Am Ende schreibt "THE CURATOR" ein Manifest.

## 2. Architektur-Entscheidung: Virtuelles Modell (Hybrid)

**KEINE echte DOM-Navigation / Computer-Use.** Statt dessen: Der Agent navigiert ein virtuelles Modell von Claus' Werk (Sektionen + Items aus `lab-facts.json`). Vorteile:
- Zuverlässig (keine Mouse-Coordinate-Frickelei)
- Schnell (keine Browser-Steuerung)
- Kostengünstig (kleinerer Context, semi-scripted Action-Raum)
- Live-LLM-Thoughts bleiben erhalten (das ist der Wow)

## 3. Datenmodell: Run State

Gespeichert unter `data/runs/{runId}.json`:

```json
{
  "id": "r-abc123def456",
  "status": "running" | "complete",
  "startedAt": "2026-06-29T12:00:00.000Z",
  "completedAt": null | "2026-06-29T12:01:15.000Z",
  "visitorMode": "hybrid" | "full",
  "currentLocation": { "section": "hero", "item": null },
  "history": [
    {
      "step": 0,
      "thought": "Let me start by understanding who Claus is...",
      "action": { "type": "navigate", "target": "about", "item": null },
      "timestamp": "2026-06-29T12:00:02.000Z",
      "latencyMs": 850
    }
  ],
  "manifest": null | "Three things stand out..."
}
```

## 4. Backend Endpoints

Alle unter Prefix `/api/speedrun`. Auth-Logik wie bei `/api/ai/*`: Full-Mode (visitor-key via `Authorization: Bearer` oder `X-Visitor-Key`) bypasses Rate-Limit, Hybrid-Mode zählt gegen IP-Rate-Limit.

### 4.1 `POST /api/speedrun/start`

**Request Body:**
```json
{ "visitorApiKey": "sk-ant-..." }   // optional, für Full-Mode
```

**Response (201):**
```json
{
  "runId": "r-abc123def456",
  "initialState": {
    "section": "hero",
    "item": null,
    "availableSections": ["hero", "about", "works", "career", "skills"],
    "availableItems": { "works": ["beyond-design", ...], "career": [...] }
  }
}
```

**Side Effect:** Legt `data/runs/{runId}.json` mit `status: "running"`, leerem `history`-Array, `currentLocation: {section:"hero"}` an.

### 4.2 `POST /api/speedrun/step`

**Request Body:**
```json
{ "runId": "r-abc123def456", "visitorApiKey": "sk-ant-..." }   // visitorApiKey optional
```

**Response (200):**
```json
{
  "step": 5,
  "thought": "Wait — MetaDesign SF in 2000? Then NOSE...",
  "action": { "type": "navigate", "target": "career", "item": "metadesign" },
  "done": false,
  "latencyMs": 920
}
```

**Oder (wenn Agent fertig):**
```json
{
  "step": 12,
  "thought": "I've seen enough. Time to write the manifest.",
  "action": { "type": "done" },
  "done": true,
  "latencyMs": 780
}
```

**Side Effect:** Hängt den Step ans `history`-Array an; updated `currentLocation` falls Navigate.

### 4.3 `POST /api/speedrun/manifest`

**Request Body:**
```json
{ "runId": "r-abc123def456", "visitorApiKey": "sk-ant-..." }
```

**Response (200):**
```json
{
  "manifest": "Three things stand out in Claus' body of work...\n\n[3 paragraphs]...\n\nA designer who treats the algorithm as material."
}
```

**Side Effect:** Setzt `manifest` und `status: "complete"`, `completedAt` Timestamp.

## 5. Page State (für Claude)

Das Backend baut aus `lab-facts.json` + aktuellem Run-State einen "Page State", der an Claude geschickt wird:

```json
{
  "step": 5,
  "currentLocation": { "section": "works", "item": "beyond-design" },
  "visitedThisRun": [
    { "section": "hero", "item": null },
    { "section": "about", "item": null },
    { "section": "works", "item": "beyond-design" }
  ],
  "availableSections": ["hero", "about", "works", "career", "skills"],
  "availableItems": {
    "works": ["beyond-design", "design-library", "bookscreening", "imo", "key4-si", "myway", "uds"],
    "career": ["freelance-1995", "eclat", "metadesign", "nose", "namics", "ubs-design-systems", "ubs-lead"],
    "skills": ["UX Research", "Design Systems", "Prototyping", "Visual Design", "Workshop Facilitation", "AI for Design"]
  },
  "currentItemDetails": {
    "title": "Beyond Design",
    "category": "Design Systems",
    "year": "2025",
    "description": "Comprehensive design system initiative..."
  }
}
```

## 6. Observer System Prompt

Wird aus `data/personas.json` → `observer.systemPrompt` geladen. Erwartet Claude-Output als JSON:

```
{
  "thought": "1-2 sentences inner monologue",
  "action": {
    "type": "navigate" | "observe" | "done",
    "target": "section id (hero|about|works|career|skills)",
    "item": "optional item id within section"
  }
}
```

### Verhalten:
- **navigate**: Cursor bewegt sich zu neuem section/item.
- **observe**: Bleibt am currentLocation, schaut genauer hin, kommentiert.
- **done**: Run ist beendet, Curator übernimmt.

### Constraints für den Agent-Loop:
- Schritt 0: Pflicht-Navigate zu `about` (Agent beginnt mit Bio).
- Zwischen Schritten 1-10: Frei Wahl (Navigate oder Observe), aber Target muss aus availableSections/Items stammen.
- Schritt ≥ 8: Backend injiziert "Consider wrapping up soon." in den User-Prompt.
- Schritt ≥ 13: Backend zwingt `done` (Hard Cap für MVP).

### JSON-Output sicherstellen:
Backend nutzt Anthropic-Tool-Use oder strikten JSON-Modus. Falls Claude invalides JSON liefert → Retry mit klärungs-Prompt (max 1 Retry), dann Fallback: `{"thought": "(observer paused)", "action":{"type":"observe"}}`.

## 7. Curator System Prompt

Aus `data/personas.json` → `curator.systemPrompt`. Input: alle Thoughts aus `history`. Output: 3-Absatz Prosa-Manifest.

## 8. Frontend Komponenten

### 8.1 SpeedrunSection.tsx  (ersetzt Stub)

Container-Komponente. Zeigt:
- Links/rechts (Desktop): **Stage** (visualisiert Claus' Werk als Stationen) + **ThoughtStream** (Side Panel).
- Mobile: vertikaler Stack; ThoughtStream als Caption-Overlay über der Stage.

**States:**
- `idle`: Zeigt "Start"-Button + kurze Erklärung.
- `running`: Stage + ThoughtStream + Cursor-Animation.
- `manifest`: Manifest-Karte mit Typewriter.
- `replay`: Wie `running`, aber mit gespeicherter History (keine API-Calls außer initial GET).

### 8.2 useSpeedrun.ts (Hook)

Orchestriert die Run-Lifecycle:

```typescript
const {
  status,           // "idle" | "starting" | "running" | "manifest" | "replay" | "error"
  currentStep,      // aktuelle Step-Number
  thoughts,         // Array aller { step, thought, action }
  currentLocation,  // { section, item }
  manifest,         // finaler Text oder null
  runId,            // aktuelle/nachste Run-ID
  start,            // () => Promise<void>
  replay,           // (runId: string) => Promise<void>
  share,            // () => string  (gibt URL zurück)
  error,
} = useSpeedrun();
```

**Flow bei `start()`:**
1. `POST /api/speedrun/start` (mit visitorApiKey falls vorhanden)
2. Loop: `POST /api/speedrun/step` → warte `stepDelayMs` (für Animation) → bis `done: true`
3. `POST /api/speedrun/manifest`
4. Status → `manifest`

**Flow bei `replay(runId)`:**
1. `GET /api/runs/:runId` → bekomme kompletten Run-State
2. Spiele `history` Schritt für Schritt ab (mit festem Timing, keine neuen API-Calls)
3. Zeige `manifest` am Ende

### 8.3 Stage.tsx

Visualisiert Claus' Werk als Grid von "Stationen":
- **Hero-Station** (zentral, größer) — "Claus Medvesek / Head of Design"
- **Works-Row** — 7 Work-Cards
- **Career-Timeline** — 7 Stationen als horizontale Linie
- **Skills-Grid** — 6 Skill-Badges

Jede Station ist ein quadratischer/kleiner Card mit Title + Year. Inaktive Stationen: geringe Opacity. Aktive Station (wo Cursor gerade ist): Glow + leichter Scale.

### 8.4 VirtualCursor.tsx

Ein SVG-Vektor-Pfeil (theme-color, Glow), der zwischen Stationen animiert wird. Mit Trail (3-5 Echo-Pfeilen mit abnehmender Opacity).

**Animation:** GSAP, `ease: "power2.inOut"`, Dauer ~1.2s. Der Cursor "schwebt" leicht im Idle-Zustand (Sinus-Bewegung).

### 8.5 ThoughtStream.tsx

Side-Panel (Desktop rechts, Mobile unten als Caption):
- Zeigt aktuellen Thought mit **Typewriter-Effekt** (40-60ms pro Zeichen).
- Vorherige Thoughts als Scroll-History (gray, smaller).
- Persona-Label oben: `THE OBSERVER` in Fira Mono, theme-color, glow.
- Live-Indikator (pulse-dot) während laufe.

### 8.6 ManifestCard.tsx

Wird am Ende angezeigt:
- Title: `THE CURATOR // MANIFEST`
- Typewriter-Effekt für den Manifest-Text.
- Danach: Action-Buttons `Replay` und `Share` (Share kopiert URL `#observer/r-{runId}` in Clipboard).

### 8.7 Marginalia.tsx (optional für MVP)

Kleine Notiz-Boxen, die an aktiven Stationen erscheinen (z.B. "Tidy grid. Token-driven."). Kann auf Phase 1a.2 verschoben werden.

## 9. Mobile (D4-b)

Für MVP akzeptabel:
- Stage kleiner, ThoughtStream als Caption unten.
- Cursor-Animation etwas schneller.
- Runs kürzer (~45s statt 75s) — Backend-Schritt-Cap anpassen auf ~10 für Mobile.

Später: echtes TikTok-Format mit vertikalem Scroll.

## 10. Error Handling

- Claude-API-Fehler → zeige "Observer stepped away..." im ThoughtStream, versuche 1x Retry nach 2s, dann Run als komplett markieren mit Fehler-Manifest.
- Network-Fehler → "Connection lost" + Retry-Button.
- Run-ID nicht gefunden (Replay) → "This run has expired (24h TTL)."

## 11. Kosten-Limit

- Hybrid-Mode: 1 Run ≈ 12 Steps × ~2k tokens in/out = ~24k tokens. Bei Haiku: ~$0.02/Run. Bei Sonnet: ~$0.20/Run.
- Backend trackt Tokens pro Run in `history[i].latencyMs` und Run-Metadata (zusätzliches Feld `usage`).
- Bei deaktiviertem `ANTHROPIC_API_KEY`: Hybrid disabled, nur Full-Mode (visitor-key) möglich. Frontend zeigt Hinweis: "Hybrid mode disabled. Add your API key to start."

## 12. Skip für MVP (Phase 1a.1)

- Marginalia-Overlay (kommt in 1a.2)
- Mobile TikTok-Format (kommt in 1a.2)
- Sound-Triggers (kommt in Phase 1c)
- GSAP-Brücken zwischen Sections (kommt in Phase 3)

## 13. Akzeptanzkriterien

- [ ] Besucher kann "Start Speedrun" clicken und sieht Agent in ~60-75s durch Claus' Werk navigieren.
- [ ] ThoughtStream zeigt Live-LLM-Thoughts mit Typewriter-Effekt.
- [ ] Virtueller Cursor animiert zwischen Stationen.
- [ ] Am Ende erscheint das Manifest mit Typewriter-Effekt.
- [ ] Besucher kann "Share" klicken und URL mit Run-ID kopieren.
- [ ] Besucher kann geteilte URL (`#observer/r-xxx`) öffnen und sieht Replay.
- [ ] Theme-Switch (Vector-Green → CRT-Amber → Y2K) funktioniert live während des Runs.
- [ ] Hybrid-Mode funktioniert mit Server-Key; Full-Mode mit Visitor-Key.
