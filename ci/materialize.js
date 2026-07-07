"use strict";
// CI entry point: takes the Serenity "bundle" JSON exported from manual-execution
// and materializes it on disk (feature file + evidence images + per-step results),
// then writes the engine TSV consumed by ManualResults.java.
//
// Usage:  node ci/materialize.js <bundle.json> [--evidence-dir <path>]
//
// When --evidence-dir is provided, evidence files are read from that directory
// (individual files previously uploaded to the Gist) instead of being embedded
// as base64 in the bundle JSON. This avoids Vercel 413 errors for large executions.
const fs = require("fs");
const path = require("path");

const importer = require(path.join(__dirname, "..", "webapp", "lib", "importer"));
const runner = require(path.join(__dirname, "..", "webapp", "lib", "runner"));
const store = require(path.join(__dirname, "..", "webapp", "lib", "store"));

const ALLOWED_EXT = /\.(png|jpg|jpeg|gif|webp|pdf)$/i;

function safeName(name) {
  const base = path.basename(String(name || ""));
  return base.replace(/[^\w.\- ]/g, "_");
}

function decodeBase64(data) {
  const s = String(data || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(s, "base64");
}

// ── CLI args ──
const args = process.argv.slice(2);
const bundlePath = args[0];
let evidenceDir = null;
const evIdx = args.indexOf("--evidence-dir");
if (evIdx >= 0 && args[evIdx + 1]) {
  evidenceDir = args[evIdx + 1];
}

if (!bundlePath) {
  console.error("Usage: node ci/materialize.js <bundle.json> [--evidence-dir <path>]");
  process.exit(1);
}
if (!fs.existsSync(bundlePath)) {
  console.error("Bundle not found: " + bundlePath);
  process.exit(1);
}

let bundle;
try {
  bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
} catch (e) {
  console.error("Invalid JSON bundle: " + e.message);
  process.exit(1);
}

// ── Patch evidence from external dir into the bundle ──
if (evidenceDir && fs.existsSync(evidenceDir)) {
  let patched = 0;
  for (const ev of (bundle.evidences || [])) {
    if (ev.base64) continue;
    const srcPath = path.join(evidenceDir, safeName(ev.name));
    if (fs.existsSync(srcPath)) {
      ev.base64 = fs.readFileSync(srcPath, "utf8").trim();
      patched++;
    }
  }
  console.log("[materialize] Patched " + patched + " evidence files from " + evidenceDir);
}

// ── Materialize ──
try {
  const res = importer.importBundle(bundle);
  const tsv = runner.writeEngineResults();
  console.log("[materialize] feature file : " + res.featureFile);
  console.log("[materialize] scenarios    : " + res.scenarios);
  console.log("[materialize] steps        : " + res.steps);
  console.log("[materialize] evidences    : " + res.savedEvidence);
  if (res.evErrors && res.evErrors.length) {
    console.log("[materialize] evidence warnings: " + JSON.stringify(res.evErrors));
  }
  console.log("[materialize] results TSV  : " + tsv);
} catch (e) {
  console.error("[materialize] FAILED: " + e.message);
  process.exit(1);
}
