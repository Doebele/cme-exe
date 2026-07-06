# Phase 1c — ASCII-Boot (C) + Asteroids (E) + Sound-Layer

> Bindend für Frontend-Agent. Backend unverändert. Stand: 2026-06-29.

## 1. Was gebaut wird

Die letzten α+-Stücke plus Vervollständigung des Sound-Designs.

### Stück C — ASCII-Boot-Sequenz
CRT-Power-On-Animation beim Erstbesuch (~3 Sek), dann „decodiert" die Seite zur normalen Darstellung.

### Stück E — Asteroids-Game „Designer's Quest"
Vector-Asteroids-Game als Easter Egg / Reward. Spieler schießt auf Design-Probleme (Stakeholder, Scope Creep, Tech Debt, etc.); jeder Treffer entfesselt einen Maeda-Micro-Quote.

### Sound-Layer (Vervollständigung)
Bisher nur `playDiscoverySting`. Neu: Boot-Sound, Hover-Sound, Shoot/Explosion-SFX, Game-BGM. Alle via Tone.js synthetisiert (Higgsfield-Assets kommen später).

## 2. Architektur

- **Frontend-only** — keine Backend-Änderungen.
- **Pure Canvas für Asteroids** — kein p5.js (sonst Bundle zu groß). Vector-Grafik direkt auf `<canvas>` mit `shadowBlur` für Glow.
- **CSS/GSAP für Boot** — keine Extra-Engine.
- **Tone.js für Sound** — bereits installiert.

## 3. Stück C — ASCII-Boot-Sequenz

### 3.1 `frontend/src/components/BootSequence.tsx`

Vollbild-Overlay, das beim App-Start angezeigt wird.

**Trigger-Logik:**
- Liest `behavior.bootMode` aus `/api/content/settings` (Werte: `"always"` | `"first-visit"` | `"off"`, Default: `"first-visit"`).
- Bei `"off"`: gar nicht anzeigen.
- Bei `"first-visit"`: prüfe `localStorage["cme_exe_booted"]`. Falls gesetzt, skip. Sonst anzeigen und Flag nach Abschluss setzen.
- Bei `"always"`: immer anzeigen (für Dev/Demo).

**Phasen (Total ~3 Sek):**

**Phase 1 — CRT Power-On (~600ms)**
- Screen startet pitch-black.
- Kurzer weißer Flash (1 Frame).
- Scanlines fade-in von oben nach unten.
- Subtiles CRT-Curve-Vignette erscheint.

**Phase 2 — BIOS-POST Text (~1500ms)**
- Zeile für Zeile erscheint (typewriter-style, ~80ms/Zeile) in Fira Mono, theme primary color, phosphor glow:
  ```
  CME.EXE v0.1.0 — AI × DESIGN LAB
  (C) 2026 CLAUS MEDVESEK. ALL RIGHTS RESERVED.
  
  MEMORY CHECK................. 65536K OK
  LOADING THE OBSERVER......... OK
  LOADING THE MACHINE.......... OK
  LOADING THE CURATOR.......... OK
  ANTHROPIC LINK............... [HYBRID ACTIVE]
  THEME........................ VECTOR-GREEN
  
  PRESS ANY KEY TO ENTER
  ```
- Die Zeile `ANTHROPIC LINK............... [HYBRID ACTIVE]` zeigt `[HYBRID ACTIVE]` wenn `/api/health` `anthropic: true` zurückgibt, sonst `[VISITOR KEY REQUIRED]`.
- Theme-Name aus `localStorage["cme_exe_theme"]` oder Default.

**Phase 3 — ASCII Logo Decode (~700ms)**
- Ein großes ASCII-Art-Logo `CME.exe` erscheint zunächst als random chars, die sich dann zum finalen Logo „decodieren" (Matrix-Style).
- Logo-Vorlage (vereinfacht):
  ```
   ____  ____ ___  ____   ___   ____   ___   __   _
  / ___||  _ \_ _|  _ \ / _ \ / ___| / _ \ / /  / |
  | |   | |_) | || |_) | | | | |  _ | | | |/ /   | |
  | |___|  __/| ||  _ <| |_| | |_| || |_| / /    | |
  \____||_|  |___|_| \_\\___/ \____| \___/_/     |_|
  ```
