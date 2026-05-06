# LightPlayer Performance

Generated compact performance history and dashboard data for LightPlayer.

The source repository owns the profiler, workload manifest, and publisher. This repository intentionally stores compact JSON records and a small static dashboard, not raw profile directories.

## Layout

- `runs/<branch-slug>/YYYY/MM/DD/*.json` contains append-only run records.
- `latest/<branch-slug>.json` points at the most recent compact record per branch.
- `branches/*.json` contains generated branch indexes for the dashboard.
- `dashboard/` contains the GitHub Pages UI.

Raw profiles are kept as short-retention GitHub Actions artifacts in the source repository.
