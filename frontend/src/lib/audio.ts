import * as Tone from "tone";

// ---------------------------------------------------------------------------
// CME.exe audio module.
//
// Thin wrapper around Tone.js. Synthesizes UI / game SFX and a chiptune BGM.
// The shape is forward-compatible with swapping the synths for sampled assets
// (data/settings.json → audio.tracks.*) later.
//
// State machine:
//   enabled (localStorage) ──▶ gates playback
//   initialized (in-memory) ─▶ Tone context created
//
// Tone.start() must run inside a user gesture; callers reach it via
// `initAudio()` (the SoundToggle click is the canonical init moment).
// ---------------------------------------------------------------------------

const STORAGE_KEY = "cme_exe_sound_enabled";
const MASTER_VOLUME_DEFAULT = 0.7;
const STING_VOLUME_DB = -10;
const STING_RATE_LIMIT_MS = 5000;
const HOVER_RATE_LIMIT_MS = 100;

// Cmaj7 arpeggio, bright and short.
const STING_NOTES = ["C5", "E5", "G5", "B5"] as const;
const STING_STEP_SEC = 0.1;

interface AudioState {
  initialized: boolean;
  initializing: Promise<void> | null;
  enabled: boolean;
  masterVolume: number;
  synth: Tone.PolySynth | null;
}

const state: AudioState = {
  initialized: false,
  initializing: null,
  enabled: readEnabled(),
  masterVolume: MASTER_VOLUME_DEFAULT,
  synth: null,
};

const subscribers = new Set<(enabled: boolean) => void>();

function readEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // First visit: no value stored → default ON.
    // After user toggles: "1" = on, "0" = off.
    return stored === null ? true : stored === "1";
  } catch {
    return true; // default on if storage unavailable
  }
}

function persistEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* storage unavailable — non-fatal, state still in-memory */
  }
}

function notify(): void {
  for (const cb of subscribers) cb(state.enabled);
}

/**
 * Boots the Tone.js audio context and creates the discovery-sting synth.
 * Must be invoked from a user gesture (e.g. SoundToggle click). Idempotent —
 * concurrent callers share the same init promise.
 */
export async function initAudio(): Promise<void> {
  if (state.initialized) return;
  if (state.initializing) return state.initializing;

  const promise = (async () => {
    await Tone.start();
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.4 },
    }).toDestination();
    synth.volume.value = STING_VOLUME_DB;
    state.synth = synth;
    state.initialized = true;
  })();

  state.initializing = promise;
  try {
    await promise;
  } finally {
    state.initializing = null;
  }
}

export function setEnabled(enabled: boolean): void {
  state.enabled = enabled;
  persistEnabled(enabled);
  notify();
}

export function isEnabled(): boolean {
  return state.enabled;
}

/**
 * Master volume 0–1, converted to dB. Clamped to a sane floor so silence
 * stays silence rather than producing +Infinity dB.
 */
export function setVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  state.masterVolume = clamped;
  if (state.synth) {
    state.synth.volume.value = clamped <= 0.0001 ? -Infinity : Tone.gainToDb(clamped);
  }
}

let lastStingTs = 0;

/**
 * Plays the synthesized discovery-sting arpeggio. No-op when disabled or
 * before `initAudio()` resolves. Rate-limited to one sting per 5 seconds so
 * a run of aha moments doesn't machine-gun the listener.
 */
export function playDiscoverySting(): void {
  if (!state.enabled || !state.initialized || !state.synth) return;
  const now = Date.now();
  if (now - lastStingTs < STING_RATE_LIMIT_MS) return;
  lastStingTs = now;

  const t0 = Tone.now();
  STING_NOTES.forEach((note, i) => {
    state.synth?.triggerAttackRelease(note, "8n", t0 + i * STING_STEP_SEC);
  });
}

/**
 * Subscribes to enabled-state changes. Returns an unsubscribe fn.
 * Used by the React hook (useAudio) to keep state in sync without polling.
 */
