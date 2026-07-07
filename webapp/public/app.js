"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const STEP_KW = ["Given", "When", "Then", "And", "But"];
const state = { features: [], selected: null, evidence: [], results: {}, editingIndex: null, es: null, poll: null };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast " + kind;
  setTimeout(() => (t.className = "toast hidden"), 2600);
}

/* ---------------- Tabs ---------------- */
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("active"));
    $$(".tab-panel").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("#tab-" + t.dataset.tab).classList.add("active");
    if (t.dataset.tab === "evidence") loadEvidence();
    if (t.dataset.tab === "run") renderResults();
  })
);

/* ---------------- Features ---------------- */
async function loadFeatures(selectFile) {
  const { features } = await api("/api/features");
  state.features = features;
  const ul = $("#featureList");
  ul.innerHTML = "";
  features.forEach((f) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(f.feature.name || f.file)}</span><span class="fcount">${f.feature.scenarios.length}</span>`;
    li.onclick = () => selectFeature(f.file);
    if (state.selected && state.selected.file === f.file) li.classList.add("active");
    ul.appendChild(li);
  });
  const target = selectFile || (state.selected && state.selected.file) || (features[0] && features[0].file);
  if (target) selectFeature(target);
}

function selectFeature(file) {
  const f = state.features.find((x) => x.file === file);
  if (!f) return;
  state.selected = f;
  $$("#featureList li").forEach((li, i) => li.classList.toggle("active", state.features[i].file === file));
  $("#featureHeader").classList.remove("hidden");
  $("#scenarioEmpty").classList.add("hidden");
  $("#featureTitle").textContent = f.feature.name || f.file;
  $("#featureDesc").textContent = (f.feature.description || []).join(" ").trim();
  $("#featureFile").textContent = f.file;
  renderScenarios();
}

function renderScenarios() {
  const box = $("#scenarioList");
  box.innerHTML = "";
  const f = state.selected;
  if (!f) return;
  f.feature.scenarios.forEach((sc, i) => {
    const card = document.createElement("div");
    card.className = "scenario-card";
    const steps = sc.steps.map((s) => `<div><span class="kw">${esc(s.keyword)}</span> ${esc(s.text)}</div>`).join("");
    const tags = (sc.tags || []).length ? `<span class="sc-tags">${esc(sc.tags.join(" "))}</span>` : "";
    card.innerHTML = `
      <div class="sc-top">
        <div><span class="sc-title">${esc(sc.name)}</span><span class="sc-type">${esc(sc.type)}</span>${tags}</div>
        <div class="sc-actions">
          <button class="btn btn-sm" data-edit="${i}">Editar</button>
          <button class="btn btn-sm btn-danger" data-del="${i}">Eliminar</button>
        </div>
      </div>
      <div class="gherkin">${steps || '<span class="muted">Sin pasos</span>'}</div>`;
    box.appendChild(card);
  });
  box.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openScenarioModal(+b.dataset.edit)));
  box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => deleteScenario(+b.dataset.del)));
}

$("#btnDeleteFeature").onclick = async () => {
  if (!state.selected) return;
  if (!confirm("¿Eliminar el feature " + state.selected.file + "?")) return;
  await api("/api/features/" + encodeURIComponent(state.selected.file), { method: "DELETE" });
  state.selected = null;
  toast("Feature eliminado");
  await loadFeatures();
};

/* ---------------- Feature modal ---------------- */
$("#btnNewFeature").onclick = () => openModal("#featureModal");
$("#btnSaveFeature").onclick = async () => {
  const file = $("#ftFile").value.trim();
  if (!file) return toast("Indica el nombre del archivo", "err");
  try {
    const r = await api("/api/features", { method: "POST", body: JSON.stringify({ file, name: $("#ftName").value.trim(), description: $("#ftDesc").value.trim() }) });
    closeModals(); $("#ftFile").value = $("#ftName").value = $("#ftDesc").value = "";
    toast("Feature creado");
    await loadFeatures(r.file);
  } catch (e) { toast(e.message, "err"); }
};

/* ---------------- Scenario modal ---------------- */
$("#btnAddScenario").onclick = () => openScenarioModal(null);
$("#btnAddStep").onclick = () => addStepRow("Given", "");

function addStepRow(keyword, text) {
  const row = document.createElement("div");
  row.className = "step-row";
  row.innerHTML = `
    <select>${STEP_KW.map((k) => `<option ${k === keyword ? "selected" : ""}>${k}</option>`).join("")}</select>
    <input type="text" value="${esc(text)}" placeholder="open the calculator" />
    <button class="icon-btn" title="Quitar">✕</button>`;
  row.querySelector(".icon-btn").onclick = () => row.remove();
  $("#stepsEditor").appendChild(row);
}

function openScenarioModal(index) {
  state.editingIndex = index;
  $("#stepsEditor").innerHTML = "";
  if (index == null) {
    $("#scenarioModalTitle").textContent = "Nuevo escenario";
    $("#scName").value = ""; $("#scTags").value = ""; $("#scType").value = "Scenario";
    addStepRow("Given", ""); addStepRow("When", ""); addStepRow("Then", "");
  } else {
    const sc = state.selected.feature.scenarios[index];
    $("#scenarioModalTitle").textContent = "Editar escenario";
    $("#scName").value = sc.name; $("#scTags").value = (sc.tags || []).join(" "); $("#scType").value = sc.type || "Scenario";
    (sc.steps.length ? sc.steps : [{ keyword: "Given", text: "" }]).forEach((s) => addStepRow(s.keyword, s.text));
  }
  openModal("#scenarioModal");
}

$("#btnSaveScenario").onclick = async () => {
  if (!state.selected) return;
  const name = $("#scName").value.trim();
  if (!name) return toast("Falta el nombre del escenario", "err");
  const steps = Array.from($("#stepsEditor").children).map((r) => ({
    keyword: r.querySelector("select").value, text: r.querySelector("input").value.trim(),
  })).filter((s) => s.text);
  const scenario = {
    name, type: $("#scType").value,
    tags: $("#scTags").value.trim().split(/\s+/).filter(Boolean),
    steps,
  };
  try {
    const file = encodeURIComponent(state.selected.file);
    if (state.editingIndex == null) await api("/api/features/" + file + "/scenarios", { method: "POST", body: JSON.stringify(scenario) });
    else await api("/api/features/" + file + "/scenarios/" + state.editingIndex, { method: "PUT", body: JSON.stringify(scenario) });
    closeModals(); toast("Escenario guardado");
    await loadFeatures(state.selected.file);
  } catch (e) { toast(e.message, "err"); }
};

async function deleteScenario(index) {
  if (!confirm("¿Eliminar este escenario?")) return;
  const file = encodeURIComponent(state.selected.file);
  await api("/api/features/" + file + "/scenarios/" + index, { method: "DELETE" });
  toast("Escenario eliminado");
  await loadFeatures(state.selected.file);
}

/* ---------------- Evidence ---------------- */
async function loadEvidence() {
  const { evidence } = await api("/api/evidence");
  state.evidence = evidence;
  const grid = $("#evidenceGrid");
  grid.innerHTML = "";
  if (!evidence.length) { grid.innerHTML = '<div class="empty">Aún no hay evidencias.</div>'; return; }
  evidence.forEach((e) => {
    const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(e.name);
    const card = document.createElement("div");
    card.className = "ev-card";
    const thumb = isImg
      ? `<div class="ev-thumb" style="background-image:url('/evidences/${encodeURIComponent(e.name)}')"></div>`
      : `<div class="ev-thumb">📄 PDF</div>`;
    card.innerHTML = `${thumb}
      <div class="ev-meta"><span class="ev-name">${esc(e.name)}</span>
      <button class="icon-btn" title="Eliminar" data-del="${esc(e.name)}">🗑</button></div>`;
    card.querySelector(".ev-thumb").onclick = () => window.open("/evidences/" + encodeURIComponent(e.name), "_blank");
    card.querySelector("[data-del]").onclick = async () => {
      if (!confirm("¿Eliminar " + e.name + "?")) return;
      await api("/api/evidence/" + encodeURIComponent(e.name), { method: "DELETE" });
      toast("Evidencia eliminada"); loadEvidence();
    };
    grid.appendChild(card);
  });
}

$("#evidenceInput").onchange = async (ev) => {
  const files = Array.from(ev.target.files || []);
  for (const file of files) {
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    try { await api("/api/evidence", { method: "POST", body: JSON.stringify({ name: file.name, data }) }); }
    catch (e) { toast(e.message, "err"); }
  }
  ev.target.value = "";
  toast("Evidencia(s) subida(s)");
  loadEvidence();
};

/* ---------------- Results & Run ---------------- */
function allScenarios() {
  const list = [];
  state.features.forEach((f) => f.feature.scenarios.forEach((sc) =>
    list.push({ file: f.file, name: sc.name, steps: sc.steps || [] })));
  return list;
}
function deriveScenarioStatus(statuses) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("pending")) return "pending";
  return "passed";
}

async function renderResults() {
  const { results } = await api("/api/results"); state.results = results;
  try { const { evidence } = await api("/api/evidence"); state.evidence = evidence; } catch {}
  const body = $("#resultsBody"); body.innerHTML = "";
  const scenarios = allScenarios();
  if (!scenarios.length) { body.innerHTML = '<tr><td colspan="4" class="muted">No hay escenarios.</td></tr>'; return; }

  const evOptionsHtml = (selected) => ['<option value="">— sin evidencia —</option>'].concat(
    state.evidence.map((e) => `<option value="${esc(e.name)}" ${selected === e.name ? "selected" : ""}>${esc(e.name)}</option>`)
  ).join("");

  scenarios.forEach((sc) => {
    const scRes = results[sc.name] || { steps: {} };
    const stepResults = scRes.steps || {};
    const steps = sc.steps || [];

    // --- scenario group header ---
    const head = document.createElement("tr");
    head.className = "sc-group";
    const pillId = "pill-" + Math.random().toString(36).slice(2);
    head.innerHTML = `<td colspan="4">
      <span class="sc-name">${esc(sc.name)}</span>
      <span class="chip">${esc(sc.file)}</span>
      <span id="${pillId}" class="pill pill-mini"></span>
    </td>`;
    body.appendChild(head);

    if (!steps.length) {
      const empty = document.createElement("tr");
      empty.innerHTML = '<td colspan="4" class="muted" style="padding-left:20px">Sin pasos</td>';
      body.appendChild(empty);
      return;
    }

    const statusSelects = [];
    const refreshPill = () => {
      const st = deriveScenarioStatus(statusSelects.map((s) => s.value));
      const pill = document.getElementById(pillId);
      if (pill) { pill.className = "pill pill-mini pill-" + st; pill.textContent = st; }
    };

    steps.forEach((step, i) => {
      const sr = stepResults[String(i)] || { status: "passed", evidence: "", notes: "" };
      const tr = document.createElement("tr");
      tr.className = "step-row-result";
      const statusOpts = ["passed", "failed", "pending"].map(
        (s) => `<option value="${s}" ${sr.status === s ? "selected" : ""}>${s}</option>`
      ).join("");
      tr.innerHTML = `
        <td class="step-cell"><span class="kw">${esc(step.keyword)}</span> ${esc(step.text)}</td>
        <td><select class="st-${sr.status}" data-k="status">${statusOpts}</select></td>
        <td><select data-k="evidence">${evOptionsHtml(sr.evidence)}</select></td>
        <td><input type="text" data-k="notes" value="${esc(sr.notes || "")}" placeholder="Observaciones..." /></td>`;
      const statusSel = tr.querySelector('[data-k="status"]');
      statusSelects.push(statusSel);
      const save = async () => {
        const payload = { scenario: sc.name, stepIndex: i };
        tr.querySelectorAll("[data-k]").forEach((el) => (payload[el.dataset.k] = el.value));
        try {
          await api("/api/results/step", { method: "PUT", body: JSON.stringify(payload) });
          statusSel.className = "st-" + statusSel.value;
          refreshPill();
        } catch (e) { toast(e.message, "err"); }
      };
      tr.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("change", save));
      body.appendChild(tr);
    });

    refreshPill();
  });
}

function setPill(status) {
  const pill = $("#runPill");
  const map = { idle: "listo", running: "ejecutando…", passed: "éxito", failed: "con fallos", error: "error" };
  pill.className = "pill pill-" + status;
  pill.textContent = "● " + (map[status] || status);
}

async function runReport() {
  $("#btnRun").disabled = true; $("#btnRunTop").disabled = true;
  $("#console").textContent = "";
  $("#btnReport").hidden = true;
  setPill("running");
  // switch to run tab
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".tab-panel").forEach((x) => x.classList.remove("active"));
  document.querySelector('.tab[data-tab="run"]').classList.add("active");
  $("#tab-run").classList.add("active");
  try { await api("/api/run", { method: "POST", body: JSON.stringify({}) }); }
  catch (e) { toast(e.message, "err"); setPill("error"); $("#btnRun").disabled = false; $("#btnRunTop").disabled = false; return; }
  startStream();
}

function startStream() {
  if (state.es) state.es.close();
  const con = $("#console");
  state.es = new EventSource("/api/run/stream");
  state.es.onmessage = (ev) => {
    try { const { line } = JSON.parse(ev.data); con.textContent += line + "\n"; con.scrollTop = con.scrollHeight; } catch {}
  };
  if (state.poll) clearInterval(state.poll);
  state.poll = setInterval(async () => {
    try {
      const st = await api("/api/run");
      setPill(st.status);
      if (st.status !== "running") {
        clearInterval(state.poll); state.poll = null;
        if (state.es) { state.es.close(); state.es = null; }
        $("#btnRun").disabled = false; $("#btnRunTop").disabled = false;
        $("#btnReport").hidden = !st.reportAvailable;
        if (st.reportAvailable) $("#btnReport").href = st.reportUrl || "/report/index.html";
        toast(st.reportAvailable ? "Reporte generado" : "Finalizó sin reporte", st.reportAvailable ? "ok" : "err");
      }
    } catch {}
  }, 1500);
}
$("#btnRun").onclick = runReport;
$("#btnRunTop").onclick = runReport;

/* ---------------- Modal helpers ---------------- */
function openModal(sel) { $(sel).classList.remove("hidden"); }
function closeModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }
$$("[data-close-modal]").forEach((b) => (b.onclick = closeModals));
$$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));

/* ---------------- Import bundle ---------------- */
const importInput = $("#importInput");
if (importInput) {
  importInput.onchange = async (ev) => {
    const file = (ev.target.files || [])[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const r = await api("/api/import", { method: "POST", body: JSON.stringify(bundle) });
      toast(`Importado: ${r.scenarios} escenario(s), ${r.savedEvidence} evidencia(s)`);
      state.selected = null;
      await loadFeatures();
      try { await loadEvidence(); } catch (_) {}
      try { await renderResults(); } catch (_) {}
    } catch (e) {
      toast("Error al importar: " + e.message, "err");
    } finally {
      ev.target.value = "";
    }
  };
}

/* ---------------- Init ---------------- */
(async function init() {
  try {
    await loadFeatures();
    const st = await api("/api/run"); setPill(st.status === "running" ? "running" : "idle");
    if (st.status === "running") startStream();
  } catch (e) { toast("Error inicial: " + e.message, "err"); }
})();
