/* Client minimale per l'API di intervals.icu.
 * Le credenziali sono lette solo da localStorage: nessuna chiave nel codice. */
(function () {
  'use strict';

  const BASE = 'https://intervals.icu/api/v1';
  const KEY_STORE = 'allenamenti.settings';

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
  }

  function getSettings() {
    try {
      const raw = safeGet(KEY_STORE);
      const s = raw ? JSON.parse(raw) : {};
      return { apiKey: s.apiKey || '', athleteId: s.athleteId || '' };
    } catch (e) {
      return { apiKey: '', athleteId: '' };
    }
  }

  function saveSettings(apiKey, athleteId) {
    return safeSet(KEY_STORE, JSON.stringify({ apiKey: apiKey.trim(), athleteId: athleteId.trim() }));
  }

  function clearAll() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('allenamenti.'))
        .forEach(safeRemove);
    } catch (e) { /* ignora */ }
  }

  function isConfigured() {
    const s = getSettings();
    return Boolean(s.apiKey && s.athleteId);
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function request(path, { method = 'GET', body, query } = {}) {
    const { apiKey, athleteId } = getSettings();
    if (!apiKey || !athleteId) {
      throw new ApiError('Inserisci chiave API e Athlete ID nelle Impostazioni.', 0);
    }
    const url = new URL(BASE + path.replace('{athlete}', encodeURIComponent(athleteId)));
    if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

    const headers = {
      Authorization: 'Basic ' + btoa('API_KEY:' + apiKey),
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError(navigator.onLine === false
        ? 'Sei offline: controlla la connessione.'
        : 'Impossibile contattare intervals.icu (rete o CORS).', 0);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) { /* ignora */ }
      const msg = {
        401: 'Chiave API non valida (401).',
        403: 'Accesso negato: controlla Athlete ID e permessi della chiave (403).',
        404: 'Risorsa non trovata: controlla l\'Athlete ID (404).',
        429: 'Troppe richieste, riprova tra poco (429).',
      }[res.status] || `Errore ${res.status}${detail ? ': ' + detail : ''}`;
      throw new ApiError(msg, res.status);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function isoDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  const Api = {
    getSettings,
    saveSettings,
    clearAll,
    isConfigured,
    isoDate,
    ApiError,

    getAthlete() {
      return request('/athlete/{athlete}');
    },

    getActivities(oldest, newest) {
      return request('/athlete/{athlete}/activities', {
        query: { oldest: isoDate(oldest), newest: isoDate(newest) },
      });
    },

    getWellness(oldest, newest) {
      return request('/athlete/{athlete}/wellness', {
        query: { oldest: isoDate(oldest), newest: isoDate(newest) },
      });
    },

    createEvent(event) {
      return request('/athlete/{athlete}/events', { method: 'POST', body: event });
    },

    /** Crea più eventi; se l'endpoint bulk non è disponibile li crea uno alla volta. */
    async createEvents(events, onProgress) {
      try {
        const res = await request('/athlete/{athlete}/events/bulk', { method: 'POST', body: events });
        if (onProgress) onProgress(events.length, events.length);
        return Array.isArray(res) ? res : [];
      } catch (e) {
        if (![404, 405].includes(e.status)) throw e;
      }
      const out = [];
      for (let i = 0; i < events.length; i++) {
        out.push(await request('/athlete/{athlete}/events', { method: 'POST', body: events[i] }));
        if (onProgress) onProgress(i + 1, events.length);
      }
      return out;
    },

    deleteEvent(id) {
      return request('/athlete/{athlete}/events/' + encodeURIComponent(id), { method: 'DELETE' });
    },
  };

  window.Api = Api;
})();