export function subscribe(cb: (enabled: boolean) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Phase 1c sound design — boot glitch, hover blip, game SFX + BGM.
// All functions are idempotent and no-op when disabled or before init.
// ---------------------------------------------------------------------------

/**
 * CRT power-on glitch: white-noise burst + a square-wave sweep 50→800Hz over
 * ~1.5s. Plays once per boot (no rate-limit by design).
 */
/**
 * Synthesised 56k modem handshake (~5.5s). Plays only when audio is enabled.
 *
 * Phase timeline (synced with BootSequence phases):
 *   0.00s  click + line pickup
 *   0.30s  ring pulse (1100 Hz, 0.5s on)
 *   1.10s  answer click
 *   1.30s  CED answer tone (2100 Hz, 1.6s) — the iconic "answering modem" tone
 *   3.00s  training burst A (600 Hz beep 0.2s)
 *   3.30s  training burst B (1800 Hz beep 0.2s)
 *   3.60s  training noise burst (0.3s, band-passed)
 *   4.00s  frequency sweep (600→2400 Hz, 0.4s)
 *   4.50s  training burst C (1300 Hz beep 0.2s)
 *   4.80s  training burst D (2400 Hz beep 0.2s)
 *   5.10s  final confirm (2250 Hz beep 0.3s)
 *   5.50s  silence (CONNECT 56000)
 */
/**
 * Synthesised 56k modem handshake (~6s). Plays only when audio is enabled.
 *
 * Reconstructed after the iconic 1990s dial-up sound: pickup → ring-back →
 * CED answer tone → training bursts (the famous "plink plink plink") → final
 * connect. Tuned to feel nostalgic without being a forensic sample-accurate
 * copy.
 *
 * Phase timeline (synced with BootSequence phases):
 *   0.00s  pickup click + faint line hiss
 *   0.40s  ring-back chord (440+480 Hz) 0.4s on, 0.2s off, 2 cycles
 *   1.80s  ring-back ends, brief silence
 *   2.10s  CED answer tone (2100 Hz) ~0.5s
 *   2.70s  silence (~0.4s) — the "are you there?" pause
 *   3.10s  training phase begins — rapid high-freq plinks:
 *          many 80-120ms bursts between 1500-2800 Hz, staggered every ~120ms
 *   4.50s  rate negotiation: descending chirp (2600→600 Hz, 0.3s)
 *   4.90s  more bursts + bandpass noise
 *   5.40s  final confirm (980 Hz, 0.3s) — "connection established"
 *   5.80s  silence
 */
export function playBootSound(): void {
  if (!state.enabled) return;
  // Lazy-init Tone.js on first sound call. If no user gesture is active,
  // Tone.start() will silently fail and the sound won't play this time —
  // the next user interaction (click, key) will succeed.
  if (!state.initialized) {
    initAudio().catch(() => { /* may fail without user gesture — ok */ });
    return;
  }
  const now = Tone.now();

  // Master gain — kept modest so it doesn't drown out the BIOS typewriter.
  const masterGain = new Tone.Gain(-14);
  masterGain.toDestination();

  // ---- Helpers -----------------------------------------------------------

  const tone = (
    freq: number,
    startOffset: number,
    duration: number,
    type: "sine" | "square" | "triangle" | "sawtooth" = "sine",
    volDb = -8,
    freqEnd?: number,
  ): Tone.Oscillator => {
    const osc = new Tone.Oscillator(freq, type);
    osc.volume.value = volDb;
    osc.connect(masterGain);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
    if (freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(freqEnd, now + startOffset + duration);
    }
    return osc;
  };

  // Two-tone chord helper (ring-back uses 440 + 480 Hz).
  const chord = (
    freqs: number[],
    startOffset: number,
    duration: number,
    type: "sine" | "square" | "triangle" = "sine",
    volDb = -10,
  ): Tone.Oscillator[] => freqs.map((f) => tone(f, startOffset, duration, type, volDb));

  const noiseBurst = (
    startOffset: number,
    duration: number,
    filterFreq: number,
    volDb = -14,
    filterType: "bandpass" | "lowpass" | "highpass" = "bandpass",
    q = 2,
  ): Tone.NoiseSynth => {
    const noise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.005, decay: duration, sustain: 0 },
    });
    const filter = new Tone.Filter(filterFreq, filterType);
    filter.Q.value = q;
    noise.connect(filter);
    filter.connect(masterGain);
    noise.volume.value = volDb;
    noise.triggerAttackRelease(duration, now + startOffset);
    return noise;
  };

  // ---- Phase 1: pickup + line hiss --------------------------------------

  noiseBurst(0.0, 0.04, 700, -22);
  const lineNoise = new Tone.Noise("pink");
  lineNoise.volume.value = -32;
  lineNoise.connect(masterGain);
  lineNoise.start(now + 0.05);
  lineNoise.stop(now + 0.45);

  // ---- Phase 2: ring-back chord (440 + 480 Hz, 0.4s on / 0.2s off) ------

  // Two ring cycles — the iconic "brrrr-brrrr" cadence.
  chord([440, 480], 0.45, 0.4, "sine", -12);
  chord([440, 480], 1.05, 0.4, "sine", -12);

  // Brief silence + pickup click after second ring.
  noiseBurst(1.85, 0.03, 1200, -22);

  // ---- Phase 3: CED answer tone (2100 Hz) -------------------------------

  // The answering modem's "I'm here" tone. Slight attack wobble.
  const ced = tone(2100, 2.1, 0.55, "sine", -6);
  ced.frequency.setValueAtTime(2050, now + 2.1);
  ced.frequency.linearRampToValueAtTime(2100, now + 2.2);

  // Silence between CED and training (the "are you there?" pause).
  // (intentionally no sound 2.65-3.10)

  // ---- Phase 4: training plinks (the iconic part) -----------------------
  //
  // Many short high-frequency bursts at staggered offsets. Real modems
  // negotiate line quality via rapid tone exchanges — the famous
  // "plink-plink-plink-plink" that everyone remembers.

  // 1.5s of dense plinks with frequency variation.
  const plinkFreqs = [
    1850, 2250, 2400, 1650, 2750,
    2400, 2000, 2600, 1750, 2250,
    2800, 2150, 1850, 2400, 1650,
  ];
  let plinkT = 3.10;
  for (const f of plinkFreqs) {
    // Shorter at start, slightly longer toward the end.
    const dur = 0.07 + Math.random() * 0.04;
    tone(f, plinkT, dur, "square", -16);
    // Sometimes add a second tone for chord-like texture.
    if (Math.random() < 0.35) {
      tone(f * 0.66, plinkT, dur, "sine", -22);
    }
    plinkT += 0.085 + Math.random() * 0.04;
  }

  // Bandpass noise sweeps during training — the "sshk-sshk-sshk".
  noiseBurst(3.30, 0.15, 1800, -20, "bandpass", 4);
  noiseBurst(3.80, 0.20, 2200, -20, "bandpass", 4);
  noiseBurst(4.20, 0.18, 1500, -20, "bandpass", 4);

  // ---- Phase 5: rate negotiation (descending chirp) ---------------------

  tone(2600, 4.50, 0.35, "triangle", -16, 600);
  // A complementary ascending echo.
  tone(600, 4.55, 0.30, "triangle", -22, 2200);

  // More plinks during negotiation.
  const negotFreqs = [2400, 1800, 2600, 2000, 2200];
  let negT = 4.85;
  for (const f of negotFreqs) {
    tone(f, negT, 0.08, "square", -18);
    negT += 0.06;
  }

  // ---- Phase 6: final connect -------------------------------------------

  // Brief low-frequency "thump" — connection established.
  tone(980, 5.40, 0.30, "sine", -8);
  // Faint high-frequency confirmation ping.
  tone(2400, 5.45, 0.15, "sine", -18);

  // Dispose all nodes after the handshake completes.
  const disposeCutoff = 6500;
  setTimeout(() => {
    masterGain.dispose();
  }, disposeCutoff);
}

