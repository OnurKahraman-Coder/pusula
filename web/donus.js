'use strict';
/* Pusula — DÖNÜŞ MERKEZİ
 * Kanıta dayalı tasarım (analiz/surpriz W1–W6, curutucu doğrulamaları):
 *  - Maç öncesi İY/MS dönüş oranları (Nesine %32, UK %23 marj) zararda; sıralama sadece "en olası" gösterir.
 *  - Gerçek bilgi anı İLK YARI SONU: favori gerideyse dönüş ihtimali %8–38'e çıkar (155b maç tablosu).
 *  - Bu modül: canlı skorları (ESPN, geniş lig listesi) maç öncesi Nesine oranlarıyla eşler, İY sonunda
 *    favori gerideyse uyarır/bildirir, kullanıcının seçimlerini canlı takip eder ve sonuçlandırır.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const pad = (n) => String(n).padStart(2, '0');
  const f2 = (x) => (x > 1 ? (+x).toFixed(2) : '—');

  const SLUGS = ['all', 'tur.1', 'eng.1', 'eng.2', 'eng.3', 'eng.4', 'ger.1', 'ger.2', 'esp.1', 'esp.2', 'fra.1', 'fra.2', 'ita.1', 'ita.2',
    'ned.1', 'ned.2', 'bel.1', 'por.1', 'gre.1', 'sco.1', 'sco.2', 'den.1', 'aut.1', 'sui.1', 'swe.1', 'nor.1', 'cyp.1', 'isr.1',
    'arg.1', 'bra.1', 'mex.1', 'usa.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf'];

  const D = { nes: [], live: [], tab: 'canli', notified: st.get('pz_notified', {}), ht: st.get('pz_ht', {}), at: null, busy: false };

  /* ---------------- ad eşleme ---------------- */
  const TR = { 'ı': 'i', 'İ': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c' };
  const STOP = new Set(['fc', 'sk', 'if', 'bk', 'fk', 'sc', 'cf', 'ac', 'as', 'afc', 'cd', 'club', 'de', 'the', 'united', 'city', 'spor', 'kulubu', 'c', 'f', 'u']);
  function toks(s) {
    return String(s || '').replace(/[ıİşğüöç]/gi, (c) => TR[c.toLowerCase()] || c).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
  }
  function sim(a, b) {
    const A = toks(a), B = toks(b);
    for (const x of A) for (const y of B) if (x === y || (x.length >= 5 && y.length >= 5 && x.slice(0, 5) === y.slice(0, 5))) return 1;
    return 0;
  }
  function matchNes(ev) {
    let best = null;
    for (const n of D.nes) {
      if (n.esd && Math.abs(n.esd - ev.t) > 20 * 60e3) continue;
      const s = sim(n.home, ev.home) + sim(n.away, ev.away);
      if (s >= 2 && (!best || s > best.s)) best = { s, n }; // iki takım da eşleşmeli
    }
    return best && best.n;
  }

  /* ---------------- dönüş olasılığı (doğrulanmış tablo) ---------------- */
  // favori İY'de geride → kazanma %: bant (<1.30, <1.50, ≤1.65, >1.65) × fark (1 / 2+)
  const BASE = [[38, 17], [27, 11], [21, 8], [15, 5]];
  function rate(favOdds, deficit, min, favRed, oppRed) {
    const band = favOdds < 1.3 ? 0 : favOdds < 1.5 ? 1 : favOdds <= 1.65 ? 2 : 3;
    let r = BASE[band][deficit >= 2 ? 1 : 0];
    const pts = [[45, 1], [60, 0.73], [75, 0.54], [85, 0.22], [90, 0.05]];
    let f = 1;
    for (let k = 1; k < pts.length; k++) {
      if (min <= pts[k][0]) { const [a0, f0] = pts[k - 1], [a1, f1] = pts[k]; f = f0 + (f1 - f0) * Math.max(0, min - a0) / (a1 - a0); break; }
      f = pts[k][1];
    }
    let red = '';
    if (oppRed > favRed) { f *= 1.6; red = 'rakip 10 kişi'; } else if (favRed > oppRed) { f *= 0.2; red = 'favori 10 kişi'; }
    return { p: Math.max(1, Math.min(70, Math.round(r * f))), red, approx: band === 3 };
  }

  /* ---------------- veri ---------------- */
  async function loadNes() {
    try {
      const r = await fetch('data/nesine-surpriz.json?t=' + Date.now(), { cache: 'no-store' });
      const j = r.ok ? await r.json() : { matches: [] };
      D.nes = j.matches || []; D.nesAt = j.fetchedAt;
    } catch (_) { D.nes = []; }
  }
  const dstr = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  async function getJ(url, ms) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 9000);
    try { const r = await fetch(url, { signal: c.signal, cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (_) { return null; } finally { clearTimeout(t); }
  }
  async function loadLive() {
    const now = new Date(), days = [dstr(now)];
    if (now.getHours() < 4) { const y = new Date(now - 864e5); days.push(dstr(y)); }
    const jobs = [];
    for (const s of SLUGS) for (const d of days) jobs.push(getJ(`https://site.api.espn.com/apis/site/v2/sports/soccer/${s}/scoreboard?dates=${d}`).then((j) => ({ s, j })));
    const seen = new Map();
    for (const { s, j } of await Promise.all(jobs)) {
      for (const e of (j && j.events) || []) {
        if (seen.has(e.id)) { if (s !== 'all' && !seen.get(e.id).slug) seen.get(e.id).slug = s; continue; }
        const c = (e.competitions || [])[0] || {}; const cs = c.competitors || [];
        const h = cs.find((x) => x.homeAway === 'home') || {}, a = cs.find((x) => x.homeAway === 'away') || {};
        const ty = (e.status && e.status.type) || {};
        const slug = (c.league && c.league.slug) || (e.league && e.league.slug) || (s === 'all' ? ((e.uid || '').match(/l:(\d+)/) || [])[1] : s);
        seen.set(e.id, {
          id: e.id, slug: s === 'all' ? null : s, t: Date.parse(e.date), home: (h.team || {}).displayName || '', away: (a.team || {}).displayName || '',
          hid: (h.team || {}).id, aid: (a.team || {}).id, hg: +h.score || 0, ag: +a.score || 0,
          state: ty.state, name: ty.name || '', period: (e.status || {}).period || 0, clock: (e.status || {}).displayClock || '',
          lh: h.linescores && h.linescores[0] ? +h.linescores[0].value : null, la: a.linescores && a.linescores[0] ? +a.linescores[0].value : null,
          rh: (c.details || []).filter((x) => x.redCard && x.team && x.team.id === (h.team || {}).id).length,
          ra: (c.details || []).filter((x) => x.redCard && x.team && x.team.id === (a.team || {}).id).length,
          lig: s === 'all' ? '' : s, _s: slug,
        });
      }
    }
    D.live = [...seen.values()];
    D.at = new Date();
  }
  // İY skoru: linescores → önbellek → (İY'de/devrede) anlık skor → gerekiyorsa summary golleri
  async function htScore(ev) {
    if (ev.lh != null && ev.la != null && ev.period >= 2) return [ev.lh, ev.la];
    if (D.ht[ev.id]) return D.ht[ev.id];
    if (ev.name === 'STATUS_HALFTIME') { D.ht[ev.id] = [ev.hg, ev.ag]; st.set('pz_ht', D.ht); return D.ht[ev.id]; }
    if (ev.period < 2 && ev.state === 'in') return null;
    if (ev.state === 'pre') return null;
    if (!ev.slug) return null; // summary için lig kodu gerek
    const s = await getJ(`https://site.api.espn.com/apis/site/v2/sports/soccer/${ev.slug}/summary?event=${ev.id}`);
    if (!s) return null;
    let h = 0, a = 0;
    for (const k of s.keyEvents || []) {
      if (!/goal/i.test((k.type && k.type.text) || '') || !(k.period && k.period.number === 1)) continue;
      const tid = k.team && k.team.id;
      if (tid === ev.hid) h++; else if (tid === ev.aid) a++;
    }
    D.ht[ev.id] = [h, a]; st.set('pz_ht', D.ht);
    return D.ht[ev.id];
  }
  const res = (x, y) => (x > y ? '1' : x < y ? '2' : 'X');
  const minuteOf = (ev) => { if (ev.name === 'STATUS_HALFTIME') return 45; const m = String(ev.clock).match(/^(\d+)/); return m ? +m[1] : ev.period >= 2 ? 60 : 30; };

  /* ---------------- canlı durum + bildirim ---------------- */
  async function enrich() {
    const out = [];
    for (const ev of D.live) {
      const n = matchNes(ev);
      ev.nes = n || null;
      if (!n || !n.ms) continue;
      const homeFav = n.ms[0] <= n.ms[2]; const favOdds = Math.min(n.ms[0], n.ms[2]);
      ev.homeFav = homeFav; ev.favOdds = favOdds; ev.favKey = homeFav ? '2/1' : '1/2';
      ev.favName = homeFav ? ev.home : ev.away;
      if (ev.state === 'in' || ev.state === 'post') {
        const fg = homeFav ? ev.hg : ev.ag, og = homeFav ? ev.ag : ev.hg;
        if (ev.state === 'in' && fg < og) {
          const R = rate(favOdds, og - fg, minuteOf(ev), homeFav ? ev.rh : ev.ra, homeFav ? ev.ra : ev.rh);
          ev.alert = { ...R, deficit: og - fg };
          out.push(ev);
        }
      }
    }
    out.sort((a, b) => b.alert.p - a.alert.p);
    D.alerts = out;
  }
  function notify(key, title, body) {
    if (D.notified[key]) return;
    D.notified[key] = Date.now(); st.set('pz_notified', D.notified);
    try { if (window.Notification && Notification.permission === 'granted') new Notification(title, { body, icon: 'icon-192.png', tag: key }); } catch (_) {}
    const t = document.getElementById('toast'); if (t) { t.textContent = title + ' — ' + body; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 6000); }
  }
  async function checkNotify() {
    for (const ev of D.alerts || []) {
      if (ev.name === 'STATUS_HALFTIME' || (ev.period === 2 && minuteOf(ev) <= 50)) {
        notify('ht:' + ev.id, `🔴 İY: ${ev.favName} geride`, `${ev.home} ${ev.hg}-${ev.ag} ${ev.away} · favori ${f2(ev.favOdds)} · tarihsel dönüş %${ev.alert.p} → ${ev.favKey}`);
      }
      if (ev.alert.red === 'rakip 10 kişi') notify('red:' + ev.id, `🟥 ${ev.favName} geride, rakip 10 kişi`, `${ev.hg}-${ev.ag} ${ev.clock} · dönüş %${ev.alert.p}`);
    }
    for (const p of picks()) {
      const ev = findEv(p); if (!ev) continue;
      const ht = await htScore(ev); if (!ht) continue;
      const need = p.sec[0];
      if (res(ht[0], ht[1]) === need) notify('pk:' + p.k, `✅ İY tuttu: ${p.home}–${p.away}`, `İY ${ht[0]}-${ht[1]} · ${p.sec} için şimdi ${p.sec[2] === '1' ? p.home : p.away} kazanmalı`);
      else if (ev.period >= 2 || ev.state === 'post') notify('pkx:' + p.k, `❌ İY tutmadı: ${p.home}–${p.away}`, `İY ${ht[0]}-${ht[1]} · ${p.sec} yandı`);
    }
  }

  /* ---------------- seçimlerim ---------------- */
  const picks = () => st.get('pz_picks', []);
  const savePicks = (a) => st.set('pz_picks', a);
  function addPick(n, sec) {
    const a = picks(); const k = n.id + ':' + sec;
    if (a.some((p) => p.k === k)) return toast('Zaten listede');
    const oran = sec === '1/2' ? n.iyms[2] : n.iyms[6];
    const pm = sec === n.favKey ? n.pFavCb : n.pDogCb;
    a.push({ k, id: n.id, home: n.home, away: n.away, lig: n.lig, d: n.d, t: n.t, esd: n.esd, sec, oran, pm, ms: n.ms, at: Date.now() });
    savePicks(a); toast(`Eklendi: ${n.home}–${n.away} ${sec} @${oran}`); render();
  }
  function toast(m) { const t = document.getElementById('toast'); if (t) { t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); } }
  function findEv(p) {
    return D.live.find((ev) => Math.abs(ev.t - p.esd) <= 20 * 60e3 && sim(p.home, ev.home) + sim(p.away, ev.away) >= 2);
  }
  async function settle() {
    const a = picks(); let ch = false;
    for (const p of a) {
      if (p.out) continue;
      const ev = findEv(p); if (!ev || ev.state !== 'post') continue;
      const ht = await htScore(ev); if (!ht) continue;
      p.ht = ht; p.ft = [ev.hg, ev.ag]; p.out = res(ht[0], ht[1]) + '/' + res(ev.hg, ev.ag); ch = true;
    }
    if (ch) savePicks(a);
  }

  /* ---------------- görünüm ---------------- */
  const P = (x) => '%' + (x * 100).toFixed(1);
  function head() {
    const perm = window.Notification ? Notification.permission : 'yok';
    const bt = perm === 'granted' ? '<span class="dz-ok">🔔 bildirim açık</span>' : perm === 'yok' ? '<span class="dz-mut">bu tarayıcı bildirim desteklemiyor</span>' : '<button class="dz-btn" id="dzNotif">🔔 Bildirimleri aç</button>';
    const tb = (k, l) => `<button data-dz="${k}" class="${D.tab === k ? 'on' : ''}">${l}</button>`;
    return `<div class="dz-top"><div class="fnav">${tb('canli', '🔴 Canlı İY')}${tb('secim', '⭐ Seçimlerim')}${tb('once', '📋 Maç öncesi')}</div>${bt}
      <div class="dz-mut">${D.at ? 'canlı ' + pad(D.at.getHours()) + ':' + pad(D.at.getMinutes()) + ' · ' : ''}${D.live.length} maç · Nesine eşleşen ${D.live.filter((e) => e.nes).length} · 60 sn'de yenilenir (uygulama açıkken)</div></div>`;
  }
  function vCanli() {
    let h = `<div class="guyar"><b>Ne zaman bakmalı?</b> Maç öncesi İY/MS dönüş oranları Nesine'de %32, UK'de %23 marjlı; 295 UK + 527 Nesine maçında kenar bulunamadı. Bilgi <b>ilk yarı sonunda</b> doğar: favori gerideyse dönüş ihtimali %8–38'e çıkar. Bu ekran onu yakalar. Değerini görmek için o anki <b>canlı MS oranıyla</b> kıyasla: canlı oran > 100 / % ise değer var.</div>`;
    const A = D.alerts || [];
    if (!A.length) h += '<div class="empty">Şu an Nesine favorisinin geride olduğu canlı maç yok.</div>';
    for (const ev of A) {
      const be = (100 / ev.alert.p).toFixed(2);
      h += `<div class="gcard dz-al"><div class="gtop"><span class="badge-live">${esc(ev.name === 'STATUS_HALFTIME' ? 'DEVRE' : ev.clock)}</span><span class="gbadge don">${ev.favKey} ADAYI</span>${ev.alert.red ? `<span class="gbadge kural">${ev.alert.red}</span>` : ''}</div>
        <div class="gteams">${esc(ev.home)} <b>${ev.hg}-${ev.ag}</b> ${esc(ev.away)}</div>
        <div class="gleague">${esc(ev.nes.lig || '')} · Nesine MS ${ev.nes.ms.map(f2).join(' / ')}</div>
        <div class="gstats"><span>${esc(ev.favName)} dönüp kazanır <b>%${ev.alert.p}</b>${ev.alert.approx ? ' (zayıf favori, yaklaşık)' : ''}</span><span>canlı ${esc(ev.favName)} oranı <b>&gt; ${be}</b> ise değer</span><span class="gsub">maç öncesi ${ev.favKey}: ${f2(ev.favKey === '1/2' ? ev.nes.iyms[2] : ev.nes.iyms[6])}</span></div></div>`;
    }
    return h;
  }
  function vSecim() {
    const a = picks();
    let h = '';
    const done = a.filter((p) => p.out), win = done.filter((p) => p.out === p.sec);
    const pl = done.reduce((s, p) => s + (p.out === p.sec ? p.oran - 1 : -1), 0);
    const exp = done.reduce((s, p) => s + (p.pm || 0), 0);
    h += `<div class="guyar"><b>Karne:</b> ${done.length} sonuçlanan · ${win.length} tuttu (model beklentisi ${exp.toFixed(1)}) · 1'er birimle kâr/zarar <b>${pl >= 0 ? '+' : ''}${pl.toFixed(1)}</b> birim. ${done.length < 100 ? 'Kalıcı bir sonuç için ~100+ seçim gerekir.' : ''}<br>Seçim eklemek için <b>📋 Maç öncesi</b> sekmesinde maçın yanındaki 1/2 veya 2/1'e bas.</div>`;
    if (!a.length) return h + '<div class="empty">Henüz seçim yok.</div>';
    h += '<div class="glist">';
    for (const p of a.slice().sort((x, y) => y.esd - x.esd)) {
      const ev = findEv(p);
      let durum = '<span class="dz-mut">başlamadı</span>';
      if (p.out) durum = p.out === p.sec ? `<b class="dz-ok">✅ TUTTU</b> İY ${p.ht.join('-')} · MS ${p.ft.join('-')} · +${(p.oran - 1).toFixed(2)}` : `<b class="dz-x">❌</b> İY ${p.ht.join('-')} · MS ${p.ft.join('-')} (${p.out})`;
      else if (ev && ev.state === 'in') {
        const ht = D.ht[ev.id]; const need = p.sec[0], fin = p.sec[2];
        let tx = `CANLI ${ev.hg}-${ev.ag} ${esc(ev.clock)}`;
        if (ev.period >= 2 && ht) {
          tx += res(ht[0], ht[1]) === need ? ` · İY ${ht.join('-')} ✓ → ${fin === '1' ? esc(p.home) : esc(p.away)} kazanmalı` : ` · İY ${ht.join('-')} ✗ yandı`;
          if (res(ht[0], ht[1]) === need && ev.homeFav != null && (p.sec === ev.favKey) && ev.alert) tx += ` · şu an dönüş %${ev.alert.p}`;
        } else if (ev.period < 2) tx += ` · İY için ${need === '1' ? esc(p.home) : esc(p.away)} önde olmalı`;
        durum = tx;
      } else if (!ev && p.esd < Date.now()) {
        durum = `<span class="dz-mut">canlı skor kaynağı yok — sonucu elle gir:</span> <input class="dz-in" data-k="${esc(p.k)}" placeholder="İY 1-0 MS 2-1" size="12"><button class="dz-btn dz-man" data-k="${esc(p.k)}">kaydet</button>`;
      }
      h += `<div class="gcard ncard"><div class="gtop"><span class="gtime">${esc((p.d || '').slice(0, 5))} ${esc(p.t || '')}</span><span class="gbadge don">${p.sec} @${f2(p.oran)}</span><button class="dz-del" data-k="${esc(p.k)}" title="sil">✕</button></div>
        <div class="gteams">${esc(p.home)} – ${esc(p.away)}</div><div class="gleague">${esc(p.lig || '')} · model ${p.pm ? P(p.pm) : '—'} · başabaş ${p.pm ? (1 / p.pm).toFixed(1) : '—'}</div>
        <div class="gstats"><span>${durum}</span></div></div>`;
    }
    return h + '</div>';
  }
  function vOnce() {
    const q = (D.q || '').toLowerCase();
    const now = Date.now();
    const L = D.nes.filter((m) => m.iyms && (!m.esd || m.esd > now - 30 * 60e3) && (!q || (m.home + ' ' + m.away + ' ' + m.lig).toLowerCase().includes(q)))
      .sort((a, b) => b.pFavCb - a.pFavCb).slice(0, q ? 80 : 50);
    let h = `<div class="guyar">Nesine bülteni${D.nesAt ? ' (' + new Date(D.nesAt).toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' }) + ')' : ''}, dönüş ihtimaline göre. <b>Uyarı:</b> beklenen getiri neredeyse her maçta eksi; buradan seçip ⭐ listene ekle, sistem İY'de takip edip bildirir ve sonuçlandırır.</div>
      <input type="text" class="q" id="dzQ" placeholder="takım / lig ara…" value="${esc(D.q || '')}">`;
    h += '<div class="glist">';
    for (const m of L) {
      const ev = (x, o) => (o ? Math.round((x * o - 1) * 100) : null);
      const o12 = m.iyms[2], o21 = m.iyms[6];
      const p12 = m.favKey === '1/2' ? m.pFavCb : m.pDogCb, p21 = m.favKey === '2/1' ? m.pFavCb : m.pDogCb;
      const btn = (sec, o, p) => `<button class="dz-btn dz-add" data-id="${m.id}" data-s="${sec}">+ ${sec} @${f2(o)} <small>${P(p)} · ${ev(p, o) >= 0 ? '+' : ''}${ev(p, o)}%</small></button>`;
      h += `<div class="gcard ncard"><div class="gtop"><span class="gtime">${esc((m.d || '').slice(0, 5))} ${esc(m.t || '')}</span>${m.kural ? `<span class="gbadge kural">TAVAN ${m.kural.secim}</span>` : ''}</div>
        <div class="gteams">${esc(m.home)} – ${esc(m.away)}</div><div class="gleague">${esc(m.lig)} · MS ${(m.ms || []).map(f2).join(' / ')}${m.ou ? ' · 2,5Ü ' + f2(m.ou[1]) : ''}</div>
        <div class="gstats">${btn('2/1', o21, p21)}${btn('1/2', o12, p12)}</div></div>`;
    }
    return h + '</div>';
  }
  function render() {
    const out = document.getElementById('donusOut'); if (!out) return;
    out.innerHTML = head() + (D.tab === 'canli' ? vCanli() : D.tab === 'secim' ? vSecim() : vOnce());
  }
  function bind() {
    const out = document.getElementById('donusOut'); if (!out || out._b) return; out._b = 1;
    out.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dz) { D.tab = b.dataset.dz; render(); return; }
      if (b.id === 'dzNotif') { try { await Notification.requestPermission(); } catch (_) {} render(); return; }
      if (b.classList.contains('dz-add')) { const n = D.nes.find((x) => String(x.id) === b.dataset.id); if (n) addPick(n, b.dataset.s); return; }
      if (b.classList.contains('dz-del')) { if (confirm('Seçim silinsin mi?')) { savePicks(picks().filter((p) => p.k !== b.dataset.k)); render(); } return; }
      if (b.classList.contains('dz-man')) {
        const inp = out.querySelector(`.dz-in[data-k="${CSS.escape(b.dataset.k)}"]`); const m = (inp.value.match(/(\d+)\D+(\d+)\D+(\d+)\D+(\d+)/) || []);
        if (!m[4]) return toast('Biçim: İY 1-0 MS 2-1');
        const a = picks(); const p = a.find((x) => x.k === b.dataset.k);
        p.ht = [+m[1], +m[2]]; p.ft = [+m[3], +m[4]]; p.out = res(+m[1], +m[2]) + '/' + res(+m[3], +m[4]); p.manual = 1;
        savePicks(a); render();
      }
    });
    out.addEventListener('input', (e) => { if (e.target.id === 'dzQ') { D.q = e.target.value; clearTimeout(D._qt); D._qt = setTimeout(() => { render(); const i = document.getElementById('dzQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } });
  }
  async function tick() {
    if (D.busy) return; D.busy = true;
    try {
      if (!D.nes.length || !D._nt || Date.now() - D._nt > 15 * 60e3) { await loadNes(); D._nt = Date.now(); }
      await loadLive(); await enrich(); await checkNotify(); await settle();
      if (!document.getElementById('donusPane').hidden && !(document.activeElement && document.activeElement.classList.contains('dz-in'))) render();
    } finally { D.busy = false; }
  }
  window.PusulaDonus = {
    show() { bind(); render(); tick(); },
    start() { tick(); setInterval(() => { if (!document.hidden) tick(); }, 60000); },
    _D: D, _rate: rate, _sim: sim,
  };
})();
