const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const dashboard = require("./app.js");

const repoRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const index = JSON.parse(fs.readFileSync(path.join(repoRoot, "index.json"), "utf8"));

const requiredIds = [
  "series",
  "metric",
  "branch",
  "tracking",
  "metric-detail",
  "chart-title",
  "main-chart",
  "main-chart-tooltip",
  "execution-chart-title",
  "execution-chart",
  "execution-chart-tooltip",
  "execution-detail",
  "feature-list",
  "latest-run",
  "detail-title",
  "detail-body",
  "detail-col-1",
  "detail-col-2",
  "detail-col-3",
];

for (const id of requiredIds) {
  assert.match(html, new RegExp(`id="${id}"`), `missing dashboard element #${id}`);
}

assert.ok(index.default_branch, "index.json missing default_branch");
assert.ok(Array.isArray(index.branches), "index.json branches should be an array");
assert.ok(Array.isArray(index.runs), "index.json runs should be an array");
assert.ok(index.runs.length > 0, "index.json should contain runs");

for (const run of index.runs) {
  assert.ok(run.path, "run missing path");
  assert.ok(fs.existsSync(path.join(repoRoot, run.path)), `missing run file: ${run.path}`);
}

assert.equal(typeof dashboard.buildSeriesList, "function");
assert.equal(typeof dashboard.choosePreferredSeries, "function");
assert.equal(typeof dashboard.metricsForSeries, "function");

console.log("dashboard validation ok");
