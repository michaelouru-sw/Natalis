/* Natalis prediction engine — pure functions, no DOM, no network. Dates are 'YYYY-MM-DD' strings. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 86400000;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => fmt(parse(s) + n * DAY);
  const diff = (a, b) => Math.round((parse(a) - parse(b)) / DAY); // a - b in days
  const todayStr = () => { const d = new Date(); return fmt(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : NaN);
  const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
  const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo); };

  const DEFAULTS = { cycle: 28, period: 5, luteal: 14 };
  const MIN_LEN = 15, MAX_LEN = 120; // lengths outside are treated as logging gaps/errors, not cycles

  function sortedPeriods(periods) { return [...periods].sort((a, b) => (a.start < b.start ? -1 : 1)); }

  /** Completed cycle lengths between consecutive period starts. */
  function cycles(periods) {
    const p = sortedPeriods(periods), out = [];
    for (let i = 1; i < p.length; i++) {
      const len = diff(p[i].start, p[i - 1].start);
      out.push({ start: p[i - 1].start, next: p[i].start, len, valid: len >= MIN_LEN && len <= MAX_LEN });
    }
    return out;
  }
  const validLens = (periods) => cycles(periods).filter((c) => c.valid).map((c) => c.len);

  function periodLengths(periods) {
    return periods.filter((p) => p.end).map((p) => diff(p.end, p.start) + 1).filter((n) => n >= 1 && n <= 14);
  }

  /** Predictability level from the last 6 cycles: regular / variable / irregular / learning */
  function classify(lens) {
    const L = lens.slice(-6);
    if (L.length < 3) return { level: 'learning', n: L.length, range: 0, sd: 0 };
    const range = Math.max(...L) - Math.min(...L);
    const level = range >= 10 ? 'irregular' : range >= 7 ? 'variable' : 'regular';
    return { level, n: L.length, range, sd: sd(L), mean: mean(L), median: median(L), min: Math.min(...L), max: Math.max(...L) };
  }

  /** Expected distribution of the NEXT cycle length. {lo, mid, hi, level, basis} */
  function lengthDistribution(lens, mode) {
    const c = classify(lens);
    let level = c.level;
    if (mode === 'regular' && lens.length >= 2) level = 'regular';
    if (mode === 'irregular' && lens.length >= 2) level = 'irregular';
    const n = lens.length;
    if (n === 0) return { lo: DEFAULTS.cycle - 5, mid: DEFAULTS.cycle, hi: DEFAULTS.cycle + 5, level: 'learning', basis: 'starter', n };
    if (n < 3 && mode === 'auto') {
      const m = Math.round(mean(lens)), half = n === 1 ? 4 : 3;
      return { lo: m - half, mid: m, hi: m + half, level: 'learning', basis: 'starter', n };
    }
    if (level === 'regular') {
      const L = lens.slice(-6);
      const w = L.map((_, i) => i + 1); // newer cycles weigh more
      const mid = Math.round(sum(L.map((x, i) => x * w[i])) / sum(w));
      const half = Math.max(2, Math.ceil(1.28 * sd(L)));
      return { lo: mid - half, mid, hi: mid + half, level, basis: 'weighted-average', n };
    }
    if (level === 'variable') {
      const L = lens.slice(-6), mid = Math.round(median(L));
      const lo = Math.min(...L), hi = Math.max(...L);
      return { lo: Math.min(lo, mid - 3), mid, hi: Math.max(hi, mid + 3), level, basis: 'range', n };
    }
    const L = lens.slice(-8), mid = Math.round(median(L));
    return { lo: Math.floor(quantile(L, 0.1)) - 2, mid, hi: Math.ceil(quantile(L, 0.9)) + 2, level: 'irregular', basis: 'range', n };
  }

  /** Temperature shift ("3 over 6") or LH surge → ovulation date within a cycle window. */
  function detectOvulation(days, startDate, endExclusive) {
    const dates = Object.keys(days).filter((d) => d >= startDate && (!endExclusive || d < endExclusive)).sort();
    const temps = dates.filter((d) => typeof days[d].bbt === 'number').map((d) => ({ d, t: days[d].bbt }));
    for (let i = 6; i + 2 < temps.length; i++) {
      const base = Math.max(...temps.slice(i - 6, i).map((x) => x.t));
      const a = temps[i].t, b = temps[i + 1].t, c = temps[i + 2].t;
      if (a > base && b > base && c >= base + 0.2 && diff(temps[i + 2].d, temps[i].d) <= 5) {
        return { date: add(temps[i].d, -1), method: 'bbt' };
      }
    }
    const lh = dates.find((d) => days[d].lh === 'pos' || days[d].lh === 'peak');
    if (lh) return { date: add(lh, 1), method: 'lh' };
    return null;
  }

  /** Luteal phase learned from cycles with a confirmed ovulation. */
  function lutealStats(state) {
    const vals = [];
    for (const c of cycles(state.periods)) {
      if (!c.valid) continue;
      const ov = detectOvulation(state.days || {}, c.start, c.next);
      if (ov) { const l = diff(c.next, ov.date); if (l >= 8 && l <= 18) vals.push(l); }
    }
    return vals.length ? { n: vals.length, median: Math.round(median(vals)), sd: sd(vals), learned: true } : { n: 0, median: DEFAULTS.luteal, sd: 2, learned: false };
  }

  /**
   * Prediction for the next period.
   * Returns { status, level, nextStart:{earliest,likely,latest}, ovulation, fertile, basis, confidence, dayOfCycle, ... }
   */
  function predictNext(state, today) {
    const s = state.settings || {};
    const ps = sortedPeriods(state.periods);
    if (!ps.length) return { status: 'no-data' };
    const last = ps[ps.length - 1].start;
    const N = diff(today, last) + 1; // today is day N of the current cycle
    const lens = validLens(state.periods);
    const dist = lengthDistribution(lens, s.mode || 'auto');
    const luteal = lutealStats(state);
    const lutealDays = s.lutealOverride || luteal.median;
    let { lo, mid, hi } = dist;
    let basis = dist.basis, status = 'on-track', note = '';

    // Confirmed ovulation in the current cycle → the period date becomes far more predictable.
    const ovNow = detectOvulation(state.days || {}, last, null);
    let ovulation;
    if (ovNow && !s.hormonalContraception) {
      const spread = luteal.learned && luteal.n >= 3 && luteal.sd <= 1.2 ? 1 : 2;
      const likely = add(ovNow.date, lutealDays);
      const el = diff(likely, last);
      lo = el - spread; mid = el; hi = el + spread;
      basis = 'ovulation-confirmed';
      ovulation = { date: ovNow.date, confirmed: true, method: ovNow.method };
    }

    // Past the usual window → condition on "not started yet".
    if (basis !== 'ovulation-confirmed') {
      if (N - 1 > hi) {
        status = 'late';
        const longer = lens.filter((l) => l >= N);
        if (dist.level !== 'regular' && longer.length >= 2) { lo = N - 1; mid = Math.round(median(longer)); hi = Math.max(...longer) + 1; basis = 'conditional'; }
        else { lo = N - 1; mid = N + 1; hi = N + 6; basis = 'late'; }
      } else if (N - 1 > mid) {
        status = 'due';
        const longer = lens.filter((l) => l >= N - 1);
        if (dist.level !== 'regular' && longer.length >= 2) { mid = Math.round(median(longer)); basis = 'conditional'; }
        else mid = Math.max(mid, N);
        lo = Math.max(lo, N - 1);
      } else if (N - 1 >= lo) status = 'due';
    } else if (N - 1 > hi) status = 'late';

    lo = Math.max(lo, N - 1); mid = Math.max(mid, lo); hi = Math.max(hi, mid + 1);
    const nextStart = { earliest: add(last, lo), likely: add(last, mid), latest: add(last, hi) };

    // Ovulation / fertile estimate (calendar method — informational only).
    if (!ovulation && !s.hormonalContraception) {
      const oLo = add(nextStart.earliest, -lutealDays), oMid = add(nextStart.likely, -lutealDays), oHi = add(nextStart.latest, -lutealDays);
      ovulation = { date: oMid, earliest: oLo, latest: oHi, confirmed: false, wide: diff(oHi, oLo) > 6 };
    }
    let fertile = null;
    if (ovulation) {
      const a = ovulation.confirmed ? ovulation.date : ovulation.earliest, b = ovulation.confirmed ? ovulation.date : ovulation.latest;
      fertile = { start: add(a, -5), end: add(b, 1) };
    }

    const width = diff(nextStart.latest, nextStart.earliest) + 1;
    let confidence = 'low';
    if (basis === 'ovulation-confirmed') confidence = 'high';
    else if (dist.level === 'regular' && dist.n >= 4) confidence = width <= 5 ? 'high' : 'medium';
    else if (dist.level === 'regular' || dist.level === 'variable') confidence = dist.n >= 4 ? 'medium' : 'low';

    return { status, level: dist.level, basis, confidence, dayOfCycle: N, lastStart: last, nextStart, windowDays: width, midLen: dist.mid, spread: { lo: dist.mid - dist.lo, hi: dist.hi - dist.mid }, ovulation, fertile, luteal, n: dist.n, note };
  }

  /** Project k future cycles (k=1 uses predictNext). Windows widen with sqrt(k). */
  function forecast(state, today, count) {
    const p = predictNext(state, today);
    if (p.status === 'no-data') return [];
    const s = state.settings || {};
    const pl = Math.round(median(periodLengths(state.periods)) || s.periodDefault || DEFAULTS.period);
    const out = [];
    const lutealDays = s.lutealOverride || p.luteal.median;
    for (let k = 1; k <= count; k++) {
      let earliest, likely, latest;
      if (k === 1) ({ earliest, likely, latest } = p.nextStart);
      else {
        const sq = Math.sqrt(k);
        likely = add(p.nextStart.likely, (k - 1) * p.midLen);
        earliest = add(likely, -Math.ceil(Math.max(2, p.spread.lo) * sq));
        latest = add(likely, Math.ceil(Math.max(2, p.spread.hi) * sq));
      }
      const o = add(likely, -lutealDays);
      out.push({ k, earliest, likely, latest, periodLen: pl, ovulation: o, fertile: { start: add(o, -5), end: add(o, 1) }, confirmedOv: k === 1 && p.basis === 'ovulation-confirmed' });
    }
    return out;
  }

  /** What to draw for a given calendar date. */
  function dayStatus(state, date, fc) {
    const out = { period: false, predicted: false, predictedLikely: false, fertile: false, ovulation: false };
    for (const p of state.periods) {
      const end = p.end || add(p.start, Math.max(0, (state.settings.periodDefault || 5) - 1));
      if (date >= p.start && date <= end) out.period = true;
    }
    if (!fc || state.settings.predictionsOn === false) return out;
    for (const f of fc) {
      if (date >= f.earliest && date <= add(f.latest, f.periodLen - 1) && !out.period) {
        // bleeding days from earliest..latest+len; mark the likely span stronger
        const likelyEnd = add(f.likely, f.periodLen - 1);
        out.predicted = true;
        if (date >= f.likely && date <= likelyEnd) out.predictedLikely = true;
      }
      if (state.settings.showFertile && !state.settings.hormonalContraception) {
        if (date >= f.fertile.start && date <= f.fertile.end) out.fertile = true;
        if (date === f.ovulation) out.ovulation = true;
      }
    }
    return out;
  }

  /** Phase of a past/current date based on logged cycles. */
  function phaseOf(state, date) {
    const ps = sortedPeriods(state.periods);
    let idx = -1;
    for (let i = 0; i < ps.length; i++) if (ps[i].start <= date) idx = i;
    if (idx < 0) return null;
    const cur = ps[idx], next = ps[idx + 1];
    const endEx = next ? next.start : null;
    if (endEx && diff(endEx, cur.start) > MAX_LEN) return null;
    if (!endEx && diff(date, cur.start) > MAX_LEN) return null;
    const pend = cur.end || add(cur.start, (state.settings.periodDefault || 5) - 1);
    if (date <= pend) return 'menstrual';
    const ov = detectOvulation(state.days || {}, cur.start, endEx);
    let ovDate;
    if (ov) ovDate = ov.date;
    else if (next) ovDate = add(next.start, -DEFAULTS.luteal);
    else ovDate = add(cur.start, Math.round(median(validLens(state.periods)) || DEFAULTS.cycle) - DEFAULTS.luteal);
    if (date < add(ovDate, -1)) return 'follicular';
    if (date <= add(ovDate, 1)) return 'ovulatory';
    return 'luteal';
  }

  function insights(state, today) {
    const lens = validLens(state.periods);
    const cls = classify(lens);
    const cyc = cycles(state.periods);
    const pl = periodLengths(state.periods);
    const byPhase = { menstrual: {}, follicular: {}, ovulatory: {}, luteal: {} };
    const phaseDays = { menstrual: 0, follicular: 0, ovulatory: 0, luteal: 0 };
    for (const [d, v] of Object.entries(state.days || {})) {
      const ph = phaseOf(state, d); if (!ph) continue;
      const items = [...(v.symptoms || []), ...(v.mood || [])];
      if (items.length) phaseDays[ph]++;
      items.forEach((it) => { byPhase[ph][it] = (byPhase[ph][it] || 0) + 1; });
    }
    const top = {};
    for (const ph of Object.keys(byPhase)) top[ph] = Object.entries(byPhase[ph]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => ({ name: k, n }));
    const alerts = [];
    const last3 = lens.slice(-3);
    if (last3.length === 3 && last3.every((l) => l < 21)) alerts.push({ id: 'short', text: 'Last 3 cycles under 21 days.' });
    if (last3.length === 3 && last3.every((l) => l > 35)) alerts.push({ id: 'long', text: 'Last 3 cycles over 35 days.' });
    if (cls.level === 'irregular') alerts.push({ id: 'variation', text: `Cycles vary by ${cls.range} days.` });
    const ps = sortedPeriods(state.periods);
    if (ps.length && today && diff(today, ps[ps.length - 1].start) > 90 && !state.settings.paused)
      alerts.push({ id: 'amenorrhea', text: 'No period logged for 90+ days.' });
    if (pl.some((n) => n > 7)) alerts.push({ id: 'long-period', text: 'A period lasted over 7 days.' });
    return { lens, cls, cycles: cyc, periodLen: pl.length ? { median: median(pl), min: Math.min(...pl), max: Math.max(...pl) } : null, topSymptoms: top, phaseDays, luteal: lutealStats(state), alerts };
  }

  /** Neutral calendar events built from state — used by Google sync and .ics export. */
  function buildCalendarEvents(state, today) {
    const s = state.settings, c = s.cal || {};
    const discreet = c.discreet !== false;
    const label = (t, d) => (discreet ? d : t);
    const ev = [];
    const rem = (days) => (days > 0 ? [{ minutes: days * 1440 - 540 }] : []); // popup at 09:00, N days before
    if (c.pushLogged !== false) {
      for (const p of state.periods) {
        const end = p.end || add(p.start, (s.periodDefault || 5) - 1);
        ev.push({ kind: 'l', key: p.start, start: p.start, end: add(end, 1), summary: label('Period', '●'), description: 'Logged in Natalis.', reminders: [], open: !p.end });
      }
    }
    if (s.predictionsOn !== false) {
      const p = predictNext(state, today);
      if (p.status !== 'no-data' && !s.paused) {
        const count = p.level === 'irregular' ? 2 : 3;
        for (const f of forecast(state, today, count)) {
          if (f.latest < today) continue;
          const wide = diff(f.latest, f.earliest) >= 3;
          const likelyTxt = `Most likely around ${f.likely}.`;
          ev.push({
            kind: 'p', key: f.earliest, start: f.earliest, end: add(wide ? f.latest : f.earliest, 1),
            summary: label(wide ? 'Period expected (window)' : 'Period expected', '○'),
            description: `${likelyTxt} Prediction window ${f.earliest} to ${f.latest}. Estimates only; log your real start date in Natalis.`,
            reminders: rem(c.remindDays ?? 1),
          });
        }
        if (s.showFertile && c.pushFertile && !s.hormonalContraception) {
          for (const f of forecast(state, today, 2)) {
            if (f.fertile.end < today) continue;
            ev.push({ kind: 'f', key: f.fertile.start, start: f.fertile.start, end: add(f.fertile.end, 1), summary: label('Fertile window (estimate)', '◇'), description: 'Calendar estimate only — not contraception.', reminders: [] });
          }
        }
      }
    }
    return ev;
  }

  function toICS(events, name) {
    const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const d8 = (s) => s.replace(/-/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Natalis//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + esc(name || 'Cycle')];
    for (const e of events) {
      lines.push('BEGIN:VEVENT', `UID:cw-${e.kind}-${d8(e.key)}@natalis.local`, 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d8(e.start), 'DTEND;VALUE=DATE:' + d8(e.end),
        'SUMMARY:' + esc(e.summary), 'DESCRIPTION:' + esc(e.description), 'TRANSP:TRANSPARENT', 'CLASS:PRIVATE');
      for (const r of e.reminders || []) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.summary), `TRIGGER:-PT${r.minutes}M`, 'END:VALARM');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  return { parse, fmt, add, diff, todayStr, mean, median, sd, quantile, DEFAULTS, cycles, validLens, periodLengths, classify, lengthDistribution, detectOvulation, lutealStats, predictNext, forecast, dayStatus, phaseOf, insights, buildCalendarEvents, toICS, sortedPeriods };
});
