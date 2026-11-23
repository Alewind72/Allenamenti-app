/* Grafici SVG semplici, senza librerie esterne (funzionano offline). */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  function widthOf(container) {
    return Math.max(260, Math.round(container.clientWidth || 340));
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * exp;
  }

  /** Etichetta ogni `every` punti più l'ultimo, saltando quelle troppo vicine all'ultimo. */
  function showTick(i, n, every) {
    if (i === n - 1) return true;
    return i % every === 0 && (n - 1 - i) >= Math.max(1, every / 2);
  }

  function empty(container, msg) {
    container.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = msg || 'Nessun dato disponibile.';
    container.appendChild(d);
  }

  /** Istogramma verticale. data: [{label, value, title}] */
  function bars(container, data, opts = {}) {
    if (!data.length || data.every((d) => !d.value)) return empty(container, opts.emptyText);
    container.innerHTML = '';
    const W = widthOf(container);
    const H = opts.height || 170;
    const m = { t: 10, r: 6, b: 22, l: 30 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const max = niceMax(Math.max(...data.map((d) => d.value || 0)));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'grafico' }, container);

    for (let i = 0; i <= 4; i++) {
      const y = m.t + ih - (ih * i) / 4;
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'grid' }, svg);
      const t = el('text', { x: m.l - 4, y: y + 3, 'text-anchor': 'end' }, svg);
      t.textContent = Math.round((max * i) / 4);
    }

    const step = iw / data.length;
    const bw = Math.max(2, step * 0.7);
    const labelEvery = Math.ceil(data.length / 8);
    data.forEach((d, i) => {
      const h = ((d.value || 0) / max) * ih;
      const x = m.l + i * step + (step - bw) / 2;
      const r = el('rect', {
        x, y: m.t + ih - h, width: bw, height: Math.max(0, h),
        rx: Math.min(3, bw / 3), fill: d.color || opts.color || 'var(--accent)',
      }, svg);
      if (d.title) el('title', {}, r).textContent = d.title;
      if (showTick(i, data.length, labelEvery)) {
        const t = el('text', { x: m.l + i * step + step / 2, y: H - 6, 'text-anchor': 'middle' }, svg);
        t.textContent = d.label;
      }
    });
  }

  /** Grafico a linee. labels: [string], series: [{values, color, dashed}] */
  function lines(container, labels, series, opts = {}) {
    const all = series.flatMap((s) => s.values).filter((v) => v != null && !isNaN(v));
    if (!all.length) return empty(container, opts.emptyText);
    container.innerHTML = '';
    const W = widthOf(container);
    const H = opts.height || 180;
    const m = { t: 10, r: 8, b: 22, l: 30 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    let lo = Math.min(0, ...all);
    let hi = Math.max(...all);
    hi = niceMax(hi);
    if (lo < 0) lo = -niceMax(-lo);
    const span = hi - lo || 1;
    const y = (v) => m.t + ih - ((v - lo) / span) * ih;
    const x = (i) => m.l + (labels.length > 1 ? (i * iw) / (labels.length - 1) : iw / 2);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'grafico' }, container);

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (span * i) / ticks;
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }, svg);
      el('text', { x: m.l - 4, y: y(v) + 3, 'text-anchor': 'end' }, svg).textContent = Math.round(v);
    }
    if (lo < 0) el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), stroke: 'var(--muted)', 'stroke-width': 1 }, svg);

    const labelEvery = Math.ceil(labels.length / 7);
    labels.forEach((l, i) => {
      if (showTick(i, labels.length, labelEvery)) {
        el('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, svg).textContent = l;
      }
    });

    series.forEach((s) => {
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null || isNaN(v)) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      el('path', {
        d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': s.dashed ? '4 3' : 'none',
      }, svg);
    });
  }

  /** Barre orizzontali per le zone. zones: [{name, secs, color}] */
  function zoneBars(container, zones, fmt) {
    const total = zones.reduce((a, z) => a + z.secs, 0);
    if (!total) return empty(container, 'Nessun dato sulle zone nel periodo.');
    container.innerHTML = '';
    const max = Math.max(...zones.map((z) => z.secs));
    zones.forEach((z) => {
      const row = document.createElement('div');
      row.className = 'zone-row';
      const pct = Math.round((z.secs / total) * 100);
      row.innerHTML = `
        <span class="z-name" style="color:${z.color}">${z.name}</span>
        <span class="z-bar"><span style="width:${(z.secs / max) * 100}%;background:${z.color}"></span></span>
        <span class="z-val">${fmt(z.secs)} · ${pct}%</span>`;
      row.title = `${z.name}: ${fmt(z.secs)} (${pct}%)`;
      container.appendChild(row);
    });
  }

  /** Profilo di un allenamento. segments: [{secs, from, to, color}] con from/to in % FTP. */
  function profile(container, segments) {
    const total = segments.reduce((a, s) => a + s.secs, 0);
    if (!total) return empty(container, 'Aggiungi almeno un blocco.');
    container.innerHTML = '';
    const W = widthOf(container);
    const H = 130;
    const m = { t: 6, r: 2, b: 18, l: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const top = Math.max(130, ...segments.map((s) => Math.max(s.from, s.to))) + 10;
    const y = (p) => m.t + ih - (p / top) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Profilo allenamento' }, container);

    [50, 100].forEach((p) => {
      el('line', { x1: m.l, x2: W - m.r, y1: y(p), y2: y(p), class: 'grid', 'stroke-dasharray': p === 100 ? '4 3' : 'none' }, svg);
      el('text', { x: m.l - 4, y: y(p) + 3, 'text-anchor': 'end' }, svg).textContent = p + '%';
    });

    let t = 0;
    segments.forEach((s) => {
      const x0 = m.l + (t / total) * iw;
      const x1 = m.l + ((t + s.secs) / total) * iw;
      const pts = `${x0},${y(0)} ${x0},${y(s.from)} ${x1},${y(s.to)} ${x1},${y(0)}`;
      const poly = el('polygon', { points: pts, fill: s.color, stroke: 'var(--bg)', 'stroke-width': 0.6 }, svg);
      el('title', {}, poly).textContent = s.title || '';
      t += s.secs;
    });

    const mins = total / 60;
    const stepMin = mins > 120 ? 30 : mins > 60 ? 15 : 10;
    for (let mm = 0; mm <= mins; mm += stepMin) {
      el('text', { x: m.l + ((mm * 60) / total) * iw, y: H - 4, 'text-anchor': 'middle' }, svg).textContent = mm + "'";
    }
  }

  window.Charts = { bars, lines, zoneBars, profile };
})();
