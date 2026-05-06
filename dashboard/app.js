const state = {
  index: null,
  runs: [],
  loadedMetrics: new Map(),
  seriesList: [],
};

const EXECUTION_METRIC = {
  key: "execution.cycles_used",
  label: "Execution cycles",
  shortLabel: "Execution cycles",
  unit: "cycles",
  direction: "Lower is better",
  description: "Total measured execution cycles recorded for the run. This is wall-clock work in target-cycle terms, not just attributed profiler samples.",
  getter: (metric) => metric.cycles_used ?? null,
  detailKind: "execution",
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
  const requested = readUrlState();
  const selectedSeriesKey = selectRequestedValue(
    state.seriesList.map((series) => series.key),
    requested.series,
    defaultSeries?.key || state.seriesList[0]?.key || "",
  );
  const selectedSeriesValue = state.seriesList.find((series) => series.key === selectedSeriesKey) || defaultSeries;
  const selectedBranchSlug = selectRequestedValue(
    branches.map((branch) => branch.slug),
    requested.branch,
    "main",
  );

  fillSelect(
    requiredElement("series"),
    state.seriesList.map((series) => series.key),
    selectedSeriesKey,
    (key) => seriesLabel(state.seriesList.find((series) => series.key === key)),
  );
  fillMetricSelect(selectedSeriesValue, requested.metric);
  fillSelect(
    requiredElement("branch"),
    branches.map((branch) => branch.slug),
    selectedBranchSlug,
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

function fillMetricSelect(series, requestedKey = null) {
  const metrics = metricsForSeries(series);
  const selectedMetricKey = selectRequestedValue(
    metrics.map((metric) => metric.key),
    requestedKey,
    metrics[0]?.key || "",
  );
  fillSelect(
    requiredElement("metric"),
    metrics.map((metric) => metric.key),
    selectedMetricKey,
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

  syncUrlState({
    series: series.key,
    metric: metric.key,
    branch: branchSlug,
  });

  const scopedRuns = state.runs.filter((run) => seriesMatchesRun(series, run));
  const mainRuns = scopedRuns.filter((run) => run.branch_slug === "main");
  const selectedRuns = scopedRuns.filter((run) => run.branch_slug === branchSlug);
  const mainSeries = await loadSeries(mainRuns, metric);
  const executionSeries = await loadSeries(mainRuns, EXECUTION_METRIC);

  renderTracking(series, metric, mainRuns.length);
  renderMetricDetail(metric);
  renderExecutionDetail(series, executionSeries.length);
  requiredElement("chart-title").textContent = `Main Branch Trend - ${metric.shortLabel}`;
  requiredElement("execution-chart-title").textContent = `Main Branch Trend - ${EXECUTION_METRIC.shortLabel}`;
  requiredElement("detail-title").textContent = detailTitle(metric);

  drawChart(requiredElement("main-chart"), requiredElement("main-chart-tooltip"), mainSeries, metric);
  drawChart(requiredElement("execution-chart"), requiredElement("execution-chart-tooltip"), executionSeries, EXECUTION_METRIC, {
    emptyMessage: series.kind === "heap-trace" ? "execution-cycle data is only available for profiled runs" : "no execution-cycle samples for selected series",
  });
  renderFeatures(scopedRuns, metric);
  renderLatest(await latestMetric(selectedRuns), metric);
}

function seriesMatchesRun(series, run) {
  return run.workload === series.workload && run.mode === series.mode && inferKind(run) === series.kind;
}

async function loadSeries(runs, metric) {
  const loaded = await Promise.all(runs.map((run) => loadMetric(run.path)));
  return loaded
    .map((data, index) => ({
      timestamp: data.timestamp || "",
      value: metric.getter(data),
      data,
      run: runs[index],
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

function renderExecutionDetail(series, sampleCount) {
  const target = requiredElement("execution-detail");
  target.innerHTML = "";
  const rows = [
    ["Metric", EXECUTION_METRIC.label],
    ["Units", EXECUTION_METRIC.unit],
    ["Meaning", EXECUTION_METRIC.description],
    ["Availability", series.kind === "heap-trace" ? "Not emitted for heap traces" : "Recorded on profiled runs"],
    ["Main samples", sampleCount],
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

function drawChart(canvas, tooltip, series, metric, options = {}) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090d12";
  ctx.fillRect(0, 0, width, height);
  hideTooltip(tooltip);

  const emptyMessage = options.emptyMessage || "no samples for selected series";

  if (!series.length) {
    ctx.fillStyle = "#7f8b98";
    ctx.font = "20px IBM Plex Mono, Menlo, monospace";
    ctx.fillText(emptyMessage, 36, height / 2);
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    return;
  }

  const padding = { top: 28, right: 24, bottom: 58, left: 100 };
  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (i) =>
    series.length === 1
      ? width / 2
      : padding.left + (i / Math.max(1, series.length - 1)) * (width - padding.left - padding.right);
  const y = (value) => height - padding.bottom - ((value - min) / span) * (height - padding.top - padding.bottom);
  const chartBottom = height - padding.bottom;
  const points = series.map((point, index) => ({ ...point, x: x(index), y: y(point.value) }));

  ctx.strokeStyle = "#1f2d39";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const yy = padding.top + i * ((height - padding.top - padding.bottom) / 3);
    ctx.beginPath();
    ctx.moveTo(padding.left, yy);
    ctx.lineTo(width - padding.right, yy);
    ctx.stroke();
    const sampleValue = max - ((max - min) * i) / 3;
    ctx.fillStyle = "#6f7d8d";
    ctx.font = "11px IBM Plex Mono, Menlo, monospace";
    ctx.fillText(formatCompactValue(sampleValue, metric.unit), 10, yy + 4);
  }

  ctx.beginPath();
  ctx.moveTo(padding.left, chartBottom);
  ctx.lineTo(width - padding.right, chartBottom);
  ctx.stroke();

  ctx.fillStyle = "#6f7d8d";
  ctx.font = "11px IBM Plex Mono, Menlo, monospace";
  for (const index of chooseTickIndexes(points.length)) {
    const point = points[index];
    ctx.beginPath();
    ctx.moveTo(point.x, chartBottom);
    ctx.lineTo(point.x, chartBottom + 6);
    ctx.stroke();
    ctx.save();
    ctx.translate(point.x, chartBottom + 18);
    ctx.rotate(-0.32);
    ctx.fillText(formatTimestampLabel(point.timestamp), -12, 0);
    ctx.restore();
  }

  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  ctx.fillStyle = "#9fb3ff";
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#7f8b98";
  ctx.font = "12px IBM Plex Mono, Menlo, monospace";
  ctx.fillText(`${metric.shortLabel} (${metric.unit})`, padding.left, 18);
  ctx.fillText(`${series.length} sample(s)`, padding.left, height - 12);

  canvas.onmousemove = (event) => {
    const point = nearestPoint(canvas, points, event);
    if (!point || Math.abs(point.x - scaleOffsetX(canvas, event)) > 20 || Math.abs(point.y - scaleOffsetY(canvas, event)) > 20) {
      hideTooltip(tooltip);
      return;
    }
    showTooltip(canvas, tooltip, point, metric);
  };
  canvas.onmouseleave = () => hideTooltip(tooltip);
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
      tr.innerHTML = `<td>${escapeHtml(compactSymbolName(row.name))}</td><td>${formatAbbreviatedNumber(row.cycles)}</td><td>${row.percent.toFixed(1)}%</td>`;
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
      tr.innerHTML = `<td>${name}</td><td>${value === null || value === undefined ? "n/a" : formatAbbreviatedNumber(value)}</td><td>${units}</td>`;
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
    tr.innerHTML = `<td>${name}</td><td>${value === null || value === undefined ? "n/a" : formatAbbreviatedNumber(value)}</td><td>${units}</td>`;
    body.append(tr);
  }
}

function detailTitle(metric) {
  if (metric.detailKind === "topSelf") return "Top Self Cycles";
  if (metric.detailKind === "frames") return "Frame Statistics";
  if (metric.detailKind === "execution") return "Execution Statistics";
  return "Memory Statistics";
}

function seriesLabel(series) {
  return `${series.workload} / ${series.mode} / ${series.kind}`;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "n/a";
  return `${formatAbbreviatedNumber(value)} ${unit}`;
}

function formatCompactValue(value, unit) {
  if (value === null || value === undefined) return "n/a";
  return `${formatAbbreviatedNumber(value)} ${unit}`;
}

function formatTimestampLabel(timestamp) {
  if (!timestamp) return "n/a";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatTimestampLong(timestamp) {
  if (!timestamp) return "n/a";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function chooseTickIndexes(length) {
  if (length <= 1) return [0];
  if (length <= 4) return Array.from({ length }, (_, index) => index);
  return [...new Set([0, Math.floor((length - 1) / 3), Math.floor(((length - 1) * 2) / 3), length - 1])];
}

function scaleOffsetX(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return (event.clientX - rect.left) * (canvas.width / rect.width);
}

function scaleOffsetY(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return (event.clientY - rect.top) * (canvas.height / rect.height);
}

function nearestPoint(canvas, points, event) {
  const x = scaleOffsetX(canvas, event);
  const y = scaleOffsetY(canvas, event);
  let best = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const candidate = Math.hypot(point.x - x, point.y - y);
    if (candidate < distance) {
      best = point;
      distance = candidate;
    }
  }
  return best;
}

function showTooltip(canvas, tooltip, point, metric) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  const left = Math.min(rect.width - 230, Math.max(12, point.x * scaleX + 14));
  const top = Math.min(rect.height - 116, Math.max(12, point.y * scaleY - 18));
  tooltip.innerHTML = [
    `<strong>${escapeHtml(formatTimestampLong(point.timestamp))}</strong>`,
    `<span>${escapeHtml(metric.label)}: ${escapeHtml(formatValue(point.value, metric.unit))} (${escapeHtml(formatExactValue(point.value, metric.unit))})</span>`,
    `<span>Commit: ${escapeHtml(shortCommit(point.data.commit))}</span>`,
    `<span>Workload: ${escapeHtml(point.data.workload || "n/a")}</span>`,
  ].join("");
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.hidden = false;
}

function hideTooltip(tooltip) {
  tooltip.hidden = true;
  tooltip.innerHTML = "";
}

function shortCommit(commit) {
  return commit ? String(commit).slice(0, 12) : "n/a";
}

function compactSymbolName(name) {
  if (!name) return "n/a";
  const parts = String(name).split("::");
  return parts.length >= 2 ? `${parts.at(-2)}::${parts.at(-1)}` : String(name);
}

function formatAbbreviatedNumber(value) {
  if (value === null || value === undefined) return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const abs = Math.abs(number);
  const sign = number < 0 ? "-" : "";
  const scales = [
    { limit: 1e12, suffix: "T" },
    { limit: 1e9, suffix: "B" },
    { limit: 1e6, suffix: "M" },
    { limit: 1e3, suffix: "K" },
  ];
  for (const scale of scales) {
    if (abs >= scale.limit) {
      const scaled = abs / scale.limit;
      const formatted = scaled >= 10 ? Math.floor(scaled).toString() : trimTrailingZero((Math.round(scaled * 10) / 10).toFixed(1));
      return `${sign}${formatted}${scale.suffix}`;
    }
  }
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

function formatExactValue(value, unit) {
  if (value === null || value === undefined) return "n/a";
  return `${Number(value).toLocaleString()} ${unit}`;
}

function trimTrailingZero(value) {
  return String(value).replace(/\.0$/, "");
}

function readUrlState() {
  if (!hasDom) return {};
  const params = new URLSearchParams(window.location.search);
  return {
    series: params.get("series"),
    metric: params.get("metric"),
    branch: params.get("branch"),
  };
}

function syncUrlState(nextState) {
  if (!hasDom) return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(nextState)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", nextUrl);
}

function selectRequestedValue(values, requested, fallback) {
  if (requested && values.includes(requested)) return requested;
  return fallback;
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
  chooseTickIndexes,
  METRIC_CATALOG,
  EXECUTION_METRIC,
  buildSeriesList,
  compactSymbolName,
  choosePreferredSeries,
  detailTitle,
  escapeHtml,
  formatAbbreviatedNumber,
  formatCompactValue,
  formatExactValue,
  formatTimestampLabel,
  formatValue,
  inferKind,
  metricsForSeries,
  selectRequestedValue,
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
