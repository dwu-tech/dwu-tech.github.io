/* Track results app — live-fetches meet results from a public Google Sheet.
   No build step, no dependencies. */

'use strict';

const SHEET_KEY = '18TUqtcZmlkFuM9V0BdlAedNIUwMxJnPET3qEHOUpoBk';

// The Athletic.net archive (data/results.csv) is authoritative only through this
// year; the live Google Sheet is authoritative from the next year onward.
const ARCHIVE_THROUGH_YEAR = 2022;

// Each tab = one season. startYear is used to infer the year for dates
// written without one (e.g. "05/9"). Oct–Dec -> startYear, Jan–Sep -> startYear+1.
const SEASONS = [
  { gid: '12857418',   label: '2025\u201326', startYear: 2025 },
  { gid: '710451721',  label: '2024\u201325', startYear: 2024 },
  { gid: '1292685659', label: '2023\u201324', startYear: 2023 },
  { gid: '0',          label: '2022\u201323', startYear: 2022 },
];

const csvUrl = (gid) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_KEY}/gviz/tq?tqx=out:csv&gid=${gid}`;

// Rows whose parsed mark count didn't match their event count (data to clean up).
const PARSE_WARNINGS = [];

/* ------------------------------ CSV parsing ------------------------------ */
// Handles quoted fields, escaped quotes, commas and newlines inside quotes.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* --------------------------- Event normalization -------------------------- */
function normalizeEvent(raw) {
  let e = (raw || '').trim();
  if (!e) return '';
  const key = e.toLowerCase().replace(/\s|meters?|m\b/g, '').replace(/\.$/, '');
  const map = {
    '60': '60m', '60h': '60m Hurdles',
    '100': '100m', '100h': '100m Hurdles',
    '110h': '110m Hurdles',
    '200': '200m', '300': '300m', '400': '400m',
    '500': '500m', '600': '600m', '800': '800m',
    'lj': 'Long Jump', 'tj': 'Triple Jump', 'hj': 'High Jump',
    'sp': 'Shot Put', 'shot': 'Shot Put',
  };
  if (map[key]) return map[key];
  // fall back: title-case the raw token
  return e.replace(/\b\w/g, (m) => m.toUpperCase());
}

const FIELD_EVENTS = new Set(['Long Jump', 'Triple Jump', 'High Jump', 'Shot Put']);
const isFieldEvent = (ev) => FIELD_EVENTS.has(ev);

// Events where wind is measured and >+2.0 m/s makes a mark wind-aided (illegal for records).
const WIND_EVENTS = new Set(['100m', '200m', '100m Hurdles', '110m Hurdles', 'Long Jump', 'Triple Jump']);
const WIND_LEGAL_LIMIT = 2.0;

/* ------------------------------ Mark parsing ------------------------------ */
// Returns { display, wind, value, valid } where value is comparable
// (seconds for track, inches for field). Lower is better for track,
// higher is better for field.
function parseMark(raw, eventName) {
  const s = (raw || '').trim();
  if (!s) return { display: '', wind: '', windValue: null, value: null, valid: false };

  // Wind: optional sign, decimal, optionally in parens. Examples: (4.2) +1.8 -.2 "+ 0.5"
  let wind = '';
  const windMatch = s.match(/\(\s*([+-]?\.?\d+(?:\.\d+)?)\s*\)|(?:^|\s)([+-]\s?\.?\d+(?:\.\d+)?)(?:\s|$)/);
  if (windMatch) {
    const w = (windMatch[1] || windMatch[2] || '').replace(/\s+/g, '');
    if (w) wind = (w[0] === '+' || w[0] === '-') ? w : '+' + w;
  }
  const windValue = wind ? parseFloat(wind) : null;

  if (isFieldEvent(eventName)) {
    // Feet/inches: 40' 3''  or 18' 4"  -> inches
    const fi = s.match(/(\d+)\s*'\s*(\d+(?:\.\d+)?)?/);
    if (fi) {
      const feet = parseFloat(fi[1]);
      const inch = fi[2] ? parseFloat(fi[2]) : 0;
      const totalIn = feet * 12 + inch;
      return { display: s.replace(/\s+/g, ' ').trim(), wind, windValue, value: totalIn, valid: true };
    }
    // metric height/distance like 1.50 or 12.51m -> store value in inches (comparable to feet/inches)
    const m = s.match(/(\d+\.\d+)/);
    if (m) return { display: m[1] + 'm', wind, windValue, value: parseFloat(m[1]) * 39.3701, valid: true };
    return { display: s.trim(), wind, windValue, value: null, valid: false };
  }

  // Track: leading time. Handles 7.58, 11.93, 56.25, 1:52.3, "11.4h", "23.23ht"
  const t = s.match(/(\d+:)?(\d{1,3}(?:\.\d+)?)\s*(h|ht|hy)?/i);
  if (t) {
    const min = t[1] ? parseInt(t[1], 10) : 0;
    const sec = parseFloat(t[2]);
    const handTimed = !!t[3];
    let display = (t[1] ? t[1] : '') + t[2];
    if (handTimed) display += 'h';
    return { display, wind, windValue, value: min * 60 + sec, valid: true, handTimed };
  }
  return { display: s.trim(), wind, windValue, value: null, valid: false };
}

/* ------------------------- Indoor / outdoor guess ------------------------- */
function seasonEnv(eventName, monthIdx, meetName) {
  const mn = (meetName || '').toLowerCase();
  if (mn.includes('indoor')) return 'Indoor';
  if (mn.includes('outdoor')) return 'Outdoor';
  if (eventName === '60m' || eventName === '60m Hurdles' ||
      eventName === '300m' || eventName === '500m' || eventName === '600m') return 'Indoor';
  if (eventName === '100m' || eventName === '100m Hurdles' ||
      eventName === '110m Hurdles') return 'Outdoor';
  // month fallback (monthIdx 0-11): Nov–Mar indoor
  return (monthIdx >= 10 || monthIdx <= 2) ? 'Indoor' : 'Outdoor';
}

/* ------------------------------ Date parsing ------------------------------ */
function parseDate(raw, startYear) {
  const s = (raw || '').trim();
  const m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year;
  if (m[3]) {
    year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
  } else {
    year = (month >= 10) ? startYear : startYear + 1;
  }
  return new Date(year, month - 1, day);
}

const NON_RESULT = /^(n\/?a|cancelled|canceled|dns|dnf|sick|registration)/i;

// Competition-season year for a row (a string like "2024"). Nov/Dec roll into the
// next year to match track season grouping. Indoor/Outdoor is tracked separately (env).
function seasonLabel(date, env, fallbackYear) {
  const y = date ? date.getFullYear() : fallbackYear;
  const m = date ? date.getMonth() : 0; // 0-11
  const year = (m >= 10) ? y + 1 : y;   // Nov (10) / Dec (11) -> next year
  return `${year}`;
}

/* --------------------------- Row -> result rows --------------------------- */
// Split a results string into per-event chunks. Handles both comma- and
// space-separated marks, wind readings (signed or parenthesized), and
// feet/inches jump marks like "40' 3''". `expectedCount` is used to fold
// stray bare-number wind tokens back into the preceding mark.
const JUMP_RE = /\d+\s*'\s*\d+(?:\.\d+)?\s*''?/g;
function splitResults(resultsStr, expectedCount) {
  // 1) Protect feet/inches marks (they contain spaces) with placeholders.
  const jumps = [];
  const s = resultsStr.replace(JUMP_RE, (m) => {
    jumps.push(m.replace(/\s+/g, ' ').trim());
    return `\u0000${jumps.length - 1}\u0000`;
  });

  // 2) Tokenize on commas and whitespace.
  const toks = s.split(/[\s,]+/).filter(Boolean);
  const isJump = (t) => /^\u0000(\d+)\u0000$/.test(t);
  const isWind = (t) => /^[\(+\-]/.test(t);           // (4.2) +1.8 -.2
  const restore = (t) => isJump(t) ? jumps[+t.replace(/\u0000/g, '')] : t;

  // 3) Group: marks start chunks; winds attach to the current chunk.
  const chunks = [];
  for (const t of toks) {
    if (isJump(t)) { chunks.push(restore(t)); continue; }
    if (chunks.length && isWind(t)) { chunks[chunks.length - 1] += ' ' + t; continue; }
    chunks.push(t);
  }

  // 4) If we over-split (bare unsigned wind mistaken for a mark), fold small
  //    bare numbers into the previous chunk until the count matches events.
  const isBareWind = (t) => /^-?\.?\d+(?:\.\d+)?$/.test(t) && Math.abs(parseFloat(t)) < 10;
  for (let i = chunks.length - 1; i > 0 && chunks.length > expectedCount; i--) {
    if (isBareWind(chunks[i])) {
      chunks[i - 1] += ' ' + chunks[i];
      chunks.splice(i, 1);
    }
  }
  return chunks;
}

function buildResults(rawRows) {
  const results = [];
  PARSE_WARNINGS.length = 0;
  for (const season of SEASONS) {
    const rows = rawRows[season.gid];
    if (!rows) continue;

    for (let r = 0; r < rows.length; r++) {
      let cells = rows[r].slice();
      if (cells.length < 7) continue;

      // gid=0 has header labels merged into the first data row.
      // Strip a leading "Date " / "Meet Name " / "Events " / "Results " label.
      cells = cells.map((c) => c.replace(/^(Date|Meet Name|Events|Entry Fee|Misc Fee|Results)\s+/i, '').trim());

      const dateRaw = cells[0];
      const meet = (cells[1] || '').trim();
      const eventsRaw = (cells[3] || '').trim();
      const resultsRaw = (cells[6] || '').trim();
      const linkRaw = (cells[7] || '').trim(); // optional Link column

      // skip header, blank, and fee-total rows
      if (/^date$/i.test(dateRaw) || (!dateRaw && !meet)) continue;
      if (!meet) continue;
      const date = parseDate(dateRaw, season.startYear);

      const events = eventsRaw.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean);
      // meets with no usable events/results (upcoming, cancelled, sick, etc.)
      if (!events.length || NON_RESULT.test(eventsRaw) || !resultsRaw) {
        const env = seasonEnv('', date ? date.getMonth() : 0, meet);
        results.push({
          date, meet, season: seasonLabel(date, env, season.startYear),
          event: '', eventRaw: eventsRaw, mark: '', wind: '',
          value: null, env, place: '', round: '', link: linkRaw,
          status: statusOf(eventsRaw, resultsRaw, date), source: 'sheet',
        });
        continue;
      }

      const chunks = splitResults(resultsRaw, events.length);
      if (chunks.length !== events.length) {
        PARSE_WARNINGS.push({ season: season.label, meet, eventsRaw, resultsRaw,
          events: events.length, marks: chunks.length });
      }
      for (let k = 0; k < events.length; k++) {
        const ev = normalizeEvent(events[k]);
        const parsed = parseMark(chunks[k] || '', ev);
        const monthIdx = date ? date.getMonth() : 0;
        const env = seasonEnv(ev, monthIdx, meet);
        results.push({
          date, meet, season: seasonLabel(date, env, season.startYear),
          event: ev, eventRaw: events[k],
          mark: parsed.display, wind: parsed.wind,
          value: parsed.valid ? parsed.value : null,
          field: isFieldEvent(ev),
          handTimed: !!parsed.handTimed,
          windValue: parsed.windValue,
          windAided: WIND_EVENTS.has(ev) && parsed.windValue != null && parsed.windValue > WIND_LEGAL_LIMIT,
          env, place: '', round: '',
          link: linkRaw, status: '', source: 'sheet',
        });
      }
    }
  }
  return results;
}

function statusOf(eventsRaw, resultsRaw, date) {
  if (/cancel/i.test(eventsRaw)) return 'Cancelled';
  if (/sick|dns|registration/i.test(eventsRaw)) return 'Did not start';
  if (!resultsRaw && date && date > new Date()) return 'Upcoming';
  if (!resultsRaw) return 'No results';
  return '';
}

/* ------------------------------ PR detection ------------------------------ */
function computePRs(results) {
  const best = {};
  for (const r of results) {
    if (r.value == null || !r.event) continue;
    if (r.handTimed) continue; // hand times aren't comparable to FAT — exclude from PRs
    const cur = best[r.event];
    const better = !cur ||
      (r.field ? r.value > cur.value : r.value < cur.value);
    if (better) best[r.event] = r;
  }
  // mark PR rows
  for (const r of results) r.isPR = false;
  Object.values(best).forEach((r) => { r.isPR = true; });
  return best;
}

// Best mark per (event, season). Hand times excluded, like PRs.
function computeSeasonBests(results) {
  const best = {};
  for (const r of results) {
    if (r.value == null || !r.event || r.handTimed) continue;
    const key = `${r.event}|${r.season}`;
    const cur = best[key];
    const better = !cur || (r.field ? r.value > cur.value : r.value < cur.value);
    if (better) best[key] = r;
  }
  for (const r of results) r.isSB = false;
  Object.values(best).forEach((r) => { r.isSB = true; });
  return best;
}

/* -------------------------------- State ---------------------------------- */
let ALL = [];
let PRS = {};
let sortKey = 'date';
let sortDir = -1; // newest first
let view = 'seasons';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------ Clean archive ---------------------------- */
// Parse the committed data/results.csv (one row per performance) into result objects.
function buildCleanResults(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iDate = col('date'), iSeason = col('season'), iEnv = col('env'), iEvent = col('event'),
    iMark = col('mark'), iWind = col('wind'), iPlace = col('place'), iRound = col('round'),
    iMeet = col('meet'), iLink = col('link');
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    const dateStr = (c[iDate] || '').trim();
    if (!dateStr) continue;
    const date = new Date(dateStr + 'T00:00:00');
    const event = (c[iEvent] || '').trim();
    const mark = (c[iMark] || '').trim();
    const wind = (c[iWind] || '').trim();
    const parsed = parseMark(mark, event);
    const windValue = wind ? parseFloat(wind) : null;
    const env = (c[iEnv] || '').trim();
    out.push({
      date, meet: (c[iMeet] || '').trim(), season: seasonLabel(date, env, date ? date.getFullYear() : 0),
      event, eventRaw: event,
      mark: parsed.display || mark, wind,
      value: parsed.valid ? parsed.value : null,
      field: isFieldEvent(event),
      handTimed: !!parsed.handTimed,
      windValue,
      windAided: WIND_EVENTS.has(event) && windValue != null && windValue > WIND_LEGAL_LIMIT,
      env, place: (c[iPlace] || '').trim(), round: (c[iRound] || '').trim(),
      link: (c[iLink] || '').trim(), status: '', source: 'archive',
    });
  }
  return out;
}

function dedupKey(r) {
  const d = r.date ? r.date.toISOString().slice(0, 10) : 'nd';
  const v = r.value != null ? Math.round(r.value * 100) : r.mark;
  return `${d}|${r.event}|${v}`;
}

/* -------------------------------- Fetch ---------------------------------- */
async function loadAll() {
  // 1) Static archive CSV — canonical historical record.
  let archive = [];
  try {
    const res = await fetch('data/results.csv', { cache: 'no-cache' });
    if (res.ok) archive = buildCleanResults(await res.text());
  } catch (e) { console.warn('Archive CSV not loaded:', e); }

  // 2) Live Google Sheet tabs — new / ongoing seasons in the quick "messy" format.
  const settled = await Promise.allSettled(
    SEASONS.map((s) =>
      fetch(csvUrl(s.gid)).then((res) => {
        if (!res.ok) throw new Error(`${s.label}: HTTP ${res.status}`);
        return res.text();
      })
    )
  );
  const rawRows = {};
  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') rawRows[SEASONS[idx].gid] = parseCSV(res.value);
  });
  const sheet = buildResults(rawRows);

  // 3) Merge by year cutoff: the Athletic.net archive is used only through 2022;
  //    the Google Sheet is authoritative from 2023 onward.
  const merged = [];
  for (const r of archive) {
    if (!r.date || r.date.getFullYear() <= ARCHIVE_THROUGH_YEAR) merged.push(r);
  }
  for (const r of sheet) {
    if (!r.date || r.date.getFullYear() >= ARCHIVE_THROUGH_YEAR + 1) merged.push(r);
  }
  if (!merged.length) throw new Error('Could not load any results.');
  return merged;
}

/* ------------------------------ Rendering -------------------------------- */
function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function uniqueSorted(arr) { return [...new Set(arr)].filter(Boolean).sort(); }

// Seasons present in the data, ordered by their most recent result (newest first).
function seasonsSorted() {
  const latest = {};
  ALL.forEach((r) => {
    const t = r.date ? r.date.getTime() : 0;
    if (!(r.season in latest) || t > latest[r.season]) latest[r.season] = t;
  });
  return Object.keys(latest).sort((a, b) => latest[b] - latest[a]);
}

function populateFilters() {
  const seasonSel = $('#f-season');
  const seasons = seasonsSorted();
  for (const s of seasons) seasonSel.add(new Option(s, s));
  const cSeason = $('#c-season');
  for (const s of seasons) cSeason.add(new Option(s, s));

  refreshEventFilter();  // table Event options (scoped to season)
  refreshChartEvents();  // chart Event options (scoped to season)
}

// Events present in a given season ('' = all seasons).
function eventsInSeason(season) {
  const rows = season ? ALL.filter((r) => r.season === season) : ALL;
  return uniqueSorted(rows.map((r) => r.event));
}

// Rebuild the table Event dropdown for the currently-selected season.
function refreshEventFilter() {
  const sel = $('#f-event');
  const prev = sel.value;
  const events = eventsInSeason($('#f-season').value);
  sel.innerHTML = '<option value="">All events</option>';
  for (const e of events) sel.add(new Option(e, e));
  sel.value = events.includes(prev) ? prev : ''; // reset if no longer valid
}

// Rebuild the chart Event dropdown (with per-season counts) for its selected season.
function refreshChartEvents() {
  const sel = $('#c-event');
  const prev = sel.value;
  const season = $('#c-season').value;
  const rows = season ? ALL.filter((r) => r.season === season) : ALL;
  const counts = {};
  rows.forEach((r) => { if (r.event && r.value != null) counts[r.event] = (counts[r.event] || 0) + 1; });
  const events = Object.keys(counts).sort((a, b) => {
    const pri = (e) => e === '100m' ? 0 : e === '200m' ? 1 : 9;
    if (pri(a) !== pri(b)) return pri(a) - pri(b);   // 100m, 200m first
    return counts[b] - counts[a];                    // then most data points
  });
  sel.innerHTML = '';
  for (const e of events) sel.add(new Option(`${e} (${counts[e]})`, e));
  sel.value = events.includes(prev) ? prev : (events[0] || '');
}

function currentFilters() {
  return {
    event: $('#f-event').value,
    season: $('#f-season').value,
    env: $('#f-env').value,
    q: $('#f-search').value.trim().toLowerCase(),
  };
}

function applyFilters(rows) {
  const f = currentFilters();
  return rows.filter((r) => {
    if (f.event && r.event !== f.event) return false;
    if (f.season && r.season !== f.season) return false;
    if (f.env && r.env !== f.env) return false;
    if (f.q && !(`${r.meet} ${r.event} ${r.mark}`.toLowerCase().includes(f.q))) return false;
    return true;
  });
}

function sortRows(rows) {
  const dir = sortDir;
  return rows.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'date': av = a.date ? a.date.getTime() : 0; bv = b.date ? b.date.getTime() : 0; break;
      case 'meet': av = a.meet.toLowerCase(); bv = b.meet.toLowerCase(); break;
      case 'event': av = a.event.toLowerCase(); bv = b.event.toLowerCase(); break;
      case 'mark': av = a.value == null ? Infinity : a.value; bv = b.value == null ? Infinity : b.value; break;
      case 'season': av = a.season; bv = b.season; break;
      case 'env': av = a.env; bv = b.env; break;
      default: av = 0; bv = 0;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function markCell(r) {
  if (!r.mark) return `<span class="muted">${r.status || '\u2014'}</span>`;
  const wind = r.wind ? `<span class="wind">${r.wind}</span>` : '';
  const pr = r.isPR ? `<span class="badge-pr">PR</span>` : (r.isSB ? `<span class="badge-sb">SB</span>` : '');
  const w = r.windAided ? `<span class="badge-w" title="Wind-aided (over +2.0 m/s)">w</span>` : '';
  const inner = `${r.mark}${wind}${w}${pr}`;
  return r.link ? `<a href="${r.link}" target="_blank" rel="noopener">${inner}</a>` : inner;
}

function renderTable() {
  const rows = sortRows(applyFilters(ALL.filter((r) => r.event || r.status)));
  const arrow = (k) => sortKey === k ? `<span class="arrow">${sortDir === 1 ? '\u25B2' : '\u25BC'}</span>` : '';
  const head = `
    <tr>
      <th data-k="date">Date ${arrow('date')}</th>
      <th data-k="season">Season ${arrow('season')}</th>
      <th data-k="meet">Meet ${arrow('meet')}</th>
      <th data-k="event">Event ${arrow('event')}</th>
      <th data-k="mark">Mark ${arrow('mark')}</th>
      <th data-k="env">Type ${arrow('env')}</th>
    </tr>`;
  const body = rows.map((r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${r.season}</td>
      <td>${escapeHtml(r.meet)}</td>
      <td>${r.event || `<span class="muted">${escapeHtml(r.eventRaw || '')}</span>`}</td>
      <td class="mark">${markCell(r)}</td>
      <td>${r.env ? `<span class="tag-${r.env.toLowerCase()}">${r.env}</span>` : ''}</td>
    </tr>`).join('');
  $('#results-area').innerHTML = `
    <div class="table-wrap"><table>
      <thead>${head}</thead>
      <tbody>${body || `<tr><td colspan="6" class="muted">No results match your filters.</td></tr>`}</tbody>
    </table></div>`;
  $('#result-count').textContent = `${rows.filter((r) => r.mark).length} marks shown`;
  bindSortHandlers();
}

