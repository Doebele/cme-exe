# CME.exe — AI × Design Lab

An experimental, award-aimed AI × Design website for Claus Medvesek. Built as a standalone site at `lab.medvesek.com`, sibling to `portfolio.medvesek.com` (classic portfolio) and `design.medvesek.com` (freelance).

This is **not** a traditional portfolio. It is a full art piece (D1-c) exploring Computational Design, AI as co-creator, and the meta-question of what it means when a machine "visits" your work.

## Concept — Combo α+ „The Machine as Co-Author"

| Piece | Role | Status |
|-------|------|--------|
| **C — ASCII Boot** | Intro animation on first visit (~3s) | Planned |
| **A — Terminal Oracle** | Greeting; "the Machine" persona answers questions | Planned |
| **H — Speedrun Agent** | AI agent "visits" the site live, scrolling, clicking, commenting | Planned (MVP) |
| **B — Prompt → Sketch** | Visitor prompts → AI generates p5.js code → runs live | Planned |
| **E — Asteroids Game** | Easter egg / reward; vector game, chiptune | Planned |
| **Chiptune Layer** | Soundtrack via Higgsfield, opt-in | Planned |

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind v4 + three.js + p5.js + Tone.js + xterm.js + react-router-dom
- **Backend:** Node 20 + Express + bcrypt + express-session + JSON file storage
- **AI:** Hybrid (D2-c) — Browser-AI for perception, Claude API (Anthropic) via backend proxy for reasoning. Dual-mode UX (Hybrid default + Full Experience with visitor's own key, Maeda-style inline widget).
- **Hosting:** Strato, Docker, `lab.medvesek.com`

## Multi-Theme System

Three swappable themes via admin:
1. **Vector-Green** (default) — Vectrex/Asteroids neon-green aesthetic
2. **CRT-Amber** — Classic terminal amber-on-black
3. **Y2K-Vaporwave** — Pink/blue/mint/lila chrome

## Quick Start

```bash
# Frontend
cd frontend && npm install && npm run dev    # http://localhost:5173

# Backend
cd backend && npm install && npm run dev     # http://localhost:8093

# Or Docker (production-style)
docker-compose up --build -d                 # http://localhost:8093
```

## Project Structure

```
cme-exe/
├── frontend/              # React + Vite SPA
│   └── src/
│       ├── components/    # Navigation, Footer, ApiKeyWidget (Maeda-style), ThemeToggle, SoundToggle
│       ├── sections/      # Boot, Oracle, Speedrun, Sketch, Quest (the α+ pieces)
│       ├── lib/           # apiKey, aiClient, themes, audio
│       ├── hooks/         # useApiKey, useTheme, useContent
│       ├── admin/         # ThemeTab, AudioTab, PersonasTab, ContentTab, BehaviorTab, AnalyticsTab
│       └── types/
├── backend/               # Express API server
│   ├── server.js
│   ├── routes/            # auth, ai (dual-mode), content, admin
│   └── lib/               # auth, claude, proxy, storage
├── data/                  # JSON storage (lab-facts, personas, settings, maeda-quotes, runs/)
├── Dockerfile
├── docker-compose.yml
└── project-brief.md       # full specification
```

## Admin Area

`/admin` — bcrypt-protected. Tabs for Theme/Visual, Audio, Personas/Voice, Content, Behavior, Analytics/Costs. See `project-brief.md` § 13.8.12.

## API Key UX (Maeda-style)

Inspired by John Maeda's [Design in Tech 2026 app](https://dit-2026-app.john-04e.workers.dev/):

- Inline expand widget in nav (no modal).
- Single unified field: `sk-ant-… or sk-…` (auto-detects provider from key prefix).
- After save: status badge shows detected provider + ✓ (e.g. `Anthropic ✓`).
- Key never displayed; placeholder becomes `(key set — paste to replace)`.
- One-click „Clear key".

Visitors without a key use Hybrid mode (rate-limited, powered by CME.exe's own Claude API). Visitors with their own key get Full Experience (no rate-limit, their key, no server-side logging).

## Status

- **Phase:** 0 → 1 transition. Repo scaffold complete; α+ pieces pending.
- **Brief:** See `project-brief.md` for full specification (migrated from cme-lab § 13).

## License

© 2026 Claus Medvesek. All rights reserved.
