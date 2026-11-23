/* Interfaccia della scheda «Piano»: piano Z2 di 4 settimane. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const SETTINGS_KEY = 'allenamenti.plan.settings';
  const UPLOADED_KEY = 'allenamenti.plan.uploaded';

  // getDay(): 0 = domenica. Ordine di visualizzazione da lunedì.
  const DAYS = [[1, 'Lunedì'], [2, 'Martedì'], [3, 'Mercoledì'], [4, 'Giovedì'], [5, 'Venerdì'], [6, 'Sabato'], [0, 'Domenica']];
  const MINUTES = [0, 30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300];
  const DEFAULT_AVAIL = { 1: 0, 2: 60, 3: 0, 4: 60, 5: 0, 6: 120, 0: 90 };

  const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  const shortFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'numeric' });

  let state = null;
  let initialized = false;
  let triedRead = false;

  function load(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignora */ } }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignora */ } }

  function nextMonday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const delta = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + delta);
    return d;
  }

  function parseDate(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return y ? new Date(y, m - 1, d) : null;
  }

  function fmtHours(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }

  function setStatus(node, text, kind = 'info', spinner = false) {
    if (!text) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.className = 'status ' + kind;
    node.innerHTML = '';
    if (spinner) { const s = document.createElement('span'); s.className = 'spinner'; node.appendChild(s); }
    node.appendChild(document.createTextNode(text));
  }

  /* ---------- impostazioni ---------- */

  function readForm() {
    const avail = {};
    DAYS.forEach(([d]) => { avail[d] = Number($(`#avail-${d}`).value) || 0; });
    return {
      avail,
      start: $('#plan-start').value,
      pct: Number($('#plan-pct').value) || 68,
      sport: $('#plan-sport').value,
      tempo: $('#plan-tempo').value === '1',
      ctl: $('#plan-ctl').value,
      atl: $('#plan-atl').value,
      auto: $('#plan-auto').checked,
      scale: Number($('#plan-scale').value) || 100,
    };
  }

  function init() {
    const saved = load(SETTINGS_KEY) || {};
    const avail = saved.avail || DEFAULT_AVAIL;

    const box = $('#plan-avail');
    DAYS.forEach(([d, name]) => {
      const row = document.createElement('label');
      row.className = 'avail-row';
      row.innerHTML = `<span></span><select id="avail-${d}"></select>`;
      row.firstChild.textContent = name;
      const sel = row.querySelector('select');
      MINUTES.forEach((m) => {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m ? Plan.durLabel(m) : 'Riposo';
        sel.appendChild(o);
      });
      sel.value = String(avail[d] ?? 0);
      if (sel.value === '') sel.value = '0';
      box.appendChild(row);
    });

    const savedStart = parseDate(saved.start);
    $('#plan-start').value = Api.isoDate(savedStart && savedStart >= new Date(new Date().toDateString()) ? savedStart : nextMonday());
    if (saved.pct) $('#plan-pct').value = saved.pct;
    if (saved.sport) $('#plan-sport').value = saved.sport;
    $('#plan-tempo').value = saved.tempo ? '1' : '0';
    if (saved.ctl != null) $('#plan-ctl').value = saved.ctl;
    if (saved.atl != null) $('#plan-atl').value = saved.atl;
    if (saved.auto === false) $('#plan-auto').checked = false;
    if (saved.scale) $('#plan-scale').value = saved.scale;

    $('#view-piano').addEventListener('input', onChange);
    $('#view-piano').addEventListener('change', onChange);
    $('#plan-read').addEventListener('click', readFitness);
    $('#plan-upload').addEventListener('click', upload);
    $('#plan-remove').addEventListener('click', removeUploaded);
    window.addEventListener('resize', debounce(() => { if (!$('#view-piano').hidden) renderChart(); }, 200));
    initialized = true;
  }

  function onChange(e) {
    if (e.target && e.target.closest && e.target.closest('details')) return;
    if (e.target && e.target.id === 'plan-scale') $('#plan-auto').checked = false;
    update();
  }

  async function readFitness() {
    const st = $('#plan-read-status');
    if (!Api.isConfigured()) return setStatus(st, 'Configura chiave API e Athlete ID nelle Impostazioni.', 'err');
    setStatus(st, 'Leggo fitness e fatica…', 'info', true);
    try {
      const today = new Date();
      const w = await Api.getWellness(Plan.addDays(today, -3), today);
      const last = (w || []).filter((x) => x.ctl != null).pop();
      if (!last) return setStatus(st, 'Nessun dato di fitness trovato su intervals.icu.', 'err');
      $('#plan-ctl').value = Number(last.ctl).toFixed(1);
      $('#plan-atl').value = Number(last.atl).toFixed(1);
      setStatus(st, `Fitness ${Number(last.ctl).toFixed(0)}, fatica ${Number(last.atl).toFixed(0)}, forma ${(last.ctl - last.atl).toFixed(0)} (al ${last.id}).`, 'ok');
      update();
    } catch (err) {
      setStatus(st, err.message, 'err');
    }
  }

  /* ---------- calcolo e rendering ---------- */

  function update() {
    const f = readForm();
    save(SETTINGS_KEY, f);
    const start = parseDate(f.start) || nextMonday();
    const opts = { start, avail: f.avail, pct: f.pct, sport: f.sport, tempo: f.tempo };
    const ctl0 = Number(f.ctl) || 0;
    const atl0 = f.atl === '' ? ctl0 : Number(f.atl) || 0;

    let scale = f.scale / 100;
    if (f.auto) {
      scale = Plan.autoScale(opts, ctl0, atl0);
      $('#plan-scale').value = Math.round(scale * 100);
    }
    $('#plan-scale-label').textContent = Math.round(scale * 100) + '%';

    const plan = Plan.generate({ ...opts, scale });
    const sim = Plan.simulate(plan, ctl0, atl0);
    const ev = Plan.evaluate(plan, sim, ctl0);
    state = { plan, sim, ev };

    renderVerdict(ev);
    renderChart();
    renderWeeks(plan, sim);
    renderUploaded();
  }

  function renderVerdict(ev) {
    const box = $('#plan-verdict');
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'verdict-head ' + ev.level;
    head.textContent = { ok: '✓ Piano equilibrato', warn: '! Piano da controllare', bad: '✕ Piano da correggere' }[ev.level];
    box.appendChild(head);
    const ul = document.createElement('ul');
    ev.items.forEach((i) => {
      const li = document.createElement('li');
      li.className = i.level;
      li.textContent = i.text;
      ul.appendChild(li);
    });
    box.appendChild(ul);
    $('#plan-verdict-card').className = 'card verdict-' + ev.level;
  }

  function renderChart() {
    if (!state) return;
    const s = state.sim.series;
    Charts.lines($('#plan-chart'), s.map((x) => shortFmt.format(x.date)), [
      { values: s.map((x) => x.ctl), color: 'var(--c-ctl)' },
      { values: s.map((x) => x.atl), color: 'var(--c-atl)' },
      { values: s.map((x) => x.tsb), color: 'var(--c-tsb)', dashed: true },
    ], { label: 'Andamento previsto' });
  }

  function renderWeeks(plan, sim) {
    const root = $('#plan-weeks');
    root.innerHTML = '';
    sim.weeks.forEach((w) => {
      const card = document.createElement('div');
      card.className = 'card week';
      const days = plan.days.slice(w.index * 7, w.index * 7 + 7);
      const ramp = (w.ramp >= 0 ? '+' : '') + w.ramp.toFixed(1);
      card.innerHTML = `
        <div class="week-head">
          <h2></h2>
          <span class="muted small"></span>
        </div>
        <div class="week-stats"></div>
        <ul class="sessions"></ul>`;
      card.querySelector('h2').textContent = `Settimana ${w.index + 1} · ${w.name}`;
      card.querySelector('.week-head span').textContent = `${shortFmt.format(days[0].date)} – ${shortFmt.format(days[6].date)}`;
      card.querySelector('.week-stats').textContent = `${w.sessions} uscite · ${fmtHours(w.secs)} · carico ${Math.round(w.load)} · CTL ${ramp}`;
      const ul = card.querySelector('.sessions');
      days.forEach((d) => {
        if (!d.session) return;
        const s = d.session;
        const li = document.createElement('li');
        li.innerHTML = `
          <details>
            <summary>
              <span class="s-dot"></span>
              <span class="s-day"></span>
              <span class="s-name"></span>
              <span class="s-meta"></span>
            </summary>
            <div class="s-body">
              <div class="chart profile"></div>
              <pre class="wo-text"></pre>
              <button class="btn small s-open">Modifica in «Crea»</button>
            </div>
          </details>`;
        li.querySelector('.s-dot').style.background = s.kind === 'tempo' ? 'var(--z3)' : s.kind === 'deload' ? 'var(--z1)' : 'var(--z2)';
        li.querySelector('.s-day').textContent = dayFmt.format(d.date);
        li.querySelector('.s-name').textContent = s.name;
        li.querySelector('.s-meta').textContent = `${fmtHours(s.secs)} · ${s.load}`;
        li.querySelector('.wo-text').textContent = Workout.toText(s.blocks);
        const det = li.querySelector('details');
        det.addEventListener('toggle', () => {
          if (det.open) Charts.profile(li.querySelector('.profile'), Workout.segments(s.blocks));
        });
        li.querySelector('.s-open').addEventListener('click', () => {
          if (window.App && App.openInBuilder) App.openInBuilder(s, Api.isoDate(d.date));
        });
        ul.appendChild(li);
      });
      if (!ul.children.length) {
        const li = document.createElement('li');
        li.className = 'muted';
        li.textContent = 'Nessuna uscita.';
        ul.appendChild(li);
      }
      root.appendChild(card);
    });
  }

  /* ---------- caricamento ---------- */

  function renderUploaded() {
    const up = load(UPLOADED_KEY);
    $('#plan-uploaded').hidden = !(up && up.ids && up.ids.length);
    if (up && up.ids) {
      $('#plan-uploaded-text').textContent = `Hai caricato ${up.ids.length} allenamenti dal ${up.from} al ${up.to}. Se vuoi rifare il piano, eliminali prima per evitare doppioni.`;
    }
  }

  async function upload() {
    const st = $('#plan-status');
    if (!Api.isConfigured()) return setStatus(st, 'Configura chiave API e Athlete ID nelle Impostazioni.', 'err');
    if (!state) return;
    const days = state.plan.days.filter((d) => d.session);
    if (!days.length) return setStatus(st, 'Il piano non contiene allenamenti.', 'err');
    const from = dayFmt.format(days[0].date);
    const to = dayFmt.format(days[days.length - 1].date);
    const prev = load(UPLOADED_KEY);
    const warnDup = prev && prev.ids && prev.ids.length ? '\n\nAttenzione: c\'è già un piano caricato. Se si sovrappone, avrai allenamenti doppi.' : '';
    if (state.ev.level === 'bad' && !confirm('La valutazione segnala problemi importanti. Vuoi caricarlo comunque?')) return;
    if (!confirm(`Caricare ${days.length} allenamenti nel calendario di intervals.icu, dal ${from} al ${to}?${warnDup}`)) return;

    const btn = $('#plan-upload');
    btn.disabled = true;
    setStatus(st, 'Caricamento in corso…', 'info', true);
    try {
      const events = days.map(Plan.toEvent);
      const res = await Api.createEvents(events, (n, tot) => setStatus(st, `Caricamento ${n}/${tot}…`, 'info', true));
      const ids = res.map((r) => r && r.id).filter((x) => x != null);
      const all = (prev && prev.ids ? prev.ids : []).concat(ids);
      save(UPLOADED_KEY, { ids: all, from: prev && prev.from ? prev.from : from, to });
      setStatus(st, `Fatto: ${events.length} allenamenti caricati nel calendario.`, 'ok');
      renderUploaded();
    } catch (err) {
      setStatus(st, err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  async function removeUploaded() {
    const up = load(UPLOADED_KEY);
    if (!up || !up.ids || !up.ids.length) return;
    if (!confirm(`Eliminare da intervals.icu i ${up.ids.length} allenamenti caricati con il piano?`)) return;
    const st = $('#plan-status');
    const btn = $('#plan-remove');
    btn.disabled = true;
    const left = [];
    for (let i = 0; i < up.ids.length; i++) {
      setStatus(st, `Eliminazione ${i + 1}/${up.ids.length}…`, 'info', true);
      try {
        await Api.deleteEvent(up.ids[i]);
      } catch (err) {
        if (err.status !== 404) left.push(up.ids[i]);
      }
    }
    btn.disabled = false;
    if (left.length) {
      save(UPLOADED_KEY, { ...up, ids: left });
      setStatus(st, `${left.length} allenamenti non sono stati eliminati. Riprova.`, 'err');
    } else {
      remove(UPLOADED_KEY);
      setStatus(st, 'Piano eliminato dal calendario.', 'ok');
    }
    renderUploaded();
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function enter() {
    if (!initialized) init();
    update();
    if (!triedRead && Api.isConfigured() && $('#plan-ctl').value === '') {
      triedRead = true;
      readFitness();
    }
  }

  window.PlanUI = { enter };
})();
