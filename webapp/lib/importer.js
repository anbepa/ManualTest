"use strict";
// Imports a self-contained JSON "bundle" exported from manual-execution and
// materializes it on disk exactly as Manual BDD Studio expects, so the user can
// then press "Generar Reporte Serenity" (Gradle) manually.
//
// Bundle shape:
//   {
//     "schemaVersion": 1,
//     "run": { "id", "name", "huTitle", "testPlanTitle" },
//     "feature": { "name", "description":[], "tags":[], "scenarios":[
//         { "name", "type", "tags":[], "steps":[ {"keyword","text"} ] } ] },
//     "results": { "<scenarioName>": { "steps": { "0": {status, evidences:[names], notes} }, "notes" } },
//     "evidences": [ { "name":"ev-0-0-0.png", "base64":"data:image/png;base64,..." } ]
//   }
const fs = require("fs");
const path = require("path");
const store = require("./store");
const { serializeFeature } = require("./gherkin");

const ALLOWED_EXT = /\.(png|jpg|jpeg|gif|webp|pdf)$/i;

function clearDir(dir, filterRe) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (filterRe && !filterRe.test(f)) continue;
    try { fs.unlinkSync(path.join(dir, f)); n++; } catch (_) {}
  }
  return n;
}

function safeName(name) {
  const base = path.basename(String(name || ""));
  return base.replace(/[^\w.\- ]/g, "_");
}

function decodeBase64(data) {
  const s = String(data || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(s, "base64");
}

function validate(bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("Bundle invalido: no es un objeto JSON");
  if (!bundle.feature || !Array.isArray(bundle.feature.scenarios))
    throw new Error("Bundle invalido: falta feature.scenarios");
  if (bundle.results && typeof bundle.results !== "object")
    throw new Error("Bundle invalido: results debe ser un objeto");
  if (bundle.evidences && !Array.isArray(bundle.evidences))
    throw new Error("Bundle invalido: evidences debe ser un arreglo");
}

function safeFeatureFileName(bundle) {
  let base = (bundle.run && (bundle.run.name || bundle.run.id)) || (bundle.feature && bundle.feature.name) || "reporte";
  base = String(base).toLowerCase().replace(/[^\w\- ]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "reporte";
  return base + ".feature";
}

function importBundle(bundle) {
  validate(bundle);

  // 1) Clean previous state so the Serenity report reflects ONLY this bundle.
  const removedFeatures = clearDir(store.FEATURES_DIR, /\.feature$/i);
  const removedEvidence = clearDir(store.EVIDENCES_DIR, ALLOWED_EXT);
  try { if (fs.existsSync(store.RESULTS_FILE)) fs.unlinkSync(store.RESULTS_FILE); } catch (_) {}

  // 2) Write evidences (base64 -> files).
  let savedEvidence = 0;
  const evErrors = [];
  for (const ev of bundle.evidences || []) {
    try {
      const name = safeName(ev && ev.name);
      if (!ALLOWED_EXT.test(name)) { evErrors.push(name + " (extension no permitida)"); continue; }
      fs.writeFileSync(path.join(store.EVIDENCES_DIR, name), decodeBase64(ev.base64 || ev.data));
      savedEvidence++;
    } catch (e) { evErrors.push(((ev && ev.name) || "?") + ": " + e.message); }
  }

  // 3) Write the .feature file (reusing the same serializer as the UI).
  const feature = {
    name: (bundle.feature && bundle.feature.name) || "Reporte manual",
    description: Array.isArray(bundle.feature.description)
      ? bundle.feature.description
      : (bundle.feature.description ? [bundle.feature.description] : []),
    tags: Array.isArray(bundle.feature.tags) ? bundle.feature.tags : [],
    scenarios: (bundle.feature.scenarios || []).map((s) => ({
      name: String((s && s.name) || "Escenario"),
      type: s && s.type === "Scenario Outline" ? "Scenario Outline" : "Scenario",
      tags: Array.isArray(s && s.tags) ? s.tags : [],
      steps: (Array.isArray(s && s.steps) ? s.steps : [])
        .filter((st) => st && st.text != null && String(st.text).trim())
        .map((st) => ({ keyword: st.keyword || "Given", text: String(st.text).trim() })),
      extra: [],
    })),
  };
  const featureFile = safeFeatureFileName(bundle);
  fs.writeFileSync(path.join(store.FEATURES_DIR, featureFile), serializeFeature(feature), "utf8");

  // 4) Write results.json (supports MULTIPLE evidences per step via `evidences`).
  const results = {};
  for (const [scenarioName, sc] of Object.entries(bundle.results || {})) {
    const steps = {};
    for (const [idx, r] of Object.entries((sc && sc.steps) || {})) {
      const raw = Array.isArray(r.evidences) ? r.evidences : (r.evidence ? [r.evidence] : []);
      const names = raw.map(safeName).filter(Boolean);
      steps[String(idx)] = {
        status: ["passed", "failed", "pending"].includes(r.status) ? r.status : "passed",
        evidence: names[0] || "",   // keeps the single-select UI happy
        evidences: names,           // full list consumed by the engine
        notes: r.notes || "",
      };
    }
    results[scenarioName] = { steps, notes: (sc && sc.notes) || "", updatedAt: new Date().toISOString() };
  }
  fs.writeFileSync(store.RESULTS_FILE, JSON.stringify(results, null, 2), "utf8");

  return {
    ok: true,
    featureFile,
    scenarios: feature.scenarios.length,
    steps: feature.scenarios.reduce((a, s) => a + s.steps.length, 0),
    savedEvidence,
    removedFeatures,
    removedEvidence,
    evErrors,
  };
}

module.exports = { importBundle, validate };
