"""Evet/Evet arşivi (İY KG Var + 2. yarı KG Var) — Maçkolik arşivinden son sezon(lar)ın oranlı maçları.
Çıktı: data/raw/evev-arsiv.csv  (lib/evev.js bunu okur; benzer KG+2.5 oranlı maçların Evet/Evet sıklığı)
Kullanım: python3 tools/evev-arsiv.py ~/Masaüstü/Pusula/pusula-veri/mackolik-arsiv.db [sezon ...]
Varsayılan sezonlar: 2025/26 2026/27. Alt/üst: ou25a = üst, ou25u = alt.
"""
import sqlite3, sys, os, csv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = sys.argv[2:] or ['2025/26', '2026/27']
db = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
q = f"""select season,date,league,home,away,hthg,htag,hg,ag,p1,px,p2,kgv,kgy,ou25a,ou25u from maclar2
 where season in ({','.join('?' * len(S))}) and hthg is not null and hg is not null
 and p1>1 and px>1 and p2>1 and kgv>1 and kgy>1 and ou25a>1 and ou25u>1 order by date"""
rows = db.execute(q, S).fetchall()
with open(os.path.join(ROOT, 'data', 'raw', 'evev-arsiv.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh)
    w.writerow(['sezon', 'tarih', 'lig', 'ev', 'dep', 'iy_ev', 'iy_dep', 'ms_ev', 'ms_dep', 'ms1', 'msx', 'ms2', 'kg_var', 'kg_yok', 'ust25', 'alt25', 'evev'])
    n = 0
    for r in rows:
        ev = int(r[5] > 0 and r[6] > 0 and r[7] - r[5] > 0 and r[8] - r[6] > 0)
        n += ev
        w.writerow(list(r) + [ev])
print(len(rows), 'maç,', n, 'Evet/Evet')
