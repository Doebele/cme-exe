# URL-Speedrun Feature — Contract

> Bindend für Backend- und Frontend-Agent. Stand: 2026-06-29. Phase 1+ Addon.

## 1. Was gebaut wird

Besucher kann eine **externe URL** eingeben (LinkedIn-Profil, persönliche Website, GitHub-Page, Dribbble, etc.) und der Observer-Agent „besucht" diese live statt nur Claus' eigene Arbeit.

Gleiche UX wie bestehender Speedrun:
- Live-Streaming-Thoughts via SSE (The Observer Persona)
- Stage mit virtueller Site-Map
- Virtueller Cursor navigiert zwischen Stationen
- The Curator schreibt am Ende ein Manifest

## 2. Architektur-Erweiterung (statt Replacement)

Bestehender `/api/speedrun/*` bleibt für Claus' eigene Arbeit. Neue Route `/api/speedrun/url/*` für externe URLs. Frontend bietet Umschalter im SpeedrunSection-UI.

## 3. Backend: URL-Fetcher + Extraktor + neue Routen

### 3.1 `backend/lib/urlFetcher.js`

Exporte:
- `fetchAndExtract(url, opts)` → `{ title, description, sections, items, raw }` oder wirft `FetchError`.

**Pipeline:**
1. **URL-Validierung** (`validateUrl(url)`):
   - Nur `http:` und `https:` Protokolle.
   - Hostname muss auflösbar sein (DNS).
   - **SSRF-Schutz**: Aufgelöste IP darf NICHT in private ranges sein (`10.x.x.x/8`, `172.16.x.x/12`, `192.168.x.x/16`, `127.x.x.x/8`, `169.254.x.x/16`, `::1`, `fc00::/7`). Wirf `BlockedError`.
2. **Fetch mit Timeout (8s)** und **Größenlimit (1 MB HTML)** via `fetch()` Node 20+.
3. **User-Agent** setzen: `cme-exe-observer/0.1 (+https://lab.medvesek.com)` — transparent, identifizierbar.
4. **HTML-Extraktion** (kein cheerio — plain regex für Minimal-Footprint):
   - `<title>` → title
   - `<meta name="description">` → description
   - `<h1>`, `<h2>`, `<h3>` → headings[] (max 30)
   - `<p>` → paragraphs[] (max 50, jeweils max 500 Zeichen)
   - `<li>` → list items (max 30)
   - `<a href>` → links[] (max 30, interne nur)
   - Strip Script/Style/Nav/Footer/SVG/Comments
   - Decode HTML entities
   - Truncate final content auf 8000 Zeichen

**Site-spezifische Extraktoren (optional):**
- LinkedIn: suche nach `<section>` mit `experience`/`education` class
- Generic fallback: alle Headings + Paragraphs

**Rate-Limit:** Pro IP, max 10 URL-Fetches pro Stunde (in-memory counter). Error: 429.

**Caching:** URL-Hash → extrahierter Content für 1 Stunde (in-memory Map). Vermeidet re-fetch bei Replay.

### 3.2 Neue Endpunkte in `backend/routes/speedrun.js`

**(a) `POST /api/speedrun/url/start`**

Body: `{ url: string, visitorApiKey?: string }`

Flow:
1. URL validieren (XHR body).
2. `fetchAndExtract(url)` aufrufen.
3. Page-State bauen aus extrahiertem Content:
   ```json
   {
     "source": "external",
     "sourceUrl": "https://linkedin.com/in/...",
     "subject": {
       "name": <aus title oder h1>,
       "role": <aus meta description oder sub-heading>,
       "location": <falls gefunden, sonst null>
     },
     "sections": ["hero", "about", "works", "skills"],
     "items": {
       "works": [<top 5-10 headings/links als "title" mit optionaler URL>],
       "skills": [<keywords/tags falls gefunden>]
     }
   }
   ```
4. Run-State erstellen (wie bestehend, aber `kind: "url-speedrun"`, mit `sourceUrl` und extrahiertem Page-State).
5. Rate-Limit: 5 URL-Starts pro Stunde pro IP.
6. Response 201: `{ runId, initialState }`.