- Falls zu kompliziert: einfaches Wort-Logo in Fira Mono, das von „decodiertem" Zustand aus random chars erscheint.

**Phase 4 — Fade Out (~200ms)**
- Overlay fade-out, darunter wird die normale Site sichtbar.

**User kann boot skippen:**
- Any key press → sofort Phase 4.
- Click anywhere → sofort Phase 4.
- Skip-Button „SKIP ▶" unten rechts.

### 3.2 Integration in `Lab.tsx`

`BootSequence` wird als erstes Child von `<div className="min-h-screen...">` gerendert, als Fixed-Overlay mit `z-index: 100`. Nach Abschluss (`onDone` callback) wird es via State aus dem DOM entfernt.

### 3.3 Replay-Button

Ein kleiner Easter-Egg-Button „⟲ REPLAY BOOT" im Footer (neben den Cross-Links). Klick → Boot-Sequenz erneut abspielen (unabhängig von `cme_exe_booted`-Flag).

### 3.4 Reduced-Motion

Bei `prefers-reduced-motion: reduce`:
- Kein Flash, keine Scanline-Animation.
- Text erscheint sofort komplett.
- Logo ohne Decode, direkt final.
- Gesamtdauer ~500ms.

## 4. Stück E — Asteroids „Designer's Quest"

### 4.1 `frontend/src/sections/QuestSection.tsx` (REPLACE stub)

**States:**
- `idle`: Start-Screen mit Logo „DESIGNER'S QUEST", Anleitung, „▶ START QUEST" Button. High-Score anzeigen falls vorhanden.
- `playing`: Game läuft.
- `paused`: Pause-Overlay (ESC oder P).
- `gameOver`: End-Screen mit Score, ggf. neuem High-Score, „PLAY AGAIN" + „RETURN" Buttons.

### 4.2 `frontend/src/components/quest/GameCanvas.tsx`

Pure-Canvas-Game-Engine. Kein p5.js.

**Spielmechanik:**
- Canvas-Größe: responsive, max 800x600, aspect-ratio 4:3.
- Spieler-Schiff: Dreieck in theme primary color mit Glow.
  - Position: Mitte des Canvas zu Beginn.
  - Rotation: A/D oder ←/→.
  - Thrust: W oder ↑ (beschleunigt in Blickrichtung).
  - Schuss: Space (cooldown 200ms).
- Asteroiden: unregelmäßige Polygone (6-10 Eckpunkte), theme primary mit Glow.
  - Spawnen von Rändern, drift Across screen.
  - Bei Treffer: in 2 kleinere Asteroiden zerfallen (medium → small → destroyed).
  - Jeder Asteroid hat ein Label (Text mittig): Stakeholder, Scope Creep, Tech Debt, Legacy Code, Migration Risk, Accessibility Debt, Performance Issue, Browser Compat.
- Bullets: kleine theme-accent Linien mit Glow, Lebensdauer ~1 Sek.
- Kollisionen: Ship-Asteroid = -1 Leben + kurze Invulnerability (1.5s blinken). Bullet-Asteroid = Asteroid zerstört.
- Lives: 3 (start). Bei 0 → Game Over.
- Score: +20 (large), +50 (medium), +100 (small) pro Treffer.

**Sound (bei aktiviertem Sound):**
- Shoot: `playShootSound()` (Tone.js synth, kurzer blip).
- Hit: `playExplosionSound()` (noise burst).
- Game-BGM: `startGameBgm()` beim Spielstart, `stopGameBgm()` bei Game Over.

**Maeda-Quotes bei Treffer:**
- Bei jeder Asteroiden-Zerstörung (small → destroyed): 30% Chance, einen Maeda-Quote einzublenden.
- Quote erscheint als Overlay-Text über dem zerstörten Asteroid für 2 Sek, dann fade-out.
- Quotes aus `/api/content/maeda-quotes` (bereits vorhanden).
- random pick, nicht wiederholen bis alle gezeigt wurden.

**Mobile Controls:**
- Touch-Buttons unten: ←, →, THRUST, FIRE.
- Volle Breite, ~15% Screen height.

