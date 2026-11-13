const assert = require('assert');
const E = require('../engine.js');

const mk = (first, lens, extra = {}) => {
  const periods = []; let d = first;
  periods.push({ start: d, end: E.add(d, 4) });
  for (const l of lens) { d = E.add(d, l); periods.push({ start: d, end: E.add(d, 4) }); }
  return { periods, days: {}, settings: { mode: 'auto', predictionsOn: true, periodDefault: 5, showFertile: true, cal: {}, ...extra } };
};
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };

t('regular cycles → narrow window, high confidence', () => {
  const s = mk('2026-01-01', [28, 28, 29, 28, 27, 28]);
  const last = s.periods[s.periods.length - 1].start;
  const p = E.predictNext(s, E.add(last, 5));
  assert.strictEqual(p.level, 'regular');
  assert(p.windowDays <= 5, 'window ' + p.windowDays);
  assert.strictEqual(p.confidence, 'high');
  assert.strictEqual(E.diff(p.nextStart.likely, last), 28);
});

t('irregular cycles → wide window, low confidence, median midpoint', () => {
  const s = mk('2026-01-01', [24, 45, 31, 58, 27, 40]);
  const p = E.predictNext(s, E.add(s.periods.at(-1).start, 5));
  assert.strictEqual(p.level, 'irregular');
  assert(p.windowDays >= 20, 'window ' + p.windowDays);
  assert.strictEqual(p.confidence, 'low');
});

t('late period conditions on history and never predicts the past', () => {
  const s = mk('2026-01-01', [28, 28, 28, 28]);
  const last = s.periods.at(-1).start, today = E.add(last, 40);
  const p = E.predictNext(s, today);
  assert.strictEqual(p.status, 'late');
  assert(p.nextStart.earliest >= E.add(today, -1));
});

t('irregular + long gap uses only longer historical cycles', () => {
  const s = mk('2026-01-01', [24, 45, 31, 58, 27, 40, 52]);
  const last = s.periods.at(-1).start, p = E.predictNext(s, E.add(last, 44)); // day 45
  assert.strictEqual(p.basis, 'conditional');
  assert(E.diff(p.nextStart.likely, last) >= 44);
});

t('BBT 3-over-6 detects ovulation (day before first high)', () => {
  const days = {}, start = '2026-03-01';
  for (let i = 0; i < 20; i++) days[E.add(start, i)] = { bbt: i < 14 ? 36.3 + (i % 2) * 0.05 : 36.7 };
  const ov = E.detectOvulation(days, start, null);
  assert.strictEqual(ov.method, 'bbt'); assert.strictEqual(ov.date, E.add(start, 13));
});

t('confirmed ovulation overrides wide window (irregular → predictable)', () => {
  const s = mk('2026-01-01', [24, 45, 31, 58, 27, 40]);
  const last = s.periods.at(-1).start;
  for (let i = 0; i < 24; i++) s.days[E.add(last, i)] = { bbt: i < 19 ? 36.3 + (i % 2) * 0.05 : 36.75 };
  const p = E.predictNext(s, E.add(last, 23));
  assert.strictEqual(p.basis, 'ovulation-confirmed');
  assert(p.windowDays <= 5);
  assert.strictEqual(p.ovulation.confirmed, true);
});

t('LH positive → ovulation next day', () => {
  const ov = E.detectOvulation({ '2026-03-12': { lh: 'pos' } }, '2026-03-01', null);
  assert.deepStrictEqual(ov, { date: '2026-03-13', method: 'lh' });
});

t('luteal length is learned from confirmed cycles', () => {
  const s = mk('2026-01-01', [30, 30, 30, 30]);
  for (const c of E.cycles(s.periods)) {
    const ov = E.add(c.next, -12);
    for (let i = 0; i < c.len; i++) s.days[E.add(c.start, i)] = { bbt: E.diff(E.add(c.start, i), ov) > 0 ? 36.8 : 36.3 + (i % 2) * 0.05 };
  }
  assert.strictEqual(E.lutealStats(s).median, 12);
});

