/**
 * Gollü maç tarayıcı.
 * Fikstürdeki (oranlı) maçları panel ile analiz eder; benzer oran bandındaki
 * geçmiş maçlara göre gol eğilimi güçlü olanları toplar. update-live.js her
 * güncellemede (3 saatte bir) çağırır ve data/gollu.json'a yazar — UI o dosyayı okur.
 *
 * Not: Bu bir BAHİS ÖNERİSİ DEĞİL. "2.5 üst %85" = aynı oran dizilimindeki geçmiş
 * maçların %85'inde 2.5 üst çıkmış demektir (tarihsel sıklık), garanti değil.
 */
function scanGollu(panel, fixtures, opts = {}) {
  const minO25 = opts.minO25 != null ? opts.minO25 : 0.65;
  const out = [];
  for (const m of fixtures || []) {
    if (!(m.h > 1 && m.d > 1 && m.a > 1)) continue;
    let r;
    try {
      r = panel.analyze(
        {
          h: m.h, d: m.d, a: m.a, o: m.o || 0, u: m.u || 0,
          home: m.home, away: m.away, homeName: m.homeName, awayName: m.awayName, date: m.date,
        },
        { model: false },
      );
    } catch (_) { continue; }
    const st = r.stats;
    if (!st || !st.o25 || st.n < 8) continue; // çok az benzer maç varsa atla
    const o25 = st.o25.p, kg = st.kg.p;
    if (o25 < minO25) continue;
    out.push({
      date: m.date, time: m.time || '', league: m.league,
      home: m.home, away: m.away, homeName: m.homeName, awayName: m.awayName,
      h: m.h, d: m.d, a: m.a, o: m.o || 0, u: m.u || 0, oddsSource: m.oddsSource || '',
      verdict: r.verdict ? r.verdict.label : '',
      strong: o25 >= 0.70 && kg >= 0.65,
      o25, kg, iy05: st.iy05 ? st.iy05.p : 0,
      avgGoals: st.avgGoals, g6: st.g6 ? `${st.g6.k}/${st.g6.n}` : '',
      found: r.found,
    });
  }
  out.sort((a, b) => (b.strong - a.strong) || (b.o25 - a.o25) || (b.avgGoals - a.avgGoals) || (a.date - b.date));
  return out;
}

module.exports = { scanGollu };
