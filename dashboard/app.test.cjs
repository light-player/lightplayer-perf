const test = require("node:test");
const assert = require("node:assert/strict");
const dashboard = require("./app.js");

test("buildSeriesList groups runs by workload mode and kind", () => {
  const runs = [
    { workload: "examples/basic", mode: "steady-render", metric_kind: "profile", source_kind: "ci" },
    { workload: "examples/basic", mode: "steady-render", metric_kind: "profile", source_kind: "ci" },
    { workload: "examples/basic", mode: "heap-trace", metric_kind: "heap-trace", source_kind: "local-backfill" },
  ];
  const series = dashboard.buildSeriesList(runs);
  assert.equal(series.length, 2);
  assert.deepEqual(
    series.map((item) => item.key),
    ["examples/basic|heap-trace|heap-trace", "examples/basic|steady-render|profile"],
  );
});

test("choosePreferredSeries prefers main-backed series", () => {
  const seriesList = [
    { key: "a", workload: "examples/basic", mode: "steady-render", kind: "profile" },
    { key: "b", workload: "examples/perf/fastmath", mode: "steady-render", kind: "profile" },
  ];
  const runs = [
    { branch_slug: "main", workload: "examples/perf/fastmath", mode: "steady-render", metric_kind: "profile" },
    { branch_slug: "main", workload: "examples/perf/fastmath", mode: "steady-render", metric_kind: "profile" },
    { branch_slug: "feature/domain", workload: "examples/basic", mode: "steady-render", metric_kind: "profile" },
  ];
  assert.equal(dashboard.choosePreferredSeries(seriesList, runs).key, "b");
});

test("formatValue includes units and separators", () => {
  assert.equal(dashboard.formatValue(1234567, "cycles"), "1,234,567 cycles");
  assert.equal(dashboard.formatValue(null, "cycles"), "n/a");
});

test("detailTitle matches metric detail kind", () => {
  assert.equal(dashboard.detailTitle({ detailKind: "topSelf" }), "Top Self Cycles");
  assert.equal(dashboard.detailTitle({ detailKind: "frames" }), "Frame Statistics");
  assert.equal(dashboard.detailTitle({ detailKind: "memory" }), "Memory Statistics");
});