function renderSeasons() {
  const filtered = applyFilters(ALL);
  let html = '';
  for (const seasonLabel of seasonsSorted()) {
    const rows = filtered.filter((r) => r.season === seasonLabel);
    if (!rows.length) continue;
    // group by meet
    const meets = new Map();
    for (const r of rows) {
      const key = `${r.date ? r.date.getTime() : 0}|${r.meet}`;
      if (!meets.has(key)) meets.set(key, { date: r.date, meet: r.meet, env: r.env, rows: [] });
      meets.get(key).rows.push(r);
    }
    const sortedMeets = [...meets.values()].sort((a, b) =>
      (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
    const meetRows = sortedMeets.map((m) => {
      const marks = m.rows
        .filter((r) => r.event)
        .map((r) => {
          const wind = r.wind ? ` <span class="wind">${r.wind}</span>` : '';
          const pr = r.isPR ? ' <span class="badge-pr">PR</span>' : (r.isSB ? ' <span class="badge-sb">SB</span>' : '');
          const w = r.windAided ? ' <span class="badge-w" title="Wind-aided (over +2.0 m/s)">w</span>' : '';
          const body = `${r.event} <strong>${r.mark || '\u2014'}</strong>${wind}${w}${pr}`;
          return r.link ? `<a href="${r.link}" target="_blank" rel="noopener">${body}</a>` : body;
        }).join(' &nbsp;·&nbsp; ');
      const status = (!m.rows.some((r) => r.event)) ? `<span class="muted">${m.rows[0].status || ''}</span>` : marks;
      return `<tr class="meet-row">
        <td>${fmtDate(m.date)}</td>
        <td>${escapeHtml(m.meet)}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
    html += `<div class="season-block">
      <div class="season-title"><h3>${seasonLabel}</h3><span class="count">${sortedMeets.length} meets</span></div>
      <div class="table-wrap"><table><tbody>${meetRows}</tbody></table></div>
    </div>`;
  }
  $('#results-area').innerHTML = html || `<p class="muted">No meets match your filters.</p>`;
  $('#result-count').textContent = '';
}

/* ------------------------------ Chart ------------------------------------ */
function niceTicks(min, max, count) {
  if (min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const s = step * mult;
  const ticks = [];
  for (let t = Math.ceil(min / s) * s; t <= max + 1e-9; t += s) ticks.push(+t.toFixed(6));
  return ticks;
}

function renderChart() {
  const svg = $('#chart');
  const note = $('#chart-note');
  const tip = $('#chart-tooltip');
  tip.classList.add('hidden');

  const event = $('#c-event').value;
  const env = $('#c-env').value;
  const season = $('#c-season').value;
  if (!event) { svg.innerHTML = ''; note.textContent = 'No event selected.'; return; }

  const pts = ALL.filter((r) =>
    r.event === event && r.value != null && r.date &&
    (!env || r.env === env) && (!season || r.season === season));
  pts.sort((a, b) => a.date - b.date);

  if (pts.length === 0) {
    svg.innerHTML = '';
    note.textContent = `No results for ${event}${env ? ' (' + env + ')' : ''}${season ? ' in ' + season : ''}.`;
    return;
  }

  const isField = pts[0].field;
  const N = pts.length;
  const H = 340;
  const pad = { l: 58, r: 24, t: 18, b: 50 };
  const gap = 56;                                   // horizontal px per performance
  const plotW = Math.max((N - 1) * gap, 340);
  const W = pad.l + pad.r + plotW;
  const plotH = H - pad.t - pad.b;
  pts.forEach((p, i) => { p._i = i; });

  const ys = pts.map((p) => p.value);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.12 || Math.max(0.1, yMax * 0.02);
  yMin -= yPad; yMax += yPad;

  // Equal spacing per performance (ordinal x) so closely-dated meets stay readable.
  const xOf = (i) => pad.l + (N === 1 ? plotW / 2 : (i / (N - 1)) * plotW);
  const yOf = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceTicks(yMin, yMax, 5);
  let grid = '';
  for (const t of yTicks) {
    const y = yOf(t);
    grid += `<line class="chart-grid" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}"/>`;
    const lbl = isField ? t.toFixed(1) : t.toFixed(2);
    grid += `<text class="chart-label" x="${pad.l - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${lbl}</text>`;
  }

  // one date label per point
  let xLabels = '';
  pts.forEach((p, i) => {
    const lab = p.date.toLocaleDateString('en-US', { month: 'short' }) + " '" + String(p.date.getFullYear()).slice(2);
    xLabels += `<text class="chart-label" x="${xOf(i).toFixed(1)}" y="${H - pad.b + 18}" text-anchor="middle">${lab}</text>`;
  });

  // Trend line — segmented by season so seasons aren't connected to each other.
  const bySeason = {};
  pts.forEach((p) => { (bySeason[p.season] = bySeason[p.season] || []).push(p); });
  let lines = '';
  for (const seasonPts of Object.values(bySeason)) {
    if (seasonPts.length < 2) continue; // a lone point needs no line
    const d = seasonPts
      .map((p, i) => `${i ? 'L' : 'M'}${xOf(p._i).toFixed(1)},${yOf(p.value).toFixed(1)}`)
      .join(' ');
    lines += `<path class="chart-line" d="${d}"/>`;
  }
  const best = PRS[event];
  let circles = '';
  pts.forEach((p, i) => {
    const cls = ['chart-pt', p.env === 'Outdoor' ? 'outdoor' : 'indoor'];
    if (p.handTimed) cls.push('hand');
    if (p === best) cls.push('pr');
    else if (p.isSB) cls.push('sb');
    circles += `<circle class="${cls.join(' ')}" cx="${xOf(p._i).toFixed(1)}" cy="${yOf(p.value).toFixed(1)}" r="4.5" data-i="${i}"/>`;
  });

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.width = W + 'px';
  svg.style.height = H + 'px';
  svg.style.maxWidth = 'none';
  svg.innerHTML =
    `<line class="chart-axis" x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H - pad.b}"/>` +
    `<line class="chart-axis" x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}"/>` +
    grid + xLabels +
    lines + circles;

  note.innerHTML =
    `<span class="chart-legend">` +
    `<span><span class="dot indoor"></span>Indoor</span>` +
    `<span><span class="dot outdoor"></span>Outdoor</span>` +
    `<span><span class="dot hand"></span>Hand-timed</span>` +
    `<span><span class="dot sb"></span>Season best</span>` +
    `<span><span class="dot pr"></span>PR</span>` +
    `<span>${isField ? 'Higher = farther' : 'Lower = faster'}</span>` +
    `</span>`;

  const wrap = $('#chart-wrap');
  svg.querySelectorAll('.chart-pt').forEach((c) => {
    const p = pts[+c.dataset.i];
    const show = (e) => {
      const rect = wrap.getBoundingClientRect();
      tip.style.left = (e.clientX - rect.left + wrap.scrollLeft) + 'px';
      tip.style.top = (e.clientY - rect.top) + 'px';
      tip.innerHTML = `<strong>${p.mark}${p.wind ? ' ' + p.wind : ''}</strong>` +
        `${p.windAided ? ' <span style="color:#e67e22">wind-aided</span>' : ''}` +
        `${p.handTimed ? ' (hand)' : ''}<br>${escapeHtml(p.meet)}<br>${fmtDate(p.date)} · ${p.env}`;
      tip.classList.remove('hidden');
    };
    c.addEventListener('mouseenter', show);
    c.addEventListener('mousemove', show);
    c.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  });
}

function renderPRs() {
  const order = ['60m', '100m', '200m', '400m', '60m Hurdles', '100m Hurdles', '110m Hurdles',
    'Long Jump', 'Triple Jump', 'High Jump'];
  const keys = Object.keys(PRS).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const html = keys.map((k) => {
    const r = PRS[k];
    const w = r.windAided ? ` <span class="badge-w" title="Wind-aided (over +2.0 m/s)">w</span>` : '';
    let legalLine = '';
    if (r.windAided) {
      // best wind-legal mark for this event
      const legal = ALL.filter((x) => x.event === k && x.value != null && !x.handTimed && !x.windAided)
        .sort((a, b) => r.field ? b.value - a.value : a.value - b.value)[0];
      if (legal) {
        legalLine = `<div class="pr-legal">Best legal: <strong>${legal.mark}</strong>` +
          `${legal.wind ? ` <span class="wind">${legal.wind}</span>` : ''} · ${fmtDate(legal.date)}</div>`;
      }
    }
    return `<div class="pr-row">
        <span class="pr-ev">${k}</span>
        <span class="pr-mk">${r.mark}${r.wind ? ` <span class="wind">${r.wind}</span>` : ''}${w}</span>
      </div>
      <div class="pr-meta">${escapeHtml(r.meet)} · ${fmtDate(r.date)}</div>
      ${legalLine}`;
  }).join('');
  $('#pr-list').innerHTML = html || '<p class="muted">No PRs yet.</p>';
}

function render() {
  if (view === 'table') renderTable(); else renderSeasons();
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------ Handlers --------------------------------- */
function bindSortHandlers() {
  document.querySelectorAll('th[data-k]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir *= -1;
      else { sortKey = k; sortDir = (k === 'date') ? -1 : 1; }
      renderTable();
    });
  });
}

function bindControls() {
  ['#f-event', '#f-env'].forEach((s) => $(s).addEventListener('change', render));
  $('#f-season').addEventListener('change', () => { refreshEventFilter(); render(); });
  $('#f-search').addEventListener('input', render);
  ['#c-event', '#c-env'].forEach((s) => $(s).addEventListener('change', renderChart));
  $('#c-season').addEventListener('change', () => { refreshChartEvents(); renderChart(); });
  document.querySelectorAll('.toggle-group button').forEach((btn) => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      document.querySelectorAll('.toggle-group button').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
  });
}

