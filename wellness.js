/* Cyclewise wellness module: phase-aware food, movement and self-care ideas + daily tracking helpers.
   Design rules: no weight or calorie targets, evidence level shown on every tip, phase guidance framed as
   optional ("many people find...") because evidence for strict cycle-syncing is limited. */
const Wellness = (() => {
  const E = typeof Engine !== 'undefined' ? Engine : require('./engine.js');
  const t = (text, ev) => ({ t: text, e: ev || 'good' });

  const PHASES = {
    menstrual: {
      title: 'Rest & restore', blurb: 'Energy can dip. Be kind to yourself — normal activity is fine if you feel up to it.',
      eat: [
        t('Iron-rich foods: beans, ndengu, dark greens (sukuma wiki, managu, terere), eggs, omena, or small portions of red meat or liver.', 'good'),
        t('Pair iron with vitamin C (orange, guava, tomato, lemon). Keep tea and coffee between meals — they reduce iron absorption.', 'good'),
        t('Warm, easy-to-digest meals: soups, stews, uji. Drink fluids through the day.', 'limited'),
        t('Ginger tea (tangawizi) from the first days may ease cramps.', 'some'),
      ],
      move: [
        t('Gentle movement if it feels good: walking, stretching, easy yoga. Light activity can ease cramps.', 'some'),
        t('A heat pack on the lower belly helps many people with cramps.', 'good'),
        t('Feeling fine? Train as usual — there is no need to stop.', 'good'),
      ],
      care: [
        t('Sleep is the best recovery tool: aim for an earlier night if you are tired.', 'good'),
        t('Heavy bleeding (soaking a pad or tampon hourly for several hours, large clots, or more than 7 days) deserves a clinician visit — it can cause iron deficiency.', 'strong'),
      ],
    },
    follicular: {
      title: 'Building energy', blurb: 'Many people feel energy and focus rise through this phase.',
      eat: [
        t('Balanced plates: half vegetables and fruit, a quarter protein (fish, eggs, beans), a quarter whole grains or starch (millet, sweet potato, brown ugali).', 'good'),
        t('Include yoghurt or maziwa lala and plenty of fibre to support digestion.', 'limited'),
        t('Keep meals regular — steady fuel matters more than any special "phase food".', 'good'),
      ],
      move: [
        t('A good window to try something new or push a little harder if you feel strong.', 'limited'),
        t('Aim for strength work on 2 days a week and brisk aerobic activity most days.', 'strong'),
      ],
      care: [t('If you feel sharp, use this time for demanding tasks and planning.', 'limited')],
    },
    ovulatory: {
      title: 'Peak for many', blurb: 'Energy and mood are often at their best around ovulation.',
      eat: [
        t('Stay well hydrated and add colourful vegetables and fruit.', 'good'),
        t('Include protein at each meal (fish, eggs, beans, groundnuts).', 'good'),
      ],
      move: [
        t('Strong sessions, dance or group sport often feel great now.', 'limited'),
        t('Warm up thoroughly: some research links ovulation with changes in joint stability, so cutting, jumping and heavy lifting deserve a good warm-up.', 'some'),
      ],
      care: [t('Social energy is often higher — a good time for connection.', 'limited')],
    },
    luteal: {
      title: 'Slow down gently', blurb: 'Appetite, sleep and mood can shift before a period. This is normal.',
      eat: [
        t('Eat regularly (every 3–4 hours) and combine protein with fibre to steady cravings: beans with greens, eggs with sweet potato, groundnuts with fruit.', 'good'),
        t('Complex carbohydrates (millet, sorghum, oats, sweet potato, arrowroot) and magnesium-rich foods (groundnuts, pumpkin seeds, leafy greens).', 'limited'),
        t('Feeling hungrier before a period is normal. There is no need to restrict.', 'good'),
      ],
      move: [
        t('Steady, moderate movement works well: walking, cycling, swimming, or strength with a little more rest.', 'good'),
        t('Peak strength can feel lower in this phase for some people. Lowering the load without guilt is fine.', 'some'),
      ],
      care: [
        t('Wind-down routine: screens off an hour before bed, a regular bedtime, less caffeine late in the day.', 'good'),
        t('If mood changes before your period are severe or disrupt your life, mention them to a clinician.', 'strong'),
      ],
    },
  };

  const SYMPTOM_TIPS = {
    Cramps: [t('Heat on the lower belly, a short walk, and ginger tea are the gentlest first steps.', 'some')],
    Headache: [t('Drink water, eat regular meals and keep a steady sleep schedule — all common headache triggers.', 'good')],
    Bloating: [t('Smaller, slower meals, less salty food, and a gentle walk after eating can help.', 'limited')],
    Fatigue: [t('Check sleep first. If your periods are heavy, iron-rich foods with vitamin C help — and persistent tiredness is worth a blood test.', 'good')],
    'Breast tenderness': [t('A well-fitting supportive bra and less caffeine around your period help some people.', 'limited')],
    Acne: [t('Wash gently, avoid picking, and keep a regular sleep and meal pattern. Persistent acne with irregular periods is worth mentioning to a clinician.', 'limited')],
    'Back pain': [t('Heat, gentle stretches (child\'s pose, cat-cow) and a short walk usually ease it.', 'some')],
    Nausea: [t('Small, bland meals, sipping fluids and ginger tea can settle the stomach.', 'some')],
    Cravings: [t('Cravings settle with regular meals that include protein and fibre. Allow yourself the food you crave in a normal portion.', 'good')],
    Insomnia: [t('Keep a fixed wake time, dim lights and screens in the evening, and cut caffeine after midday.', 'good')],
    Spotting: [t('Spotting between periods that keeps happening is worth mentioning to a clinician.', 'strong')],
    Anxious: [t('Slow breathing (4 seconds in, 6 out) for a few minutes and a short walk in daylight can calm things.', 'good')],
    Low: [t('Daylight, movement and contact with a friend are the most reliable mood lifts. If low mood lasts, talk to someone.', 'good')],
    Irritable: [t('Regular meals and enough sleep reduce irritability. A short walk before reacting helps too.', 'good')],
  };

  const FOUNDATIONS = [
    t('Eat enough, regularly. Under-eating and very strict dieting can stop ovulation and periods.', 'strong'),
    t('Move most days and include strength training twice a week. This supports insulin sensitivity, which matters for PCOS-type irregularity.', 'good'),
    t('Favour whole-food, slower carbohydrates (millet, beans, sweet potato) to keep blood sugar steady.', 'good'),
    t('Protect sleep (7–9 hours for most adults) and build a stress outlet you enjoy.', 'good'),
    t('Very intense training combined with low energy intake can switch periods off. If your periods stop for 3 months, see a clinician.', 'strong'),
  ];

  const ACTIVITY = ['Walk', 'Run', 'Strength', 'Yoga', 'Cycling', 'Dance', 'Swim', 'Sport', 'Other'];

  function dailyPlan(state, date, phase, ins) {
    const base = PHASES[phase] || { title: 'Daily wellness', blurb: 'Simple habits that support your cycle.', eat: PHASES.follicular.eat, move: PHASES.follicular.move, care: PHASES.follicular.care };
    const flows = Object.keys(state.days).filter((d) => state.days[d].flow === 4 && E.diff(date, d) >= 0 && E.diff(date, d) < 120);
    const heavy = flows.length >= 2 || (ins && ins.alerts.some((a) => a.id === 'long-period'));
    const eat = [...base.eat];
    if (heavy && phase !== 'menstrual') eat.unshift(t('You have logged heavy flow: keep iron-rich foods in your week (beans, greens, eggs, fish, liver) with a vitamin C food, and ask a clinician about checking iron.', 'good'));
    return { phase, title: base.title, blurb: base.blurb, eat, move: base.move, care: base.care };
  }

  function recentSymptoms(state, date) {
    const set = new Set();
    for (let i = 0; i < 3; i++) { const d = state.days[E.add(date, -i)]; if (d) [...(d.symptoms || []), ...(d.mood || [])].forEach((x) => set.add(x)); }
    return [...set].filter((x) => SYMPTOM_TIPS[x]);
  }

  function weekStats(state, date) {
    const days = []; let total = 0, strength = 0, sleepSum = 0, sleepN = 0, waterSum = 0, waterN = 0;
    for (let i = 6; i >= 0; i--) {
      const d = E.add(date, -i), x = state.days[d] || {}, m = x.moveMin || 0;
      days.push({ d, min: m }); total += m;
      if (x.moveType === 'Strength' && m > 0) strength++;
      if (x.sleep) { sleepSum += x.sleep; sleepN++; }
      if (x.water) { waterSum += x.water; waterN++; }
    }
    return { days, total, strength, sleepAvg: sleepN ? sleepSum / sleepN : null, waterAvg: waterN ? waterSum / waterN : null };
  }

  function rings(state, date) {
    const x = state.days[date] || {}, goal = state.settings.waterGoal || 8;
    return {
      move: { v: x.moveMin || 0, pct: Math.min(1, (x.moveMin || 0) / 22) },
      sleep: { v: x.sleep || 0, pct: Math.min(1, (x.sleep || 0) / 7) },
      water: { v: x.water || 0, goal, pct: Math.min(1, (x.water || 0) / goal) },
    };
  }

  /** Average energy / sleep by cycle phase from logs. */
  function byPhase(state) {
    const acc = {};
    for (const [d, v] of Object.entries(state.days)) {
      if (!v.energy && !v.sleep) continue;
      const ph = E.phaseOf(state, d); if (!ph) continue;
      const a = (acc[ph] = acc[ph] || { en: [], sl: [] });
      if (v.energy) a.en.push(v.energy); if (v.sleep) a.sl.push(v.sleep);
    }
    const avg = (a) => (a.length >= 2 ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const out = {}; for (const k of Object.keys(acc)) out[k] = { energy: avg(acc[k].en), sleep: avg(acc[k].sl), n: Math.max(acc[k].en.length, acc[k].sl.length) };
    return out;
  }

  const EVIDENCE = { strong: 'Strong evidence', good: 'Well accepted', some: 'Some evidence', limited: 'Limited evidence' };
  return { PHASES, SYMPTOM_TIPS, FOUNDATIONS, ACTIVITY, EVIDENCE, dailyPlan, recentSymptoms, weekStats, rings, byPhase };
})();
if (typeof module === 'object' && module.exports) module.exports = Wellness;
