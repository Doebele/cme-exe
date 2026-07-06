# Phase 1b — Oracle (A) + Prompt→Sketch (B) Contract

> Bindend für Backend- und Frontend-Agent. Stand: 2026-06-29.

## 1. Was gebaut wird

Zwei interaktive Stücke, die die bestehende Infrastruktur (Dual-Mode AI, Theme-System, ApiKeyWidget, Sound) wiederverwenden.

### Stück A — Terminal Oracle "THE MACHINE"
Besucher stellt eine Frage (Text), "THE MACHINE" antwortet im Stil eines CRT-Terminals mit Typewriter-Effekt. Themenscope: Design × Tech × Business, AI, Computational Design. Persona aus `data/personas.json → machine`.

### Stück B — Prompt → Sketch
Besucher gibt einen Prompt ein, Claude generiert p5.js-Code, Code läuft live in sandboxed iframe. Galerie aller Skizzen (localStorage, optional server-side).

## 2. Architektur: Wiederverwendung bestehender Infra

Beide Stücke nutzen die bereits gebauten Endpunkte `/api/ai/claude` (Hybrid) und `/api/ai/proxy` (Full) — KEINE neuen Backend-Routen nötig.

Vorteile:
- Keine Duplizierung der Auth/Ratelimit/Logging-Logik.
- Persona-Wechsel über `systemPrompt`-Feld im Request-Body.
- Backend bleibt generisch.

## 3. Stück A: Terminal Oracle

### 3.1 Frontend `frontend/src/sections/OracleSection.tsx` (ersetzt Stub)

**Layout (Desktop):**
- Centered terminal window (max-width 800px).
- Header: `THE MACHINE` in Fira Mono, theme primary, glow. Live-Indikator (pulse-dot) wenn Antwort streamt.
- Body: Scroll-History von Q/A-Paaren.
- Footer: Input-Zeile mit Prompt-Symbol `>` + Textbox + Send-Button.
- Unten: kurzer Disclaimer "THE MACHINE is a persona, not Claus. Curated responses within design × tech × business scope."

**Layout (Mobile):**
- Full-screen terminal (height: 100vh minus nav).
- Input sticky am Bottom.

**States:**
- `idle`: Begrüßungsmessage "Ask the Machine about design, technology, or the spaces between." + Beispiel-Prompts als klickbare Chips (z. B. "What is computational design?", "How does AI change creativity?", "Why does simplicity matter?").
- `thinking`: Input disabled, Cursor blinkt, "..." animation.
- `streaming`: AntwortSchreibmaschine mit SSE-Stream von /api/ai/claude (stream:true).
- `error`: Bei 503 hybridDisabled → "Hybrid mode disabled. Add your API key (top right) or try a different question." Bei Rate-Limit (429) → "Rate limit reached. Try again in {minutes} min, or use your own API key."
- `reduced-motion`: Sofort完整er Text statt Typewriter.

### 3.2 Frontend `frontend/src/components/oracle/TerminalWindow.tsx`

Visuelles CRT-Terminal mit:
- CRT-Scanlines (bereits via `body::before` oder neu).
- Phosphor-Glow auf Text (text-shadow mit theme primary color).
- Optionaler Cursor-Blink (CSS animation).
- Scrollbar-Theming (theme-aware).

### 3.3 Frontend `frontend/src/hooks/useOracle.ts`

```typescript
export interface QAPair { id: string; question: string; answer: string; timestamp: string; }
export interface UseOracle {
  history: QAPair[];
  status: "idle" | "thinking" | "streaming" | "error";
  partialAnswer: string;       // für live-typewriter während stream
  error: string | null;
  ask: (question: string) => Promise<void>;
  reset: () => void;
}
```

**`ask()` Flow:**
1. Append `{ question, answer: "" }` zur History. Status → "thinking".
2. Read visitor API key via `getApiKey()`.
3. POST /api/ai/claude (Hybrid) oder /api/ai/proxy (Full):
   - Body: `{ systemPrompt: personas.machine.systemPrompt + ORACLE_OUTPUT_INSTRUCTION, messages: [{role:"user", content: question}], stream: true }`.
   - personas.machine wird vom Frontend via `GET /api/content/personas` geladen (diese Route gibt bereits die Personas zurück — Frontend kann systemPrompt lesen).
4. SSE-Stream: jedes `data: {type:"token", text}` → append to `partialAnswer`, Status → "streaming".
5. Bei `data: {type:"done"}` → Status → "idle", finalisiere History-Entry.

**Error-Handling:** wie Speedrun — 503 hybridDisabled, 429 rate-limit, network. Mid-Stream-Fehler → partielle Answer behalten, Error-Flag setzen.

### 3.4 ORACLE_OUTPUT_INSTRUCTION (Frontend-Konstante)

```
You are speaking as a terminal oracle. Keep responses concise (50-200 words), dense, and slightly enigmatic. Use line breaks for rhythm. Never use markdown headers or bullet points — plain prose with short paragraphs only. You may end with a question that turns the visitor's inquiry back on them.
```

