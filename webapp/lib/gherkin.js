"use strict";
// Minimal, tolerant Gherkin parser/serializer for manual BDD scenarios.

const STEP_KEYWORDS = ["Given", "When", "Then", "And", "But", "*"];

function parseFeature(text) {
  const lines = String(text).split(/\r?\n/);
  const feature = { name: "", description: [], tags: [], scenarios: [] };
  let current = null;
  let pendingTags = [];
  let inFeatureDesc = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("@")) {
      pendingTags = line.split(/\s+/).filter((t) => t.startsWith("@"));
      continue;
    }
    const feat = line.match(/^Feature:\s*(.*)$/i);
    if (feat) {
      feature.name = feat[1].trim();
      feature.tags = pendingTags; pendingTags = [];
      inFeatureDesc = true;
      continue;
    }
    const sc = line.match(/^(Scenario Outline|Scenario|Example):\s*(.*)$/i);
    if (sc) {
      inFeatureDesc = false;
      current = { name: sc[2].trim(), type: sc[1], tags: pendingTags, steps: [], extra: [] };
      pendingTags = [];
      feature.scenarios.push(current);
      continue;
    }
    const step = line.match(/^(Given|When|Then|And|But|\*)\s+(.*)$/);
    if (step && current) {
      current.steps.push({ keyword: step[1], text: step[2].trim() });
      continue;
    }
    if (inFeatureDesc) {
      feature.description.push(raw.replace(/\s+$/, ""));
    } else if (current) {
      current.extra.push(raw);
    }
  }
  return feature;
}

function serializeFeature(feature) {
  const out = [];
  if ((feature.tags || []).length) out.push(feature.tags.join(" "));
  out.push("Feature: " + (feature.name || "Untitled"));
  for (const d of feature.description || []) {
    const t = String(d).trim();
    if (t) out.push("  " + t);
  }
  out.push("");
  for (const s of feature.scenarios || []) {
    if ((s.tags || []).length) out.push("  " + s.tags.join(" "));
    out.push("  " + (s.type || "Scenario") + ": " + s.name);
    for (const st of s.steps || []) out.push("    " + st.keyword + " " + st.text);
    for (const e of s.extra || []) out.push(e);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

module.exports = { parseFeature, serializeFeature, STEP_KEYWORDS };