**Theme-Awareness:**
- Schiffs-, Asteroiden-, Bullet-Farben aus CSS-Variablen lesen (getComputedStyle beim Game-Start).
- Bei Theme-Switch während Spiels: Farben updaten (Game-Loop liest bei jedem Frame? oder einmal?).
- Empfehlung: einmal beim Start lesen + bei Theme-Switch (MutationObserver).

### 4.3 `frontend/src/hooks/useAsteroids.ts`

State-Machine für das Game:
```typescript
export interface GameState {
  status: "idle" | "playing" | "paused" | "gameOver";
  score: number;
  lives: number;
  highScore: number;
}

export interface UseAsteroids extends GameState {
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  endGame: () => void;
  resetHighScore: () => void;
}
```

- High-Score persistiert in `localStorage["cme_exe_quest_highscore"]`.
- Pause: P oder ESC.

## 5. Sound-Layer (Vervollständigung)

### 5.1 Erweiterung `frontend/src/lib/audio.ts`

**Neue Funktionen (alle idempotent, respektieren `enabled` state):**

- `playBootSound()` — CRT Power-On Glitch. Synth:
  ```javascript
  // Sweep from 50Hz to 800Hz over 1.5s + noise burst at start
  const noise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.01, decay: 0.3, sustain: 0 } }).toDestination();
  noise.volume.value = -10;
  noise.triggerAttackRelease(0.3);
  
  const osc = new Tone.Oscillator(50, "square").toDestination();
  osc.volume.value = -20;
  osc.frequency.rampTo(800, 1.5);
  osc.start();
  osc.stop("+1.5");
  ```

- `playHoverSound()` — Subtiler Klick (~50ms):
  ```javascript
  // 1kHz sine blip at low volume
  ```
  - Rate-limit: max 1 alle 100ms (sonst nervt).

- `playShootSound()` — Laser-Blip (~150ms):
  ```javascript
  // 800Hz → 200Hz ramp, square wave, ~150ms
  ```

- `playExplosionSound()` — Noise-Burst (~400ms):
  ```javascript
  // White noise + lowpass filter sweep, ~400ms
  ```

- `startGameBgm()` / `stopGameBgm()` — Chiptune-Loop:
  ```javascript
  // Simple 4-note loop sequence using Tone.Loop / Tone.Sequence
  // Bass + melody, ~120 BPM
  // Use Tone.Transport for start/stop
  ```

### 5.2 Wiring

- **Boot:** `BootSequence.tsx` ruft `playBootSound()` bei Phase 1.
- **Hover:** Auf `Stage`-Stationen und Oracle/Sketch Cards: `onMouseEnter={() => playHoverSound()}`. Optional für MVP — kann auch auf Phase 2 verschoben werden, falls zu nervig.
- **Asteroids:** `GameCanvas.tsx` ruft `playShootSound()` / `playExplosionSound()` / `startGameBgm()` / `stopGameBgm()`.

## 6. Skip für MVP (Phase 1c.1)

- Touch-Gyro-Steuerung (nur Buttons).
- Multi-Level / Wave-System (ein endlose Wave reicht für Easter Egg).
- Power-Ups.
- High-Score-Leaderboard (nur local).
- Hover-Sound überall (nur in Quest).

## 7. Akzeptanzkriterien

- [x] Boot-Sequenz läuft beim ersten Besuch (~3 Sek), danach nicht mehr (außer „always" mode).
- [x] Boot kann mit Tastendruck/Click skippen.
- [x] Replay-Button im Footer startet Boot erneut.
- [x] Boot zeigt korrekten Theme-Namen + Anthropic-Status an.
- [x] Reduced-Motion: Boot ohne Animation, ~500ms.
- [x] Asteroids: Spiel läuft, Schiffe bewegen/schießen, Asteroiden zerfallen.
- [x] Maeda-Quotes erscheinen bei ~30% der kleinen Treffer.
- [x] High-Score wird in localStorage gespeichert.
- [x] Mobile: Touch-Buttons funktionieren.
- [x] Game-BGM startet/stoppt mit Spiel.
- [x] Theme-Switch während Boot/Spiel wird visuell korrekt angewendet.
- [x] Keine neuen npm-Abhängigkeiten.
