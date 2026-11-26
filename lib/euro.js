/**
 * Avrupa/kupa dönüşü indeksi (DENEYSEL).
 * ESPN'den EL/ECL/CL maçlarını geçmiş birkaç gün + önümüzdeki pencere için çeker,
 * takım id'sine göre "bu takım şu tarihlerde Avrupa maçı oynadı" haritası döndürür.
 * update-live.js bunu her güncellemede kurar; scanFixtures bir LİG maçının öncesinde
 * (son ~4 gün) takımın Avrupa maçı olup olmadığını işaretler.
 *
 * NOT: Bu sinyalin dönüşü (1/2 2/1) artırdığı HENÜZ KANITLANMADI — arşivde Avrupa maçı
 * olmadığı için geçmişten ölçülemiyor. İleriye dönük veri toplamak için işaretlenir.
 */
const UEFA = { CL: 'uefa.champions', EL: 'uefa.europa', ECL: 'uefa.europa.conf' };
// Arşivdeki bir isimle yanlış eşleşen (ülke bilgisi olmadan ayırt edilemeyen) kulüpler:
// "Lincoln Red Imps"(Cebelitarık)≠Lincoln City, "Red Star Belgrade"(Sırbistan)≠Fransız Red Star.
const IGNORE = new Set(['Lincoln Red Imps', 'Red Star Belgrade', 'Crvena Zvezda', 'FK Crvena Zvezda']);
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d) { return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; }
function dateNum(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

async function fetchEuroIndex(FX, index, opts = {}) {
  const back = opts.back != null ? opts.back : 5;
  const fwd = opts.fwd != null ? opts.fwd : 9;
  const base = opts.date || new Date();
  const byTeam = {};
  for (let off = -back; off < fwd; off++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off);
    const s = stamp(d), dn = dateNum(d);
    for (const [code, slug] of Object.entries(UEFA)) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 9000);
        const r = await fetch(`${API}/${slug}/scoreboard?dates=${s}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
        clearTimeout(t);
        if (!r.ok) continue;
        const j = await r.json();
        for (const ev of j.events || []) {
          const comp = (ev.competitions && ev.competitions[0]) || {};
          for (const c of comp.competitors || []) {
            const nm = (c.team && (c.team.displayName || c.team.name)) || '';
            // Arşivdeki bir takımla BİREBİR isim çakışan ama o takım olmayan Avrupa
            // kulüpleri (ör. "Lincoln Red Imps" Cebelitarık ≠ arşiv "Lincoln"/Lincoln City).
            if (IGNORE.has(nm)) continue;
            const id = FX.matchTeam(nm, index);
            if (id != null && id >= 0) { (byTeam[id] = byTeam[id] || []).push({ date: dn, code }); }
          }
        }
      } catch (_) { /* gün/lig atlanır */ }
    }
  }
  let n = 0;
  for (const k in byTeam) { byTeam[k].sort((a, b) => a.date - b.date); n += byTeam[k].length; }
  return { byTeam, count: n };
}

module.exports = { fetchEuroIndex, UEFA };