### 3.5 Beispiel-Prompts (idle-state)
- "What is computational design?"
- "How does AI change creativity?"
- "Why does simplicity matter?"
- "What is the difference between UX and AX?"
- "Can a machine have taste?"

## 4. Stück B: Prompt → Sketch

### 4.1 Frontend `frontend/src/sections/SketchSection.tsx` (ersetzt Stub)

**Layout (Desktop):**
- Links (40%): Input-Panel.
  - Textarea für Prompt.
  - "Generate Sketch" Button.
  - Optional: Style-Presets als Chips ("Vector", "Geometric", "Particle", "Wave").
- Rechts (60%): Sketch-Preview.
  - Iframe (sandbox="allow-scripts") für generierten p5.js Code.
  - Über dem Iframe: Code-Viewer (kollabierbar) mit live-typewriter während Generierung.

**Layout (Mobile):**
- Stack: Input oben, Iframe darunter (~50vh).

**States:**
- `idle`: Begrüßung "Describe a sketch. The Machine will draw it." + Beispiel-Prompts.
- `generating`: Code-Viewer zeigt Code mit Typewriter, Iframe noch leer.
- `running`: Iframe zeigt generierte Sketch (live).
- `error`: Wie Oracle, plus syntax-error-Fallback (falls p5-Code invalide).

### 4.2 Frontend `frontend/src/hooks/useSketch.ts`

```typescript
export interface Sketch { id: string; prompt: string; code: string; timestamp: string; }
export interface UseSketch {
  current: Sketch | null;
  gallery: Sketch[];      // localStorage-persisted
  status: "idle" | "generating" | "running" | "error";
  partialCode: string;
  error: string | null;
  generate: (prompt: string, preset?: string) => Promise<void>;
  rerun: (sketchId: string) => void;
  reset: () => void;
}
```

### 4.3 SKETCH_SYSTEM_PROMPT_ADDON (Frontend-Konstante)

```
You are generating a complete, runnable p5.js sketch in global mode. Rules:
- Output ONLY the JavaScript code, no markdown fences, no explanation.
- Use the global mode setup() and draw() functions.
- Canvas size 600x400.
- Read theme colors from CSS variables on the parent document:
  - bg = getComputedStyle(parent.document.documentElement).getPropertyValue('--color-bg').trim() || '#0a0e0a'
  - primary = ... '--color-text-primary' ...
  - accent = ... '--color-accent' ...
  Use these in background() and stroke()/fill() calls so the sketch matches the site theme.
- Make the sketch interactive (mouse or time-based) where appropriate.
- Keep it under 100 lines. No external assets.
- The code MUST be syntactically valid JavaScript that runs without errors.
```

### 4.4 Iframe-Setup

```typescript
const html = `<!DOCTYPE html>
<html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.10/p5.min.js"></script></head>
<body style="margin:0;background:transparent;overflow:hidden;">
<script>${sketch.code}</script>
</body></html>`;
iframe.srcdoc = html;
```

Achtung: p5.js wird im Iframe via CDN geladen. Sollte ~3 KB gzipped sein wenn cached.

### 4.5 Gallery

- localStorage key `cme_exe_sketches` — Array von `{ id, prompt, code, timestamp }`.
- Max 20 Einträge, dann älteste raus.
- Mini-Preview in Grid (kleines Iframe thumbnail).
- Click → lädt Sketch in Hauptansicht.
- Optional für MVP: kann auch auf Phase 1b.2 verschoben werden.

## 5. Backend: KEINE neuen Routen

Alle AI-Calls gehen durch bestehende `/api/ai/claude` (Hybrid) und `/api/ai/proxy` (Full).

`GET /api/content/personas` liefert bereits `{ observer, machine, curator }` mit systemPrompts. Frontend nutzt `personas.machine.systemPrompt` als Basis für Oracle.

## 6. Sound (Optional für 1b)

- Oracle: Optional `typing`-Sound (kurze Click-SFX pro Token im Stream). Kann auf 1c verschoben werden.
- Sketch: `sketch-glitter` (bereits in lib/audio.ts? falls nein, später ergänzen) wenn Code zu streamen anfängt.

Für MVP: ohne Sound, kommt in 1c.

## 7. Skip für MVP (Phase 1b.1)

- Voice-Output für Oracle (D9 offen, später).
- Multi-turn-Conversation (Oracle vergisst vorherige Fragen nach Reset).
- Sketch-Gallery server-side (erstmal localStorage-only).
- Style-Preset-Auswahl im Detail (zunächst nur freies Prompt).

## 8. Akzeptanzkriterien

- [ ] Besucher kann Frage im Oracle eingeben und bekommt Streaming-Antwort.
- [ ] Beispiel-Prompts sind klickbar.
- [ ] Error-States (503/429/network) werden sauber angezeigt.
- [ ] Theme-Switch funktioniert während Oracle-Antwort (Text-Farbe ändert sich live).
- [ ] Besucher kann Prompt eingeben und bekommt lauffähige p5-Sketch im Iframe.
- [ ] Bei p5-Code-Fehlern: saubere Fehlermeldung statt broken iframe.
- [ ] Gallery (falls gebaut): Skizzen bleiben über Reload erhalten.
- [ ] Mobile: beide Stücke nutzbar.
