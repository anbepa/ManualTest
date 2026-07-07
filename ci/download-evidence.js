"use strict";
// CI tool: downloads files from Supabase Storage using the official JS client.
// The REST API was unreliable; @supabase/supabase-js handles auth correctly.
//
// Usage:
//   node ci/download-evidence.js --bundle <storagePath> <outFile>
//     storagePath is just the file path inside the bucket (no bucket prefix).
//     Example: 754f69.../temp/serenity-xxx.json
//
//   node ci/download-evidence.js --evidence <bundle.json> <outDir>
//     Reads bundle.evidenceMap and downloads all evidence images.

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const BUCKET = process.env.EVIDENCE_BUCKET || "execution-evidence";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("[download] ERROR: SUPABASE_URL y SUPABASE_SERVICE_KEY requeridos");
  process.exit(1);
}

// Lazy-load supabase client (installed by workflow)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    // Polyfill WebSocket for Node.js < 22
    try { globalThis.WebSocket = require("ws"); } catch (_) {}
    const { createClient } = require("@supabase/supabase-js");
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _supabase;
}

async function downloadFile(bucketPath, destPath) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(bucketPath);

  if (error) {
    throw new Error(`Supabase download error: ${error.message}`);
  }
  if (!data) {
    throw new Error("No data returned");
  }

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const buffer = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

async function downloadBundle() {
  const storagePath = process.argv[3];
  const outFile = process.argv[4];

  if (!storagePath || !outFile) {
    console.error("Usage: node ci/download-evidence.js --bundle <storagePath> <outFile>");
    process.exit(1);
  }

  // storagePath from Vercel is "execution-evidence/userId/temp/file.json"
  // Strip bucket prefix if present
  const bucketPath = storagePath.replace(/^execution-evidence\//, "");

  console.log(`[download] Descargando bundle: ${bucketPath}`);
  await downloadFile(bucketPath, outFile);
  console.log(`[download] Bundle: ${outFile} (${fs.statSync(outFile).size} bytes)`);
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
        // evidenceMap values are like "userId/execId/imgId.ext"
        return downloadFile(supabasePath, destPath);
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
(async () => {
  if (mode === "--bundle") {
    await downloadBundle();
  } else if (mode === "--evidence") {
    await downloadEvidence();
  } else {
    console.error("Usage: --bundle <path> <out> | --evidence <bundle.json> <dir>");
    process.exit(1);
  }
})().catch((e) => {
  console.error("[download] ERROR:", e.message);
  process.exit(1);
});
