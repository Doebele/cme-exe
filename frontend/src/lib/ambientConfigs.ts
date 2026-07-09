import type { AmbientConfig } from "./audio";

// ---------------------------------------------------------------------------
// Per-animation ambient bed configs.
//
// Each hero animation has a distinct, quiet soundscape. All are kept low
// (masterGain ~0.04–0.09) so they sit beneath the boot/modem sounds. The
// BootSection starts the matching bed when the animation is visible + audio
// is ready, and fades it out as the user scrolls away.
// ---------------------------------------------------------------------------

export const AMBIENT_CONFIGS: Record<string, AmbientConfig> = {
  // 1 — digital typewriter bed
  "ascii-materialize": {
    masterGain: 0.05,
    oscs: [
      { freq: 220, type: "sine", detune: -6, gain: 0.5 },
      { freq: 330, type: "sine", detune: 8, gain: 0.3 },
    ],
    noise: { type: "white", filterFreq: 2400, filterType: "bandpass", q: 0.7, gain: 0.18 },
    sweep: { rate: 0.08, depth: 600 },
  },

  // 2 — machine hum + modem ghost
  "console-boot": {
    masterGain: 0.06,
    oscs: [
      { freq: 110, type: "sawtooth", gain: 0.3 },
      { freq: 55, type: "sine", gain: 0.5 },
    ],
    noise: { type: "pink", filterFreq: 500, filterType: "lowpass", gain: 0.25 },
  },

  // 3 — deep space drone
  "rotating-wireframe": {
    masterGain: 0.05,
    oscs: [
      { freq: 55, type: "sawtooth", gain: 0.4 },
      { freq: 82.5, type: "sine", gain: 0.3 },
    ],
    noise: { type: "brown", filterFreq: 400, filterType: "lowpass", gain: 0.2 },
    sweep: { rate: 0.04, depth: 200 },
  },

  // 4 — shimmer pad
  "particle-text": {
    masterGain: 0.045,
    oscs: [
      { freq: 330, type: "triangle", detune: -4, gain: 0.4 },
      { freq: 660, type: "sine", detune: 5, gain: 0.25 },
      { freq: 495, type: "sine", gain: 0.2 },
    ],
  },

  // 5 — airy wind
  "flow-field": {
    masterGain: 0.05,
    oscs: [{ freq: 196, type: "sine", gain: 0.15 }],
    noise: { type: "pink", filterFreq: 900, filterType: "bandpass", q: 0.5, gain: 0.3 },
    sweep: { rate: 0.06, depth: 500 },
  },

  // 6 — synthwave bass drone
  "outrun": {
    masterGain: 0.07,
    oscs: [
      { freq: 82.41, type: "sawtooth", gain: 0.35 }, // E2
      { freq: 41.2, type: "sine", gain: 0.5 },        // E1 sub
    ],
    noise: { type: "white", filterFreq: 300, filterType: "lowpass", gain: 0.08 },
    sweep: { rate: 0.03, depth: 150 },
  },

  // 7 — digital corruption
  "glitch-storm": {
    masterGain: 0.055,
    oscs: [
      { freq: 50, type: "square", gain: 0.2 },
      { freq: 120, type: "sawtooth", detune: 12, gain: 0.15 },
    ],
    noise: { type: "white", filterFreq: 1800, filterType: "bandpass", q: 1.5, gain: 0.25 },
    sweep: { rate: 0.7, depth: 1200 },
  },

  // 8 — warp whoosh
  "hyperspace": {
    masterGain: 0.06,
    oscs: [
      { freq: 65, type: "sine", gain: 0.4 },
      { freq: 130, type: "triangle", gain: 0.2 },
    ],
    noise: { type: "white", filterFreq: 1200, filterType: "highpass", q: 0.5, gain: 0.2 },
    sweep: { rate: 0.12, depth: 800 },
  },

  // 9 — minimal high ambient
  "game-of-life": {
    masterGain: 0.035,
    oscs: [
      { freq: 880, type: "sine", gain: 0.25 },
      { freq: 1320, type: "sine", detune: 7, gain: 0.15 },
    ],
    noise: { type: "white", filterFreq: 4000, filterType: "bandpass", q: 2, gain: 0.06 },
  },
};
