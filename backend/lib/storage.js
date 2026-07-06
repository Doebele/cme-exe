import { readFile, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// storage.js lives in backend/lib/, data/ lives at the repo root (cme-exe/data),
// sibling to backend/. Hence two levels up.
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "..", "data");

export const LAB_FACTS_FILE = join(DATA_DIR, "lab-facts.json");
export const PERSONAS_FILE = join(DATA_DIR, "personas.json");
export const DESIGN_QUOTES_FILE = join(DATA_DIR, "design-quotes.json");
export const SETTINGS_FILE = join(DATA_DIR, "settings.json");
export const SECTIONS_FILE = join(DATA_DIR, "sections.json");
export const API_KEYS_FILE = join(DATA_DIR, "api-keys.json");
export const RUNS_DIR = join(DATA_DIR, "runs");
export const RECORDINGS_DIR = join(DATA_DIR, "recordings");
export const RECORDINGS_INDEX_FILE = join(RECORDINGS_DIR, "index.json");

/**
 * Read and parse a JSON file. Returns null on missing file or parse error.
 * @param {string} filePath
 * @returns {Promise<any>}
 */
export async function readJson(filePath) {
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Write data as pretty-printed JSON (2-space indent). Ensures the parent
 * directory exists so it works for nested paths like runs/<id>.json.
 * @param {string} filePath
 * @param {any} data
 * @returns {Promise<void>}
 */
export async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
