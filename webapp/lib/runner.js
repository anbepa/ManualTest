"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const ROOT = store.ROOT;
const SERENITY_DIR = path.join(ROOT, "target", "site", "serenity");
const REPORT_INDEX = path.join(SERENITY_DIR, "index.html");
const REPORT_SUMMARY = path.join(SERENITY_DIR, "serenity-summary.html");
const RESULTS_TSV = path.join(store.DATA_DIR, "manual-results.tsv");
const RESULTS_JSON = path.join(store.DATA_DIR, "manual-results.json");

const state = {
  id: null, status: "idle", startedAt: null, endedAt: null,
  exitCode: null, log: [], reportAvailable: false,
};
const subscribers = new Set();

function reportExists() { return fs.existsSync(REPORT_INDEX) || fs.existsSync(REPORT_SUMMARY); }
function reportUrl() {
  if (fs.existsSync(REPORT_INDEX)) return "/report/index.html";
  if (fs.existsSync(REPORT_SUMMARY)) return "/report/serenity-summary.html";
  return null;
}

function emit(line) {
  state.log.push(line);
  if (state.log.length > 5000) state.log.shift();
  for (const res of subscribers) {
    try { res.write("data: " + JSON.stringify({ line }) + "\n\n"); } catch (_) {}
  }
}
function subscribe(res) { subscribers.add(res); res.on("close", () => subscribers.delete(res)); }
function isRunning() { return state.status === "running"; }

function b64(s) { return Buffer.from(String(s == null ? "" : s), "utf8").toString("base64"); }

function writeEngineResults() {
  const results = store.getResults();
  // Human-readable snapshot
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(results, null, 2), "utf8");
  // Dependency-free TSV consumed by ManualResults.java. One line PER STEP.
  // Format: base64(scenario) \t stepIndex \t status \t base64(evidence) \t base64(notes)
  const lines = [];
  for (const [name, sc] of Object.entries(results)) {
    const steps = (sc && sc.steps) || {};
    for (const [idx, r] of Object.entries(steps)) {
      const evList = Array.isArray(r.evidences)
        ? r.evidences
        : (r.evidence ? [r.evidence] : []);
      lines.push([
        b64(name),
        String(idx),
        (r.status || "passed"),
        b64(evList.join(";")),
        b64(r.notes || ""),
      ].join("\t"));
    }
  }
  fs.writeFileSync(RESULTS_TSV, lines.join("\n"), "utf8");
  return RESULTS_TSV;
}

function start(options = {}) {
  if (isRunning()) throw new Error("A run is already in progress");
  const resultsFile = writeEngineResults();
  try { fs.rmSync(SERENITY_DIR, { recursive: true, force: true }); } catch (_) {}

  state.id = "run-" + Date.now();
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.endedAt = null; state.exitCode = null; state.reportAvailable = false; state.log = [];

  const isWin = process.platform === "win32";
  const gradle = isWin ? "gradlew.bat" : "./gradlew";
  if (!isWin) { try { fs.chmodSync(path.join(ROOT, "gradlew"), 0o755); } catch (_) {} }
  const tasks = options.tasks || ["clean", "test", "aggregate"];
  const args = [
    ...tasks,
    "-Dmanual.headless=true",
    "-Dmanual.results.file=" + resultsFile,
    "-Dmanual.evidences.dir=" + store.EVIDENCES_DIR,
    "--console=plain",
    "--offline",
  ];
  if (options.tests) args.push("--tests", options.tests);

  emit("[web] Directorio:      " + ROOT);
  emit("[web] Comando:         " + gradle + " " + args.join(" "));
  emit("[web] Resultados:      " + resultsFile);
  emit("[web] Evidencias:      " + store.EVIDENCES_DIR);
  emit("");

  let child;
  try {
    child = spawn(gradle, args, { cwd: ROOT, env: process.env, shell: isWin });
  } catch (e) {
    emit("[web] No se pudo iniciar Gradle: " + e.message);
    state.status = "error"; state.endedAt = new Date().toISOString();
    return getState();
  }

  const onData = (buf) => { for (const l of buf.toString().split(/\r?\n/)) emit(l); };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  child.on("error", (e) => {
    emit("[web] Error de proceso: " + e.message);
    state.status = "error"; state.endedAt = new Date().toISOString();
  });

  child.on("close", (code) => {
    state.exitCode = code;
    state.endedAt = new Date().toISOString();
    const hasReport = reportExists();
    if (state.status === "running") state.status = hasReport ? (code === 0 ? "passed" : "failed") : "error";
    emit("");
    emit("[web] Finalizado. Exit code: " + code + " · estado: " + state.status);
    if (hasReport) emit("[web] Reporte listo: " + reportUrl());
    else emit("[web] No se generó el reporte Serenity. Revisa el log (¿red/artifactory/JDK?).");
  });

  return getState();
}

function getState() {
  return {
    id: state.id, status: state.status,
    startedAt: state.startedAt, endedAt: state.endedAt, exitCode: state.exitCode,
    reportAvailable: reportExists(), reportUrl: reportUrl(),
    logTail: state.log.slice(-400),
  };
}

module.exports = { start, writeEngineResults, getState, subscribe, isRunning, reportUrl, reportExists, SERENITY_DIR, REPORT_INDEX, REPORT_SUMMARY };
