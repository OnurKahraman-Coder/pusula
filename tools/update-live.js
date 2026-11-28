/**
 * Otomatik güncelleme (GitHub Actions her 6 saatte bir çalıştırır)
 * Kullanim: node tools/update-live.js
 *
 *  1) Güncel sezonun lig dosyalarını football-data.co.uk'den indirir (bwin açılış + kapanış oranları)
 *     — ulaşılamazsa İnternet Arşivi'ndeki son kopya denenir
 *  2) Veritabanını derler (tools/build.js)
 *  3) Oynanacak maçları ve bwin oranlarını indirir (fixtures.csv → data/bwin-fixtures.json)
 *  4) Günün bültenini ESPN'den çeker (data/bulletin.json)
 *
 * Bir adım başarısız olursa önceki veriyle devam edilir; site yine yayınlanır.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const DATA = path.join(ROOT, 'data');
const LEAGUES = ['T1', 'E0', 'E1', 'E2', 'D1', 'D2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'G1', 'SC0', 'SC1', 'I1', 'I2'];
const UA = 'Mozilla/5.0 (compatible; Pusula/2.3; +https://github.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (y) => String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');

async function get(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function getCsv(rel) {
  const direct = `https://www.football-data.co.uk/${rel}`;
  const sources = [direct, `https://web.archive.org/web/2id_/${direct}`];
  let last;
  for (const u of sources) {
    for (let i = 0; i < 2; i++) {
      try {
        const text = await get(u);
        if (/^﻿?Div,/.test(text)) return { text, via: u === direct ? 'football-data' : 'arşiv' };
        last = new Error('beklenmeyen içerik');
      } catch (e) { last = e; await sleep(1500); }
    }
  }
  throw last;
}

function seasonsToRefresh(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const cur = m >= 7 ? y : y - 1;
  // yaz aylarında biten sezonun son halini de al
  return m >= 6 && m <= 9 ? [cur - 1, cur] : [cur];
}

async function main() {
  const report = [];

  /* 1) güncel sezon dosyaları */
  for (const sy of seasonsToRefresh()) {
    const sc = code(sy);
    const dir = path.join(RAW, sc);
    fs.mkdirSync(dir, { recursive: true });
    let ok = 0, fail = 0;
    for (const lg of LEAGUES) {
      try {
        const { text } = await getCsv(`mmz4281/${sc}/${lg}.csv`);
        const file = path.join(dir, `${lg}.csv`);
        const oldLen = fs.existsSync(file) ? fs.statSync(file).size : 0;
        // arşivdeki eski kopya mevcut dosyadan kısaysa üzerine yazma
        if (text.length >= oldLen * 0.9) fs.writeFileSync(file, text);
        ok++;
      } catch (e) {
        fail++;
        console.log(`  ! ${sc}/${lg}: ${e.message}`);
      }
      await sleep(300);
    }
    report.push(`sezon ${sc}: ${ok} lig güncellendi${fail ? `, ${fail} hata` : ''}`);
  }

  /* 1b) ek ligler (Norveç vb.: football-data new/*.csv) */
  try {
    report.push('ek ligler: ' + await require('./extra-leagues').refresh());
  } catch (e) { report.push(`ek ligler: HATA ${e.message} (önceki veri korunur)`); }

  /* 1c) Türkiye 1. Lig güncel sezon (TFF sonuç + İY, oran Maçkolik/Nesine arşivi) */
  try {
    const r = await require('./tr1lig').refresh({ log: (x) => console.log('  ! ' + x) });
    report.push(`1. Lig: ${r.mac} maç (İY ${r.iy}, oranlı ${r.oran}, yeni sayfa ${r.yeniSayfa})${r.bilinmeyen.length ? ' · TANINMAYAN KULÜP: ' + r.bilinmeyen.join('; ') : ''}`);
  } catch (e) { report.push(`1. Lig: HATA ${e.message} (önceki veri korunur)`); }

  /* 2) derle */
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], { stdio: 'inherit' });

  const { Engine } = require('../lib/engine');
  const FX = require('../lib/fixtures');
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  const engine = new Engine(db);

  /* 3) bwin fikstür */
  try {
    const BW = require('../lib/bwfixtures');
    const p = await BW.refresh(DATA, engine, FX);
    report.push(`fikstür: ${p.count} maç, ${p.bwinCount} tanesi bwin oranlı (${p.source})`);
  } catch (e) {
    report.push(`fikstür: HATA ${e.message} (önceki liste korunur)`);
  }

  /* 4) günün bülteni (ESPN) */
  try {
    const B = require('../lib/bulletin');
    const index = FX.buildIndex(engine.teams);
    const p = await B.fetchWindow(index, { days: 8 });
    // ESPN'de olmayan Türkiye 1. Lig: yaklaşan maçlar ve oranlar Nesine bülteninden
    try {
      const nd = await require('../lib/nesine').fetchNesine();
      const pad = (n) => String(n).padStart(2, '0');
      const lim = new Date(); lim.setDate(lim.getDate() + (p.windowDays || 8));
      const t2 = nd.matches.filter((m) => m.lig === 'Türkiye 1. Lig' && m.ms && m.esd < lim.getTime()).map((m) => {
        const [dd, mm, yy] = m.d.split('.');
        return {
          id: 'nes' + m.id, league: 'T2', date: Number(yy + pad(mm) + pad(dd)), time: m.t || '',
          homeName: m.home, awayName: m.away, home: FX.matchTeam(m.home, index), away: FX.matchTeam(m.away, index),
          hg: null, ag: null, status: 'ns', raw: '', clock: '', rh: 0, ra: 0, venue: '', played: false,
          h: m.ms[0], d: m.ms[1], a: m.ms[2], o: m.ou ? m.ou[1] : 0, u: m.ou ? m.ou[0] : 0, oddsSource: 'Nesine', oddsLine: 'pre',
        };
      });
      p.matches = p.matches.concat(t2).sort((a, b) => a.date - b.date || (a.time || '').localeCompare(b.time || ''));
      p.count = p.matches.length; p.t2 = t2.length;
    } catch (e) { report.push(`bülten 1. Lig: HATA ${e.message}`); }
    B.save(DATA, p);
    report.push(`bülten: ${p.dateText}+${p.windowDays}g · ${p.count} maç (1. Lig ${p.t2 || 0})`);
  } catch (e) {
    report.push(`bülten: HATA ${e.message}`);
  }

  /* 5) gollü maç taraması (bültendeki oranlı maçları analiz et) */
  try {
    const PANEL = require('../lib/panel');
    const GOLLU = require('../lib/gollu');
    const panel = PANEL.createPanel(engine);
    const bl = JSON.parse(fs.readFileSync(path.join(DATA, 'bulletin.json'), 'utf8'));
    const today = engine.today || Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    const up = (bl.matches || []).filter((m) => m.date >= today && m.status !== 'ft');
    let euroIndex = null;
    try {
      const EURO = require('../lib/euro');
      euroIndex = await EURO.fetchEuroIndex(FX, FX.buildIndex(engine.teams), { back: 5, fwd: 9 });
    } catch (_) { euroIndex = null; }
    const list = GOLLU.scanFixtures(panel, up, euroIndex);
    const euroN = list.filter((m) => m.euroRet).length;
    fs.writeFileSync(path.join(DATA, 'gollu.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(), count: list.length, matches: list,
    }));
    const gc = list.filter((m) => m.kind).length;
    report.push(`taramalar: ${list.length} maç (${gc} gollü/kg, ${euroN} Avrupa dönüşü)`);
  } catch (e) {
    report.push(`gollü: HATA ${e.message}`);
  }

  /* 6) Nesine İY/MS sürpriz listesi + ileriye dönük oran arşivi */
  try {
    const NES = require('../lib/nesine');
    const nd = await NES.fetchNesine();
    const ws = nd.matches.filter((m) => m.oFav);
    const ev = ws.map((m) => m.pFavCb * m.oFav - 1).sort((a, b) => a - b);
    const n = ws.length;
    let kor = null;
    if (n > 10) {
      const mx = ws.reduce((s, m) => s + m.pFavCb, 0) / n, my = ws.reduce((s, m) => s + 1 / m.oFav, 0) / n;
      let sxy = 0, sx = 0, sy = 0;
      for (const m of ws) { const x = m.pFavCb - mx, y = 1 / m.oFav - my; sxy += x * y; sx += x * x; sy += y * y; }
      kor = (sxy / Math.sqrt(sx * sy)).toFixed(2).replace('.', ',');
    }
    const med = n ? ev[n >> 1] : null;
    nd.stats = { kor, deger: ev.filter((x) => x > 0).length, evMed: med == null ? null : (med >= 0 ? '+%' : '−%') + Math.abs(Math.round(med * 100)) };
    // başlamış maçlar bültenden düşer; canlı İY eşlemesi için son 8 saatte başlayanları önceki dosyadan koru
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(DATA, 'nesine-surpriz.json'), 'utf8'));
      const have = new Set(nd.matches.map((m) => m.id)), cut = Date.now() - 8 * 3600e3;
      const keep = (prev.matches || []).filter((m) => !have.has(m.id) && m.esd && m.esd > cut && m.esd < Date.now() + 3600e3);
      nd.matches = keep.concat(nd.matches); nd.kept = keep.length;
    } catch (_) { /* ilk çalışma */ }
    // Evet/Evet (İY KG + 2Y KG) adayları: KG + 2,5 oranı olan tüm Nesine maçları, Maçkolik arşivine göre
    try {
      const EV = require('../lib/evev');
      const list = EV.scan(EV.loadArchive(), nd.kgAll, { esik: 0.10 });
      const evev = { fetchedAt: nd.fetchedAt, taranan: (nd.kgAll || []).length, count: list.length, matches: list };
      fs.writeFileSync(path.join(DATA, 'evev.json'), JSON.stringify(evev));
      // ileride gerçek sonuç/oranla ölçmek için günlük kayıt (ilk görülen tahmin korunur)
      const dir = path.join(DATA, 'evev-kayit'); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, nd.fetchedAt.slice(0, 10) + '.json');
      let old = {}; try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { old = {}; }
      for (const m of list) { const k = String(m.id); const row = { h: m.home, a: m.away, l: m.lig, d: m.d, t: m.t, p: m.p, kg: m.kg, ou: m.ou, x452: m.x452, x599: m.x599, at: nd.fetchedAt }; old[k] = old[k] ? { ilk: old[k].ilk, son: row } : { ilk: row, son: row }; }
      fs.writeFileSync(f, JSON.stringify(old));
      report.push(`evet/evet: ${(nd.kgAll || []).length} maç tarandı, ${list.length} aday (arşiv olasılığı ≥%10)`);
    } catch (e) { report.push(`evet/evet: HATA ${e.message}`); }
    delete nd.kgAll;
    fs.writeFileSync(path.join(DATA, 'nesine-surpriz.json'), JSON.stringify(nd));
    const kayit = NES.archive(path.join(DATA, 'nesine'), nd);
    report.push(`nesine: ${nd.count} İY/MS'li maç · değer>0 ${nd.stats.deger} · arşiv bugün ${kayit}`);
  } catch (e) {
    report.push(`nesine: HATA ${e.message}`);
  }

  console.log('\n' + report.map((r) => '• ' + r).join('\n'));
  console.log(`son maç: ${db.matches[db.matches.length - 1][0]}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
