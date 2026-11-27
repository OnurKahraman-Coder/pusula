/**
 * Nesine bülteni → İY/MS sürpriz (1/2, 2/1) adayları + ileriye dönük kayıt.
 *
 * Kaynak: bulten.nesine.com (halka açık bülten JSON'u). Piyasa kodları:
 *   MTID 1 = MS 1X2, MTID 5 = İY/MS (N1..9 = 1/1,1/X,1/2,X/1,X/X,X/2,2/1,2/X,2/2),
 *   MTID 7 = İY 1X2, MTID 12 SOV 2.5 = 2,5 Alt(N1)/Üst(N2).
 *
 * Model (analiz/surpriz/W1, 172 bin Maçkolik/Nesine maçı, zaman bölmeli test, curutucu: KISMEN):
 *   favori-dönüşü  logit = −4.5381 + 0.2851·pF + 1.7637·pO   (AUC ~0.55, üst dilim ≈ tabanın 1.3 katı)
 *   zayıf-dönüşü   logit = −3.5887 − 3.3108·pF + 2.2448·pO   (AUC ~0.59)
 * pF = marjı temizlenmiş favori kazanma olasılığı, pO = marjı temizlenmiş 2,5 üst olasılığı.
 * DÜRÜST NOT: Bu oranlarla bahsin kâr ettiği KANITLANMADI (İY/MS oran arşivi yoktu). Bu modül o arşivi
 * bundan sonra biriktirir (data/nesine/YYYY-MM-DD.json); sonuçlar gelince kural/model gerçek oranla test edilir.
 */
const URL = 'https://bulten.nesine.com/api/bulten/getprebultenfull';
const IYMS_KEYS = ['1/1', '1/X', '1/2', 'X/1', 'X/X', 'X/2', '2/1', '2/X', '2/2'];
const CAP = 34; // İddaa'da İY/MS dönüş oranları çoğunlukla 34–34,5'te tavan yapar

const sig = (x) => 1 / (1 + Math.exp(-x));

function market(e, mtid, sov) {
  const m = (e.MA || []).find((x) => x.MTID === mtid && (sov == null || Number(x.SOV) === sov));
  if (!m || !m.OCA) return null;
  return m.OCA.slice().sort((a, b) => a.N - b.N).map((o) => (o.O > 1 ? o.O : null)); // 1 = kapalı
}

/** Tek maç için model ve kural hesabı (Nesine oranlarından). */
function score(ms, ou, iyms) {
  if (!ms || !ms[0] || !ms[1] || !ms[2]) return null;
  const r = ms.map((o) => 1 / o), s = r[0] + r[1] + r[2];
  const pH = r[0] / s, pA = r[2] / s;
  const homeFav = pH >= pA, pF = Math.max(pH, pA);
  let pO = null;
  if (ou && ou[0] && ou[1]) pO = (1 / ou[1]) / (1 / ou[0] + 1 / ou[1]);
  const po = pO == null ? 0.5 : pO; // 2,5 yoksa nötr kabul
  const pFavCb = sig(-4.5381 + 0.2851 * pF + 1.7637 * po);
  const pDogCb = sig(-3.5887 - 3.3108 * pF + 2.2448 * po);
  const favKey = homeFav ? '2/1' : '1/2'; // favori ev sahibiyse dönüşü 2/1'dir
  const dogKey = homeFav ? '1/2' : '2/1';
  const o12 = iyms ? iyms[2] : null, o21 = iyms ? iyms[6] : null;
  const oFav = homeFav ? o21 : o12, oDog = homeFav ? o12 : o21;
  // Kullanıcı kuralı: iki dönüş oranından biri tavanda (34+), diğeri altında → düşük olan "gelir" iddiası
  let kural = null;
  if (o12 && o21) {
    const lo = Math.min(o12, o21), hi = Math.max(o12, o21);
    if (hi >= CAP && lo < CAP) kural = { secim: o12 < o21 ? '1/2' : '2/1', oran: lo };
  }
  return {
    pF: +pF.toFixed(3), pO: pO == null ? null : +pO.toFixed(3), homeFav,
    favKey, dogKey, pFavCb: +pFavCb.toFixed(4), pDogCb: +pDogCb.toFixed(4),
    oFav, oDog, bbFav: +(1 / pFavCb).toFixed(1), bbDog: +(1 / pDogCb).toFixed(1), kural,
  };
}

async function fetchNesine(opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 45000);
  const r = await fetch(URL, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  clearTimeout(t);
  if (!r.ok) throw new Error('nesine HTTP ' + r.status);
  const j = await r.json();
  const leagues = new Map(((j.sg && j.sg.LA) || []).map((l) => [l.LID, l.N]));
  const out = [];
  for (const e of (j.sg && j.sg.EA) || []) {
    if (e.TYPE !== 1 || !e.HN || !e.AN) continue;
    const iyms = market(e, 5);
    if (!iyms) continue; // sürpriz için İY/MS şart
    const ms = market(e, 1), iy = market(e, 7), ou = market(e, 12, 2.5);
    const sc = score(ms, ou, iyms);
    if (!sc) continue;
    out.push({
      id: e.C, ev: e.EV, kod: e.C, home: e.HN, away: e.AN, lig: leagues.get(e.LC) || '', d: e.D, t: e.T, esd: e.ESD,
      ms, iy, ou, iyms, ...sc,
    });
  }
  out.sort((a, b) => a.esd - b.esd);
  return { fetchedAt: new Date().toISOString(), count: out.length, matches: out };
}

/** Günlük arşive ekle (aynı maçın son anlık görüntüsü + ilk görülen oranlar). */
function archive(dir, data) {
  const fs = require('fs'), path = require('path');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const f = path.join(dir, day + '.json');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { old = {}; }
  for (const m of data.matches) {
    const k = String(m.id);
    const row = { h: m.home, a: m.away, l: m.lig, d: m.d, t: m.t, ms: m.ms, iy: m.iy, ou: m.ou, iyms: m.iyms, at: data.fetchedAt };
    if (!old[k]) old[k] = { ilk: row, son: row };
    else old[k].son = row;
  }
  fs.writeFileSync(f, JSON.stringify(old));
  return Object.keys(old).length;
}

module.exports = { fetchNesine, archive, score, IYMS_KEYS, CAP };
