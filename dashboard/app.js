const state = {
  index: null,
  runs: [],
  loadedMetrics: new Map(),
  seriesList: [],
};

const METRIC_CATALOG = {
  profile: [
    {
      key: "cpu.total_attributed_cycles",
      label: "Total attributed CPU cycles",
      shortLabel: "CPU cycles",
      unit: "cycles",
      direction: "Lower is better",
      description: "Total emulated cycles attributed to profiled functions for this render workload.",
      getter: (metric) => metric.cpu?.total_attributed_cycles ?? null,
      detailKind: "topSelf",
    },
    {
      key: "frames.p95",
      label: "Frame p95 cycles",
      shortLabel: "Frame p95",
      unit: "cycles / frame",
      direction: "Lower is better",
      description: "95th percentile frame cost from recorded frame events. Good proxy for steady render latency.",
      getter: (metric) => metric.frames?.p95 ?? null,
      detailKind: "frames",
    },
    {
      key: "cpu.profiled_instructions",
      label: "Profiled instructions",
      shortLabel: "Instructions",
      unit: "instructions",
      direction: "Lower is usually better",
      description: "Instruction count captured by the profiler for the measured interval.",
      getter: (metric) => metric.cpu?.profiled_instructions ?? null,
      detailKind: "topSelf",
    },
    {
      key: "frames.max",
      label: "Frame max cycles",
      shortLabel: "Frame max",
      unit: "cycles / frame",
      direction: "Lower is better",
      description: "Worst observed frame in the sampled window.",
      getter: (metric) => metric.frames?.max ?? null,
      detailKind: "frames",
    },
  ],
  "heap-trace": [
    {
      key: "memory.tracked_bytes_at_peak",
      label: "Tracked bytes at peak",
      shortLabel: "Peak tracked bytes",
      unit: "bytes",
      direction: "Lower is better",
      description: "Tracked heap bytes at the lowest-free point of the heap trace.",
      getter: (metric) => metric.memory?.tracked_bytes_at_peak ?? null,
      detailKind: "memory",
    },
    {
      key: "memory.peak_free_bytes",
      label: "Peak free bytes",
      shortLabel: "Peak free bytes",
      unit: "bytes free",
      direction: "Higher is better",
      description: "Free heap bytes at the tightest point in the run.",
      getter: (metric) => metric.memory?.peak_free_bytes ?? null,
      detailKind: "memory",
    },
    {
      key: "memory.live_bytes_at_end",
      label: "Live bytes at end",
      shortLabel: "Live bytes at end",
      unit: "bytes",
      direction: "Lower is better",
      description: "Tracked live bytes remaining at the end of the trace.",
      getter: (metric) => metric.memory?.live_bytes_at_end ?? null,
      detailKind: "memory",
    },
    {
      key: "memory.allocation_count_at_peak",
      label: "Allocations at peak",
      shortLabel: "Peak alloc count",
      unit: "allocations",
      direction: "Lower is usually better",
      description: "Number of tracked allocations alive at the peak heap pressure point.",
      getter: (metric) => metric.memory?.allocation_count_at_peak ?? null,
      detailKind: "memory",
    },
  ],
};

const $ = (id) => document.getElementById(id);
const hasDom = typeof window !== "undefined" && typeof document !== "undefined";

function requiredElement(id) {
  const element = $(id);
  if (!element) {
    throw new Error(`dashboard element missing: #${id}`);
  }
  return element;
}

async function main() {
  state.index = await fetchJson("../index.json");
  state.runs = state.index.runs || [];
  state.seriesList = buildSeriesList(state.runs);
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

function buildSeriesList(runs) {
  const byKey = new Map();
  for (const run of runs) {
    const key = [run.workload || "unknown", run.mode || "unknown", run.source_kind === "local-backfill" && run.mode === "heap-trace" ? "heap-trace" : inferKind(run)].join("|");
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        workload: run.workload || "unknown",
        mode: run.mode || "unknown",
        kind: run.metric_kind || inferKind(run),
      });
    }
  }
  return [...byKey.values()].sort((a, b) => seriesLabel(a).localeCompare(seriesLabel(b)));
}

function inferKind(run) {
  return run.mode === "heap-trace" ? "heap-trace" : "profile";
}

