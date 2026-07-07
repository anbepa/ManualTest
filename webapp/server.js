"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const store = require("./lib/store");
const runner = require("./lib/runner");
const importer = require("./lib/importer");

const PORT = process.env.PORT || 4321;
const PUBLIC_DIR = path.join(__dirname, "public");
const ROOT = store.ROOT;
const SERENITY_DIR = path.join(ROOT, "target", "site", "serenity");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".ico": "image/x-icon",
};
function mime(p) { return MIME[path.extname(p).toLowerCase()] || "application/octet-stream"; }

function send(res, code, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": headers["Content-Type"] || "application/json; charset=utf-8", ...headers });
  res.end(data);
}
function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" }); }
function fail(res, code, msg) { sendJson(res, code, { error: msg }); }

function serveStatic(res, baseDir, relPath, fallback) {
  let filePath = path.join(baseDir, relPath);
  if (!filePath.startsWith(baseDir)) return fail(res, 403, "Forbidden");
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
  if (!fs.existsSync(filePath)) {
    if (fallback) filePath = fallback; else return fail(res, 404, "Not found");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return fail(res, 404, "Not found");
    res.writeHead(200, { "Content-Type": mime(filePath) });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 200 * 1024 * 1024) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname);
  const parts = pathname.split("/").filter(Boolean); // e.g. ["api","features","x.feature"]
  const method = req.method.toUpperCase();

  try {
    // ---- Static: evidences ----
    if (parts[0] === "evidences") {
      return serveStatic(res, store.EVIDENCES_DIR, parts.slice(1).join("/"));
    }
    // ---- Static: serenity report ----
    if (parts[0] === "report") {
      const rel = parts.slice(1).join("/") || "index.html";
      return serveStatic(res, SERENITY_DIR, rel, runner.REPORT_SUMMARY);
    }

    // ---- API ----
    if (parts[0] === "api") {
      // health
      if (parts[1] === "health") return sendJson(res, 200, { ok: true, root: ROOT });

      // ----- Features -----
      if (parts[1] === "features") {
        // /api/features
        if (parts.length === 2) {
          if (method === "GET") return sendJson(res, 200, { features: store.listFeatures() });
          if (method === "POST") {
            const b = await readBody(req);
            return sendJson(res, 201, store.createFeature(b.file, b.name, b.description));
          }
        }
        const file = parts[2];
        // /api/features/:file
        if (parts.length === 3) {
          if (method === "GET") return sendJson(res, 200, store.readFeature(file));
          if (method === "DELETE") return sendJson(res, 200, store.deleteFeature(file));
          if (method === "PUT") {
            const b = await readBody(req);
            const { feature } = store.readFeature(file);
            if (b.name !== undefined) feature.name = b.name;
            if (b.description !== undefined) feature.description = Array.isArray(b.description) ? b.description : [b.description];
            return sendJson(res, 200, store.writeFeature(file, feature));
          }
        }
        // /api/features/:file/scenarios
        if (parts.length === 4 && parts[3] === "scenarios") {
          if (method === "POST") {
            const b = await readBody(req);
            return sendJson(res, 201, store.addScenario(file, b));
          }
        }
        // /api/features/:file/scenarios/:index
        if (parts.length === 5 && parts[3] === "scenarios") {
          const idx = parseInt(parts[4], 10);
          if (method === "PUT") { const b = await readBody(req); return sendJson(res, 200, store.updateScenario(file, idx, b)); }
          if (method === "DELETE") return sendJson(res, 200, store.deleteScenario(file, idx));
        }
      }

      // ----- Evidence -----
      if (parts[1] === "evidence") {
        if (parts.length === 2) {
          if (method === "GET") return sendJson(res, 200, { evidence: store.listEvidence() });
          if (method === "POST") { const b = await readBody(req); return sendJson(res, 201, store.saveEvidence(b.name, b.data)); }
        }
        if (parts.length === 3) {
          if (method === "DELETE") return sendJson(res, 200, store.deleteEvidence(parts[2]));
        }
      }

      // ----- Results (per step) -----
      if (parts[1] === "results") {
        if (parts.length === 2) {
          if (method === "GET") return sendJson(res, 200, { results: store.getResults() });
          if (method === "PUT") {
            const b = await readBody(req);
            if (!b.scenario) return fail(res, 400, "scenario is required");
            return sendJson(res, 200, store.setScenarioNote(b.scenario, b));
          }
        }
        // /api/results/step  -> set the result of a single step
        if (parts.length === 3 && parts[2] === "step" && method === "PUT") {
          const b = await readBody(req);
          if (!b.scenario || b.stepIndex === undefined || b.stepIndex === null)
            return fail(res, 400, "scenario and stepIndex are required");
          return sendJson(res, 200, store.setStepResult(b.scenario, b.stepIndex, b));
        }
      }

      // ----- Run / Report -----
      if (parts[1] === "run") {
        if (parts.length === 2) {
          if (method === "POST") { const b = await readBody(req); return sendJson(res, 202, runner.start(b || {})); }
          if (method === "GET") return sendJson(res, 200, runner.getState());
        }
        if (parts.length === 3 && parts[2] === "stream" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write("retry: 3000\n\n");
          const state = runner.getState();
          for (const line of state.logTail) res.write("data: " + JSON.stringify({ line }) + "\n\n");
          runner.subscribe(res);
          return;
        }
      }

      // ----- Import bundle (JSON exported from manual-execution) -----
      if (parts[1] === "import" && parts.length === 2 && method === "POST") {
        const b = await readBody(req);
        return sendJson(res, 200, importer.importBundle(b));
      }

      return fail(res, 404, "Unknown API route: " + method + " " + pathname);
    }

    // ---- Frontend (SPA) ----
    const rel = parts.join("/") || "index.html";
    return serveStatic(res, PUBLIC_DIR, rel, path.join(PUBLIC_DIR, "index.html"));
  } catch (e) {
    return fail(res, 400, e.message || "Bad request");
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  Manual BDD Studio  ->  http://localhost:" + PORT);
  console.log("  Project root:       " + ROOT);
  console.log("");
});
