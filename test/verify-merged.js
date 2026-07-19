// Verifies the merged pipeline: static archive CSV + live sheet tabs, deduped.
// Run: node test/verify-merged.js
const fs = require('fs');
const path = require('path');
const {
  parseCSV, buildResults, buildCleanResults, dedupKey,
  computePRs, computeSeasonBests, SEASONS, csvUrl,
} = require('../app.js');

(async () => {
  // archive
  const csv = fs.readFileSync(path.join(__dirname, '..', 'data', 'results.csv'), 'utf8');
  const archive = buildCleanResults(csv);
  console.log(`Archive rows: ${archive.length}`);

  // live sheet
  const rawRows = {};
  for (const s of SEASONS) {
    const r = await fetch(csvUrl(s.gid));
    if (r.ok) rawRows[s.gid] = parseCSV(await r.text());
  }
  const sheet = buildResults(rawRows);
  console.log(`Sheet rows: ${sheet.length}`);

  // merge by year cutoff (mirror loadAll): archive <=2022, sheet >=2023
  const merged = [];
  let arch = 0, sh = 0;
  for (const r of archive) if (!r.date || r.date.getFullYear() <= 2022) { merged.push(r); arch++; }
  for (const r of sheet) if (!r.date || r.date.getFullYear() >= 2023) { merged.push(r); sh++; }
  console.log(`Merged: ${merged.length} (archive<=2022: ${arch}, sheet>=2023: ${sh})`);
  const deduped = 0, added = sh;

  const prs = computePRs(merged);
  computeSeasonBests(merged);

  const seasons = [...new Set(merged.map((r) => r.season))];
  console.log(`Seasons (${seasons.length}): ${seasons.join(', ')}`);

  console.log('\n--- Personal bests (with wind + legality) ---');
  for (const [ev, r] of Object.entries(prs)) {
    console.log(`  ${ev.padEnd(20)} ${(r.mark + (r.wind ? ' ' + r.wind : '')).padEnd(14)} ${r.windAided ? 'WIND-AIDED ' : ''}${r.meet} (${r.date.getFullYear()})`);
  }

  // checks
  const problems = [];
  const withMark = merged.filter((r) => r.mark && r.value != null);
  if (merged.length < 150) problems.push(`merged too small: ${merged.length}`);
  if (added < 1) problems.push(`expected some sheet rows, got ${added}`);
  if (seasons.length < 8) problems.push(`expected >=8 seasons, got ${seasons.length}`);
  if (merged.some((r) => r.source === 'archive' && r.date && r.date.getFullYear() >= 2023))
    problems.push('archive rows from 2023+ leaked into merged');
  ['60m', '100m', '200m', '110m Hurdles', 'Triple Jump', 'High Jump'].forEach((e) => {
    if (!prs[e]) problems.push(`missing PR for ${e}`);
  });
  // no duplicate exact performances in merged
  const keys = withMark.map(dedupKey);
  if (new Set(keys).size !== keys.length) problems.push(`duplicate performances present: ${keys.length - new Set(keys).size}`);

  console.log('\n--- Checks ---');
  if (problems.length) { problems.forEach((p) => console.log('  x ' + p)); process.exit(1); }
  console.log('  ok all checks passed');
})();