let lastHoverTs = 0;

/**
 * Subtle 1kHz sine blip (~50ms). Rate-limited to one per 100ms.
 */
export function playHoverSound(): void {
  if (!state.enabled || !state.initialized) return;
  const now = Date.now();
  if (now - lastHoverTs < HOVER_RATE_LIMIT_MS) return;
  lastHoverTs = now;

  const osc = new Tone.Oscillator(1000, "sine").toDestination();
  osc.volume.value = -24;
  const t0 = Tone.now();
  osc.start(t0);
  osc.stop(t0 + 0.05);
  setTimeout(() => osc.dispose(), 200);
}

// ---- Speedrun analysis sounds ------------------------------------------

/** @type {Tone.Noise | null} */
let _analysisNoise: Tone.Noise | null = null;
/** @type {Tone.Gain | null} */
let _analysisNoiseGain: Tone.Gain | null = null;
let _lastTypewriterClick = 0;
const TYPEWRITER_CLICK_MIN_MS = 35;

/**
 * Faint typewriter click (~25ms). Rate-limited to ~28 clicks/sec so fast
 * streams don't turn into a buzz. Used per-character by the speedrun
 * ThoughtStream typewriter.
 */
export function playTypewriterClick(): void {
  if (!state.enabled) return;
  if (!state.initialized) {
    initAudio().catch(() => { /* no gesture — skip */ });
    return;
  }
  const now = Date.now();
  if (now - _lastTypewriterClick < TYPEWRITER_CLICK_MIN_MS) return;
  _lastTypewriterClick = now;

  // Brief high-frequency pluck with fast decay.
  const osc = new Tone.Oscillator(1400 + Math.random() * 400, "square");
  osc.volume.value = -28;
  const gain = new Tone.Gain(0);
  gain.toDestination();
  osc.connect(gain);
  const t = Tone.now();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  osc.start(t);
  osc.stop(t + 0.035);
  setTimeout(() => {
    try { osc.dispose(); gain.dispose(); } catch { /* gone */ }
  }, 80);
}

