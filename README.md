# dwu-tech.github.io

Personal track &amp; field results site. It live-fetches every meet result from a
Google Sheet and shows a sortable / filterable table, a personal-bests panel, and
a by-season view. The goal: one complete record of all my meets — including the
many that never show up on Athletic.net.

**Live:** https://dwu-tech.github.io/

## How it works

Two data sources are merged in the browser on load:

1. **`data/results.csv`** — the canonical historical archive (2015–2026), one row per
   performance, parsed from an Athletic.net export. Past results don't change, so they
   ship as a committed file.
2. **Live Google Sheet tabs** — the quick "messy" meet-centric format, for new / ongoing
   seasons. Fetched live via the public `gviz` CSV endpoint.

They're merged with **date-based dedup**: the archive is canonical, and a sheet row is
only added if its date isn't already in the archive (i.e. genuinely new or upcoming meets).

Features:
- Sortable/filterable master table + by-season grouped view, filter by event/season/type.
- Interactive SVG progression chart per event (season-segmented line, PR/SB rings, tooltips).
- **Personal bests** and **season bests** highlighted (PR / SB badges).
- **Wind-legal awareness**: marks with wind > +2.0 m/s (on 100/200/hurdles/LJ/TJ) get a
  `w` marker; wind-aided PRs also show the best *legal* mark.
- Hand-timed marks (`h`) are shown but excluded from PRs/SBs.
- Dark-mode toggle (persists; defaults to system).

### Files
| File | Purpose |
|------|---------|
| `index.html` | Results homepage (stats, PRs sidebar, chart, filters, table) |
| `about.html` | Bio / education / skills |
| `app.js` | Fetch (archive + sheet), parse, merge, PR/SB/wind logic, render |
| `theme.js` | Dark-mode toggle |
| `styles.css` | Styling (responsive, light/dark) |
| `data/results.csv` | Canonical per-result archive |
| `scripts/athletic-raw.txt` | Raw Athletic.net export (source for the archive) |
| `scripts/parse-athletic.js` | Converts the raw export into `data/results.csv` |
| `test/verify.js` | Checks sheet parsing against the live sheet |
| `test/verify-merged.js` | Checks the merged archive + sheet pipeline |

## Adding results

**New seasons (ongoing):** add rows to the Google Sheet in the existing meet-centric
format — `Date, Meet Name, _, Events, fee, fee, Results` (see below). They appear live.

**Regenerating the archive:** update `scripts/athletic-raw.txt` and run
`node scripts/parse-athletic.js` to rebuild `data/results.csv`.

## The Google Sheet

- Key: `18TUqtcZmlkFuM9V0BdlAedNIUwMxJnPET3qEHOUpoBk`
- Must be shared **Anyone with the link → Viewer** for the live fetch to work.
- One tab per season; tab `gid`s and season labels are configured in `SEASONS`
  at the top of `app.js`. Add a new season by adding its `gid` there.
- Columns used: `Date`, `Meet Name`, `Events`, `Results` (fee columns are ignored).
- `Events` and `Results` are paired positionally (comma- or space-separated).
- Wind is read from `(4.2)`, `+1.8`, `-.2`, etc.
- **Optional:** add a `Link` column (8th column) with a results URL
  (Athletic.net / EliteFeats / MileSplit) and each mark becomes a link.

### Data cleanup tips
The parser reports rows where the number of marks doesn't match the number of
events (run the test below). Keep marks comma-separated and write wind in
parentheses, e.g. `11.54 (1.7), 23.68 (1.9)`.

## Local development

```bash
python3 -m http.server 8000      # then open http://localhost:8000
node test/verify.js              # sanity-check parsing against the live sheet
```

## Deploy (GitHub Pages)

This repo is a user site, so `master` is served directly at
`https://dwu-tech.github.io/`.

```bash
git add -A
git commit -m "feat: live track results site"
git push origin master
```

Pushing requires personal GitHub auth (Personal Access Token over HTTPS, or an
SSH key). See the chat notes for setup.
