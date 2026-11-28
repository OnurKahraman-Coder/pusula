/**
 * Trendyol 1. Lig güncel sezon: TFF (tff.org) fikstür + maç sayfaları -> data/raw/<sezon>/T2.csv
 *  - Fikstür (pageID=142): tüm sezonun maçları, kulüp kimliği (kulupId) ve skor
 *  - Maç sayfası (pageId=29&macId=): tarih/saat ve gol dakikaları -> İY skoru
 *    (sayfalar data/raw/tff-t2.json'da önbelleklenir; her çalışmada yalnız yeni bitenler çekilir)
 *  - Oran: data/raw/t2-oran.json (Maçkolik arşivi, 08.11.2026'ya kadar) + data/nesine/*.json (Nesine kapanışa yakın)
 * Geçmiş sezonlar Maçkolik arşivinden: tools/t2-seed.py (tek seferlik).
 * Kullanım: node tools/tr1lig.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const CACHE = path.join(RAW, 'tff-t2.json');
const KULUP = path.join(RAW, 'tff-kulup.json'); // kulupId -> sistem adı
const BASE = 'https://www.tff.org/';
const UA = 'Mozilla/5.0 (compatible; Pusula/2.3; +https://github.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tools/t2names.py ile aynı kural
const FOLD = { 'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ü': 'u', 'Ü': 'U', 'ö': 'o', 'Ö': 'O', 'ç': 'c', 'Ç': 'C', 'â': 'a', 'Â': 'A' };
const SPECIAL = {
  'F. Karagümrük': 'Karagumruk', 'Ç. Rizespor': 'Rizespor', 'Çorum FK': 'Corum', 'Erzurumspor FK': 'Erzurum BB',
  'Amed SK': 'Amedspor', 'Ankaraspor': 'Ankaraspor AS', 'Beykoz A.Ş.': 'Beykoz', 'Göztepe': 'Goztepe',
};
const canon = (n) => SPECIAL[n.trim()] || n.trim().replace(/[ıİşŞğĞüÜöÖçÇâÂ]/g, (c) => FOLD[c]);
// eşleştirme anahtarı: küçük harf, Türkçe harf katlanmış, kulüp/sponsor ekleri atılmış kelimeler
const key = (n) => canon(n).toLowerCase().replace(/\b(a\.?s|fk|sk|spor|kulubu|futbol|fc|as)\b/g, ' ')
  .replace(/spor\b/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal }); clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return new TextDecoder('windows-1254').decode(Buffer.from(await r.arrayBuffer()));
    } catch (e) { if (i === 2) throw e; await sleep(3000); }
  }
}

function parseFixture(html) {
  const re = /kulupId=(\d+)">([^<]+)<\/a><\/td>\s*<td[^>]*><a href="\/Default\.aspx\?pageID=29&macId=(\d+)">([^<]*)<\/a><\/td>\s*<td[^>]*><a href="\/Default\.aspx\?pageID=28&kulupId=(\d+)">([^<]+)</g;
  const out = new Map(); let m;
  while ((m = re.exec(html))) {
    const s = m[4].match(/(\d+)\s*-\s*(\d+)/);
    out.set(m[3], { id: m[3], hk: m[1], hn: m[2].trim(), ak: m[5], an: m[6].trim(), hg: s ? +s[1] : null, ag: s ? +s[2] : null });
  }
  return [...out.values()];
}

function parseMatch(html) {
  const tm = html.match(/lblTarih">(\d{1,2})\.(\d{1,2})\.(\d{4})\s*-\s*(\d{1,2}:\d\d)/);
  const goals = [1, 2].map((k) => [...html.matchAll(new RegExp(`grdTakim${k}_rptGoller_ctl\\d+_lblGol"[^>]*>([^<]+)<`, 'g'))]
    .map((x) => { const d = x[1].match(/,(\d+)(?:\+\d+)?\.dk/); return d ? +d[1] : 999; }));
  const s1 = html.match(/lblTakim1Skor">(\d+)</), s2 = html.match(/dtMacBilgisi_Label12">(\d+)</);
  return {
    d: tm ? `${tm[3]}-${tm[2].padStart(2, '0')}-${tm[1].padStart(2, '0')}` : null, t: tm ? tm[4].padStart(5, '0') : '',
    hg: s1 ? +s1[1] : null, ag: s2 ? +s2[1] : null,
    hh: goals[0].filter((x) => x <= 45).length, ha: goals[1].filter((x) => x <= 45).length,
    g1: goals[0].length, g2: goals[1].length, gn: goals[0].length + goals[1].length, bad: goals.flat().some((x) => x === 999),
  };
}

function nesineOdds(names) {
  // data/nesine/*.json: { id: { ilk, son: {h,a,l,d,t,ms,ou=[alt,üst]} } }
  const dir = path.join(ROOT, 'data', 'nesine'), out = new Map();
  if (!fs.existsSync(dir)) return out;
  const byKey = names.map((n) => [n, key(n)]);
  const find = (nm) => {
    const k = key(nm); let best = null, bs = 0;
    for (const [n, kk] of byKey) {
      const s = k.filter((w) => kk.some((v) => v === w || (Math.min(v.length, w.length) >= 4 && (v.startsWith(w) || w.startsWith(v))))).length;
      if (s > bs) { bs = s; best = n; }
    }
    return bs ? best : null;
  };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const v of Object.values(j)) {
      const s = v.son || v.ilk;
      if (!s || s.l !== 'Türkiye 1. Lig' || !s.ms) continue;
      const h = find(s.h), a = find(s.a);
      if (!h || !a) continue;
      const [dd, mm, yy] = s.d.split('.');
      out.set(`${yy}-${mm}-${dd}|${h}|${a}`, [s.ms[0], s.ms[1], s.ms[2], s.ou ? s.ou[1] : null, s.ou ? s.ou[0] : null]);
    }
  }
  return out;
}

async function refresh({ log = () => {} } = {}) {
  const fx = parseFixture(await get(BASE + 'default.aspx?pageID=142'));
  if (fx.length < 100) throw new Error(`fikstür okunamadı (${fx.length} maç)`);
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const kulup = fs.existsSync(KULUP) ? JSON.parse(fs.readFileSync(KULUP, 'utf8')) : {};
  let fetched = 0;
  for (const m of fx) {
    if (m.hg == null) continue;
    const c = cache[m.id];
    if (c && c.hg === m.hg && c.ag === m.ag && c.d && c.g1 != null) continue;
    try { cache[m.id] = parseMatch(await get(`${BASE}Default.aspx?pageId=29&macId=${m.id}`)); fetched++; } catch (e) { log(`maç ${m.id}: ${e.message}`); }
    await sleep(700);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));

  const nameOf = (k, n) => kulup[k] || canon(n.replace(/\b(A\.Ş\.|FUTBOL KULÜBÜ|KULÜBÜ|FUTBOL A\.Ş\.)/g, '').trim());
  const unknown = new Set(fx.flatMap((m) => [[m.hk, m.hn], [m.ak, m.an]]).filter(([k]) => !kulup[k]).map(([k, n]) => `${k}:${n}`));
  const names = [...new Set(fx.flatMap((m) => [nameOf(m.hk, m.hn), nameOf(m.ak, m.an)]))];
  const seed = fs.existsSync(path.join(RAW, 't2-oran.json')) ? JSON.parse(fs.readFileSync(path.join(RAW, 't2-oran.json'), 'utf8')) : {};
  const nes = nesineOdds(names);

  const rows = []; let odds = 0, ht = 0, yr = 0;
  for (const m of fx) {
    const c = cache[m.id];
    if (m.hg == null || !c || !c.d) continue;
    const h = nameOf(m.hk, m.hn), a = nameOf(m.ak, m.an);
    const k = `${c.d}|${h}|${a}`;
    const o = seed[k] || nes.get(k) || [];
    if (o.length) odds++;
    // TFF kendi kalesine golü atanın takımı altında listeler: takım başına sayı skorla tutmazsa İY boş bırakılır
    const htOk = !c.bad && c.g1 === m.hg && c.g2 === m.ag;
    // TFF İY'si güvenilmezse Maçkolik arşivindeki İY skoru (varsa) kullanılır
    const sh = seed[k] && seed[k][5] != null ? [seed[k][5], seed[k][6]] : null;
    const H = htOk ? [c.hh, c.ha] : sh || ['', ''];
    if (H[0] !== '') ht++;
    const [y, mo, d] = c.d.split('-'); yr = Math.max(yr, mo >= 7 ? +y : +y - 1);
    const f = (v) => (v && v > 1 ? v : '');
    rows.push(['T2', `${d}/${mo}/${y}`, c.t, h, a, m.hg, m.ag, m.hg > m.ag ? 'H' : m.hg < m.ag ? 'A' : 'D',
      H[0], H[1], f(o[0]), f(o[1]), f(o[2]), f(o[3]), f(o[4])].join(','));
  }
  rows.sort((x, z) => x.split(',')[1].split('/').reverse().join('').localeCompare(z.split(',')[1].split('/').reverse().join('')));
  if (!yr) throw new Error('oynanmış maç yok');
  const sc = String(yr % 100).padStart(2, '0') + String((yr + 1) % 100).padStart(2, '0');
  fs.mkdirSync(path.join(RAW, sc), { recursive: true });
  fs.writeFileSync(path.join(RAW, sc, 'T2.csv'), 'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,IDH,IDD,IDA,ID>2.5,ID<2.5\n' + rows.join('\n') + '\n');
  return { sezon: sc, mac: rows.length, iy: ht, oran: odds, yeniSayfa: fetched, bilinmeyen: [...unknown], fx };
}

module.exports = { refresh, parseFixture, parseMatch, canon };
if (require.main === module) {
  refresh({ log: console.log }).then((r) => { delete r.fx; console.log(JSON.stringify(r)); }).catch((e) => { console.error(e); process.exit(1); });
}