**(b) `POST /api/speedrun/url/step`** — identisch zu bestehendem `/step`, aber liest Run-State mit `kind: "url-speedrun"`. Step-Logik bleibt gleich (Observer Persona).

**(c) `POST /api/speedrun/url/manifest`** — identisch zu bestehend.

### 3.3 Run-State Schema (Erweiterung)

Bestehendes Schema in `data/runs/{id}.json` wird erweitert:

```json
{
  "id": "r-abc123",
  "kind": "speedrun" | "url-speedrun",   // NEU
  "sourceUrl": "https://...",             // NEU (nur für url-speedrun)
  "externalPageState": { ... },           // NEU: cached extrahierter Content
  "status": "running" | "complete",
  ...
}
```

### 3.4 Page-State Builder Anpassung (`backend/lib/speedrun.js`)

`buildPageState(runRecord)` muss prüfen:
- Wenn `runRecord.kind === "url-speedrun"` → return `externalPageState` (aus Cache/Datei).
- Sonst → bestehende Logik mit `lab-facts.json`.

### 3.5 Observer Persona-Anpassung (`data/personas.json`)

`observer.systemPrompt` muss mit **beiden** Modi umgehen können:
- Für Claus' eigene Site: wie bisher (Personas, lab-facts).
- Für externe URLs: generischere Fragen stellen, die Site kennenlernen, Biases erkennen.

Neue Persona-Variante oder dynamische Prompt-Ergänzung im Code? Empfehlung: dynamische Ergänzung im Code (`lib/speedrun.js → callObserver`):

```javascript
const observerContextPrompt = runRecord.kind === "url-speedrun"
  ? `You are visiting an EXTERNAL website (URL: ${runRecord.sourceUrl}). This is not Claus' work. Explore it with genuine curiosity — what kind of work does this person/company represent? What patterns do you notice? Be respectful but honest. Don't compare to Claus.`
  : `You are visiting Claus Medvesek's experimental design website.`;
