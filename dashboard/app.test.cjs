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
  assert.equal(dashboard.formatValue(1234567, "cycles"), "1.2M cycles");
  assert.equal(dashboard.formatValue(null, "cycles"), "n/a");
});

test("formatAbbreviatedNumber scales by magnitude", () => {
  assert.equal(dashboard.formatAbbreviatedNumber(93750992), "93M");
  assert.equal(dashboard.formatAbbreviatedNumber(1152304), "1.2M");
  assert.equal(dashboard.formatAbbreviatedNumber(980), "980");
});

test("formatTimestampLabel yields compact axis labels", () => {
  assert.equal(dashboard.formatTimestampLabel("2026-04-20T05:19:33.880270+00:00"), "Apr 20");
});

test("chooseTickIndexes keeps endpoints and intermediate labels", () => {
  assert.deepEqual(dashboard.chooseTickIndexes(1), [0]);
  assert.deepEqual(dashboard.chooseTickIndexes(4), [0, 1, 2, 3]);
  assert.deepEqual(dashboard.chooseTickIndexes(8), [0, 2, 4, 7]);
});

test("execution metric reads cycles_used", () => {
  assert.equal(dashboard.EXECUTION_METRIC.getter({ cycles_used: 110309115 }), 110309115);
  assert.equal(dashboard.EXECUTION_METRIC.getter({}), null);
});

test("compactSymbolName keeps the readable tail", () => {
  assert.equal(dashboard.compactSymbolName("FixtureRuntime::render"), "FixtureRuntime::render");
  assert.equal(dashboard.compactSymbolName("a::b::FixtureRuntime::render"), "FixtureRuntime::render");
});

test("selectRequestedValue falls back when requested value is invalid", () => {
  assert.equal(dashboard.selectRequestedValue(["a", "b"], "b", "a"), "b");
  assert.equal(dashboard.selectRequestedValue(["a", "b"], "c", "a"), "a");
});

test("detailTitle matches metric detail kind", () => {
  assert.equal(dashboard.detailTitle({ detailKind: "topSelf" }), "Top Self Cycles");
  assert.equal(dashboard.detailTitle({ detailKind: "frames" }), "Frame Statistics");
  assert.equal(dashboard.detailTitle({ detailKind: "execution" }), "Execution Statistics");
  assert.equal(dashboard.detailTitle({ detailKind: "memory" }), "Memory Statistics");
});