function populateControls() {
  const branches = state.index.branches || [];
  const defaultSeries = preferredSeries();

  fillSelect(
    requiredElement("series"),
    state.seriesList.map((series) => series.key),
    defaultSeries?.key || state.seriesList[0]?.key || "",
    (key) => seriesLabel(state.seriesList.find((series) => series.key === key)),
  );
  fillMetricSelect(defaultSeries);
  fillSelect(
    requiredElement("branch"),
    branches.map((branch) => branch.slug),
    "main",
    (slug) => branches.find((branch) => branch.slug === slug)?.name || slug,
  );

  requiredElement("series").addEventListener("change", async () => {
    fillMetricSelect(selectedSeries());
    await render();
  });
  requiredElement("metric").addEventListener("change", render);
  requiredElement("branch").addEventListener("change", render);
}

function preferredSeries() {
  return choosePreferredSeries(state.seriesList, state.runs);
}

function choosePreferredSeries(seriesList, runs) {
  return seriesList
    .map((series) => ({
      series,
      count: runs.filter((run) => run.branch_slug === "main" && seriesMatchesRun(series, run)).length,
    }))
    .sort((a, b) => b.count - a.count || seriesLabel(a.series).localeCompare(seriesLabel(b.series)))[0]?.series;
}

function fillMetricSelect(series) {
  const metrics = metricsForSeries(series);
  fillSelect(
    requiredElement("metric"),
    metrics.map((metric) => metric.key),
    metrics[0]?.key || "",
    (key) => metrics.find((metric) => metric.key === key)?.label || key,
  );
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

function selectedSeries() {
  return state.seriesList.find((series) => series.key === requiredElement("series").value) || null;
}

function selectedMetric(series) {
  return metricsForSeries(series).find((metric) => metric.key === requiredElement("metric").value) || metricsForSeries(series)[0] || null;
}

function metricsForSeries(series) {
  return METRIC_CATALOG[series?.kind || "profile"] || METRIC_CATALOG.profile;
}

async function render() {
  const series = selectedSeries();
  const metric = selectedMetric(series);
  const branchSlug = requiredElement("branch").value || "main";
  if (!series || !metric) return;

  const scopedRuns = state.runs.filter((run) => seriesMatchesRun(series, run));
  const mainRuns = scopedRuns.filter((run) => run.branch_slug === "main");
  const selectedRuns = scopedRuns.filter((run) => run.branch_slug === branchSlug);

  renderTracking(series, metric, mainRuns.length);
  renderMetricDetail(metric);
  requiredElement("chart-title").textContent = `Main Branch Trend - ${metric.shortLabel}`;
  requiredElement("detail-title").textContent = detailTitle(metric);

  drawChart(requiredElement("main-chart"), await loadSeries(mainRuns, metric), metric);
  renderFeatures(scopedRuns, metric);
  renderLatest(await latestMetric(selectedRuns), metric);
}

function seriesMatchesRun(series, run) {
  return run.workload === series.workload && run.mode === series.mode && inferKind(run) === series.kind;
}

async function loadSeries(runs, metric) {
  const loaded = await Promise.all(runs.map((run) => loadMetric(run.path)));
  return loaded
    .map((data) => ({
      timestamp: data.timestamp || "",
      value: metric.getter(data),
      data,
    }))
    .filter((point) => point.value !== null && point.value !== undefined)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
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

function renderTracking(series, metric, sampleCount) {
  const target = requiredElement("tracking");
  target.innerHTML = "";
  const rows = [
    ["Example", series.workload],
    ["Mode", series.mode],
    ["Data kind", series.kind],
    ["Primary metric", metric.label],
    ["Units", metric.unit],
    ["Main samples", sampleCount],
  ];
  for (const [key, value] of rows) {
    appendFact(target, key, value);
  }
}

function renderMetricDetail(metric) {
  const target = requiredElement("metric-detail");
  target.innerHTML = "";
  const rows = [
    ["Meaning", metric.description],
    ["Interpretation", metric.direction],
    ["Stored as", metric.key],
  ];
  for (const [key, value] of rows) {
    appendFact(target, key, value);
  }
}

function appendFact(target, key, value) {
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = key;
  dd.textContent = String(value);
  target.append(dt, dd);
}

function drawChart(canvas, series, metric) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090d12";
  ctx.fillRect(0, 0, width, height);

  if (!series.length) {
    ctx.fillStyle = "#7f8b98";
    ctx.font = "20px IBM Plex Mono, Menlo, monospace";
    ctx.fillText("no main-branch samples for selected series", 36, height / 2);
    return;
  }

  const padding = 52;
  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i) =>
    series.length === 1
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
    const sampleValue = Math.round(max - ((max - min) * i) / 3);
    ctx.fillStyle = "#6f7d8d";
    ctx.font = "11px IBM Plex Mono, Menlo, monospace";
    ctx.fillText(formatValue(sampleValue, metric.unit), 8, yy + 4);
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
  ctx.fillText(`${metric.shortLabel} (${metric.unit})`, padding, 18);
  ctx.fillText(`${series.length} sample(s)`, padding, height - 14);
}

