"use strict";
const fs = require("fs");
const path = require("path");
const { parseFeature, serializeFeature } = require("./gherkin");

const ROOT = path.resolve(__dirname, "..", "..");
const FEATURES_DIR = path.join(ROOT, "src", "test", "resources", "features");
const EVIDENCES_DIR = path.join(ROOT, "evidences");
const DATA_DIR = path.join(ROOT, "webapp", "data");
const RESULTS_FILE = path.join(DATA_DIR, "results.json");

for (const d of [FEATURES_DIR, EVIDENCES_DIR, DATA_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function safeFeatureName(name) {
  const base = path.basename(String(name || ""));
  if (!/^[\w.\- ]+$/.test(base)) throw new Error("Invalid feature file name");
  return base.endsWith(".feature") ? base : base + ".feature";
}
function safeEvidenceName(name) {
  const base = path.basename(String(name || ""));
  if (!/^[\w.\- ]+\.(png|jpg|jpeg|gif|webp|pdf)$/i.test(base))
    throw new Error("Invalid evidence file name");
  return base;
}

// ---------- Features ----------
function listFeatures() {
  return fs.readdirSync(FEATURES_DIR)
    .filter((f) => f.endsWith(".feature"))
    .map((f) => {
      const text = fs.readFileSync(path.join(FEATURES_DIR, f), "utf8");
      const parsed = parseFeature(text);
      return { file: f, feature: parsed };
    });
}
function readFeature(file) {
  const f = safeFeatureName(file);
  const text = fs.readFileSync(path.join(FEATURES_DIR, f), "utf8");
  return { file: f, feature: parseFeature(text) };
}
function writeFeature(file, feature) {
  const f = safeFeatureName(file);
  fs.writeFileSync(path.join(FEATURES_DIR, f), serializeFeature(feature), "utf8");
  return readFeature(f);
}
function createFeature(file, name, description) {
  const f = safeFeatureName(file);
  const full = path.join(FEATURES_DIR, f);
  if (fs.existsSync(full)) throw new Error("Feature file already exists");
  const feature = {
    name: name || f.replace(/\.feature$/, ""),
    description: description ? [description] : [],
    tags: [], scenarios: [],
  };
  return writeFeature(f, feature);
}
function deleteFeature(file) {
  const f = safeFeatureName(file);
  fs.unlinkSync(path.join(FEATURES_DIR, f));
  return { ok: true };
}
function addScenario(file, scenario) {
  const { feature } = readFeature(file);
  feature.scenarios.push(normalizeScenario(scenario));
  return writeFeature(file, feature);
}
function updateScenario(file, index, scenario) {
  const { feature } = readFeature(file);
  if (index < 0 || index >= feature.scenarios.length) throw new Error("Scenario index out of range");
  feature.scenarios[index] = normalizeScenario(scenario);
  return writeFeature(file, feature);
}
function deleteScenario(file, index) {
  const { feature } = readFeature(file);
  if (index < 0 || index >= feature.scenarios.length) throw new Error("Scenario index out of range");
  feature.scenarios.splice(index, 1);
  return writeFeature(file, feature);
}
function normalizeScenario(s) {
  return {
    name: String(s.name || "Untitled scenario").trim(),
    type: s.type === "Scenario Outline" ? "Scenario Outline" : "Scenario",
    tags: Array.isArray(s.tags) ? s.tags.filter(Boolean) : [],
    steps: (Array.isArray(s.steps) ? s.steps : [])
      .filter((st) => st && st.text && String(st.text).trim())
      .map((st) => ({ keyword: st.keyword || "Given", text: String(st.text).trim() })),
    extra: Array.isArray(s.extra) ? s.extra : [],
  };
}

// ---------- Evidence ----------
function listEvidence() {
  if (!fs.existsSync(EVIDENCES_DIR)) return [];
  return fs.readdirSync(EVIDENCES_DIR)
    .filter((f) => /\.(png|jpg|jpeg|gif|webp|pdf)$/i.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(EVIDENCES_DIR, f));
      return { name: f, size: st.size, modified: st.mtime };
    });
}
function saveEvidence(name, base64) {
  const f = safeEvidenceName(name);
  const data = String(base64).replace(/^data:[^;]+;base64,/, "");
  fs.writeFileSync(path.join(EVIDENCES_DIR, f), Buffer.from(data, "base64"));
  return { name: f };
}
function deleteEvidence(name) {
  const f = safeEvidenceName(name);
  const full = path.join(EVIDENCES_DIR, f);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  return { ok: true };
}

// ---------- Results (manual pass/fail + evidence PER STEP) ----------
// Model:
//   results[scenarioName] = {
//     notes: "scenario-level note",
//     steps: { "0": {status, evidence, notes}, "1": {...} },
//     updatedAt: ISO
//   }
function getResults() {
  if (!fs.existsSync(RESULTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")); }
  catch { return {}; }
}
function saveResults(all) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(all, null, 2), "utf8");
}
function getScenario(all, name) {
  const sc = all[name] || {};
  if (!sc.steps) sc.steps = {};
  all[name] = sc;
  return sc;
}
// Set the manual result for a SINGLE step of a scenario.
function setStepResult(scenarioName, stepIndex, result) {
  const idx = parseInt(stepIndex, 10);
  if (!Number.isInteger(idx) || idx < 0) throw new Error("Invalid step index");
  const all = getResults();
  const sc = getScenario(all, scenarioName);
  sc.steps[String(idx)] = {
    status: ["passed", "failed", "pending"].includes(result.status) ? result.status : "passed",
    evidence: result.evidence || "",
    notes: result.notes || "",
  };
  sc.updatedAt = new Date().toISOString();
  saveResults(all);
  return sc.steps[String(idx)];
}
// Optional scenario-level note.
function setScenarioNote(scenarioName, result) {
  const all = getResults();
  const sc = getScenario(all, scenarioName);
  if (result.notes !== undefined) sc.notes = result.notes || "";
  sc.updatedAt = new Date().toISOString();
  saveResults(all);
  return sc;
}

module.exports = {
  ROOT, FEATURES_DIR, EVIDENCES_DIR, DATA_DIR, RESULTS_FILE,
  listFeatures, readFeature, writeFeature, createFeature, deleteFeature,
  addScenario, updateScenario, deleteScenario,
  listEvidence, saveEvidence, deleteEvidence,
  getResults, setStepResult, setScenarioNote, safeEvidenceName,
};
