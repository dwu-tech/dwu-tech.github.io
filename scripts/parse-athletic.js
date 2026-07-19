// Converts scripts/athletic-raw.txt (an Athletic.net "all results" dump) into
// data/results.csv with one row per performance.
// Run: node scripts/parse-athletic.js
const fs = require('fs');
const path = require('path');
const { parseMark } = require('../app.js');

const RAW = path.join(__dirname, 'athletic-raw.txt');
const OUT = path.join(__dirname, '..', 'data', 'results.csv');

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const DATE_RE = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})/;
const SEASON_RE = /^(\d{4})\s+(Indoor|Outdoor)\b\s*(.*)$/;
const NON_RESULT = /^(DNS|DQ|NH|SCR|DNF|FS|SCR|--)\b/i;

function isEventHeader(line) {
  return /^\d+\s*(Meter|Meters)\b/i.test(line)
    || /Hurdles/i.test(line)
    || /Relay/i.test(line)
    || /^(High Jump|Long Jump|Triple Jump|Shot Put|Pole Vault|Discus|Javelin)/i.test(line);
}

function normalizeEventHeader(line) {
  const base = line.split(' - ')[0].trim();
  if (/Shuttle/i.test(base)) return '4x110 Shuttle Hurdles';
  if (/Relay/i.test(base)) return base.replace(/\s+/g, ' ');
  if (/Hurdles/i.test(base)) {
    const n = base.match(/^(\d+)/);
    return n ? `${n[1]}m Hurdles` : base;
  }
  if (/High Jump/i.test(base)) return 'High Jump';
  if (/Long Jump/i.test(base)) return 'Long Jump';
  if (/Triple Jump/i.test(base)) return 'Triple Jump';
  if (/Shot Put/i.test(base)) return 'Shot Put';
  const m = base.match(/^(\d+)\s*(?:m|Meter|Meters)/i);
  if (m) return `${m[1]}m`;
  return base;
}

function isoDate(mon, day, year) {
  return `${year}-${String(MONTHS[mon]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isPlaceToken(s) { return /^(\d+|Ex)$/.test(s.trim()); }

// Extract wind (signed) from a mark string; return { mark, wind }.
function splitWind(markStr) {
  let wind = '';
  const m = markStr.match(/\(\s*([+-]?\d*\.?\d+)\s*\)/);
  if (m) {
    const w = m[1];
    wind = (w[0] === '+' || w[0] === '-') ? w : '+' + w;
  }
  const mark = markStr.replace(/\([^)]*\)/, '').trim();
  return { mark, wind };
}

function stripTrailingCodes(rest) {
  // remove trailing "<division> <round>" or "<round>" like " O P", " 1 F", " V F", " F/S F"
  return rest.replace(/\s+(?:\S+\s+)?(P|F)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}
function roundFrom(rest) {
  const m = rest.match(/\b(P|F)\s*$/);
  return m ? (m[1] === 'P' ? 'Prelim' : 'Final') : '';
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function main() {
  const lines = fs.readFileSync(RAW, 'utf8').split('\n')
    .map((l) => l.replace(/\s+$/g, '')) // trim trailing spaces
    .map((l) => l.trim())
    .filter((l) => l.length);

  let season = '', env = '', event = '';
  let expectGrade = false;
  const rows = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const sm = line.match(SEASON_RE);
    if (sm) { env = sm[2]; season = `${sm[1]} ${env}`; expectGrade = true; continue; }
    if (expectGrade) { expectGrade = false; continue; } // age/grade line

    const dm = line.match(DATE_RE);
    if (dm) {
      // performance: mark = previous line, place = line before that (if a place token)
      const markLine = lines[i - 1] || '';
      const placeLine = lines[i - 2] || '';
      if (NON_RESULT.test(markLine)) continue; // DNS/DQ/NH/SCR
      const { mark, wind } = splitWind(markLine);
      const parsed = parseMark(mark, event);
      if (!parsed.valid) { warnings.push(`unparsed mark "${markLine}" (${event}) on ${line}`); continue; }

      const badge = (line.match(/^(SB|PB)\b/) || [])[1] || '';
      const rest = line.slice(dm.index + dm[0].length);
      const meet = stripTrailingCodes(rest);
      const round = roundFrom(rest);
      const place = isPlaceToken(placeLine) ? placeLine.trim() : '';

      rows.push({
        date: isoDate(dm[1], +dm[2], dm[3]),
        season, env, event,
        mark: parsed.display, wind,
        place, round, meet, badge, link: '',
      });
      continue;
    }

    if (isEventHeader(line)) { event = normalizeEventHeader(line); continue; }
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  const header = ['Date', 'Season', 'Env', 'Event', 'Mark', 'Wind', 'Place', 'Round', 'Meet', 'Link'];
  const out = [header.join(',')].concat(
    rows.map((r) => [r.date, r.season, r.env, r.event, r.mark, r.wind, r.place, r.round, r.meet, r.link]
      .map(csvEscape).join(','))
  ).join('\n') + '\n';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);

  console.log(`Wrote ${rows.length} rows to ${path.relative(process.cwd(), OUT)}`);
  const byEvent = {};
  rows.forEach((r) => { byEvent[r.event] = (byEvent[r.event] || 0) + 1; });
  console.log('By event:', byEvent);
  const seasons = [...new Set(rows.map((r) => r.season))];
  console.log(`Seasons (${seasons.length}):`, seasons.join(', '));
  if (warnings.length) { console.log(`\nWarnings (${warnings.length}):`); warnings.forEach((w) => console.log('  ' + w)); }
}

main();
