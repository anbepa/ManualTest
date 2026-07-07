"use strict";
// CI entry point: takes the Serenity "bundle" JSON exported from manual-execution
// and materializes it on disk (feature file + evidence images + per-step results),
// then writes the engine TSV consumed by ManualResults.java.
//
// Usage:  node ci/materialize.js <path-to-bundle.json>
//
// Reuses the SAME conversion logic as the local Manual BDD Studio (webapp), so the
// Gherkin/TSV/evidence format is guaranteed identical.
const fs = require("fs");
const path = require("path");

const importer = require(path.join(__dirname, "..", "webapp", "lib", "importer"));
const runner = require(path.join(__dirname, "..", "webapp", "lib", "runner"));

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("Usage: node ci/materialize.js <bundle.json>");
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
