/* Google Calendar sync. Least-privilege scope: calendar.app.created → the app can only touch a secondary
   calendar it creates itself. It cannot read or modify any of the user's other calendars. */
const Gcal = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
  const API = 'https://www.googleapis.com/calendar/v3';
  let token = null, expires = 0;

  const loadGIS = () => new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not reach Google (are you offline?)'));
    document.head.appendChild(s);
  });

  const hasToken = () => !!token && Date.now() < expires - 60000;

  async function connect(clientId) {
    if (!clientId) throw new Error('Add your Google Client ID first (Settings → Google Calendar).');
    if (hasToken()) return token;
    await loadGIS();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: (r) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          token = r.access_token; expires = Date.now() + (r.expires_in || 3600) * 1000; resolve(token);
        },
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : (e.message || e.type || 'Sign-in failed'))),
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  async function api(path, opts = {}) {
    const r = await fetch(API + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (r.status === 401) { token = null; throw new Error('Google session expired — tap Sync again.'); }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error((j.error && j.error.message) || 'Google Calendar error ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  async function ensureCalendar(cal) {
    if (cal.calendarId) {
      try { await api('/calendars/' + encodeURIComponent(cal.calendarId)); return cal.calendarId; }
      catch (e) { if (e.status !== 404 && e.status !== 403 && e.status !== 410) throw e; }
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const c = await api('/calendars', { method: 'POST', body: JSON.stringify({ summary: 'Natalis', description: 'Created by Natalis. Safe to delete.', timeZone: tz }) });
    cal.calendarId = c.id; return c.id;
  }

  async function listAll(calId, extra = '') {
    const out = []; let pageToken = '';
    do {
      const j = await api(`/calendars/${encodeURIComponent(calId)}/events?maxResults=250&singleEvents=true&showDeleted=false${extra}${pageToken ? '&pageToken=' + pageToken : ''}`);
      out.push(...(j.items || [])); pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  const body = (e) => ({
    summary: e.summary, description: e.description,
    start: { date: e.start }, end: { date: e.end },
    transparency: 'transparent', visibility: 'private',
    colorId: e.kind === 'p' ? '11' : e.kind === 'f' ? '7' : '4',
    reminders: { useDefault: false, overrides: (e.reminders || []).map((r) => ({ method: 'popup', minutes: r.minutes })) },
    extendedProperties: { private: { cw: e.kind, cwkey: e.key, cwopen: e.open ? '1' : '0' } },
  });

  const same = (g, b) => g.summary === b.summary && (g.description || '') === b.description && g.start.date === b.start.date && g.end.date === b.end.date &&
    JSON.stringify(((g.reminders && g.reminders.overrides) || []).map((x) => x.minutes)) === JSON.stringify(b.reminders.overrides.map((x) => x.minutes)) &&
    ((g.extendedProperties && g.extendedProperties.private && g.extendedProperties.private.cwopen) || '0') === b.extendedProperties.private.cwopen;

  async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

  /** Make the Google calendar match `events` exactly (insert / patch / delete only what changed). */
  async function sync(cal, events) {
    const calId = await ensureCalendar(cal);
    const existing = (await listAll(calId)).filter((g) => g.extendedProperties && g.extendedProperties.private && g.extendedProperties.private.cw);
    const have = new Map(existing.map((g) => [g.extendedProperties.private.cw + ':' + g.extendedProperties.private.cwkey, g]));
    const want = new Map(events.map((e) => [e.kind + ':' + e.key, e]));
    const stats = { added: 0, updated: 0, removed: 0 }, enc = encodeURIComponent(calId);
    const ops = [];
    for (const [k, e] of want) {
      const g = have.get(k), b = body(e);
      if (!g) ops.push(async () => { await api(`/calendars/${enc}/events`, { method: 'POST', body: JSON.stringify(b) }); stats.added++; });
      else if (!same(g, b)) ops.push(async () => { await api(`/calendars/${enc}/events/${g.id}`, { method: 'PATCH', body: JSON.stringify(b) }); stats.updated++; });
    }
    for (const [k, g] of have) if (!want.has(k)) ops.push(async () => { await api(`/calendars/${enc}/events/${g.id}`, { method: 'DELETE' }); stats.removed++; });
    await pool(ops, 4, (f) => f());
    return stats;
  }

  /** Rebuild logged periods from the calendar (new phone / lost data). */
  async function restore(cal) {
    const calId = await ensureCalendar(cal);
    const items = (await listAll(calId)).filter((g) => g.extendedProperties && g.extendedProperties.private && g.extendedProperties.private.cw === 'l');
    return items.map((g) => {
      const end = new Date(Date.parse(g.end.date) - 86400000).toISOString().slice(0, 10);
      return { start: g.start.date, end: g.extendedProperties.private.cwopen === '1' ? null : end };
    });
  }

  async function removeCalendar(cal) {
    if (!cal.calendarId) return;
    await api('/calendars/' + encodeURIComponent(cal.calendarId), { method: 'DELETE' });
    cal.calendarId = '';
  }

  function disconnect() {
    if (token && window.google && google.accounts) try { google.accounts.oauth2.revoke(token); } catch (e) { /* ignore */ }
    token = null; expires = 0;
  }

  return { connect, sync, restore, removeCalendar, disconnect, hasToken };
})();
