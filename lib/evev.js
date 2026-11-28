/**
 * Evet/Evet = 1. yarıda KG Var VE 2. yarıda KG Var (iki takım her iki yarıda da gol atar).
 * Arşiv: data/raw/evev-arsiv.csv (Maçkolik, 2025/26 + 2026/27, iddaa oranlı ~33 bin maç; tools/evev-arsiv.py).
 * Yöntem: maçın KG Var ve 2,5 Üst oranlarına (marjı temizlenmiş) EN YAKIN 400 arşiv maçında Evet/Evet sıklığı.
 * Test (2025/26 arşiviyle 2026/27'nin 9.374 maçı, örneklem dışı): taban %6,1; tahmin ≥%10 olan 501 maç → gerçek %12,0;
 * en üst %5 → %12,2 (tahmin %12,3). En iyi maçta bile ~8'de 1 gelir. Ayrıca KG oranı en düşük maçları seçmekten
 * belirgin iyi DEĞİL (o da ~%13-14). Piyasa Evet/Evet oranı arşivde yok → kârlılık KANITLANMADI. Bahis önerisi değil.
 */
const fs = require('fs');
const path = require('path');

const K = 400;
const norm2 = (a, b) => { const x = 1 / a, y = 1 / b; return x / (x + y); };

function loadArchive(file = path.join(__dirname, '..', 'data', 'raw', 'evev-arsiv.csv')) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(',');
  const ix = (k) => h.indexOf(k);
  const iKv = ix('kg_var'), iKy = ix('kg_yok'), iU = ix('ust25'), iA = ix('alt25'), iE = ix('evev');
  const kg = [], ov = [], y = [];
  for (const l of lines.slice(1)) {
    // tırnaklı alan olabilir (takım adlarında virgül): sondaki sayısal sütunlar sağdan okunur
    const c = l.split(',');
    const off = c.length - h.length;
    const g = (i) => +c[i + off];
    const kv = g(iKv), ky = g(iKy), u = g(iU), a = g(iA);
    if (!(kv > 1 && ky > 1 && u > 1 && a > 1)) continue;
    kg.push(norm2(kv, ky)); ov.push(norm2(u, a)); y.push(g(iE) ? 1 : 0);
  }
  return { kg: Float64Array.from(kg), ov: Float64Array.from(ov), y: Uint8Array.from(y), n: y.length };
}

/** kg = [var, yok], ou = [alt, üst] (Nesine sırası) → { p, n } */
function score(A, kg, ou) {
  if (!(kg && ou && kg[0] > 1 && kg[1] > 1 && ou[0] > 1 && ou[1] > 1)) return null;
  const fk = norm2(kg[0], kg[1]), fo = norm2(ou[1], ou[0]);
  const d = new Float64Array(A.n);
  for (let i = 0; i < A.n; i++) d[i] = Math.abs(A.kg[i] - fk) + Math.abs(A.ov[i] - fo);
  const idx = Array.from(d.keys()).sort((a, b) => d[a] - d[b]).slice(0, K);
  let k = 0; for (const i of idx) k += A.y[i];
  return { p: k / K, n: K, pKg: +fk.toFixed(3), pO: +fo.toFixed(3) };
}

/** Nesine kgAll listesi → Evet/Evet adayları (tahmin ≥ esik), olasılığa göre sıralı */
function scan(A, list, { esik = 0.10 } = {}) {
  const out = [];
  for (const m of list || []) {
    const s = score(A, m.kg, m.ou);
    if (!s || s.p < esik) continue;
    out.push({ ...m, p: +s.p.toFixed(4), adil: +(1 / s.p).toFixed(2), pKg: s.pKg, pO: s.pO });
  }
  return out.sort((a, b) => b.p - a.p || a.esd - b.esd);
}

module.exports = { loadArchive, score, scan, K };