function renderStats() {
  const marks = ALL.filter((r) => r.mark).length;
  const meets = new Set(ALL.map((r) => `${r.date ? r.date.getTime() : 0}|${r.meet}`)).size;
  const prs = Object.keys(PRS).length;
  $('#stats').innerHTML = `
    <div class="stat"><div class="num">${meets}</div><div class="lbl">Meets</div></div>
    <div class="stat"><div class="num">${marks}</div><div class="lbl">Marks recorded</div></div>
    <div class="stat"><div class="num">${prs}</div><div class="lbl">Personal bests</div></div>
    <div class="stat"><div class="num">${seasonsSorted().length}</div><div class="lbl">Seasons</div></div>`;
}

/* -------------------------------- Init ----------------------------------- */
async function init() {
  bindControls();
  try {
    ALL = await loadAll();
    PRS = computePRs(ALL);
    computeSeasonBests(ALL);
    $('#loading').classList.add('hidden');
    $('#content').classList.remove('hidden');
    populateFilters();
    renderStats();
    renderPRs();
    renderChart();
    render();
  } catch (err) {
    $('#loading').classList.add('hidden');
    const e = $('#error');
    e.classList.remove('hidden');
    e.querySelector('.error-detail').textContent = err.message || String(err);
    console.error(err);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

// Export pure functions for Node-based testing (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCSV, normalizeEvent, parseMark, parseDate, splitResults,
    buildResults, computePRs, computeSeasonBests, seasonEnv, SEASONS, csvUrl, PARSE_WARNINGS,
    buildCleanResults, dedupKey,
  };
}