```

Observer-System-Prompt + observerContextPrompt + page-state zusammen an Claude.

### 3.6 Sicherheits-Checks (verbindlich)

- **SSRF-Schutz**: DNS-Auflösung + private-IP-Check VOR dem Fetch.
- **URL-Whitelist optional**: Für v1 erstmal alle öffentlichen URLs erlauben (Admin kann später whitelist aktivieren).
- **Content-Sanitization**: Extrahierter Text wird NIE direkt an Browser gesendet ohne JSON-Encoding (automatisch via `res.json()`).
- **No JavaScript Execution**: Server-side fetch parst nur HTML, führt kein JS aus. JavaScript-rendered Sites (SPAs) liefern deshalb wenig Content — das ist OK, Observer kommentiert dann „The page seems empty / JS-rendered".
- **Logging**: URL-Hostname (nicht full URL mit path) für Abuse-Erkennung. Keine Visitor-Keys loggen.
- **Rate-Limits**: URL-Fetch (10/h/IP), URL-Speedrun-Start (5/h/IP).
- **robots.txt**: Für v1 nicht respektiert (would block most social media). Disclaimer im UI: „The Observer fetches the URL server-side to read its content. No tracking pixels or JS from the target site run."

## 4. Frontend: URL-Speedrun UI

### 4.1 `frontend/src/sections/SpeedrunSection.tsx` — Erweiterung

Im `idle`-Zustand, **zusätzlich** zum bestehenden „START SPEEDRUN" Button:

```
[▶ START SPEEDRUN]  (Claus' work — default)

───────────────────────────────────
Or speedrun any URL:

[https://...                              ] [▶ VISIT]

The Observer will fetch the URL and explore it.
```

- Toggle im UI: Radio-Buttons oder Toggle: „Claus' work" vs „External URL".
- Wenn URL-Modus: Input erscheint,„START SPEEDRUN" wird zu „▶ VISIT URL".
- URL-Validierung client-side (regex `^https?://`).
- Fehler-States: invalid URL, fetch failed (timeout/blocked/private IP), rate-limited.

### 4.2 `frontend/src/hooks/useSpeedrun.ts` — Erweiterung

Neue Methoden:
- `startWithUrl(url: string)` — statt `start()` für Claus-Mode.
- Interner State `mode: "claus" | "url"` — welche Art von Run läuft gerade.
- Für URL-Mode: Stage zeigt extrahierte Site-Daten statt Claus' lab-facts.
- `subject`, `works`, `career`, `skills` werden aus `initialState` des URL-Runs geholt statt aus lab-facts fetch.

### 4.3 Stage.tsx Anpassung

Stage muss mit **dynamischen Daten** umgehen:
- Nicht mehr hardcoded Claus-Daten.
- Neu: `subject`, `sections` (liste von `{ id, title, items }`), „works" und „skills" aus props.
- Wenn ein `subject.name` vorhanden → im Hero-Station anzeigen.
- Wenn `subject.role` → Untertitel.
- Works-Station: nimmt `items.works` (kann 0-10 sein).
- Skills-Station: nimmt `items.skills`.
- Falls externe Site wenige Daten liefert → leere Stationen werden ausgeblendet oder zeigen „(no data found)".

### 4.4 Marginalia + Cursor

Funktioniert unverändert — nur mit dynamischeren Station-Daten.

### 4.5 Manifest für URL-Runs

Manifest-Text für URL-Runs unterscheidet sich leicht:
- Reference URL und gefundene Patterns, nicht Claus.
- The Curator bekommt einen anderen Kontext-Touch im Prompt (ähnlich wie Observer oben).

## 5. UX-Flows

### Flow A: Default (Claus' Work)
Bestehend — unverändert.

### Flow B: External URL
1. Besucher landet auf `#observer`.
2. Sieht Toggle „Claus' work" / „External URL".
3. Wählt „External URL".
4. URL-Input erscheint.
5. Besucher gibt `https://www.linkedin.com/in/claus-medvesek/` ein.
6. Click „▶ VISIT URL".
7. Loading-State: „Fetching https://..." (kann 1-5s dauern).
8. Bei Erfolg: Run startet wie gewohnt. Stage zeigt Claus' LinkedIn-Daten.
9. Nach ~60-75s: Manifest.
10. Share-URL teilt den URL-Speedrun.

### Flow C: URL Failed
1. Besucher gibt invalid/private URL ein.
2. Sofortige Fehlermeldung: „The Observer can't reach that URL. Try a public one."
3. Bei SSRF/Timeout: „The URL took too long or is not publicly reachable."
4. Bei Rate-Limit: „You've started too many URL speedruns. Try again in X min."

## 6. Abwärtskompatibilität

- Bestehende `#observer/r-{id}` Share-URLs für Claus-Runs funktionieren weiter.
- Neue URL-Speedrun-Runs haben gleiche ID-Struktur (`r-xxx`), selbe Replay-Logik.
- Replay zeigt Source-URL + externe Site-Daten an.

## 7. Skip für MVP

- Login-geschützte Sites (LinkedIn-Login, GitHub-private, etc.) — Observer kann nur public content lesen.
- Browser-Rendering (Puppeteer) für JS-rendered SPAs — plain HTML only.
- robots.txt-Respect — kommt später.
- URL-Whitelist im Admin — kommt später.

## 8. Akzeptanzkriterien

- [ ] Besucher kann zwischen „Claus' work" und „External URL" wählen.
- [ ] URL-Input validiert `http(s)://`.
- [ ] Backend fetches URL, extrahiert content, cached.
- [ ] SSRF-Schutz blockt private/local IPs.
- [ ] Stage zeigt extrahierte Site-Daten statt hardcoded Claus.
- [ ] Observer navigiert externe Site wie gewohnt, schreibt Live-Commentary.
- [ ] Manifest am Ende referenziert die externe Site.
- [ ] Share-URL funktioniert für URL-Runs.
- [ ] Rate-Limits greifen (10 URL-Fetch/h/IP, 5 URL-Run-Starts/h/IP).
- [ ] Fehler-States (invalid URL, timeout, SSRF) werden sauber angezeigt.
- [ ] Bestehender Claus-Speedrun funktioniert unverändert.
