/* Logica dell'interfaccia: navigazione, impostazioni, analisi, creazione allenamenti. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const CACHE_KEY = 'allenamenti.cache.analisi';
  const DRAFT_KEY = 'allenamenti.draft';
  const DAYS = 30;

  /* ---------- utilità ---------- */

  function storeGet(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignora */ }
  }

  function fmtHours(secs) {
    secs = Math.round(secs || 0);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }
  function fmtKm(meters) {
    const km = (meters || 0) / 1000;
    return km.toLocaleString('it-IT', { maximumFractionDigits: km < 100 ? 1 : 0 }) + ' km';
  }
  function fmtNum(n) { return Math.round(n).toLocaleString('it-IT'); }

  const dayFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
  const dayShort = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function parseLocal(s) {
    // "2026-11-20T08:30:00" -> Date locale (senza conversione di fuso)
    const [d, t = '00:00:00'] = String(s).split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi, se] = t.split(':').map((x) => parseInt(x, 10) || 0);
    return new Date(y, mo - 1, da, h, mi, se);
  }

  function setStatus(node, text, kind = 'info', spinner = false) {
    if (!text) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.className = 'status ' + kind;
    node.innerHTML = '';
    if (spinner) { const s = document.createElement('span'); s.className = 'spinner'; node.appendChild(s); }
    node.appendChild(document.createTextNode(text));
  }

  /* ---------- navigazione ---------- */

  const VIEWS = ['analisi', 'crea', 'piano', 'impostazioni'];
  let analysisLoaded = false;

  function route() {
    let v = location.hash.replace('#', '');
    if (!VIEWS.includes(v)) v = Api.isConfigured() ? 'analisi' : 'impostazioni';
    VIEWS.forEach((name) => { $('#view-' + name).hidden = name !== v; });
    $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
    $('#page-title').textContent = $('#view-' + v).dataset.title;
    window.scrollTo(0, 0);

    if (v === 'analisi') enterAnalysis();
    if (v === 'crea') renderBuilder();
    if (v === 'piano') PlanUI.enter();
  }

  /* ---------- impostazioni ---------- */

  function initSettings() {
    const s = Api.getSettings();
    $('#set-apikey').value = s.apiKey;
    $('#set-athlete').value = s.athleteId;

    $('#btn-toggle-key').addEventListener('click', () => {
      const inp = $('#set-apikey');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      $('#btn-toggle-key').textContent = show ? 'Nascondi' : 'Mostra';
    });

    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      save();
      const st = $('#settings-status');
      if (Api.isConfigured()) {
        setStatus(st, 'Impostazioni salvate su questo dispositivo.', 'ok');
        analysisLoaded = false;
      } else {
        setStatus(st, 'Compila entrambi i campi.', 'err');
      }
    });

    $('#btn-test').addEventListener('click', async () => {
      save();
      const st = $('#settings-status');
      if (!Api.isConfigured()) return setStatus(st, 'Compila entrambi i campi.', 'err');
      setStatus(st, 'Verifica in corso…', 'info', true);
      try {
        const a = await Api.getAthlete();
        const name = [a && a.firstname, a && a.lastname].filter(Boolean).join(' ') || (a && a.name) || a.id;
        setStatus(st, `Connessione riuscita: ${name}.`, 'ok');
        analysisLoaded = false;
      } catch (err) {
        setStatus(st, err.message, 'err');
      }
    });

    $('#btn-clear').addEventListener('click', () => {
      if (!confirm('Cancellare chiave API, Athlete ID e dati salvati su questo telefono?')) return;
      Api.clearAll();
      $('#set-apikey').value = '';
      $('#set-athlete').value = '';
      analysisLoaded = false;
      $('#analisi-content').hidden = true;
      builder.blocks = Workout.PRESETS[0].blocks();
      setStatus($('#settings-status'), 'Dati cancellati.', 'ok');
    });

    function save() {
      Api.saveSettings($('#set-apikey').value, $('#set-athlete').value);
    }
  }

  /* ---------- analisi ---------- */

  function enterAnalysis() {
    const configured = Api.isConfigured();
    $('#analisi-setup').hidden = configured;
    $('#btn-refresh').disabled = !configured;
    const cached = storeGet(CACHE_KEY);
    if (!analysisLoaded && cached) renderAnalysis(cached, true);
    if (configured && !analysisLoaded) loadAnalysis();
  }

  async function loadAnalysis() {
    const st = $('#analisi-status');
    const newest = new Date();
    const oldest = new Date();
    oldest.setDate(newest.getDate() - (DAYS - 1));
    setStatus(st, 'Scarico le attività da intervals.icu…', 'info', true);
    $('#btn-refresh').disabled = true;
    try {
      const [activities, wellness] = await Promise.all([
        Api.getActivities(oldest, newest),
        Api.getWellness(oldest, newest).catch(() => []),
      ]);
      const data = {
        fetchedAt: Date.now(),
        oldest: Api.isoDate(oldest),
        newest: Api.isoDate(newest),
        activities: (activities || []).map(slimActivity),
        wellness: (wellness || []).map((w) => ({ id: w.id, ctl: w.ctl, atl: w.atl })),
      };
      storeSet(CACHE_KEY, data);
      analysisLoaded = true;
      setStatus(st, '');
      renderAnalysis(data, false);
    } catch (err) {
      const cached = storeGet(CACHE_KEY);
      setStatus(st, err.message + (cached ? ' Mostro gli ultimi dati salvati.' : ''), 'err');
    } finally {
      $('#btn-refresh').disabled = !Api.isConfigured();
    }
  }

  // Conserva solo i campi utili (meno spazio in cache).
  function slimActivity(a) {
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      start: a.start_date_local,
      moving: a.moving_time ?? a.elapsed_time ?? 0,
      distance: a.distance ?? a.icu_distance ?? 0,
      watts: a.icu_average_watts ?? a.average_watts ?? null,
      np: a.icu_weighted_avg_watts ?? null,
      hr: a.average_heartrate ?? null,
      hrMax: a.max_heartrate ?? null,
      load: a.icu_training_load ?? null,
      zones: Array.isArray(a.icu_zone_times) ? a.icu_zone_times.map((z) => ({ id: z.id, secs: z.secs || 0 })) : null,
      hrZones: Array.isArray(a.icu_hr_zone_times) ? a.icu_hr_zone_times : null,
      stub: !a.start_date_local || Boolean(a._note),
    };
  }

  function renderAnalysis(data, fromCache) {
    $('#analisi-content').hidden = false;
    const updated = new Date(data.fetchedAt);
    $('#analisi-range').textContent = `Ultimi ${DAYS} giorni` + (fromCache ? ` · dati del ${dateTimeFmt.format(updated)}` : '');

    const acts = data.activities.filter((a) => !a.stub).sort((a, b) => (a.start < b.start ? 1 : -1));
    const stubs = data.activities.length - acts.length;

    // KPI
    const totTime = acts.reduce((s, a) => s + (a.moving || 0), 0);
    const totDist = acts.reduce((s, a) => s + (a.distance || 0), 0);
    const totLoad = acts.reduce((s, a) => s + (a.load || 0), 0);
    const wAvg = (field) => {
      let t = 0, v = 0;
      acts.forEach((a) => { if (a[field]) { t += a.moving; v += a[field] * a.moving; } });
      return t ? v / t : null;
    };
    const avgW = wAvg('watts');
    const avgHr = wAvg('hr');
    const lastW = [...data.wellness].reverse().find((w) => w.ctl != null);

    const kpis = [
      { label: 'Attività', value: acts.length, sub: stubs ? `${stubs} senza dati (es. Strava)` : '' },
      { label: 'Durata', value: fmtHours(totTime), sub: acts.length ? `media ${fmtHours(totTime / acts.length)}` : '' },
      { label: 'Distanza', value: fmtKm(totDist), sub: '' },
      { label: 'Potenza media', value: avgW ? fmtNum(avgW) + ' W' : '—', sub: 'ponderata sul tempo' },
      { label: 'FC media', value: avgHr ? fmtNum(avgHr) + ' bpm' : '—', sub: maxOf(acts, 'hrMax') ? `max ${maxOf(acts, 'hrMax')} bpm` : '' },
      { label: 'Carico totale', value: fmtNum(totLoad), sub: lastW ? `CTL ${fmtNum(lastW.ctl)} · forma ${fmtNum(lastW.ctl - lastW.atl)}` : `media ${fmtNum(totLoad / DAYS)}/giorno` },
    ];
    const box = $('#kpis');
    box.innerHTML = '';
    kpis.forEach((k) => {
      const d = document.createElement('div');
      d.className = 'kpi';
      d.innerHTML = '<div class="k-label"></div><div class="k-value"></div><div class="k-sub"></div>';
      d.children[0].textContent = k.label;
      d.children[1].textContent = k.value;
      d.children[2].textContent = k.sub;
      box.appendChild(d);
    });

    // Carico giornaliero
    const days = [];
    const start = parseLocal(data.oldest);
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({ key: Api.isoDate(d), date: d, load: 0 });
    }
    const byDay = Object.fromEntries(days.map((d) => [d.key, d]));
    acts.forEach((a) => { const k = String(a.start).slice(0, 10); if (byDay[k]) byDay[k].load += a.load || 0; });
    Charts.bars($('#chart-load'), days.map((d) => ({
      label: dayShort.format(d.date),
      value: d.load,
      title: `${dayFmt.format(d.date)}: carico ${fmtNum(d.load)}`,
    })), { label: 'Carico giornaliero', emptyText: 'Nessun carico registrato nel periodo.' });

    // Fitness / fatica
    const wById = Object.fromEntries(data.wellness.map((w) => [w.id, w]));
    const hasFitness = data.wellness.some((w) => w.ctl != null);
    $('#card-fitness').hidden = !hasFitness;
    if (hasFitness) {
      const ctl = days.map((d) => wById[d.key] ? wById[d.key].ctl : null);
      const atl = days.map((d) => wById[d.key] ? wById[d.key].atl : null);
      const tsb = days.map((d, i) => (ctl[i] != null && atl[i] != null ? ctl[i] - atl[i] : null));
      Charts.lines($('#chart-fitness'), days.map((d) => dayShort.format(d.date)), [
        { values: ctl, color: 'var(--c-ctl)' },
        { values: atl, color: 'var(--c-atl)' },
        { values: tsb, color: 'var(--c-tsb)', dashed: true },
      ], { label: 'Fitness e fatica' });
    }

    // Zone di potenza
    const pz = {};
    const order = [];
    acts.forEach((a) => (a.zones || []).forEach((z) => {
      if (!(z.id in pz)) { pz[z.id] = 0; order.push(z.id); }
      pz[z.id] += z.secs;
    }));
    const zoneColor = (id) => (Workout.ZONES[id] ? Workout.ZONES[id].color : id === 'SS' ? 'var(--zss)' : 'var(--muted)');
    const powerZones = order
      .filter((id) => id !== 'SS')
      .sort()
      .map((id) => ({ name: id, secs: pz[id], color: zoneColor(id) }));
    Charts.zoneBars($('#chart-zones-power'), powerZones, fmtHours);
    if (pz.SS) {
      const note = document.createElement('div');
      note.className = 'hint';
      note.textContent = `Di cui sweet spot: ${fmtHours(pz.SS)}`;
      $('#chart-zones-power').appendChild(note);
    }

    // Zone cardio
    const hz = [];
    acts.forEach((a) => (a.hrZones || []).forEach((secs, i) => { hz[i] = (hz[i] || 0) + (secs || 0); }));
    const hrColors = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)', 'var(--z6)', 'var(--z7)'];
    Charts.zoneBars($('#chart-zones-hr'), hz.map((secs, i) => ({ name: 'Z' + (i + 1), secs: secs || 0, color: hrColors[i] || 'var(--muted)' })), fmtHours);

    // Elenco attività
    const list = $('#activity-list');
    list.innerHTML = '';
    if (!acts.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Nessuna attività negli ultimi 30 giorni.';
      list.appendChild(li);
    }
    acts.forEach((a) => {
      const li = document.createElement('li');
      li.innerHTML = '<div class="act-head"><span class="act-name"></span><span class="act-date"></span></div><div class="act-stats"></div>';
      li.querySelector('.act-name').textContent = a.name || a.type || 'Attività';
      li.querySelector('.act-date').textContent = dateTimeFmt.format(parseLocal(a.start));
      const stats = li.querySelector('.act-stats');
      const add = (label, value) => {
        if (value == null || value === '') return;
        const s = document.createElement('span');
        s.append(label + ' ');
        const b = document.createElement('b');
        b.textContent = value;
        s.appendChild(b);
        stats.appendChild(s);
      };
      add('⏱', fmtHours(a.moving));
      if (a.distance) add('↔', fmtKm(a.distance));
      if (a.watts) add('⚡', fmtNum(a.watts) + ' W' + (a.np ? ` (NP ${fmtNum(a.np)})` : ''));
      if (a.hr) add('♥', fmtNum(a.hr) + ' bpm');
      if (a.load != null) add('Carico', fmtNum(a.load));
      list.appendChild(li);
    });
  }

  function maxOf(arr, field) {
    const v = Math.max(0, ...arr.map((a) => a[field] || 0));
    return v || null;
  }

  /* ---------- crea allenamento ---------- */

  const builder = {
    blocks: null,
  };

  function initBuilder() {
    const draft = storeGet(DRAFT_KEY);
    builder.blocks = draft && Array.isArray(draft.blocks) ? draft.blocks : Workout.PRESETS[0].blocks();
    if (draft && draft.name) $('#wo-name').value = draft.name;
    if (draft && draft.type) $('#wo-type').value = draft.type;
    if (draft && draft.notes) $('#wo-notes').value = draft.notes;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    $('#wo-date').value = Api.isoDate(tomorrow);

    const sel = $('#wo-preset');
    Workout.PRESETS.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      const p = Workout.PRESETS.find((x) => x.id === sel.value);
      if (!p) return;
      builder.blocks = p.blocks();
      $('#wo-name').value = p.name.replace('·', '–');
      sel.value = '';
      renderBuilder();
    });

    $('#btn-add-step').addEventListener('click', () => { builder.blocks.push(Workout.defaultStep()); renderBuilder(); });
    $('#btn-add-repeat').addEventListener('click', () => { builder.blocks.push(Workout.defaultRepeat()); renderBuilder(); });
    ['#wo-name', '#wo-type', '#wo-notes'].forEach((s) => $(s).addEventListener('input', updatePreview));
    $('#btn-upload').addEventListener('click', upload);

    window.addEventListener('resize', debounce(() => { if (!$('#view-crea').hidden) updatePreview(); }, 200));
  }

  function renderBuilder() {
    const root = $('#wo-blocks');
    root.innerHTML = '';
    builder.blocks.forEach((b, i) => {
      if (b.type === 'repeat') root.appendChild(repeatNode(b, i));
      else root.appendChild(stepNode(b, builder.blocks, i));
    });
    updatePreview();
  }

  function move(arr, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderBuilder();
  }

  function stepNode(s, parentArr, index) {
    const node = $('#tpl-step').content.firstElementChild.cloneNode(true);
    const label = $('.s-label', node);
    const min = $('.s-min', node);
    const sec = $('.s-sec', node);
    const target = $('.s-target', node);
    const pctRow = $('.s-pct-row', node);
    const p1 = $('.s-p1', node);
    const p2 = $('.s-p2', node);

    Workout.TARGET_OPTIONS.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      target.appendChild(opt);
    });

    label.value = s.label || '';
    min.value = Math.floor(s.secs / 60);
    sec.value = s.secs % 60;
    target.value = s.target;
    p1.value = s.p1 ?? '';
    p2.value = s.p2 ?? '';

    const sync = () => {
      const custom = s.target === 'pct' || s.target === 'ramp';
      pctRow.hidden = !custom;
      $('span', p2.parentElement).textContent = s.target === 'ramp' ? 'fino a' : 'a (facoltativo)';
      node.style.borderLeftColor = Workout.colorOf(s);
    };
    sync();

    label.addEventListener('input', () => { s.label = label.value; updatePreview(); });
    const setDur = () => {
      const mm = Math.max(0, parseInt(min.value, 10) || 0);
      const ss = Math.min(59, Math.max(0, parseInt(sec.value, 10) || 0));
      s.secs = mm * 60 + ss;
      updatePreview();
    };
    min.addEventListener('input', setDur);
    sec.addEventListener('input', setDur);
    target.addEventListener('change', () => {
      s.target = target.value;
      if ((s.target === 'pct' || s.target === 'ramp') && !s.p1) { s.p1 = 60; p1.value = 60; }
      if (s.target === 'ramp' && !s.p2) { s.p2 = 80; p2.value = 80; }
      sync();
      updatePreview();
    });
    const setPct = () => {
      s.p1 = p1.value === '' ? null : Number(p1.value);
      s.p2 = p2.value === '' ? null : Number(p2.value);
      sync();
      updatePreview();
    };
    p1.addEventListener('input', setPct);
    p2.addEventListener('input', setPct);

    $('.s-up', node).addEventListener('click', () => move(parentArr, index, -1));
    $('.s-down', node).addEventListener('click', () => move(parentArr, index, 1));
    $('.s-del', node).addEventListener('click', () => { parentArr.splice(index, 1); renderBuilder(); });
    return node;
  }

  function repeatNode(r, index) {
    const node = document.createElement('div');
    node.className = 'repeat';
    node.innerHTML = `
      <div class="repeat-head">
        <span class="r-title">Ripeti</span>
        <input class="r-count" type="number" inputmode="numeric" min="1" max="50" aria-label="Numero di ripetute">
        <span class="muted">volte</span>
        <input class="r-label" type="text" placeholder="Nome serie (facoltativo)" maxlength="40">
        <span class="step-actions" style="flex-direction:row">
          <button class="icon-btn r-up" aria-label="Sposta su">↑</button>
          <button class="icon-btn r-down" aria-label="Sposta giù">↓</button>
          <button class="icon-btn r-del" aria-label="Elimina ripetute">✕</button>
        </span>
      </div>
      <div class="children"></div>
      <button class="btn small r-add">+ Blocco nella serie</button>`;
    const count = $('.r-count', node);
    const label = $('.r-label', node);
    count.value = r.count;
    label.value = r.label || '';
    count.addEventListener('input', () => { r.count = Math.max(1, Math.min(50, parseInt(count.value, 10) || 1)); updatePreview(); });
    label.addEventListener('input', () => { r.label = label.value; updatePreview(); });
    const children = $('.children', node);
    r.steps.forEach((s, i) => children.appendChild(stepNode(s, r.steps, i)));
    $('.r-add', node).addEventListener('click', () => { r.steps.push(Workout.defaultStep()); renderBuilder(); });
    $('.r-up', node).addEventListener('click', () => move(builder.blocks, index, -1));
    $('.r-down', node).addEventListener('click', () => move(builder.blocks, index, 1));
    $('.r-del', node).addEventListener('click', () => {
      if (!confirm('Eliminare questo gruppo di ripetute?')) return;
      builder.blocks.splice(index, 1);
      renderBuilder();
    });
    return node;
  }

  function updatePreview() {
    const blocks = builder.blocks;
    Charts.profile($('#wo-profile'), Workout.segments(blocks));
    const st = Workout.stats(blocks);
    $('#wo-summary').innerHTML = '';
    [['Durata', fmtHours(st.secs)], ['Carico stimato', fmtNum(st.load)], ['IF', st.intensityFactor.toFixed(2)]].forEach(([k, v]) => {
      const s = document.createElement('span');
      s.append(k + ' ');
      const b = document.createElement('b');
      b.textContent = v;
      s.appendChild(b);
      $('#wo-summary').appendChild(s);
    });
    $('#wo-text').textContent = Workout.toText(blocks);
    storeSet(DRAFT_KEY, { blocks, name: $('#wo-name').value, type: $('#wo-type').value, notes: $('#wo-notes').value });
  }

  async function upload() {
    const st = $('#wo-status');
    const btn = $('#btn-upload');
    if (!Api.isConfigured()) {
      return setStatus(st, 'Configura chiave API e Athlete ID nelle Impostazioni.', 'err');
    }
    const err = Workout.validate(builder.blocks);
    if (err) return setStatus(st, err, 'err');
    const date = $('#wo-date').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setStatus(st, 'Scegli una data valida.', 'err');
    const name = $('#wo-name').value.trim() || 'Allenamento';
    const notes = $('#wo-notes').value.trim();
    const text = Workout.toText(builder.blocks);
    const stats = Workout.stats(builder.blocks);

    const event = {
      category: 'WORKOUT',
      start_date_local: `${date}T00:00:00`,
      type: $('#wo-type').value,
      name,
      description: notes ? `${notes}\n\n${text}` : text,
      moving_time: stats.secs,
    };

    btn.disabled = true;
    setStatus(st, 'Caricamento nel calendario…', 'info', true);
    try {
      const res = await Api.createEvent(event);
      const when = dayFmt.format(parseLocal(date));
      st.hidden = false;
      st.className = 'status ok';
      st.textContent = `«${name}» caricato nel calendario per il ${when}. `;
      const a = document.createElement('a');
      a.href = 'https://intervals.icu/calendar';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Apri intervals.icu';
      st.appendChild(a);
      if (res && res.id) st.dataset.eventId = res.id;
    } catch (e) {
      setStatus(st, e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /** Apre una seduta del piano nell'editor «Crea». */
  function openInBuilder(session, date) {
    builder.blocks = JSON.parse(JSON.stringify(session.blocks));
    $('#wo-name').value = session.name;
    $('#wo-type').value = session.sport || 'Ride';
    $('#wo-notes').value = session.notes || '';
    if (date) $('#wo-date').value = date;
    setStatus($('#wo-status'), '');
    location.hash = '#crea';
  }
  window.App = { openInBuilder };

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------- avvio ---------- */

  function updateOnline() { $('#net-status').hidden = navigator.onLine !== false; }

  document.addEventListener('DOMContentLoaded', () => {
    initSettings();
    initBuilder();
    $('#btn-refresh').addEventListener('click', loadAnalysis);
    window.addEventListener('hashchange', route);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    window.addEventListener('resize', debounce(() => {
      if (!$('#view-analisi').hidden) { const c = storeGet(CACHE_KEY); if (c) renderAnalysis(c, !analysisLoaded); }
    }, 250));
    updateOnline();
    route();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* ignora */ });
    }
  });
})();
