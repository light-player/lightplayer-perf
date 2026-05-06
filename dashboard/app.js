const state = {
  index: null,
  runs: [],
  loadedMetrics: new Map(),
};

const $ = (id) => document.getElementById(id);

async function main() {
  state.index = await fetchJson("../index.json");
  state.runs = state.index.runs || [];
  populateControls();
  await render();
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`failed to fetch ${path}: ${response.status}`);
  }
  return response.json();
}

function populateControls() {
  const workloads = unique(state.runs.map((run) => run.workload).filter(Boolean));
  const branches = state.index.branches || [];
  const defaultWorkload = preferredMainWorkload(workloads);

  fillSelect($("workload"), workloads, defaultWorkload);
  fillSelect(
    $("branch"),
    branches.map((branch) => branch.slug),
    "main",
    (slug) => branches.find((branch) => branch.slug === slug)?.name || slug,
  );

  $("workload").addEventListener("change", render);
  $("branch").addEventListener("change", render);
}

function preferredMainWorkload(workloads) {
  return workloads
    .map((workload) => ({
      workload,
      count: state.runs.filter(
        (run) => run.branch_slug === "main" && run.workload === workload && run.mode !== "heap-trace",
      ).length,
    }))
    .sort((a, b) => b.count - a.count || a.workload.localeCompare(b.workload))[0]?.workload || workloads[0] || "";
}

function fillSelect(select, values, selected, label = (value) => value) {
  select.innerHTML = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label(value);
    option.selected = value === selected;
    select.append(option);
  }
}

async function render() {
  const workload = $("workload").value;
  const branchSlug = $("branch").value || "main";
  const mainRuns = state.runs.filter((run) => run.branch_slug === "main" && run.workload === workload);
  const selectedRuns = state.runs.filter((run) => run.branch_slug === branchSlug && run.workload === workload);

  drawChart($("main-chart"), await loadSeries(mainRuns));
  renderFeatures(workload);
  renderLatest(await latestMetric(selectedRuns));
}

async function loadSeries(runs) {
  const metrics = await Promise.all(runs.map((run) => loadMetric(run.path)));
  return metrics
    .filter((metric) => metric.cpu?.total_attributed_cycles)
    .map((metric) => ({
      label: metric.timestamp || "",
      value: metric.cpu.total_attributed_cycles,
      frameP95: metric.frames?.p95,
    }));
}

async function latestMetric(runs) {
  if (!runs.length) return null;
  const latest = [...runs].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).at(-1);
  return loadMetric(latest.path);
}

async function loadMetric(path) {
  if (!state.loadedMetrics.has(path)) {
    state.loadedMetrics.set(path, fetchJson(`../${path}`));
  }
  return state.loadedMetrics.get(path);
}

function drawChart(canvas, series) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090d12";
  ctx.fillRect(0, 0, width, height);

  if (!series.length) {
    ctx.fillStyle = "#7f8b98";
    ctx.font = "20px IBM Plex Mono, Menlo, monospace";
    ctx.fillText("no main-branch samples for selected workload", 36, height / 2);
    return;
  }

  const padding = 42;
  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i) => series.length === 1
    ? width / 2
    : padding + (i / Math.max(1, series.length - 1)) * (width - padding * 2);
  const y = (value) => height - padding - ((value - min) / span) * (height - padding * 2);

  ctx.strokeStyle = "#1f2d39";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const yy = padding + i * ((height - padding * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(padding, yy);
    ctx.lineTo(width - padding, yy);
    ctx.stroke();
  }

  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((point, i) => {
    const xx = x(i);
    const yy = y(point.value);
    if (i === 0) ctx.moveTo(xx, yy);
    else ctx.lineTo(xx, yy);
  });
  ctx.stroke();

  ctx.fillStyle = "#9fb3ff";
  series.forEach((point, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(point.value), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#7f8b98";
  ctx.font = "12px IBM Plex Mono, Menlo, monospace";
  ctx.fillText(`${series.length} sample(s)`, padding, height - 14);
}

function renderFeatures(workload) {
  const target = $("feature-list");
  const branches = (state.index.branches || [])
    .filter((branch) => branch.kind === "feature")
    .map((branch) => ({
      ...branch,
      runsForWorkload: state.runs.filter((run) => run.branch_slug === branch.slug && run.workload === workload).length,
    }))
    .filter((branch) => branch.runsForWorkload > 0)
    .slice(0, 12);

  target.innerHTML = "";
  if (!branches.length) {
    target.textContent = "No recent feature branch data yet.";
    return;
  }

  for (const branch of branches) {
    const row = document.createElement("div");
    row.className = "feature";
    row.innerHTML = `<strong>${escapeHtml(branch.name)}</strong><span>${branch.runsForWorkload} run(s)</span>`;
    row.addEventListener("click", () => {
      $("branch").value = branch.slug;
      render();
    });
    target.append(row);
  }
}

function renderLatest(metric) {
  const facts = $("latest-run");
  const topSelf = $("top-self");
  facts.innerHTML = "";
  topSelf.innerHTML = "";

  if (!metric) {
    facts.textContent = "No data for this branch/workload yet.";
    return;
  }

  const rows = [
    ["Branch", metric.branch || metric.branch_slug],
    ["Commit", metric.commit || "n/a"],
    ["Timestamp", metric.timestamp || "n/a"],
    ["Total cycles", metric.cpu?.total_attributed_cycles ?? "n/a"],
    ["Frame p95", metric.frames?.p95 ?? "n/a"],
    ["Source", metric.source?.kind || "n/a"],
  ];

  for (const [key, value] of rows) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = String(value);
    facts.append(dt, dd);
  }

  for (const row of metric.cpu?.top_self || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(row.name)}</td><td>${row.cycles}</td><td>${row.percent.toFixed(1)}%</td>`;
    topSelf.append(tr);
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

main().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Dashboard failed</h1><pre>${escapeHtml(error.stack || error.message)}</pre></section></main>`;
});