t('few cycles → learning mode with starter window', () => {
  const p = E.predictNext(mk('2026-01-01', [30]), '2026-02-05');
  assert.strictEqual(p.level, 'learning'); assert(p.windowDays >= 7);
});

t('no data', () => assert.strictEqual(E.predictNext({ periods: [], days: {}, settings: {} }, '2026-01-01').status, 'no-data'));

t('forecast windows widen with k', () => {
  const s = mk('2026-01-01', [27, 31, 26, 33, 29, 35]);
  const f = E.forecast(s, E.add(s.periods.at(-1).start, 3), 3);
  const w = (x) => E.diff(x.latest, x.earliest);
  assert(w(f[2]) > w(f[0]));
});

t('alerts: variation, short cycles, long period', () => {
  const a = E.insights(mk('2026-01-01', [18, 19, 17]), '2026-04-01').alerts.map((x) => x.id);
  assert(a.includes('short'));
  const b = E.insights(mk('2026-01-01', [20, 50, 30, 60]), '2026-12-01').alerts.map((x) => x.id);
  assert(b.includes('variation') && b.includes('amenorrhea'));
});

t('calendar events + ICS are valid and discreet by default', () => {
  const s = mk('2026-01-01', [28, 28, 28, 28]);
  const ev = E.buildCalendarEvents(s, E.add(s.periods.at(-1).start, 3));
  assert(ev.some((e) => e.kind === 'p') && ev.some((e) => e.kind === 'l'));
  assert(ev.every((e) => !/period/i.test(e.summary)), 'discreet titles');
  const ics = E.toICS(ev, 'Cycle');
  assert(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('VALARM') && ics.trim().endsWith('END:VCALENDAR'));
  s.settings.cal.discreet = false;
  assert(E.buildCalendarEvents(s, '2026-06-01').some((e) => /Period/.test(e.summary)));
});

t('hormonal contraception hides ovulation/fertile', () => {
  const s = mk('2026-01-01', [28, 28, 28, 28], { hormonalContraception: true });
  const p = E.predictNext(s, E.add(s.periods.at(-1).start, 3));
  assert(!p.ovulation && !p.fertile);
});

t('phaseOf classifies days', () => {
  const s = mk('2026-01-01', [28, 28, 28]);
  assert.strictEqual(E.phaseOf(s, '2026-01-02'), 'menstrual');
  assert.strictEqual(E.phaseOf(s, '2026-01-10'), 'follicular');
  assert.strictEqual(E.phaseOf(s, '2026-01-26'), 'luteal');
});

console.log(`\n${pass} tests passed`);

const W = require('../wellness.js');
t('wellness: plan per phase, no calorie/weight targets, week stats', () => {
  const s = mk('2026-01-01', [28, 28, 28]);
  for (const ph of ['menstrual', 'follicular', 'ovulatory', 'luteal']) { const p = W.dailyPlan(s, '2026-03-01', ph, E.insights(s, '2026-03-01')); assert(p.eat.length && p.move.length && p.care.length); }
  const all = JSON.stringify([W.PHASES, W.SYMPTOM_TIPS, W.FOUNDATIONS]).toLowerCase();
  assert(!/\bkcal\b|calorie target|lose weight|weight loss/.test(all.replace(/no need to restrict/g, '')));
  s.days['2026-03-01'] = { moveMin: 40, moveType: 'Strength', sleep: 7.5, water: 6 };
  const wk = W.weekStats(s, '2026-03-01'); assert.strictEqual(wk.total, 40); assert.strictEqual(wk.strength, 1);
  assert.strictEqual(W.rings(s, '2026-03-01').move.pct, 1);
  assert(W.recentSymptoms({ days: { '2026-03-01': { symptoms: ['Cramps'] } } }, '2026-03-01').includes('Cramps'));
});
console.log('wellness ok');