function renderFeatures(scopedRuns) {
  const target = requiredElement("feature-list");
  const branches = (state.index.branches || [])
    .filter((branch) => branch.kind === "feature")
    .map((branch) => ({
      ...branch,
      runsForSeries: scopedRuns.filter((run) => run.branch_slug === branch.slug).length,
    }))
    .filter((branch) => branch.runsForSeries > 0)
    .slice(0, 12);

  target.innerHTML = "";
  if (!branches.length) {
    target.textContent = "No recent feature branch data for this series.";
    return;
  }

  for (const branch of branches) {
    const row = document.createElement("div");
    row.className = "feature";
    row.innerHTML = `<strong>${escapeHtml(branch.name)}</strong><span>${branch.runsForSeries} sample(s)</span>`;
    row.addEventListener("click", () => {
      requiredElement("branch").value = branch.slug;
      render();
    });
    target.append(row);
  }
}

function renderLatest(metric, selectedMetricDef) {
  const facts = requiredElement("latest-run");
  const detailBody = requiredElement("detail-body");
  facts.innerHTML = "";
  detailBody.innerHTML = "";

  if (!metric) {
    facts.textContent = "No data for this branch/series yet.";
    return;
  }

  const rows = [
    ["Branch", metric.branch || metric.branch_slug],
    ["Commit", metric.commit || "n/a"],
    ["Timestamp", metric.timestamp || "n/a"],
    [selectedMetricDef.shortLabel, formatValue(selectedMetricDef.getter(metric), selectedMetricDef.unit)],
    ["Source", metric.source?.kind || "n/a"],
  ];

  for (const [key, value] of rows) {
    appendFact(facts, key, value);
  }

  renderDetailTable(metric, selectedMetricDef);
}

function renderDetailTable(metric, metricDef) {
  const body = requiredElement("detail-body");
  const col1 = requiredElement("detail-col-1");
  const col2 = requiredElement("detail-col-2");
  const col3 = requiredElement("detail-col-3");

  if (metricDef.detailKind === "topSelf") {
    col1.textContent = "Function";
    col2.textContent = "Cycles";
    col3.textContent = "%";
    for (const row of metric.cpu?.top_self || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(row.name)}</td><td>${row.cycles}</td><td>${row.percent.toFixed(1)}%</td>`;
      body.append(tr);
    }
    return;
  }

  if (metricDef.detailKind === "frames") {
    col1.textContent = "Frame stat";
    col2.textContent = "Value";
    col3.textContent = "Units";
    const rows = [
      ["p50", metric.frames?.p50, "cycles / frame"],
      ["p95", metric.frames?.p95, "cycles / frame"],
      ["max", metric.frames?.max, "cycles / frame"],
      ["count", metric.frames?.count, "frames"],
    ];
    for (const [name, value, units] of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${name}</td><td>${value ?? "n/a"}</td><td>${units}</td>`;
      body.append(tr);
    }
    return;
  }

  col1.textContent = "Memory stat";
  col2.textContent = "Value";
  col3.textContent = "Units";
  const rows = [
    ["tracked bytes at peak", metric.memory?.tracked_bytes_at_peak, "bytes"],
    ["peak free bytes", metric.memory?.peak_free_bytes, "bytes free"],
    ["live bytes at end", metric.memory?.live_bytes_at_end, "bytes"],
    ["allocations at peak", metric.memory?.allocation_count_at_peak, "allocations"],
  ];
  for (const [name, value, units] of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${value ?? "n/a"}</td><td>${units}</td>`;
    body.append(tr);
  }
}

function detailTitle(metric) {
  if (metric.detailKind === "topSelf") return "Top Self Cycles";
  if (metric.detailKind === "frames") return "Frame Statistics";
  return "Memory Statistics";
}

function seriesLabel(series) {
  return `${series.workload} / ${series.mode} / ${series.kind}`;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "n/a";
  return `${Number(value).toLocaleString()} ${unit}`;
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

const dashboardTestApi = {
  METRIC_CATALOG,
  buildSeriesList,
  choosePreferredSeries,
  detailTitle,
  escapeHtml,
  formatValue,
  inferKind,
  metricsForSeries,
  seriesLabel,
  seriesMatchesRun,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = dashboardTestApi;
}

if (typeof globalThis !== "undefined") {
  globalThis.__lightplayerPerfDashboard = dashboardTestApi;
}

if (hasDom) {
  main().catch((error) => {
    document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Dashboard failed</h1><pre>${escapeHtml(error.stack || error.message)}</pre></section></main>`;
  });
}
