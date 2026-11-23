/* Generazione, simulazione e valutazione di un piano di 4 settimane (fase Z2).
 * Logica pura: nessun accesso al DOM. */
(function () {
  'use strict';

  const WEEKS = 4;
  // Fattore di volume per settimana: 3 di carico crescente + 1 di scarico.
  const WEEK_FACTORS = [0.85, 0.93, 1.0, 0.6];
  const WEEK_NAMES = ['Carico 1', 'Carico 2', 'Carico 3', 'Scarico'];
  // Ripetute tempo (Z3) per settimana, se richieste: [serie, minuti].
  const TEMPO_SETS = [[2, 10], [3, 10], [3, 12], null];

  // Soglie di valutazione per una fase di base (Z2).
  const LIMITS = {
    rampGood: [2, 5],   // aumento CTL settimanale ideale
    rampHigh: 8,        // oltre: troppo rapido
    tsbWarn: -25,
    tsbBad: -30,
    autoRampTarget: 5,  // l'adattamento automatico non supera questo aumento
    autoTsbMin: -25,
  };

  const round5 = (m) => Math.round(m / 5) * 5;

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function durLabel(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return `${m}′`;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }

  /* ---------- costruzione delle sedute ---------- */

  function S(min, target, extra = {}) {
    return { type: 'step', label: extra.label || '', secs: Math.round(min * 60), target, p1: extra.p1 ?? null, p2: extra.p2 ?? null };
  }

  function z2Session(min, pct, kind) {
    const wu = min >= 90 ? 15 : 10;
    const cd = min >= 60 ? 10 : 5;
    const main = Math.max(5, min - wu - cd);
    const p = kind === 'easy' ? pct - 4 : pct;
    const blocks = [
      S(wu, 'ramp', { label: 'Riscaldamento', p1: 50, p2: p - 5 }),
      S(main, 'pct', { label: 'Z2', p1: p - 3, p2: p + 2 }),
      S(cd, 'Z1', { label: 'Defaticamento' }),
    ];
    const name = kind === 'long' ? `Z2 lungo ${durLabel(min)}`
      : kind === 'easy' ? `Z2 facile ${durLabel(min)}`
      : kind === 'deload' ? `Z2 scarico ${durLabel(min)}`
      : `Z2 ${durLabel(min)}`;
    const notes = [
      'Fase Z2: ritmo costante, respirazione tranquilla, devi riuscire a parlare.',
      'Se il battito sale molto a parità di watt, rallenta.',
    ];
    if (min >= 120) notes.push('Mangia ogni 30–40′ e bevi regolarmente.');
    return { name, kind, blocks, notes: notes.join('\n') };
  }

  function tempoSession(min, pct, sets) {
    let [reps, len] = sets;
    const wu = 15;
    const cd = 10;
    const rec = 5;
    // riduci le ripetute finché non entrano nel tempo disponibile
    while (reps > 1 && wu + cd + reps * len + (reps - 1) * rec > min) reps--;
    const work = reps * len + (reps - 1) * rec;
    const fill = Math.max(0, min - wu - cd - work);
    const blocks = [S(wu, 'ramp', { label: 'Riscaldamento', p1: 50, p2: pct - 5 })];
    if (fill >= 5) blocks.push(S(round5(fill / 2), 'pct', { label: 'Z2', p1: pct - 3, p2: pct + 2 }));
    const steps = [S(len, 'Z3', { label: 'Tempo' })];
    if (reps > 1) steps.push(S(rec, 'pct', { p1: pct - 10, p2: pct - 5 }));
    blocks.push({ type: 'repeat', label: 'Tempo', count: reps, steps });
    const rest = fill - (fill >= 5 ? round5(fill / 2) : 0);
    if (rest >= 5) blocks.push(S(rest, 'pct', { label: 'Z2', p1: pct - 3, p2: pct + 2 }));
    blocks.push(S(cd, 'Z1', { label: 'Defaticamento' }));
    return {
      name: `Z2 + tempo ${reps}×${len}′`,
      kind: 'tempo',
      blocks,
      notes: 'Tempo (Z3) controllato: impegnativo ma sostenibile, mai a fondo.',
    };
  }

  /**
   * Genera il piano.
   * opts: { start: Date (lunedì), avail: {0..6: minuti} (0 = domenica), pct, sport, tempo: bool, scale }
   */
  function generate(opts) {
    const pct = Math.min(80, Math.max(55, Number(opts.pct) || 68));
    const days = [];
    const availDays = Object.entries(opts.avail).filter(([, m]) => m > 0).map(([d]) => Number(d));
    // giorno della seduta lunga: quello con più tempo disponibile (a parità, il più tardi nella settimana)
    const order = (d) => (d + 6) % 7; // lunedì = 0
    let longDay = null;
    availDays.forEach((d) => {
      if (longDay === null || opts.avail[d] > opts.avail[longDay] || (opts.avail[d] === opts.avail[longDay] && order(d) > order(longDay))) longDay = d;
    });
    // giorno della seduta tempo: il primo giorno infrasettimanale con almeno 60′, diverso dal lungo e non il giorno dopo
    const dayAfterLong = longDay === null ? null : (longDay + 1) % 7;
    let tempoDay = null;
    if (opts.tempo) {
      const cands = availDays
        .filter((d) => d !== longDay && d !== dayAfterLong && opts.avail[d] >= 60)
        .sort((a, b) => order(a) - order(b));
      tempoDay = cands.length ? cands[Math.floor((cands.length - 1) / 2)] : null;
    }

    for (let i = 0; i < WEEKS * 7; i++) {
      const date = addDays(opts.start, i);
      const week = Math.floor(i / 7);
      const dow = date.getDay();
      const avail = opts.avail[dow] || 0;
      let session = null;
      if (avail > 0) {
        const factor = WEEK_FACTORS[week] * (opts.scale || 1);
        const min = Math.min(avail, Math.max(30, round5(avail * factor)));
        if (week === WEEKS - 1) session = z2Session(min, pct, 'deload');
        else if (dow === tempoDay && TEMPO_SETS[week]) session = tempoSession(Math.max(60, min), pct, TEMPO_SETS[week]);
        else if (dow === longDay) session = z2Session(min, pct, 'long');
        else if (dow === dayAfterLong) session = z2Session(min, pct, 'easy');
        else session = z2Session(min, pct, 'normal');
        const st = Workout.stats(session.blocks);
        session.secs = st.secs;
        session.load = st.load;
        session.sport = opts.sport || 'Ride';
      }
      days.push({ date, week, session });
    }
    return { days, pct, scale: opts.scale || 1 };
  }

  /* ---------- simulazione CTL / ATL / TSB ---------- */

  function simulate(plan, ctl0, atl0) {
    let ctl = Number(ctl0) || 0;
    let atl = Number(atl0) || 0;
    const series = [];
    plan.days.forEach((d) => {
      const load = d.session ? d.session.load : 0;
      const tsb = ctl - atl; // la forma del giorno dipende dai valori del giorno prima
      ctl += (load - ctl) / 42;
      atl += (load - atl) / 7;
      series.push({ date: d.date, load, ctl, atl, tsb });
    });
    const weeks = [];
    for (let w = 0; w < WEEKS; w++) {
      const slice = series.slice(w * 7, w * 7 + 7);
      const startCtl = w === 0 ? Number(ctl0) || 0 : series[w * 7 - 1].ctl;
      const sessions = plan.days.slice(w * 7, w * 7 + 7).filter((d) => d.session);
      weeks.push({
        index: w,
        name: WEEK_NAMES[w],
        load: slice.reduce((a, s) => a + s.load, 0),
        secs: sessions.reduce((a, d) => a + d.session.secs, 0),
        ramp: slice[slice.length - 1].ctl - startCtl,
        minTsb: Math.min(...slice.map((s) => s.tsb)),
        sessions: sessions.length,
      });
    }
    return { series, weeks };
  }

  /* ---------- valutazione ---------- */

  function zoneSplit(plan) {
    let easy = 0, total = 0;
    plan.days.forEach((d) => {
      if (!d.session) return;
      Workout.segments(d.session.blocks).forEach((s) => {
        total += s.secs;
        if ((s.from + s.to) / 2 <= 75) easy += s.secs;
      });
    });
    return total ? easy / total : 1;
  }

  function maxConsecutive(plan) {
    let best = 0, cur = 0;
    plan.days.forEach((d) => { cur = d.session ? cur + 1 : 0; best = Math.max(best, cur); });
    return best;
  }

  function evaluate(plan, sim, ctl0) {
    const items = [];
    const build = sim.weeks.slice(0, WEEKS - 1);
    const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(1);

    if (!plan.days.some((d) => d.session)) {
      return { level: 'bad', items: [{ level: 'bad', text: 'Nessun giorno disponibile: indica almeno un giorno di allenamento.' }] };
    }

    // Aumento della fitness
    const maxRamp = Math.max(...build.map((w) => w.ramp));
    const avgRamp = build.reduce((a, w) => a + w.ramp, 0) / build.length;
    if (maxRamp > LIMITS.rampHigh) {
      items.push({ level: 'bad', text: `Crescita troppo rapida: la fitness (CTL) sale fino a ${fmt(maxRamp)} in una settimana (oltre ${LIMITS.rampHigh}). Rischio di affaticamento eccessivo: riduci il volume.` });
    } else if (maxRamp > LIMITS.rampGood[1]) {
      items.push({ level: 'warn', text: `Crescita impegnativa: fino a ${fmt(maxRamp)} CTL/settimana. Va bene solo se recuperi bene; l'ideale in fase Z2 è ${LIMITS.rampGood[0]}–${LIMITS.rampGood[1]}.` });
    } else if (avgRamp < LIMITS.rampGood[0]) {
      // Ore settimanali che servirebbero per +3 CTL/settimana con lo stesso tipo di sedute.
      // In una settimana la CTL varia di circa (carico medio giornaliero − CTL) × (1 − (41/42)^7).
      const k = 1 - Math.pow(41 / 42, 7);
      const ctlRef = Math.max(Number(ctl0) || 0, sim.series[6] ? sim.series[6].ctl : 0);
      const secs = build.reduce((a, w) => a + w.secs, 0);
      const load = build.reduce((a, w) => a + w.load, 0);
      const perHour = secs ? load / (secs / 3600) : 0;
      const hours = perHour ? (7 * (ctlRef + 3 / k)) / perHour : 0;
      const hint = hours ? ` Per una crescita di circa +3 a settimana servirebbero circa ${Math.round(hours)} ore di Z2 a settimana.` : '';
      items.push({ level: 'warn', text: `Piano blando: la fitness cresce in media di ${fmt(avgRamp)} CTL/settimana.${hint} Aggiungi tempo o un giorno di allenamento, oppure accetta un mese di mantenimento.` });
    } else {
      items.push({ level: 'ok', text: `Crescita equilibrata: in media ${fmt(avgRamp)} CTL/settimana nelle settimane di carico.` });
    }

    // Fatica
    const minTsb = Math.min(...sim.series.map((s) => s.tsb));
    if (minTsb < LIMITS.tsbBad) {
      items.push({ level: 'bad', text: `Fatica eccessiva: la forma (TSB) scende a ${minTsb.toFixed(0)} (sotto ${LIMITS.tsbBad}).` });
    } else if (minTsb < LIMITS.tsbWarn) {
      items.push({ level: 'warn', text: `Fatica alta: la forma (TSB) scende a ${minTsb.toFixed(0)}. Controlla sonno e sensazioni.` });
    } else {
      items.push({ level: 'ok', text: `Fatica sotto controllo: la forma (TSB) non scende sotto ${minTsb.toFixed(0)}.` });
    }

    // Recupero a fine mese
    const endTsb = sim.series[sim.series.length - 1].ctl - sim.series[sim.series.length - 1].atl;
    items.push(endTsb >= -10
      ? { level: 'ok', text: `La settimana di scarico ti fa recuperare: forma finale ${endTsb.toFixed(0)}.` }
      : { level: 'warn', text: `A fine mese la forma è ancora ${endTsb.toFixed(0)}: lo scarico potrebbe non bastare.` });

    // Distribuzione delle intensità
    const easy = zoneSplit(plan);
    items.push(easy >= 0.8
      ? { level: 'ok', text: `Intensità adatta alla fase Z2: ${Math.round(easy * 100)}% del tempo sotto il 75% FTP.` }
      : { level: 'warn', text: `Solo ${Math.round(easy * 100)}% del tempo è facile: per una fase Z2 punta ad almeno l'80%.` });

    // Giorni consecutivi
    const consec = maxConsecutive(plan);
    if (consec >= 5) items.push({ level: 'warn', text: `${consec} giorni di fila senza riposo: inserisci almeno un giorno libero.` });

    if (!(Number(ctl0) > 0)) {
      items.push({ level: 'warn', text: 'Fitness attuale (CTL) sconosciuta: la valutazione è approssimativa. Leggila da intervals.icu.' });
    }

    const level = items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok';
    return { level, items };
  }

  /* ---------- adattamento automatico del volume ---------- */

  /** Trova il volume più alto (≤ 100% della disponibilità) che resta entro i limiti. */
  function autoScale(opts, ctl0, atl0) {
    let best = 0.4;
    for (let s = 1.0; s >= 0.4 - 1e-9; s -= 0.05) {
      const plan = generate({ ...opts, scale: s });
      const sim = simulate(plan, ctl0, atl0);
      const build = sim.weeks.slice(0, WEEKS - 1);
      const maxRamp = Math.max(...build.map((w) => w.ramp));
      const minTsb = Math.min(...sim.series.map((x) => x.tsb));
      if (maxRamp <= LIMITS.autoRampTarget && minTsb >= LIMITS.autoTsbMin) { best = s; break; }
    }
    return Math.round(best * 100) / 100;
  }

  /** Evento intervals.icu per una seduta del piano. */
  function toEvent(day) {
    const s = day.session;
    const text = Workout.toText(s.blocks);
    return {
      category: 'WORKOUT',
      start_date_local: `${Api.isoDate(day.date)}T00:00:00`,
      type: s.sport,
      name: s.name,
      description: `${s.notes}\n\n${text}`,
      moving_time: s.secs,
    };
  }

  window.Plan = { WEEKS, LIMITS, generate, simulate, evaluate, autoScale, toEvent, addDays, durLabel };
})();
