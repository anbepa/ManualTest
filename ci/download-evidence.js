"use strict";
// CI step: downloads evidence images from Supabase Storage for the execution
// referenced in the metadata bundle, so materialize.js can import them.
//
// Usage: node ci/download-evidence.js <bundle.json> <evidences-dir>
//
// Reads bundle.evidenceMap (bundleName → supabasePath) and downloads each
// file from Supabase using the service key passed via env vars.

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const BUCKET = process.env.EVIDENCE_BUCKET || "execution-evidence";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("[download-evidence] ERROR: SUPABASE_URL y SUPABASE_SERVICE_KEY requeridos");
  process.exit(1);
}

const bundlePath = process.argv[2];
const outDir = process.argv[3];

if (!bundlePath || !outDir) {
  console.error("Usage: node ci/download-evidence.js <bundle.json> <evidences-dir>");
  process.exit(1);
}

if (!fs.existsSync(bundlePath)) {
  console.error("Bundle not found: " + bundlePath);
  process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
const evidenceMap = bundle.evidenceMap;

if (!evidenceMap || Object.keys(evidenceMap).length === 0) {
  console.log("[download-evidence] No evidence to download (evidenceMap empty).");
  process.exit(0);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const entries = Object.entries(evidenceMap);
console.log(`[download-evidence] Descargando ${entries.length} evidencias desde Supabase...`);

function downloadFile(supabasePath, destPath) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(supabasePath)}`;
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;

    const req = mod.get(url, {
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "User-Agent": "ManualTest-CI",
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${supabasePath}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        fs.writeFileSync(destPath, Buffer.concat(chunks));
        resolve();
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function main() {
  let ok = 0;
  let fail = 0;
  const concurrency = 8;

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(([bundleName, supabasePath]) => {
        const destPath = path.join(outDir, bundleName);
        return downloadFile(supabasePath, destPath);
      })
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        ok++;
      } else {
        fail++;
        console.error(`  ✗ ${batch[j][0]}: ${results[j].reason?.message || results[j].reason}`);
      }
    }

    if (i + concurrency < entries.length) {
      process.stdout.write(`\r  Progreso: ${Math.min(i + concurrency, entries.length)}/${entries.length}`);
    }
  }

  console.log(`\n[download-evidence] Completo: ${ok} OK, ${fail} fallidas`);
  if (fail > 0) {
    console.log("[download-evidence] Continuando con las evidencias descargadas...");
  }
}

main().catch((e) => {
  console.error("[download-evidence] Error fatal:", e.message);
  process.exit(1);
});
