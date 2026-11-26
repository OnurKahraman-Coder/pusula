/**
 * Fikstür tarayıcı — her oranlı maç için gol/İY-MS metriklerini hesaplar.
 * update-live.js her güncellemede (3 saatte bir) çağırır ve data/gollu.json'a yazar.
 * UI o dosyayı okuyup filtreler: Gollü, 6+ Gol, 1/2, 2/1.
 *
 * Metrikler (benzer oran bandındaki ~20 geçmiş maç + gol modeli):
 *  - o25/kg/iy05/avgGoals : 2.5 üst, KG var, İY 0.5 üst sıklığı, maç başı gol
 *  - p6   : 6+ gol olasılığı (model varsa Poisson, yoksa benzer maç sıklığı g6)
 *  - p12  : İY/MS 1/2 (ilk yarı ev önde → maç sonu deplasman) — DÖNÜŞ, nadir
 *  - p21  : İY/MS 2/1 (ilk yarı deplasman önde → maç sonu ev) — DÖNÜŞ, nadir
 *  - kind : 'gollu' (o25>=%70 & kg>=%65) / 'kg' (kg>=%70) / null
 *
 * NOT: Hepsi tarihsel sıklık/olasılık — BAHİS ÖNERİSİ DEĞİL, garanti değil.
 * 1/2 ve 2/1 dönüşleri doğası gereği çok nadirdir ve küçük örnekten gelir (gürültülü).
 */
function poisCDF(k, lambda) {
  let sum = 0, term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) { if (i > 0) term *= lambda / i; sum += term; }
  return sum;
}

function scanFixtures(panel, fixtures) {
  const out = [];
  for (const m of fixtures || []) {
    if (!(m.h > 1 && m.d > 1 && m.a > 1)) continue;
    let r;
    try {
      r = panel.analyze({
        h: m.h, d: m.d, a: m.a, o: m.o || 0, u: m.u || 0,
        home: m.home, away: m.away, homeName: m.homeName, awayName: m.awayName, date: m.date,
      }, {});
    } catch (_) { continue; }
    const st = r.stats;
    if (!st || !st.o25 || st.n < 8) continue;
    const o25 = st.o25.p, kg = st.kg.p;
    const hf = r.htftAll || [];
    const pick = (k) => { const x = hf.find((z) => z.k === k) || {}; return x.model != null ? { v: x.model, s: 'model' } : { v: x.p || 0, s: 'benzer' }; };
    const c12 = pick('1/2'), c21 = pick('2/1');
    let p6 = null, p6s = '';
    const md = r.model;
    if (md && md.lambda) { p6 = 1 - poisCDF(5, md.lambda.home + md.lambda.away); p6s = 'model'; }
    else if (st.g6 && st.g6.n) { p6 = st.g6.k / st.g6.n; p6s = 'benzer'; }
    // benzer maçların İY/MS skorlarından: İY KG (ilk yarı iki takım da gol) ve
    // Evet/Evet (her iki yarıda da en az 1 gol)
    let iyN = 0, iyK = 0, evN = 0, evK = 0;
    for (const row of r.rows || []) {
      if (!row.ht) continue; // ilk yarı verisi yok (eski maç)
      const hp = String(row.ht).split('-').map(Number);
      const fp = String(row.ft).split('-').map(Number);
      if (hp.length !== 2 || fp.length !== 2 || hp.some((x) => !Number.isFinite(x)) || fp.some((x) => !Number.isFinite(x))) continue;
      const [hh, ha] = hp, [hg, ag] = fp;
      iyN++; if (hh > 0 && ha > 0) iyK++;
      const iyGol = hh + ha, ikGol = (hg - hh) + (ag - ha); // 1. yarı / 2. yarı toplam gol
      evN++; if (iyGol >= 1 && ikGol >= 1) evK++;
    }
    const iyKg = iyN ? iyK / iyN : null;
    const evEv = evN ? evK / evN : null;

    const isGollu = o25 >= 0.70 && kg >= 0.65;
    const isKG = kg >= 0.70;
    out.push({
      date: m.date, time: m.time || '', league: m.league,
      home: m.home, away: m.away, homeName: m.homeName, awayName: m.awayName,
      h: m.h, d: m.d, a: m.a, o: m.o || 0, u: m.u || 0, oddsSource: m.oddsSource || '',
      found: r.found,
      o25, kg, iy05: st.iy05 ? st.iy05.p : 0, iy15: st.iy15 ? st.iy15.p : 0, o35: st.o35 ? st.o35.p : 0,
      avgGoals: st.avgGoals, g6: st.g6 ? `${st.g6.k}/${st.g6.n}` : '',
      kind: isGollu ? 'gollu' : (isKG ? 'kg' : null),
      p6, p6s,
      p12: c12.v, p12s: c12.s,
      p21: c21.v, p21s: c21.s,
      iyKg, iyKgN: iyN, evEv, evEvN: evN,
    });
  }
  return out;
}

/** Eski uyum: yalnızca güçlü gollü/KG maçları, tarih-saat sıralı. */
function scanGollu(panel, fixtures) {
  return scanFixtures(panel, fixtures)
    .filter((m) => m.kind)
    .map((m) => ({ ...m, strong: true }))
    .sort((a, b) => (a.date - b.date) || String(a.time).localeCompare(String(b.time)));
}

module.exports = { scanFixtures, scanGollu, poisCDF };
