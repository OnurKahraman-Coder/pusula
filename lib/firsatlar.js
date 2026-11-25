'use strict';
/**
 * Pusula — Fırsatlar modülü (v2, curutucu doğrulaması sonrası düzeltildi)
 *
 *  (a) Değer-öncelikli: her fikstürü analiz motoruna sokar, EV>0 seçimleri sıralar.
 *      AZ VERİ koruması: takımın son 5 sezon maç sayısı düşükse seçim "güvenilmez" işaretlenir
 *      (ince-veri Poisson modeli aşırı EV üretir — gerçek değer değil).
 *  (b) Örüntü kuralları: kural oranı DOĞRU payda (oranı olan maçların bazı) ile kıyaslanır,
 *      Wilson %95 GA hesaplanır. GA'nın alt sınırı bazın üstünde değilse kural "gürültü"
 *      sayılır ve işaret olarak sunulmaz. Lift yalnız anlamlı kurallar için gösterilir.
 *
 * Dürüstlük önce gelir: küçük örneklem + çoklu eşik (p-hacking) riski kullanıcıya söylenir.
 */

const { wilson } = require('./engine');

function createFirsatlar(engine, analyzer) {
  const F = require('./engine').F;
  const AZ_VERI_ESIK = 20; // son ~5 sezon maç sayısı bunun altındaysa model güvenilmez

  // --- takımların son sezonlardaki maç sayısı (az-veri tespiti) ---
  const maxS = engine.maxSeason();
  const seasonFrom = maxS - 4;
  const macSayisi = new Map();
  for (const m of engine.matches) {
    if (m[F.SEASON] < seasonFrom) continue;
    macSayisi.set(m[F.HOME], (macSayisi.get(m[F.HOME]) || 0) + 1);
    macSayisi.set(m[F.AWAY], (macSayisi.get(m[F.AWAY]) || 0) + 1);
  }
  const takimMac = (id) => macSayisi.get(id) || 0;

  // --- tam dönüş (İY/MS 1/2 veya 2/1) ---
  function reversal(m) {
    const h = m[F.HG], a = m[F.AG], hh = m[F.HTG], ha = m[F.ATG];
    if (hh == null || ha == null || hh < 0 || ha < 0) return null;
    if (hh === ha) return false;
    return hh > ha ? a > h : h > a;
  }
  const favOf = (m) => { const oh = m[F.OH], oa = m[F.OA]; return (oh > 1 && oa > 1) ? Math.min(oh, oa) : null; };
  const ou25 = (m) => (m[F.O25] > 1 ? m[F.O25] : null);
  // kuralların uygulandığı evren: oranı (fav + 2.5Ü) olan ve dönüşü tanımlı maçlar
  const inDomain = (m) => favOf(m) != null && ou25(m) != null && reversal(m) !== null;

  /** bir koşulu DOĞRU payda (domain bazı) ile ölç + Wilson %95 GA + anlamlılık */
  function baseRate(cond) {
    let n = 0, hit = 0, domN = 0, domHit = 0;
    for (const m of engine.matches) {
      if (!inDomain(m)) continue;
      const o = reversal(m);
      domN++; if (o) domHit++;
      if (cond(m)) { n++; if (o) hit++; }
    }
    const pct = n ? (100 * hit) / n : 0;
    const basePct = domN ? (100 * domHit) / domN : 0; // oranı olan maçların gerçek bazı
    const [lo, hi] = wilson(hit, n);              // kesir
    const anlamli = n > 0 && lo * 100 > basePct;  // GA alt sınırı bazın üstünde mi
    return {
      n, hit, pct: +pct.toFixed(2),
      bazPct: +basePct.toFixed(2),
      gaLo: +(lo * 100).toFixed(1), gaHi: +(hi * 100).toFixed(1),
      lift: basePct ? +(pct / basePct).toFixed(2) : 0,
      anlamli,
    };
  }

  const KURALLAR = [
    {
      id: 'orta-favori-bol-gol', ad: 'Orta favori + bol gol',
      sinyal: 'İY/MS dönüş (1/2 veya 2/1) ihtimali',
      aciklama: 'MS favorisi 1,65–1,90 ve 2,5 Üst oranı ≤ 1,40.',
      fx: (fx) => { const f = Math.min(fx.h, fx.a); return fx.h > 1 && fx.a > 1 && fx.o > 1 && f >= 1.65 && f <= 1.90 && fx.o <= 1.40; },
      cond: (m) => { const f = favOf(m), o = ou25(m); return f != null && o != null && f >= 1.65 && f <= 1.90 && o <= 1.40; },
    },
    {
      id: 'orta-favori-gevsek', ad: 'Orta favori + bol gol (geniş)',
      sinyal: 'Aynı örüntünün daha çok örnekli hâli',
      aciklama: 'MS favorisi 1,70–1,95 ve 2,5 Üst oranı ≤ 1,50.',
      fx: (fx) => { const f = Math.min(fx.h, fx.a); return fx.h > 1 && fx.a > 1 && fx.o > 1 && f >= 1.70 && f <= 1.95 && fx.o <= 1.50; },
      cond: (m) => { const f = favOf(m), o = ou25(m); return f != null && o != null && f >= 1.70 && f <= 1.95 && o <= 1.50; },
    },
  ];

  let _baz = null;
  function bazlar() {
    if (!_baz) _baz = KURALLAR.map((k) => ({ id: k.id, ...baseRate(k.cond) }));
    return _baz;
  }

  function scan(fixtures, opts = {}) {
    const evMin = opts.evMin != null ? opts.evMin : 0.03;
    const value = [];
    const baz = bazlar();
    const kuralEsles = KURALLAR.map((k, i) => ({
      id: k.id, ad: k.ad, sinyal: k.sinyal, aciklama: k.aciklama, baz: baz[i], maclar: [],
    }));

    for (const fx of fixtures || []) {
      const hasOdds = fx.h > 1 && fx.d > 1 && fx.a > 1;
      const mac = { date: fx.date, time: fx.time, league: fx.leagueName || fx.league,
        home: fx.homeName, away: fx.awayName };

      if (hasOdds && fx.home >= 0 && fx.away >= 0) {
        const azVeri = Math.min(takimMac(fx.home), takimMac(fx.away)) < AZ_VERI_ESIK;
        const macSay = Math.min(takimMac(fx.home), takimMac(fx.away));
        try {
          const r = analyzer.analyze({ homeId: fx.home, awayId: fx.away, odds: { h: fx.h, d: fx.d, a: fx.a } });
          if (r.value && r.value.length) {
            for (const v of r.value) {
              if (v.ev != null && v.ev >= evMin) {
                // ince-veri + aşırı EV = artefakt → güvenilmez
                const supheli = azVeri || v.ev > 0.20;
                value.push({ ...mac, secim: v.label, secimOrani: v.odds,
                  modelP: v.modelP, piyasaP: v.marketP, ev: v.ev, kelly: v.kelly,
                  azVeri, macSay, supheli });
              }
            }
          }
        } catch (_) { /* eşleşmeyen takım — atla */ }
      }

      for (let i = 0; i < KURALLAR.length; i++) {
        if (hasOdds && KURALLAR[i].fx(fx)) kuralEsles[i].maclar.push(mac);
      }
    }

    // güvenilir seçimler önce (şüpheli olanlar sona), sonra EV
    value.sort((a, b) => (a.supheli - b.supheli) || (b.ev - a.ev));
    return {
      value: value.slice(0, 40),
      kurallar: kuralEsles,
      uyari: 'Kural oranları birden çok eşik denenerek bulunabilir (p-hacking). Yalnız istatistiksel '
        + 'olarak anlamlı (Wilson %95 GA bazın üstünde) kurallar "işaret" sayılır; gerisi gürültüdür.',
      sayac: { fikstur: (fixtures || []).length, deger: value.length },
    };
  }

  return { scan, bazlar, KURALLAR };
}

module.exports = { createFirsatlar };