/**
 * Continuous low-volume filtered noise — the "analysis hum". Suggests the
 * machine is reading / thinking. Idempotent.
 */
export function startAnalysisNoise(): void {
  if (!state.enabled) return;
  if (!state.initialized) {
    initAudio().catch(() => { /* no gesture — skip */ });
    return;
  }
  if (_analysisNoise) return;
  const noise = new Tone.Noise("pink");
  const filter = new Tone.Filter(900, "lowpass");
  filter.Q.value = 0.7;
  const gain = new Tone.Gain(0);
  gain.toDestination();
  noise.connect(filter);
  filter.connect(gain);
  noise.start();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(-32, Tone.now() + 0.4);
  _analysisNoise = noise;
  _analysisNoiseGain = gain;
}

/**
 * Stop the analysis hum with a short fade.
 */
export function stopAnalysisNoise(): void {
  if (!_analysisNoise || !_analysisNoiseGain) return;
  const gain = _analysisNoiseGain;
  const noise = _analysisNoise;
  _analysisNoise = null;
  _analysisNoiseGain = null;
  try {
    gain.gain.cancelScheduledValues(Tone.now());
    gain.gain.linearRampToValueAtTime(0, Tone.now() + 0.25);
  } catch { /* ignore */ }
  setTimeout(() => {
    try { noise.stop(); noise.dispose(); gain.dispose(); } catch { /* gone */ }
  }, 350);
}

let _lastBlip = 0;
const RANDOM_BLIP_MIN_MS = 200;

/**
 * Random short electronic blip — pick from a small palette. Plays only
 * occasionally (caller decides frequency). Used to layer motion over the
 * typewriter stream so it feels like a live scanner.
 */
