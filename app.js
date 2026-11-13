/* Natalis UI. All data lives on this device (localStorage). The only network use is optional Google Calendar sync. */
(() => {
  'use strict';
  const E = Engine;
  const KEY = 'cyclewise.v1';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => E.todayStr();

  const SYMPTOMS = ['Cramps', 'Headache', 'Bloating', 'Fatigue', 'Breast tenderness', 'Acne', 'Back pain', 'Nausea', 'Cravings', 'Insomnia', 'Spotting'];
  const MOODS = ['Calm', 'Happy', 'Energetic', 'Anxious', 'Irritable', 'Low'];
  const MUCUS = ['Dry', 'Sticky', 'Creamy', 'Watery', 'Egg-white'];
  const FLOW = ['Spotting', 'Light', 'Medium', 'Heavy'];

  const DEFAULT_SETTINGS = () => ({
    mode: 'auto', predictionsOn: true, showFertile: false, hormonalContraception: false, paused: false,
    periodDefault: 5, waterGoal: 8, unit: 'C', weekStart: 1, pinHash: null, pinSalt: null,
    cal: { clientId: '', calendarId: '', discreet: true, remindDays: 1, pushLogged: true, pushFertile: false, autoSync: true, lastSync: null, dirty: false },
  });
  const fresh = () => ({ v: 1, periods: [], days: {}, settings: DEFAULT_SETTINGS() });

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.periods)) { const d = DEFAULT_SETTINGS(); s.settings = { ...d, ...s.settings, cal: { ...d.cal, ...((s.settings || {}).cal || {}) } }; s.days = s.days || {}; return s; }
    } catch (e) { /* fall through */ }
    return fresh();
  }
  let state = load();
  let view = 'today', calMonth = today().slice(0, 7), sheetDate = null, busy = false, showSetup = false, deferredInstall = null;
  let lastActive = Date.now(), animNext = true;

  /* ---------- state helpers ---------- */
  function normalize() {
    const t = today(), pd = state.settings.periodDefault || 5;
    state.periods = state.periods.filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.start)).sort((a, b) => (a.start < b.start ? -1 : 1));
    state.periods.forEach((p, i) => {
      p.id = p.id || uid();
      const next = state.periods[i + 1];
      if (p.end && p.end < p.start) p.end = p.start;
      if (!p.end && E.diff(t, p.start) > 14) p.end = E.add(p.start, pd - 1);
      if (next && (!p.end || p.end >= next.start)) p.end = E.add(next.start, -1) < p.start ? p.start : E.add(next.start, -1);
    });
  }
  let syncTimer = null;
  function save(opts = {}) {
    normalize();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Storage is full or blocked — export a backup.'); }
    const c = state.settings.cal;
    if (!opts.noSync && c.calendarId) {
      if (c.autoSync && Gcal.hasToken()) { clearTimeout(syncTimer); syncTimer = setTimeout(() => doSync(true), 2500); }
      else c.dirty = true;
    }
  }
  const setDay = (date, patch) => {
    const d = { ...(state.days[date] || {}), ...patch };
    Object.keys(d).forEach((k) => { if (d[k] === '' || d[k] == null || (Array.isArray(d[k]) && !d[k].length) || d[k] === false || d[k] === 0) delete d[k]; });
    if (Object.keys(d).length) state.days[date] = d; else delete state.days[date];
  };
  const periodAt = (date) => state.periods.find((p) => date >= p.start && date <= (p.end || E.add(p.start, 13)));

  function startPeriod(date) {
    if (state.periods.some((p) => date >= p.start && date <= (p.end || E.add(p.start, state.settings.periodDefault - 1)))) return toast('That day is already in a logged period.');
    state.periods.push({ id: uid(), start: date, end: date === today() ? null : date }); save();
  }
  function endPeriod(date) {
    const p = [...state.periods].reverse().find((x) => x.start <= date);
    if (!p) return; p.end = date; save();
  }
  function togglePeriodDay(date, on) {
    if (date > today()) return toast('You can only log up to today.');
    if (on) {
      const p = state.periods.find((x) => x.end && date === E.add(x.end, 1)) || state.periods.find((x) => date === E.add(x.start, -1)) || state.periods.find((x) => !x.end && date >= x.start && date <= E.add(x.start, 13));
      if (p && date < p.start) p.start = date; else if (p) p.end = date; else state.periods.push({ id: uid(), start: date, end: date === today() ? null : date });
    } else {
      const p = periodAt(date); if (!p) return;
      const shownEnd = p.end || E.add(p.start, state.settings.periodDefault - 1);
      if (date === p.start && date >= shownEnd) state.periods = state.periods.filter((x) => x !== p);
      else if (date === p.start) p.start = E.add(date, 1);
      else p.end = E.add(date, -1);
    }
    save();
  }

  /* ---------- formatting ---------- */
  const fd = (d, o) => new Date(E.parse(d)).toLocaleDateString(undefined, { timeZone: 'UTC', ...(o || { weekday: 'short', day: 'numeric', month: 'short' }) });
  const fshort = (d) => fd(d, { day: 'numeric', month: 'short' });
  const rel = (d) => { const n = E.diff(d, today()); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`; };
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* ignore */ } };
  const toUnit = (c) => (state.settings.unit === 'F' ? Math.round((c * 9 / 5 + 32) * 100) / 100 : c);
  const fromUnit = (v) => (state.settings.unit === 'F' ? Math.round(((v - 32) * 5 / 9) * 100) / 100 : v);
  const NAME = { menstrual: 'Menstrual', follicular: 'Follicular', ovulatory: 'Around ovulation', luteal: 'Luteal' };

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200); }

  /* ---------- views ---------- */
  const ICON = {
    today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    wellness: '<svg viewBox="0 0 24 24"><path d="M12 20c-5-3.5-8-6.4-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 3.6-3 6.5-8 10z"/></svg>',
    insights: '<svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></svg>',
  };
  function renderTabs() {
    $('#tabs').innerHTML = [['today', 'Today'], ['calendar', 'Calendar'], ['wellness', 'Wellness'], ['insights', 'Insights'], ['settings', 'Settings']]
      .map(([k, l]) => `<button data-act="tab" data-v="${k}" class="${view === k ? 'on' : ''}" aria-current="${view === k}">${ICON[k]}<span>${l}</span></button>`).join('');
  }

  function explain(p) {
    const lens = E.validLens(state.periods).slice(-6), r = lens.length ? `${Math.min(...lens)}–${Math.max(...lens)}` : '';
    if (p.basis === 'ovulation-confirmed') return `Ovulation detected ${fshort(p.ovulation.date)} (${p.ovulation.method === 'bbt' ? 'temperature' : 'LH'}); period usually follows ~${p.luteal.median} days later.`;
    if (p.basis === 'conditional') return `Uses only past cycles at least this long.`;
    if (p.basis === 'late') return `Longer than any recent cycle.`;
    if (p.basis === 'starter') return `Learning: ${p.n} cycle${p.n === 1 ? '' : 's'} logged. Better after 3–6.`;
    if (p.level === 'regular') return `Last ${lens.length} cycles: ${r} days.`;
    if (p.level === 'variable') return `Last ${lens.length} cycles: ${r} days. Window covers the spread.`;
    return `Cycles vary (${r} days), so a range beats one date. LH or temperature logs narrow it.`;
  }

  function viewToday() {
    const t = today(), s = state.settings;
    if (!state.periods.length) return onboarding();
    const p = E.predictNext(state, t), inP = periodAt(t), ins = E.insights(state, t);
    const N = p.dayOfCycle, cycleLen = p.midLen || 28, pct = Math.min(1, N / cycleLen), C = 2 * Math.PI * 50;
    const phase = E.phaseOf(state, t);
    let main = '';
    if (s.paused) main = `<div class="card"><h2>Tracking paused</h2><p class="small mute">Resume in Settings.</p></div>`;
    else if (s.predictionsOn === false) main = `<div class="card"><h2>Predictions off</h2><p class="small mute">Logging only.</p></div>`;
    else main = predictionCard(p);

    const tips = [];
    if (!s.paused && s.predictionsOn !== false && (p.level === 'irregular' || p.level === 'variable') && p.basis !== 'ovulation-confirmed' && !s.hormonalContraception)
      tips.push(`<div class="card row wrap"><span class="small grow">Sharpen the range</span><button class="ghost sm" data-act="quick" data-k="lh">LH test</button><button class="ghost sm" data-act="quick" data-k="bbt">Temp</button></div>`);
    if (p.status === 'late' && !s.paused) tips.push(`<div class="card warn small">Later than usual. If pregnancy is possible, take a test.</div>`);
    for (const a of ins.alerts.slice(0, 2)) tips.push(`<div class="card warn small">${esc(a.text)} <a href="#" data-act="tab" data-v="insights" style="color:var(--brand)">Details</a></div>`);
    if (s.cal.calendarId && s.cal.dirty && !busy) tips.push(`<div class="card row"><div class="grow small">Calendar out of date</div><button class="sm" data-act="gc-sync">Sync</button></div>`);

    return `<h1>Today</h1>
    <div class="card hero ph-${phase || 'none'}">
      <div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="60" cy="60" r="50" fill="none" stroke="${inP ? 'var(--period)' : 'var(--brand-2)'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><div class="in"><div><b>${N}</b><br><span>cycle day</span></div></div></div>
      <div class="grow"><div class="big">${inP ? `Period day ${E.diff(t, inP.start) + 1}` : phase ? NAME[phase] : 'Cycle day ' + N}</div><p class="mute small">${fd(t)}</p></div>
    </div>
    <div class="row wrap" style="margin-bottom:12px">
      ${inP ? `<button class="grow soft" data-act="period-end">Period ended today</button>` : `<button class="grow" data-act="period-start">Period started today</button>`}
      <button class="grow ghost" data-act="log" data-d="${t}">Log today</button>
    </div>
    ${main}${tips.join('')}`;
  }

  function predictionCard(p) {
    const t = today(), n = p.nextStart, wide = p.level === 'irregular' || p.windowDays > 7;
    const from = n.earliest < t ? n.earliest : t, to = E.add(n.latest, 2), span = Math.max(1, E.diff(to, from));
    const pos = (d) => Math.max(0, Math.min(100, (E.diff(d, from) / span) * 100));
    const bar = `<div class="rangebar" role="img" aria-label="Prediction window"><i style="left:${pos(n.earliest)}%;width:${Math.max(2, pos(n.latest) - pos(n.earliest))}%"></i>${wide ? '' : `<u style="left:${pos(n.likely)}%"></u>`}<s style="left:${pos(t)}%"></s></div><div class="scale"><span>${fshort(from)}</span><span>${fshort(to)}</span></div>`;
    let head, sub;
    if (p.status === 'late') { head = `Day ${p.dayOfCycle}, later than usual`; sub = `Usual cycle ~${p.midLen} days. May still arrive ${fshort(n.earliest)} – ${fshort(n.latest)}.`; }
    else if (wide) { head = `${fshort(n.earliest)} – ${fshort(n.latest)}`; sub = `Midpoint ${fshort(n.likely)} · ${rel(n.likely)}`; }
    else { head = `${fd(n.likely)} <span class="mute small">${rel(n.likely)}</span>`; sub = `Window ${fshort(n.earliest)} – ${fshort(n.latest)}`; }
    let fert = '';
    if (state.settings.showFertile && !state.settings.hormonalContraception && p.fertile) {
      const o = p.ovulation;
      fert = `<p class="small gap"><b style="color:var(--fert)">${o.confirmed ? 'Ovulation' : 'Fertile (est.)'}</b> ${o.confirmed ? fshort(o.date) : `${fshort(p.fertile.start)} – ${fshort(p.fertile.end)}`} <span class="mute">· not contraception</span></p>`;
    }
    return `<div class="card"><div class="row"><h2 class="grow">Next period</h2><span class="badge b-${p.confidence}">${p.confidence}</span></div>
      <div class="big">${head}</div><p class="small mute">${sub}</p>${bar}
      <details><summary class="small mute">Why?</summary><p class="small mute">${explain(p)}</p></details>${fert}</div>`;
  }

  function onboarding() {
    return `<h1>Natalis</h1>
    <div class="card"><h2>Start</h2>
      <label for="ob-date">Last period started</label>
      <input id="ob-date" type="date" max="${today()}" value="${E.add(today(), -14)}">
      <label>Your periods are</label>
      <div class="chips" id="ob-mode">
        <button class="chip on" data-act="ob-mode" data-v="auto">Not sure</button>
        <button class="chip" data-act="ob-mode" data-v="regular">Regular</button>
        <button class="chip" data-act="ob-mode" data-v="irregular">Unpredictable</button>
      </div>
      <button class="gap" style="width:100%" data-act="ob-save">Start tracking</button>
      <details class="gap"><summary class="small">Add earlier periods</summary>
        ${[1, 2, 3, 4, 5, 6].map(() => `<input class="ob-past" type="date" max="${today()}" style="margin-top:6px" aria-label="Earlier period start">`).join('')}
      </details>
    </div>
    <p class="center small"><button class="ghost sm" data-act="demo">Sample data</button></p>`;
  }

  /* calendar */
  function viewCalendar() {
    const t = today(), [y, m] = calMonth.split('-').map(Number), first = `${calMonth}-01`;
    const ws = state.settings.weekStart, dow = new Date(E.parse(first)).getUTCDay(), lead = (dow - ws + 7) % 7;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), cells = Math.ceil((lead + dim) / 7) * 7;
    const fc = state.settings.paused || state.settings.predictionsOn === false ? null : E.forecast(state, t, 8);
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let g = '';
    for (let i = 0; i < 7; i++) g += `<div class="dow">${labels[(i + ws) % 7]}</div>`;
    for (let i = 0; i < cells; i++) {
      const d = E.add(first, i - lead), inMonth = d.slice(0, 7) === calMonth;
      const st = E.dayStatus(state, d, d >= t || true ? fc : null);
      const past = d < t;
      const cls = ['day'];
      if (!inMonth) cls.push('out');
      if (st.period) cls.push('period'); else if (!past && st.predictedLikely) cls.push('predl'); else if (!past && st.predicted) cls.push('pred'); else if (!past && st.fertile) cls.push('fert');
      if (!past && st.ovulation && !st.period) cls.push('ov');
      if (d === t) cls.push('today');
      const has = state.days[d] && Object.keys(state.days[d]).length;
      g += `<button class="${cls.join(' ')}" data-act="log" data-d="${d}" aria-label="${fd(d)}${st.period ? ', period' : ''}">${Number(d.slice(8))}${has ? '<span class="dot"></span>' : ''}</button>`;
    }
    const mt = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `<h1>Calendar</h1><div class="card">
      <div class="cal-head"><button class="ghost sm" data-act="month" data-n="-1" aria-label="Previous month">‹</button><b>${mt}</b><button class="ghost sm" data-act="month" data-n="1" aria-label="Next month">›</button></div>
      <div class="grid">${g}</div>
      <div class="legend"><span><i style="background:var(--period)"></i>Period</span><span><i style="background:var(--pred)"></i>Likely start</span><span><i style="background:var(--period-soft)"></i>Possible window</span>${state.settings.showFertile ? '<span><i style="background:var(--fert-soft)"></i>Fertile (est.)</span>' : ''}<span><i style="background:var(--brand-2);border-radius:50%"></i>Logged</span></div>
    </div>
    <div class="row wrap"><button class="ghost sm" data-act="month" data-n="0">Jump to today</button><button class="ghost sm" data-act="add-past">Add a past period</button></div>`;
  }


  /* ---------- wellness ---------- */
  const evTag = (e) => `<span class="ev ev-${e}">${Wellness.EVIDENCE[e]}</span>`;
  const tipList = (items, n) => { const li = (i) => `<li><i class="evd ev-${i.e}" title="${Wellness.EVIDENCE[i.e]}"></i><span>${esc(i.t)}</span></li>`; const head = items.slice(0, n || 99), rest = items.slice(n || 99); return `<ul class="tips">${head.map(li).join('')}</ul>${rest.length ? `<details><summary class="small mute">More</summary><ul class="tips">${rest.map(li).join('')}</ul></details>` : ''}`; };
  function focusCard(phase, ins) {
    const p = Wellness.dailyPlan(state, today(), phase, ins);
    return `<div class="card focus"><div class="row"><h2 class="grow">Today's focus</h2><button class="ghost sm" data-act="tab" data-v="wellness">Wellness plan</button></div>
      <p class="small mute">${esc(p.title)} — ${esc(p.blurb)}</p>
      <div class="frow"><span class="ficon">🥗</span><p class="small">${esc(p.eat[0].t)}</p></div>
      <div class="frow"><span class="ficon">🚶🏾‍♀️</span><p class="small">${esc(p.move[0].t)}</p></div></div>`;
  }
  const ringSvg = (pct, color, icon) => { const C = 2 * Math.PI * 34; return `<svg viewBox="0 0 80 80" class="mring"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--line)" stroke-width="8"/><circle cx="40" cy="40" r="34" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 40 40)" style="transition:stroke-dashoffset .6s"/><text x="40" y="47" text-anchor="middle" font-size="22">${icon}</text></svg>`; };

  function viewWellness() {
    const t = today(), x = state.days[t] || {}, ins = E.insights(state, t), phase = E.phaseOf(state, t);
    const plan = Wellness.dailyPlan(state, t, phase, ins), wk = Wellness.weekStats(state, t), r = Wellness.rings(state, t), goal = state.settings.waterGoal || 8;
    const syms = Wellness.recentSymptoms(state, t);
    const maxMin = Math.max(30, ...wk.days.map((d) => d.min));
    const irregular = ['irregular', 'variable'].includes(ins.cls.level) || state.settings.mode === 'irregular';
    const bars = wk.days.map((d) => `<div class="wbar"><i style="height:${Math.max(3, (d.min / maxMin) * 70)}px" class="${d.min >= 22 ? 'hit' : ''}"></i><span>${fd(d.d, { weekday: 'narrow' })}</span></div>`).join('');
    const pct = (v, g) => Math.min(100, Math.round((v / g) * 100));
    const bp = Wellness.byPhase(state), bpRows = Object.keys(NAME).filter((k) => bp[k]).map((k) => `<tr><td><b>${NAME[k]}</b></td><td>${bp[k].energy ? bp[k].energy.toFixed(1) + ' / 5' : '—'}</td><td>${bp[k].sleep ? bp[k].sleep.toFixed(1) + ' h' : '—'}</td></tr>`).join('');
    return `<h1>Wellness</h1>
    <div class="card hero ph-${phase || 'none'} wide"><div class="eyebrow">${phase ? NAME[phase] : 'Today'}</div><div class="big">${esc(plan.title)}</div></div>
    <div class="card"><h2>Today's rings</h2>
      <div class="rings3">
        <div class="rc">${ringSvg(r.move.pct, 'var(--period)', '🏃🏾‍♀️')}<b>${r.move.v} min</b><span class="small mute">Move</span>
          <div class="row" style="justify-content:center;gap:6px"><button class="ghost sm" data-act="w-move" data-n="-10" aria-label="Less activity">−10</button><button class="sm" data-act="w-move" data-n="10" aria-label="More activity">+10</button></div></div>
        <div class="rc">${ringSvg(r.sleep.pct, 'var(--brand)', '🌙')}<b>${r.sleep.v ? r.sleep.v + ' h' : '— h'}</b><span class="small mute">Sleep</span>
          <input id="w-sleep" type="number" step="0.25" min="0" max="16" inputmode="decimal" placeholder="hours" value="${x.sleep || ''}" style="min-height:36px;padding:6px;text-align:center" aria-label="Hours slept last night"></div>
        <div class="rc">${ringSvg(r.water.pct, '#4a90d9', '💧')}<b>${r.water.v}/${goal}</b><span class="small mute">Water</span>
          <div class="row" style="justify-content:center;gap:6px"><button class="ghost sm" data-act="w-water" data-n="-1" aria-label="Less water">−</button><button class="sm" data-act="w-water" data-n="1" aria-label="More water">+1</button></div></div>
      </div>
      <h3>Energy</h3>
      <div class="chips">${[1, 2, 3, 4, 5].map((n) => `<button class="chip ${x.energy === n ? 'on' : ''}" data-act="w-energy" data-v="${n}">${['Drained', 'Low', 'Okay', 'Good', 'Great'][n - 1]}</button>`).join('')}</div>
      <p class="small gap"><a href="#" data-act="log" data-d="${t}" style="color:var(--brand)">More detail</a></p>
    </div>
    <div class="card"><h2>Today</h2>
      <h3>Eat</h3>${tipList(plan.eat, 2)}<h3>Move</h3>${tipList(plan.move, 2)}<h3>Care</h3>${tipList(plan.care, 1)}</div>
    ${syms.length ? `<div class="card"><h2>For what you logged</h2>${syms.slice(0, 3).map((k) => `<h3>${esc(k)}</h3>${tipList(Wellness.SYMPTOM_TIPS[k])}`).join('')}</div>` : ''}
    ${irregular ? `<div class="card"><h2>Steadier cycles</h2>${tipList(Wellness.FOUNDATIONS, 3)}</div>` : ''}
    <div class="card"><h2>This week</h2>
      <div class="wbars">${bars}</div>
      <div class="gap"><div class="row small"><span class="grow">Activity</span><b>${wk.total} / 150 min</b></div><div class="prog"><i style="width:${pct(wk.total, 150)}%"></i></div>
      <div class="row small" style="margin-top:10px"><span class="grow">Strength sessions</span><b>${wk.strength} / 2</b></div><div class="prog"><i style="width:${pct(wk.strength, 2)}%"></i></div></div>
      </div>
    ${bpRows ? `<div class="card"><h2>By phase</h2><table><tr><th></th><th>Energy</th><th>Sleep</th></tr>${bpRows}</table></div>` : ''}
    <p class="small mute center">Dots show evidence: <i class="evd ev-strong" style="display:inline-block"></i> strong <i class="evd ev-good" style="display:inline-block"></i> accepted <i class="evd ev-some" style="display:inline-block"></i> some <i class="evd ev-limited" style="display:inline-block"></i> limited. General info, not medical advice.</p>`;
  }

  /* insights */
  function viewInsights() {
    const t = today(), ins = E.insights(state, t), c = ins.cls;
    if (!state.periods.length) return `<h1>Insights</h1><div class="card"><p class="small mute">Log a period to begin.</p></div>`;
    const cyc = ins.cycles.filter((x) => x.valid).slice(-12);
    let chart = '<p class="mute small">Log at least two period start dates to see cycle lengths.</p>';
    if (cyc.length) {
      const max = Math.max(45, ...cyc.map((x) => x.len)) + 3, H = 130, W = 320, bw = Math.min(22, (W - 20) / cyc.length - 4), y = (v) => H - (v / max) * H + 8;
      chart = `<svg viewBox="0 0 ${W} ${H + 26}" width="100%" role="img" aria-label="Cycle lengths"><rect x="0" y="${y(35)}" width="${W}" height="${y(21) - y(35)}" fill="var(--fert-soft)" rx="6"/><text x="2" y="${y(35) - 4}" font-size="9" fill="var(--fert)">21–35</text>` +
        cyc.map((x, i) => { const cx = 10 + i * ((W - 20) / cyc.length) + 2; return `<rect x="${cx}" y="${y(x.len)}" width="${bw}" height="${H - y(x.len) + 8}" rx="5" fill="var(--brand-2)"/><text x="${cx + bw / 2}" y="${y(x.len) - 3}" font-size="9" text-anchor="middle" fill="var(--ink)">${x.len}</text><text x="${cx + bw / 2}" y="${H + 22}" font-size="8" text-anchor="middle" fill="var(--mute)">${fd(x.start, { month: 'short', day: 'numeric' })}</text>`; }).join('') + '</svg>';
    }
    const lvl = { learning: ['Learning', 'b-medium', 'Log 3+ cycles'], regular: ['Regular', 'b-high', `Varies ${c.range} days`], variable: ['Variable', 'b-medium', `Varies ${c.range} days`], irregular: ['Unpredictable', 'b-low', `Varies ${c.range} days`] }[c.level];
    const pl = ins.periodLen, L = ins.luteal;
    const phaseRows = Object.keys(NAME).map((k) => `<tr><td><b>${NAME[k]}</b></td><td>${ins.topSymptoms[k].length ? ins.topSymptoms[k].map((x) => `${esc(x.name)} (${x.n})`).join(', ') : '<span class="mute">—</span>'}</td></tr>`).join('');
    return `<h1>Insights</h1>
    <div class="card"><div class="row"><h2 class="grow">Cycle pattern</h2><span class="badge ${lvl[1]}">${lvl[0]}</span></div><p class="small mute">${lvl[2]}</p>${chart}
      <div class="stats gap"><div class="stat"><b>${c.median ? Math.round(c.median) : '—'}</b><span>median</span></div><div class="stat"><b>${c.min ? c.min + '–' + c.max : '—'}</b><span>range</span></div><div class="stat"><b>${pl ? Math.round(pl.median) : '—'}</b><span>period</span></div></div>
      <p class="small mute gap">Luteal phase ${L.median} days${L.learned ? '' : ' (assumed)'}</p></div>
    ${ins.alerts.length ? `<div class="card warn"><h2>Worth mentioning to a clinician</h2><ul>${ins.alerts.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2>Symptoms by phase</h2><table>${phaseRows}</table></div>
    <button class="ghost" style="width:100%" data-act="report">Doctor summary</button>`;
  }

  function reportText() {
    const t = today(), ins = E.insights(state, t), lines = [`Cycle summary — generated ${t}`, ''];
    lines.push('Period start dates and cycle lengths:');
    const ps = E.sortedPeriods(state.periods);
    ps.forEach((p, i) => { const len = i < ps.length - 1 ? E.diff(ps[i + 1].start, p.start) : null; lines.push(`• ${p.start}${p.end ? ' to ' + p.end + ' (' + (E.diff(p.end, p.start) + 1) + ' days)' : ''}${len ? ' — cycle ' + len + ' days' : ''}`); });
    if (ins.cls.n >= 3) lines.push('', `Last ${ins.cls.n} cycles: median ${Math.round(ins.cls.median)} d, range ${ins.cls.min}–${ins.cls.max} d (variation ${ins.cls.range} d).`);
    if (ins.alerts.length) lines.push('', 'Flags:', ...ins.alerts.map((a) => '• ' + a.text));
    const ph = Object.keys(NAME).filter((k) => ins.topSymptoms[k].length).map((k) => `• ${NAME[k]}: ${ins.topSymptoms[k].map((x) => x.name).join(', ')}`);
    if (ph.length) lines.push('', 'Most logged symptoms by phase:', ...ph);
    const bbt = Object.keys(state.days).filter((d) => state.days[d].bbt).length, lh = Object.keys(state.days).filter((d) => state.days[d].lh).length;
    if (bbt || lh) lines.push('', `Ovulation data logged: ${bbt} temperature readings, ${lh} LH tests.`);
    lines.push('', 'Self-reported data from Natalis; not a medical record.');
    return lines.join('\n');
  }

  /* settings */
  function viewSettings() {
    const s = state.settings, c = s.cal, origin = location.origin + location.pathname;
    const sw = (path, label, hint, val, rr) => `<label class="switch"><span>${label}</span><input type="checkbox" data-bind="${path}" ${rr ? 'data-rr="1"' : ''} ${val ? 'checked' : ''}></label>`;
    const connected = !!c.calendarId;
    return `<h1>Settings</h1>
    <div class="card"><h2>Cycle</h2>
      <label for="s-mode">Cycle type</label>
      <select id="s-mode" data-bind="mode" data-rr="1"><option value="auto" ${s.mode === 'auto' ? 'selected' : ''}>Auto</option><option value="regular" ${s.mode === 'regular' ? 'selected' : ''}>Regular</option><option value="irregular" ${s.mode === 'irregular' ? 'selected' : ''}>Unpredictable</option></select>
      ${sw('predictionsOn', 'Show predictions', 'Turn off to just log, with no estimates', s.predictionsOn !== false, true)}
      ${sw('showFertile', 'Fertile window', 'Estimate only; never rely on it for contraception', s.showFertile, true)}
      ${sw('hormonalContraception', 'Hormonal contraception', 'Hides ovulation estimates (cycles may not reflect ovulation)', s.hormonalContraception, true)}
      ${sw('paused', 'Pause tracking', 'Pregnancy, postpartum, menopause or a break', s.paused, true)}
      <label for="s-wg">Water goal (glasses)</label><input id="s-wg" type="number" min="1" max="20" value="${s.waterGoal || 8}" data-bind="waterGoal" data-type="number">
      <label for="s-pd">Period length (days)</label><input id="s-pd" type="number" min="1" max="12" value="${s.periodDefault}" data-bind="periodDefault" data-type="number" data-rr="1">
    </div>
    <div class="card"><h2>Google Calendar</h2>
      <label for="s-cid">Google OAuth Client ID</label>
      <input id="s-cid" inputmode="url" autocomplete="off" placeholder="1234567890-abc.apps.googleusercontent.com" value="${esc(c.clientId)}" data-bind="cal.clientId">
      <div class="row wrap gap"><button data-act="gc-sync" ${busy ? 'disabled' : ''}>${connected ? 'Sync now' : 'Connect & sync'}</button><button class="ghost" data-act="setup-toggle">${showSetup ? 'Hide' : 'Setup guide'}</button></div>
      ${connected ? `<p class="small mute gap">Connected${c.lastSync ? ' · last sync ' + new Date(c.lastSync).toLocaleString() : ''}${c.dirty ? ' · changes waiting' : ''}</p>` : ''}
      ${showSetup ? setupGuide(origin) : ''}
      ${sw('cal.discreet', 'Discreet titles', 'Use “○” and “●” instead of the word “Period” — calendars are often shared or visible on lock screens', c.discreet !== false)}
      ${sw('cal.pushLogged', 'Add logged periods', 'Also lets you restore your history on a new phone', c.pushLogged !== false)}
      ${sw('cal.pushFertile', 'Add fertile window', 'Needs “Show fertile window” above', c.pushFertile)}
      ${sw('cal.autoSync', 'Auto-sync', 'While Google access is active in this session', c.autoSync !== false)}
      <label for="s-rd">Reminder</label>
      <select id="s-rd" data-bind="cal.remindDays" data-type="number"><option value="0" ${c.remindDays === 0 ? 'selected' : ''}>None</option><option value="1" ${c.remindDays === 1 ? 'selected' : ''}>1 day before</option><option value="2" ${c.remindDays === 2 ? 'selected' : ''}>2 days before</option><option value="3" ${c.remindDays === 3 ? 'selected' : ''}>3 days before</option></select>
      <div class="row wrap gap"><button class="ghost sm" data-act="ics">Export .ics</button>${connected ? '<button class="ghost sm" data-act="gc-restore">Restore from calendar</button><button class="danger sm" data-act="gc-remove">Remove calendar</button>' : ''}</div>
    </div>
    <div class="card"><h2>Display</h2>
      <label for="s-unit">Temperature unit</label><select id="s-unit" data-bind="unit"><option value="C" ${s.unit === 'C' ? 'selected' : ''}>°C</option><option value="F" ${s.unit === 'F' ? 'selected' : ''}>°F</option></select>
      <label for="s-ws">Week starts on</label><select id="s-ws" data-bind="weekStart" data-type="number" data-rr="1"><option value="1" ${s.weekStart === 1 ? 'selected' : ''}>Monday</option><option value="0" ${s.weekStart === 0 ? 'selected' : ''}>Sunday</option></select>
    </div>
    <div class="card"><h2>Privacy & data</h2>
      <p class="small mute">Data stays on this device.</p>
      <div class="row wrap gap"><button class="ghost sm" data-act="${s.pinHash ? 'pin-off' : 'pin-set'}">${s.pinHash ? 'Remove app PIN' : 'Set app PIN'}</button><button class="ghost sm" data-act="export-json">Backup (JSON)</button><button class="ghost sm" data-act="export-csv">Export CSV</button><label class="btn ghost sm" style="margin:0;color:var(--brand);border:1.5px solid var(--line);background:transparent">Import backup<input type="file" accept="application/json" data-act="import" style="display:none"></label></div>
      <div class="row wrap gap"><button class="ghost sm" data-act="demo">Load sample data</button><button class="danger sm" data-act="erase">Erase everything</button></div>
      ${deferredInstall ? '<div class="gap"><button data-act="install">Install app</button></div>' : '<p class="small mute gap">Install: Share → Add to Home Screen.</p>'}
    </div>
    <p class="small mute center">Estimates only, not medical advice or contraception.</p>`;
  }

  function setupGuide(origin) {
    return `<div class="card" style="background:var(--bg)"><b>One-time Google setup (about 5 min)</b><ol class="small">
      <li>Open <code>console.cloud.google.com</code> → create a project.</li>
      <li><b>APIs & Services → Library</b> → enable <b>Google Calendar API</b>.</li>
      <li><b>OAuth consent screen</b> → External → add yourself under <b>Test users</b>. Add scope <code>.../auth/calendar.app.created</code>.</li>
      <li><b>Credentials → Create → OAuth client ID → Web application</b>. Under <b>Authorized JavaScript origins</b> add:<br><code>${esc(location.origin)}</code></li>
      <li>Paste the Client ID above, then tap <b>Connect & sync</b>.</li></ol>
      <p class="small mute">Must be served over HTTPS (e.g. GitHub Pages). Opening index.html from a file won't work for Google sign-in. “Testing” mode is fine for personal use.</p></div>`;
  }

  /* log sheet */
  function renderSheet() {
    const el = $('#sheet');
    if (!sheetDate) { el.hidden = true; el.innerHTML = ''; return; }
    const d = sheetDate, day = state.days[d] || {}, inP = !!periodAt(d), fut = d > today();
    const chips = (list, sel, key, cls = '') => `<div class="chips">${list.map((x) => `<button class="chip ${cls} ${sel.includes(x) ? 'on' : ''}" data-act="chip" data-key="${key}" data-v="${esc(x)}" ${fut ? 'disabled' : ''}>${x}</button>`).join('')}</div>`;
    el.hidden = false;
    el.innerHTML = `<div class="panel" role="dialog" aria-label="Log ${fd(d)}"><div class="grab"></div>
      <div class="row"><h2 class="grow" style="font-size:1.2rem">${fd(d, { weekday: 'long', day: 'numeric', month: 'long' })}</h2><button class="ghost sm" data-act="sheet-close">Done</button></div>
      ${fut ? '<p class="small mute">Future day</p>' : ''}
      <label class="switch"><span><b>Period day</b></span><input type="checkbox" data-act="period-toggle" ${inP ? 'checked' : ''} ${fut ? 'disabled' : ''}></label>
      ${inP ? `<h3>Flow</h3><div class="chips">${FLOW.map((x, i) => `<button class="chip flow ${day.flow === i + 1 ? 'on' : ''}" data-act="flow" data-v="${i + 1}">${x}</button>`).join('')}</div>` : ''}
      <h3>Symptoms</h3>${chips(SYMPTOMS, day.symptoms || [], 'symptoms')}
      <h3>Mood</h3>${chips(MOODS, day.mood || [], 'mood')}
      <h3>Ovulation</h3>
      <label for="l-bbt">Temperature (°${state.settings.unit})</label>
      <input id="l-bbt" type="number" step="0.01" inputmode="decimal" placeholder="${state.settings.unit === 'C' ? '36.45' : '97.7'}" value="${day.bbt ? toUnit(day.bbt) : ''}" ${fut ? 'disabled' : ''}>
      <label>LH test</label>
      <div class="chips">${[['neg', 'Negative'], ['pos', 'Positive']].map(([v, l]) => `<button class="chip ${day.lh === v ? 'on' : ''}" data-act="lh" data-v="${v}" ${fut ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      <label>Cervical mucus</label>${chips(MUCUS, day.mucus ? [day.mucus] : [], 'mucus')}
      <h3>Wellness</h3>
      <label>Energy</label><div class="chips">${[1, 2, 3, 4, 5].map((n) => `<button class="chip ${day.energy === n ? 'on' : ''}" data-act="w-energy" data-v="${n}" ${fut ? 'disabled' : ''}>${['Drained', 'Low', 'Okay', 'Good', 'Great'][n - 1]}</button>`).join('')}</div>
      <div class="row gap"><div class="grow"><label for="l-sleep">Sleep (h)</label><input id="l-sleep" type="number" step="0.25" min="0" max="16" inputmode="decimal" value="${day.sleep || ''}" ${fut ? 'disabled' : ''}></div>
      <div class="grow"><label for="l-move">Activity (min)</label><input id="l-move" type="number" step="5" min="0" max="600" inputmode="numeric" value="${day.moveMin || ''}" ${fut ? 'disabled' : ''}></div></div>
      <label>Activity</label><div class="chips">${Wellness.ACTIVITY.map((a) => `<button class="chip ${day.moveType === a ? 'on' : ''}" data-act="w-type" data-v="${a}" ${fut ? 'disabled' : ''}>${a}</button>`).join('')}</div>
      <label>Water</label><div class="row"><button class="ghost sm" data-act="w-water" data-n="-1" data-d="${d}">−</button><b style="min-width:3.5em;text-align:center">${day.water || 0} / ${state.settings.waterGoal || 8}</b><button class="sm" data-act="w-water" data-n="1" data-d="${d}">+1</button></div>
      <label for="l-note">Note</label><textarea id="l-note" rows="2" ${fut ? 'disabled' : ''}>${esc(day.note || '')}</textarea>
    </div>`;
  }

  function render() {
    const app = $('#app');
    app.className = animNext ? 'anim' : ''; animNext = false;
    app.innerHTML = { today: viewToday, calendar: viewCalendar, wellness: viewWellness, insights: viewInsights, settings: viewSettings }[view]();
    renderTabs(); renderSheet();
  }

  /* ---------- Google Calendar ---------- */
  async function doSync(quiet) {
    if (busy) return; busy = true; if (!quiet) render();
    try {
      const c = state.settings.cal;
      await Gcal.connect(c.clientId);
      const stats = await Gcal.sync(c, E.buildCalendarEvents(state, today()));
      c.lastSync = Date.now(); c.dirty = false; save({ noSync: true });
      toast(`Calendar synced (+${stats.added} · ~${stats.updated} · −${stats.removed})`);
    } catch (e) { toast(e.message || 'Sync failed'); state.settings.cal.dirty = !!state.settings.cal.calendarId; save({ noSync: true }); }
    busy = false; render();
  }

  /* ---------- PIN lock ---------- */
  const sha = async (t) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  function showLock() {
    const l = $('#lock'); if (!state.settings.pinHash) { l.hidden = true; return; }
    l.hidden = false; l.innerHTML = `<div class="box"><h1>Natalis</h1><p class="mute">Enter your PIN</p><input id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" aria-label="PIN"><p id="pin-err" class="small" style="color:#c0392b;min-height:1.2em"></p></div>`;
    $('#pin').focus();
    $('#pin').addEventListener('input', async (e) => {
      if (e.target.value.length >= 4 && (await sha(state.settings.pinSalt + e.target.value)) === state.settings.pinHash) { l.hidden = true; l.innerHTML = ''; lastActive = Date.now(); }
      else if (e.target.value.length >= 8) { $('#pin-err').textContent = 'Wrong PIN'; e.target.value = ''; }
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) lastActive = Date.now(); else if (state.settings.pinHash && Date.now() - lastActive > 60000) showLock(); });

  /* ---------- files ---------- */
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function demo() {
    const s = fresh(); s.settings.mode = 'auto'; s.settings.showFertile = true;
    const lens = [26, 31, 44, 29, 38, 27, 52, 33], first = E.add(today(), -(lens.reduce((a, b) => a + b, 0) + 10));
    let d = first; s.periods.push({ id: uid(), start: d, end: E.add(d, 4) });
    lens.forEach((l) => { d = E.add(d, l); s.periods.push({ id: uid(), start: d, end: E.add(d, 3 + (l % 3)) }); });
    for (let i = 0; i < 6; i++) s.days[E.add(d, i)] = { symptoms: i < 2 ? ['Cramps', 'Fatigue'] : ['Bloating'], mood: ['Low'], flow: 3 - (i % 3) };
    state = s; save({ noSync: true }); view = 'today'; render(); toast('Sample data loaded');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' && el.type === 'file') return;
    if (el.tagName === 'A') ev.preventDefault();
    const a = el.dataset.act, v = el.dataset.v;
    switch (a) {
      case 'tab': view = v; sheetDate = null; animNext = true; render(); window.scrollTo(0, 0); buzz(); break;
      case 'month': { const [y, m] = calMonth.split('-').map(Number), n = Number(el.dataset.n); calMonth = n === 0 ? today().slice(0, 7) : new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); render(); break; }
      case 'period-start': startPeriod(today()); render(); toast('Period start logged'); break;
      case 'period-end': endPeriod(today()); render(); toast('Period end logged'); break;
      case 'log': sheetDate = el.dataset.d; renderSheet(); break;
      case 'quick': sheetDate = today(); renderSheet(); setTimeout(() => (v === 'bbt' ? $('#l-bbt') : $('[data-act=lh]')).focus(), 50); break;
      case 'sheet-close': sheetDate = null; render(); break;
      case 'chip': { const k = el.dataset.key, day = state.days[sheetDate] || {}; if (k === 'mucus') setDay(sheetDate, { mucus: day.mucus === v ? '' : v }); else { const arr = new Set(day[k] || []); arr.has(v) ? arr.delete(v) : arr.add(v); setDay(sheetDate, { [k]: [...arr] }); } save(); renderSheet(); break; }
      case 'w-move': { const d0 = el.dataset.d || sheetDate || today(), cur = (state.days[d0] || {}).moveMin || 0; setDay(d0, { moveMin: Math.max(0, cur + Number(el.dataset.n)) }); save(); buzz(); render(); break; }
      case 'w-water': { const d0 = el.dataset.d || sheetDate || today(), cur = (state.days[d0] || {}).water || 0; setDay(d0, { water: Math.max(0, Math.min(30, cur + Number(el.dataset.n))) }); save(); buzz(); render(); break; }
      case 'w-energy': { const d0 = sheetDate || today(), cur = (state.days[d0] || {}).energy; setDay(d0, { energy: cur === Number(v) ? 0 : Number(v) }); save(); buzz(); render(); break; }
      case 'w-type': { const cur = (state.days[sheetDate] || {}).moveType; setDay(sheetDate, { moveType: cur === v ? '' : v }); save(); render(); break; }
      case 'flow': setDay(sheetDate, { flow: (state.days[sheetDate] || {}).flow === Number(v) ? 0 : Number(v) }); save(); renderSheet(); break;
      case 'lh': setDay(sheetDate, { lh: (state.days[sheetDate] || {}).lh === v ? '' : v }); save(); renderSheet(); break;
      case 'ob-mode': document.querySelectorAll('#ob-mode .chip').forEach((c) => c.classList.toggle('on', c === el)); break;
      case 'ob-save': {
        const d = $('#ob-date').value; if (!d) return toast('Pick the first day of your last period.');
        const mode = ($('#ob-mode .chip.on') || {}).dataset.v || 'auto';
        state.settings.mode = mode; state.periods.push({ id: uid(), start: d, end: null });
        document.querySelectorAll('.ob-past').forEach((i) => { if (i.value && i.value !== d) state.periods.push({ id: uid(), start: i.value, end: E.add(i.value, state.settings.periodDefault - 1) }); });
        save(); render(); break;
      }
      case 'add-past': { const d = prompt('First day of the earlier period (YYYY-MM-DD):', E.add(today(), -30)); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today()) { state.periods.push({ id: uid(), start: d, end: E.add(d, state.settings.periodDefault - 1) }); save(); render(); toast('Period added'); } else if (d) toast('Use the format YYYY-MM-DD, not in the future.'); break; }
      case 'report': { const txt = reportText(), s = $('#sheet'); s.hidden = false; s.innerHTML = `<div class="panel"><div class="grab"></div><div class="row"><h2 class="grow">Doctor summary</h2><button class="ghost sm" data-act="sheet-close-report">Close</button></div><pre style="white-space:pre-wrap;font:inherit;font-size:.9rem" id="rep">${esc(txt)}</pre><div class="row wrap gap noprint"><button class="sm" data-act="copy-report">Copy</button>${navigator.share ? '<button class="ghost sm" data-act="share-report">Share</button>' : ''}<button class="ghost sm" onclick="window.print()">Print</button></div></div>`; break; }
      case 'sheet-close-report': $('#sheet').hidden = true; $('#sheet').innerHTML = ''; break;
      case 'copy-report': try { await navigator.clipboard.writeText(reportText()); toast('Copied'); } catch (e) { toast('Copy failed'); } break;
      case 'share-report': try { await navigator.share({ title: 'Cycle summary', text: reportText() }); } catch (e) { /* cancelled */ } break;
      case 'setup-toggle': showSetup = !showSetup; render(); break;
      case 'gc-sync': { const i = $('#s-cid'); if (i) state.settings.cal.clientId = i.value.trim(); save({ noSync: true }); doSync(false); break; }
      case 'gc-restore': try { await Gcal.connect(state.settings.cal.clientId); const got = await Gcal.restore(state.settings.cal); let n = 0; got.forEach((p) => { if (!state.periods.some((x) => x.start === p.start)) { state.periods.push({ id: uid(), ...p }); n++; } }); save({ noSync: true }); render(); toast(n ? `Restored ${n} period${n > 1 ? 's' : ''}` : 'Nothing new to restore'); } catch (e) { toast(e.message); } break;
      case 'gc-remove': if (confirm('Delete the “Natalis” calendar from Google Calendar? Your data in this app stays.')) { try { await Gcal.connect(state.settings.cal.clientId); await Gcal.removeCalendar(state.settings.cal); Gcal.disconnect(); save({ noSync: true }); render(); toast('Calendar removed'); } catch (e) { toast(e.message); } } break;
      case 'ics': { const ev2 = E.buildCalendarEvents(state, today()); if (!ev2.length) return toast('Nothing to export yet.'); download('natalis.ics', E.toICS(ev2, 'Natalis'), 'text/calendar'); break; }
      case 'export-json': download(`natalis-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'); break;
      case 'export-csv': { const rows = [['date', 'period', 'flow', 'symptoms', 'mood', 'temp_c', 'lh', 'mucus', 'note']]; const dates = new Set([...Object.keys(state.days), ...state.periods.map((p) => p.start)]); [...dates].sort().forEach((d) => { const x = state.days[d] || {}; rows.push([d, periodAt(d) ? 1 : 0, x.flow || '', (x.symptoms || []).join('|'), (x.mood || []).join('|'), x.bbt || '', x.lh || '', x.mucus || '', x.note || '']); }); download('natalis.csv', rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv'); break; }
      case 'erase': if (confirm('Erase ALL data on this device? This cannot be undone.')) { localStorage.removeItem(KEY); state = fresh(); render(); toast('All data erased'); } break;
      case 'demo': if (!state.periods.length || confirm('Replace your current data with sample data?')) demo(); break;
      case 'pin-set': { const p = prompt('Choose a 4–8 digit PIN. It locks the app screen on this device (it is not encryption).'); if (p && /^\d{4,8}$/.test(p)) { state.settings.pinSalt = uid(); state.settings.pinHash = await sha(state.settings.pinSalt + p); save({ noSync: true }); render(); toast('PIN set'); } else if (p) toast('PIN must be 4–8 digits.'); break; }
      case 'pin-off': { const p = prompt('Enter your PIN to remove it:'); if (p && (await sha(state.settings.pinSalt + p)) === state.settings.pinHash) { state.settings.pinHash = null; save({ noSync: true }); render(); toast('PIN removed'); } else if (p) toast('Wrong PIN'); break; }
      case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); } break;
    }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.dataset.act === 'period-toggle') { togglePeriodDay(sheetDate, el.checked); renderSheet(); return; }
    if (el.dataset.act === 'import') {
      const f = el.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (!Array.isArray(j.periods)) throw new Error('bad'); if (!confirm('Replace current data with this backup?')) return; localStorage.setItem(KEY, JSON.stringify(j)); state = load(); save({ noSync: true }); render(); toast('Backup restored'); } catch (e) { toast('That file is not a valid Natalis backup.'); }
      return;
    }
    if (el.id === 'l-bbt') { const n = parseFloat(el.value); setDay(sheetDate, { bbt: isFinite(n) && n > 0 ? Math.round(fromUnit(n) * 100) / 100 : '' }); save(); return; }
    if (el.id === 'w-sleep') { const n = parseFloat(el.value); setDay(today(), { sleep: isFinite(n) && n > 0 && n <= 16 ? n : '' }); save(); render(); return; }
    if (el.id === 'l-sleep') { const n = parseFloat(el.value); setDay(sheetDate, { sleep: isFinite(n) && n > 0 && n <= 16 ? n : '' }); save(); return; }
    if (el.id === 'l-move') { const n = parseInt(el.value, 10); setDay(sheetDate, { moveMin: isFinite(n) && n > 0 ? Math.min(600, n) : '' }); save(); return; }
    if (el.id === 'l-note') { setDay(sheetDate, { note: el.value.trim() }); save(); return; }
    const b = el.dataset.bind; if (!b) return;
    const path = b.split('.'), key = path.pop(); let o = state.settings; path.forEach((p) => (o = o[p]));
    o[key] = el.type === 'checkbox' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value.trim();
    save(); if (el.dataset.rr) render();
  });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (view === 'settings') render(); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  normalize(); render(); showLock();
  window.__cw = { get state() { return state; }, render, demo };
})();
