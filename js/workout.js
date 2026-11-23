/* Modello degli allenamenti a zone e conversione nel formato testo di intervals.icu.
 *
 * Un allenamento è una lista di blocchi:
 *   { type: 'step', label, secs, target, p1, p2 }
 *   { type: 'repeat', label, count, steps: [step, ...] }
 * target: 'Z1'..'Z7' | 'SS' | 'pct' (p1, eventuale p2 = intervallo) | 'ramp' (da p1 a p2)
 */
(function () {
  'use strict';

  // Zone di potenza standard di intervals.icu (% FTP).
  const ZONES = {
    Z1: { name: 'Z1 Recupero', range: [0, 55], mid: 50, color: 'var(--z1)' },
    Z2: { name: 'Z2 Endurance', range: [56, 75], mid: 66, color: 'var(--z2)' },
    Z3: { name: 'Z3 Tempo', range: [76, 90], mid: 83, color: 'var(--z3)' },
    Z4: { name: 'Z4 Soglia', range: [91, 105], mid: 98, color: 'var(--z4)' },
    Z5: { name: 'Z5 VO2max', range: [106, 120], mid: 113, color: 'var(--z5)' },
    Z6: { name: 'Z6 Anaerobico', range: [121, 150], mid: 135, color: 'var(--z6)' },
    Z7: { name: 'Z7 Neuromuscolare', range: [151, 200], mid: 160, color: 'var(--z7)' },
  };
  const SWEET_SPOT = { name: 'Sweet spot (88–94%)', from: 88, to: 94 };

  const TARGET_OPTIONS = [
    ...Object.entries(ZONES).map(([k, z]) => ({ value: k, label: z.name })),
    { value: 'SS', label: SWEET_SPOT.name },
    { value: 'pct', label: '% FTP personalizzata' },
    { value: 'ramp', label: 'Rampa % FTP' },
  ];

  function colorForPct(p) {
    for (const z of Object.values(ZONES)) {
      if (p <= z.range[1]) return z.color;
    }
    return ZONES.Z7.color;
  }

  function step(secs, target, extra = {}) {
    return { type: 'step', label: extra.label || '', secs, target, p1: extra.p1 ?? null, p2: extra.p2 ?? null };
  }
  function repeat(count, steps, label = '') {
    return { type: 'repeat', label, count, steps };
  }
  const m = (n) => n * 60;

  const PRESETS = [
    {
      id: 'z2-60', name: 'Endurance Z2 · 60′',
      blocks: () => [step(m(10), 'Z1', { label: 'Riscaldamento' }), step(m(40), 'Z2'), step(m(10), 'Z1', { label: 'Defaticamento' })],
    },
    {
      id: 'z2-120', name: 'Endurance lungo Z2 · 2h',
      blocks: () => [
        step(m(15), 'ramp', { label: 'Riscaldamento', p1: 50, p2: 65 }),
        step(m(95), 'Z2'),
        step(m(10), 'Z1', { label: 'Defaticamento' }),
      ],
    },
    {
      id: 'tempo', name: 'Tempo 3×12′ Z3',
      blocks: () => [
        step(m(15), 'ramp', { label: 'Riscaldamento', p1: 50, p2: 75 }),
        repeat(3, [step(m(12), 'Z3'), step(m(4), 'Z1')], 'Tempo'),
        step(m(10), 'Z1', { label: 'Defaticamento' }),
      ],
    },
    {
      id: 'ss', name: 'Sweet spot 3×10′',
      blocks: () => [
        step(m(15), 'ramp', { label: 'Riscaldamento', p1: 50, p2: 75 }),
        repeat(3, [step(m(10), 'SS'), step(m(5), 'Z1')], 'Sweet spot'),
        step(m(10), 'Z1', { label: 'Defaticamento' }),
      ],
    },
    {
      id: 'soglia', name: 'Soglia 2×20′ Z4',
      blocks: () => [
        step(m(15), 'ramp', { label: 'Riscaldamento', p1: 50, p2: 80 }),
        repeat(2, [step(m(20), 'Z4'), step(m(5), 'Z1')], 'Soglia'),
        step(m(10), 'Z1', { label: 'Defaticamento' }),
      ],
    },
    {
      id: 'vo2', name: 'VO2max 5×3′ Z5',
      blocks: () => [
        step(m(15), 'ramp', { label: 'Riscaldamento', p1: 50, p2: 80 }),
        repeat(5, [step(m(3), 'Z5'), step(m(3), 'Z1')], 'VO2max'),
        step(m(10), 'Z1', { label: 'Defaticamento' }),
      ],
    },
    {
      id: '3030', name: 'Ripetute 30/30 · 2 serie',
      blocks: () => [
        step(m(15), 'ramp', { label: 'Riscaldamento', p1: 50, p2: 80 }),
        repeat(10, [step(30, 'Z6'), step(30, 'Z1')], 'Serie 1'),
        step(m(5), 'Z1'),
        repeat(10, [step(30, 'Z6'), step(30, 'Z1')], 'Serie 2'),
        step(m(10), 'Z1', { label: 'Defaticamento' }),
      ],
    },
  ];

  function defaultStep() { return step(m(10), 'Z2'); }
  function defaultRepeat() { return repeat(4, [step(m(4), 'Z4'), step(m(3), 'Z1')]); }

  /** Intervallo di intensità di un blocco: { from, to, ramp } in % FTP. */
  function intensity(s) {
    if (ZONES[s.target]) return { from: ZONES[s.target].mid, to: ZONES[s.target].mid, ramp: false };
    if (s.target === 'SS') return { from: 91, to: 91, ramp: false };
    const p1 = Number(s.p1) || 0;
    const p2 = Number(s.p2) || 0;
    if (s.target === 'ramp') return { from: p1, to: p2 || p1, ramp: true };
    const mid = p2 ? (p1 + p2) / 2 : p1;
    return { from: mid, to: mid, ramp: false };
  }

  function colorOf(s) {
    if (ZONES[s.target]) return ZONES[s.target].color;
    if (s.target === 'SS') return 'var(--zss)';
    const i = intensity(s);
    return colorForPct((i.from + i.to) / 2);
  }

  function fmtDuration(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const mm = Math.floor((secs % 3600) / 60);
    const ss = secs % 60;
    let out = '';
    if (h) out += h + 'h';
    if (mm) out += mm + 'm';
    if (ss || !out) out += ss + 's';
    return out;
  }

  function cleanLabel(t) {
    // Evita caratteri che il parser di intervals.icu potrebbe interpretare.
    return String(t || '').replace(/[\r\n]+/g, ' ').replace(/^[-\s]+/, '').trim();
  }

  function targetText(s) {
    if (ZONES[s.target]) return s.target;
    if (s.target === 'SS') return `${SWEET_SPOT.from}-${SWEET_SPOT.to}%`;
    const p1 = Math.round(Number(s.p1) || 0);
    const p2 = Math.round(Number(s.p2) || 0);
    if (s.target === 'ramp') return `ramp ${p1}-${p2 || p1}%`;
    return p2 && p2 !== p1 ? `${Math.min(p1, p2)}-${Math.max(p1, p2)}%` : `${p1}%`;
  }

  function stepLine(s) {
    const label = cleanLabel(s.label);
    return `- ${label ? label + ' ' : ''}${fmtDuration(s.secs)} ${targetText(s)}`;
  }

  /** Testo nel formato "workout builder" di intervals.icu. */
  function toText(blocks) {
    const out = [];
    let prevWasRepeat = false;
    blocks.forEach((b, i) => {
      if (b.type === 'repeat') {
        if (out.length) out.push('');
        out.push(`${cleanLabel(b.label) || 'Ripetute'} ${Math.max(1, b.count | 0)}x`);
        b.steps.forEach((s) => out.push(stepLine(s)));
        prevWasRepeat = true;
      } else {
        if (prevWasRepeat || (i > 0 && cleanLabel(b.label))) out.push('');
        out.push(stepLine(b));
        prevWasRepeat = false;
      }
    });
    return out.join('\n');
  }

  /** Sequenza piatta di segmenti, per il grafico del profilo. */
  function segments(blocks) {
    const segs = [];
    const add = (s) => {
      if (!(s.secs > 0)) return;
      const i = intensity(s);
      segs.push({ secs: s.secs, from: i.from, to: i.to, color: colorOf(s), title: `${fmtDuration(s.secs)} ${targetText(s)}` });
    };
    blocks.forEach((b) => {
      if (b.type === 'repeat') {
        for (let k = 0; k < Math.max(1, b.count | 0); k++) b.steps.forEach(add);
      } else add(b);
    });
    return segs;
  }

  /** Durata totale, carico stimato (TSS) e IF. */
  function stats(blocks) {
    const segs = segments(blocks);
    let secs = 0;
    let weighted = 0; // somma di secs * IF^2
    segs.forEach((s) => {
      const a = s.from / 100;
      const b = s.to / 100;
      // media di IF^2 lungo una rampa lineare
      const if2 = (a * a + a * b + b * b) / 3;
      secs += s.secs;
      weighted += s.secs * if2;
    });
    const intensityFactor = secs ? Math.sqrt(weighted / secs) : 0;
    const load = secs ? Math.round((weighted / 3600) * 100) : 0;
    return { secs, load, intensityFactor };
  }

  /** Validazione minima prima dell'invio. Ritorna un messaggio d'errore o null. */
  function validate(blocks) {
    if (!blocks.length) return 'Aggiungi almeno un blocco.';
    const check = (s) => {
      if (!(s.secs > 0)) return 'Ogni blocco deve avere una durata maggiore di zero.';
      if ((s.target === 'pct' || s.target === 'ramp') && !(Number(s.p1) > 0)) return 'Indica la % FTP per i blocchi personalizzati.';
      if (s.target === 'ramp' && !(Number(s.p2) > 0)) return 'Indica la % FTP finale della rampa.';
      return null;
    };
    for (const b of blocks) {
      if (b.type === 'repeat') {
        if (!b.steps.length) return 'Ogni gruppo di ripetute deve contenere almeno un blocco.';
        if (!(b.count >= 1)) return 'Il numero di ripetute deve essere almeno 1.';
        for (const s of b.steps) { const e = check(s); if (e) return e; }
      } else {
        const e = check(b); if (e) return e;
      }
    }
    return null;
  }

  window.Workout = {
    ZONES, TARGET_OPTIONS, PRESETS,
    defaultStep, defaultRepeat,
    toText, segments, stats, validate, colorOf, fmtDuration,
  };
})();
