// Verification harness — fetches the live sheet and runs the app's parsing logic.
// Run: node test/verify.js
const { parseCSV, buildResults, computePRs, computeSeasonBests, SEASONS, csvUrl, PARSE_WARNINGS } = require('../app.js');

(async () => {
  const rawRows = {};
  for (const s of SEASONS) {
    const res = await fetch(csvUrl(s.gid));
    if (!res.ok) { console.error(`FAIL ${s.label}: HTTP ${res.status}`); continue; }
    rawRows[s.gid] = parseCSV(await res.text());
    console.log(`ok  ${s.label}  (${rawRows[s.gid].length} rows)`);
  }

  const all = buildResults(rawRows);
  const prs = computePRs(all);
  const sbs = computeSeasonBests(all);

  const withMark = all.filter((r) => r.mark);
  console.log(`\nTotal result rows: ${all.length}`);
  console.log(`Rows with a parsed mark: ${withMark.length}`);
  const meets = new Set(all.map((r) => `${r.date ? r.date.getTime() : 0}|${r.meet}`));
  console.log(`Distinct meets: ${meets.size}`);

  console.log('\n--- Sample parsed marks (first 15 with marks) ---');
  for (const r of withMark.slice(0, 15)) {
    console.log(
      `${(r.date ? r.date.toISOString().slice(0, 10) : '??????????')}  ` +
      `${r.season}  ${r.event.padEnd(14)}  ${(r.mark + (r.wind ? ' ' + r.wind : '')).padEnd(14)}  ${r.env.padEnd(8)}  ${r.meet}`
    );
  }

  console.log('\n--- Personal bests ---');
  for (const [ev, r] of Object.entries(prs)) {
    console.log(`${ev.padEnd(14)}  ${(r.mark + (r.wind ? ' ' + r.wind : '')).padEnd(12)}  ${r.meet} (${r.date ? r.date.getFullYear() : '?'})`);
  }

  console.log('\n--- Season bests (200m by season) ---');
  all.filter((r) => r.event === '200m' && r.isSB)
    .sort((a, b) => a.date - b.date)
    .forEach((r) => console.log(`  ${r.season}  ${r.mark}${r.wind ? ' ' + r.wind : ''}  ${r.meet}`));
  console.log(`Total season-best marks flagged: ${Object.keys(sbs).length}`);

  console.log('\n--- Rows needing cleanup (mark count != event count) ---');
  if (!PARSE_WARNINGS.length) console.log('  (none)');
  for (const w of PARSE_WARNINGS) {
    console.log(`  [${w.season}] ${w.meet}: events="${w.eventsRaw}" (${w.events}) vs results="${w.resultsRaw}" (${w.marks})`);
  }

  // Sanity checks
  const problems = [];
  if (withMark.length < 40) problems.push(`Expected >=40 marks, got ${withMark.length}`);
  if (meets.size < 35) problems.push(`Expected >=35 meets, got ${meets.size}`);
  if (!prs['200m'] || !prs['100m'] || !prs['60m']) problems.push('Missing an expected sprint PR (60m/100m/200m)');
  // dates must all be valid
  const badDates = all.filter((r) => r.date && isNaN(r.date.getTime()));
  if (badDates.length) problems.push(`${badDates.length} rows have invalid dates`);

  console.log('\n--- Checks ---');
  if (problems.length) { problems.forEach((p) => console.log('  ✗ ' + p)); process.exit(1); }
  console.log('  ✓ all checks passed');
})();
