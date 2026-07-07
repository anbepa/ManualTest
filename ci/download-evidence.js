"use strict";
// CI tool: downloads files from Supabase Storage using the service key.
//
// Usage:
//   node ci/download-evidence.js --bundle <storagePath> <outFile>
//     Downloads a single file (the metadata bundle) by its full storage path.
//
//   node ci/download-evidence.js --evidence <bundle.json> <outDir>
//     Reads bundle.evidenceMap and downloads all evidence images in parallel.

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const BUCKET = process.env.EVIDENCE_BUCKET || "execution-evidence";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("[download] ERROR: SUPABASE_URL y SUPABASE_SERVICE_KEY requeridos");
  process.exit(1);
}

function download(supabasePath, destPath) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(supabasePath.replace(/\//g, '___'))}`;
    // Try without encoding first, then with per-segment encoding
    const tryUrls = [
      `${SUPABASE_URL}/storage/v1/object/${supabasePath}`,
    ];

    let attemptIdx = 0;

    function attempt() {
      if (attemptIdx >= tryUrls.length) {
        return reject(new Error(`All URLs failed for ${supabasePath}`));
      }
      const tryUrl = tryUrls[attemptIdx++];

      const parsed = new URL(tryUrl);
      const mod = parsed.protocol === "https:" ? https : http;

      const req = mod.get(tryUrl, {
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "User-Agent": "ManualTest-CI",
        },
      }, (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const dir = path.dirname(destPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(destPath, Buffer.concat(chunks));
            resolve();
          });
        } else if (res.statusCode === 400 || res.statusCode === 404) {
          // Try next URL format
          attempt();
        } else {
          let body = "";
          res.on("data", (c) => body += c.toString());
          res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
        }
      });

      req.on("error", (e) => reject(e));
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("timeout")); });
    }

    attempt();
  });
}

async function downloadBundle() {
  const bundleStoragePath = process.argv[3];
  const outFile = process.argv[4];

  if (!bundleStoragePath || !outFile) {
    console.error("Usage: node ci/download-evidence.js --bundle <storagePath> <outFile>");
    process.exit(1);
  }

  console.log(`[download] Descargando bundle: ${bundleStoragePath}`);
  await download(bundleStoragePath, outFile);
  console.log(`[download] Bundle guardado: ${outFile} (${fs.statSync(outFile).size} bytes)`);
}

async function downloadEvidence() {
  const bundlePath = process.argv[3];
  const outDir = process.argv[4];

  if (!bundlePath || !outDir) {
    console.error("Usage: node ci/download-evidence.js --evidence <bundle.json> <outDir>");
    process.exit(1);
  }

  if (!fs.existsSync(bundlePath)) {
    console.error("Bundle not found: " + bundlePath);
    process.exit(1);
  }

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const evidenceMap = bundle.evidenceMap;

  if (!evidenceMap || Object.keys(evidenceMap).length === 0) {
    console.log("[download] No evidence to download (evidenceMap empty)");
    return;
  }

  const entries = Object.entries(evidenceMap);
  console.log(`[download] Descargando ${entries.length} evidencias...`);

  let ok = 0;
  let fail = 0;
  const concurrency = 8;

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(([bundleName, supabasePath]) => {
        const destPath = path.join(outDir, bundleName);
        return download(supabasePath, destPath);
      })
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") ok++;
      else {
        fail++;
        console.error(`  FAIL ${batch[j][0]}: ${results[j].reason?.message || results[j].reason}`);
      }
    }

    if (i + concurrency < entries.length) {
      process.stdout.write(`  ${Math.min(i + concurrency, entries.length)}/${entries.length}...\r`);
    }
  }

  console.log(`[download] Evidencias: ${ok} OK, ${fail} fallidas`);
}

// ── Entry point ──
const mode = process.argv[2];
if (mode === "--bundle") {
  downloadBundle().catch((e) => { console.error(e.message); process.exit(1); });
} else if (mode === "--evidence") {
  downloadEvidence().catch((e) => { console.error(e.message); process.exit(1); });
} else {
  console.error("Usage: --bundle <path> <out> | --evidence <bundle.json> <dir>");
  process.exit(1);
}