export function playRandomBlip(): void {
  if (!state.enabled) return;
  if (!state.initialized) {
    initAudio().catch(() => { /* no gesture — skip */ });
    return;
  }
  const now = Date.now();
  if (now - _lastBlip < RANDOM_BLIP_MIN_MS) return;
  _lastBlip = now;

  const palette: Array<[number, "sine" | "square" | "triangle"]> = [
    [880, "sine"],
    [1320, "square"],
    [660, "triangle"],
    [1760, "sine"],
    [990, "square"],
  ];
  const [freq, type] = palette[Math.floor(Math.random() * palette.length)]!;
  const osc = new Tone.Oscillator(freq, type);
  osc.volume.value = -22;
  const gain = new Tone.Gain(0);
  gain.toDestination();
  osc.connect(gain);
  const t = Tone.now();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  osc.start(t);
  osc.stop(t + 0.09);
  setTimeout(() => {
    try { osc.dispose(); gain.dispose(); } catch { /* gone */ }
  }, 150);
}

/**
 * Laser blip: square wave ramped 800→200Hz over ~150ms.
 */
export function playShootSound(): void {
  if (!state.enabled) return;
  if (!state.initialized) {
    initAudio().catch(() => { /* no gesture — skip */ });
    return;
  }

  const osc = new Tone.Oscillator(800, "square").toDestination();
  osc.volume.value = -18;
  const t0 = Tone.now();
  osc.frequency.rampTo(200, 0.15, t0);
  osc.start(t0);
  osc.stop(t0 + 0.15);
  setTimeout(() => osc.dispose(), 300);
}

/**
 * Explosion: white-noise burst through a lowpass filter swept 1000→80Hz over
 * ~400ms.
 */
export function playExplosionSound(): void {
  if (!state.enabled) return;
  if (!state.initialized) {
    initAudio().catch(() => { /* no gesture — skip */ });
    return;
  }

  const filter = new Tone.Filter(1000, "lowpass").toDestination();
  const noise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.005, decay: 0.4, sustain: 0 },
  }).connect(filter);
  noise.volume.value = -12;
  const t0 = Tone.now();
  filter.frequency.rampTo(80, 0.4, t0);
  noise.triggerAttackRelease(0.4, t0);
  setTimeout(() => {
    noise.dispose();
    filter.dispose();
  }, 600);
}

// --- Chiptune BGM ----------------------------------------------------------

// Am pentatonic flavored loop, ~120 BPM. Bass on the downbeats, melody on top.
const BGM_BASS: readonly (string | null)[] = ["A2", null, "A2", null, "E2", null, "E2", null];
const BGM_MELODY: readonly (string | null)[] = [
  "A4", null, "C5", "E5",
  "G5", null, "E5", "C5",
];

interface BgmGraph {
  bass: Tone.Synth;
  melody: Tone.Synth;
  bassSeq: Tone.Sequence;
  melodySeq: Tone.Sequence;
}

let bgmGraph: BgmGraph | null = null;

function ensureBgmGraph(): BgmGraph {
  if (bgmGraph) return bgmGraph;
  const transport = Tone.getTransport();
  transport.bpm.value = 120;

  const bass = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.2 },
  }).toDestination();
  bass.volume.value = -18;

  const melody = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.1, release: 0.15 },
  }).toDestination();
  melody.volume.value = -22;

  const bassSeq = new Tone.Sequence(
    (time, note) => {
      if (note) bass.triggerAttackRelease(note, "8n", time);
    },
    [...BGM_BASS],
    "8n",
  );
  const melodySeq = new Tone.Sequence(
    (time, note) => {
      if (note) melody.triggerAttackRelease(note, "16n", time);
    },
    [...BGM_MELODY],
    "8n",
  );
  bassSeq.start(0);
  melodySeq.start(0);

  bgmGraph = { bass, melody, bassSeq, melodySeq };
  return bgmGraph;
}

/**
 * Starts the chiptune BGM loop via Tone.Transport. Idempotent — repeated
 * calls while already playing are no-ops.
 */
export function startGameBgm(): void {
  if (!state.enabled || !state.initialized) return;
  ensureBgmGraph();
  const transport = Tone.getTransport();
  if (transport.state === "started") return;
  transport.start();
}

/**
 * Stops the BGM loop. No-op if not playing.
 */
export function stopGameBgm(): void {
  if (!state.initialized) return;
  const transport = Tone.getTransport();
  if (transport.state === "stopped") return;
  transport.stop();
  transport.position = 0;
}
