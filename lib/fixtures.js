/**
 * Canli / yaklasan mac verisi — ESPN (anahtarsiz, kayit yok)
 * UMD: Node'da require, tarayicida window.OranFixtures
 *
 * ESPN'in herkese acik scoreboard ucu kullanilir:
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/<lig>/scoreboard?dates=YYYYMMDD
 *
 *  - Tek lig icin bugun + 3 gun ileri sorgulanir
 *  - Sonuc 2 dakika onbelleklenir
 *  - Lig kimligi cozulemezse bos doner (uygulama arsiv verisine duser)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OranFixtures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

  /** dogrulanmis ESPN lig kodlari */
  const LEAGUE_IDS = {
    T1: 'tur.1',
    E0: 'eng.1',
    E1: 'eng.2',
    E2: 'eng.3',
    D1: 'ger.1',
    D2: 'ger.2',
    SP1: 'esp.1',
    SP2: 'esp.2',
    F1: 'fra.1',
    F2: 'fra.2',
    N1: 'ned.1',
    B1: 'bel.1',
    P1: 'por.1',
    G1: 'gre.1',
    SC0: 'sco.1',
    SC1: 'sco.2',
    CL: 'uefa.champions',
    EL: 'uefa.europa',
    ECL: 'uefa.europa.conf',
  };

  const TTL_MS = 2 * 60 * 1000;
  const cache = new Map();

  const TR_MAP = { 'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };

  function norm(s) {
    let t = String(s == null ? '' : s);
    t = t.replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, (c) => TR_MAP[c] || c);
    return t.toLowerCase()
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(sk|fc|jk|as|a\.s\.|spor|kulubu|club|fk|sfk|cf)\b/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 99;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let i = 1; i <= m; i++) {
      dp[i][0] = i;
      for (let k = 1; k <= n; k++) {
        dp[i][k] = Math.min(dp[i - 1][k] + 1, dp[i][k - 1] + 1, dp[i - 1][k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      }
    }
    return dp[m][n];
  }

  function buildIndex(teams) {
    const exact = new Map();
    const names = [];
    teams.forEach((t, i) => {
      const n = norm(t.n || t.name || '');
      if (!n) return;
      names.push([n, i]);
      if (!exact.has(n)) exact.set(n, i);
    });
    return { exact, names };
  }

  function matchTeam(name, index) {
    const n = norm(name);
    if (!n) return null;
    if (index.exact.has(n)) return index.exact.get(n);
    for (const [cand, id] of index.names) {
      if (cand.startsWith(n) || n.startsWith(cand)) return id;
    }
    for (const [cand, id] of index.names) {
      if (cand.length > 5 && (cand.includes(n) || n.includes(cand))) return id;
    }
    let best = null, bestD = 3;
    for (const [cand, id] of index.names) {
      const d = lev(cand, n);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateNum(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

  function am2dec(v) {
    if (v === null || v === undefined || v === '') return 0;
    const a = Number(String(v).replace('+', ''));
    if (!isFinite(a) || a === 0) return 0;
    const dec = a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
    return Math.round(dec * 1000) / 1000;
  }
  function sideOdds(side) {
    if (!side) return null;
    const c = side.close || side.open || null;
    return c ? c.odds : null;
  }
  // ESPN scoreboard oran objesinden 1X2 + 2.5 alt/üst'ü ondalık orana çevirir.
  function parseOdds(comp) {
    const out = { h: 0, d: 0, a: 0, o: 0, u: 0, oddsSource: '', oddsLine: '' };
    const od = (comp && comp.odds && comp.odds[0]) || null;
    if (!od) return out;
    const ml = od.moneyline || null;
    out.h = am2dec(ml ? sideOdds(ml.home) : null);
    out.a = am2dec(ml ? sideOdds(ml.away) : null);
    out.d = am2dec(od.drawOdds ? od.drawOdds.moneyLine : null);
    const tot = od.total || null;
    if (tot && Number(od.overUnder) === 2.5) {
      const ov = tot.over && (tot.over.close || tot.over.open);
      const un = tot.under && (tot.under.close || tot.under.open);
      out.o = am2dec(ov && ov.odds);
      out.u = am2dec(un && un.odds);
    }
    if (out.h > 1 || out.d > 1 || out.a > 1) {
      out.oddsSource = (od.provider && od.provider.name) || 'ESPN';
      out.oddsLine = 'close';
    }
    return out;
  }

  function mapEvent(e, index, code) {
    const comp = (e.competitions && e.competitions[0]) || {};
    const comps = comp.competitors || [];
    const h = comps.find((x) => x.homeAway === 'home') || comps[0] || {};
    const a = comps.find((x) => x.homeAway === 'away') || comps[1] || {};
    const st = (e.status && e.status.type) || {};
    const state = st.state || 'pre';
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    const d = e.date ? new Date(e.date) : null;
    const valid = d && !isNaN(d.getTime());
    return {
      id: e.id || null,
      league: code,
      date: valid ? dateNum(d) : 0,
      time: valid ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : '',
      homeName: (h.team && (h.team.displayName || h.team.name)) || '',
      awayName: (a.team && (a.team.displayName || a.team.name)) || '',
      home: matchTeam((h.team && (h.team.displayName || h.team.name)) || '', index),
      away: matchTeam((a.team && (a.team.displayName || a.team.name)) || '', index),
      hg: num(h.score),
      ag: num(a.score),
      status: state === 'in' ? 'live' : state === 'post' ? 'ft' : 'ns',
      raw: st.description || '',
      clock: (e.status && e.status.displayClock) || '',
      venue: (comp.venue && comp.venue.fullName) || '',
      played: state === 'post',
      ...parseOdds(comp),
    };
  }

  async function getJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 9000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) return { __status: r.status };
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Lig icin canli + yaklasan maclar.
   * @param {string} code  bizim lig kodu (T1, E0, ...)
   * @param {{index:object, days?:number, refresh?:boolean, ttl?:number, now?:Date}} opts
   */
  async function leagueEvents(code, opts) {
    const o = opts || {};
    const slug = LEAGUE_IDS[code];
    if (!slug) return { events: [], error: 'no_league_map', league: code };

    const key = 'E:' + code;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (o.ttl || TTL_MS) && !o.refresh) {
      return { events: hit.events, cached: true, stale: false, league: code, at: hit.at };
    }

    const days = Math.max(1, Math.min(5, o.days || 4));
    const base = o.now ? new Date(o.now) : new Date();
    const out = [];
    let anyOk = false;

    for (let i = 0; i < days; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
      try {
        const j = await getJson(`${API}/${slug}/scoreboard?dates=${stamp}`, o.timeoutMs);
        if (j && j.__status) continue;
        anyOk = true;
        for (const ev of (j && j.events) || []) out.push(mapEvent(ev, o.index, code));
      } catch (_) { /* diger gunleri dene */ }
    }

    if (!out.length && !anyOk) {
      if (hit) return { events: hit.events, cached: true, stale: true, error: 'fetch_failed', league: code, at: hit.at };
      return { events: [], error: 'fetch_failed', league: code };
    }

    const seen = new Set();
    const uniq = out.filter((e) => {
      const k = e.id || (e.date + '|' + e.homeName + '|' + e.awayName);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const rank = (e) => (e.status === 'live' ? 0 : e.status === 'ns' ? 1 : 2);
    uniq.sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r) return r;
      return a.status === 'ft' ? b.date - a.date : a.date - b.date;
    });

    cache.set(key, { at: Date.now(), events: uniq });
    return { events: uniq, cached: false, stale: false, league: code, at: Date.now() };
  }

  function clearCache() { cache.clear(); }

  return { LEAGUE_IDS, norm, buildIndex, matchTeam, mapEvent, leagueEvents, statusOf: (s) => s, clearCache };
});
