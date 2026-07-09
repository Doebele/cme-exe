import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

import authRoutes from "./routes/auth.js";
import aiRoutes from "./routes/ai.js";
import contentRoutes from "./routes/content.js";
import runRoutes from "./routes/runs.js";
import adminRoutes from "./routes/admin.js";
import recordingsRoutes from "./routes/recordings.js";
import speedrunRoutes from "./routes/speedrun.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8093;
const STATIC_DIR = process.env.STATIC_DIR || join(__dirname, "..", "frontend", "dist");

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    console.warn(
      "\x1b[33m[server] WARNING: SESSION_SECRET not set. Using insecure dev fallback. Set SESSION_SECRET in .env before deploy.\x1b[0m"
    );
    return "cme-exe-dev-session-secret-change-me";
  })();

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
// Trust the reverse proxy (Nginx) so req.protocol reflects the original
// scheme (https) rather than the internal plain-HTTP hop.
app.set("trust proxy", 1);

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // auto: the cookie is marked Secure only when the connection is HTTPS.
    // This fixes sessions on localhost HTTP (NODE_ENV=production but no TLS)
    // while still securing cookies on the live HTTPS deployment.
    cookie: { secure: "auto", maxAge: 24 * 60 * 60 * 1000 },
  })
);

// ----- API routes -----
app.use("/api/auth", authRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/runs", runRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/recordings", recordingsRoutes);
app.use("/api/speedrun", speedrunRoutes);

// ----- Health check (for Docker liveness/readiness probes) -----
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "cme-exe",
    version: "0.1.0",
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    uptime: process.uptime(),
  });
});

// ----- Static frontend (production) -----
if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
}

// ----- SPA fallback -----
// Any non-API GET falls through to index.html (covers /admin/* and piece routes).
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  const indexFile = join(STATIC_DIR, "index.html");
  res.sendFile(indexFile, (err) => {
    if (err) {
      // Frontend not built yet — respond with a minimal 200 so the API still
      // works during backend-only development.
      if (!res.headersSent) {
        return res.status(200).type("text/plain").send("CME.exe backend is running. Frontend not built.");
      }
      next(err);
    }
  });
});

app.listen(PORT, () => {
  console.log(`CME.exe backend running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[server] ANTHROPIC_API_KEY not set — Hybrid mode disabled, Full/visitor-key mode still available.");
  }
});
