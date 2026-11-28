"""Tek seferlik: Maçkolik arşivinden Trendyol 1. Lig (TT1L) -> data/raw/<sezon>/T2.csv
Güncel sezon (TFF'den gelir) için yalnız oranlar (+ yedek İY skoru) data/raw/t2-oran.json'a yazılır.
Kullanım: python3 tools/t2-seed.py ~/Masaüstü/Pusula/pusula-veri/mackolik-arsiv.db
Alt/üst: ou25a = üst, ou25u = alt (kalibrasyonla doğrulandı).
"""
import sqlite3, sys, os, json, csv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from t2names import canon  # noqa: E402

db = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
rows = db.execute("""select season,date,hhmm,home,away,hg,ag,hthg,htag,p1,px,p2,ou25a,ou25u
                     from maclar2 where code='TT1L' and hg is not null order by date""").fetchall()
HEAD = ['Div', 'Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'FTR', 'HTHG', 'HTAG', 'IDH', 'IDD', 'IDA', 'ID>2.5', 'ID<2.5']
by, oran = {}, {}
CUR = '2026/27'
for s, d, t, h, a, hg, ag, hh, ha, p1, px, p2, ov, un in rows:
    h, a = canon(h), canon(a)
    y, m, dd = d.split('-')
    if s == CUR:
        oran[f'{d}|{h}|{a}'] = [p1, px, p2, ov, un, hh, ha]
        continue
    res = 'H' if hg > ag else 'A' if hg < ag else 'D'
    f = lambda v: '' if v is None or v <= 1 else v
    by.setdefault(s, []).append(['T2', f'{dd}/{m}/{y}', t or '', h, a, hg, ag, res,
                                 '' if hh is None else hh, '' if ha is None else ha, f(p1), f(px), f(p2), f(ov), f(un)])
for s, L in by.items():
    sc = s[2:4] + s[5:7]
    os.makedirs(os.path.join(RAW, sc), exist_ok=True)
    with open(os.path.join(RAW, sc, 'T2.csv'), 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh); w.writerow(HEAD); w.writerows(L)
    print(sc, len(L))
json.dump(oran, open(os.path.join(RAW, 't2-oran.json'), 'w'), ensure_ascii=False, indent=0)
print('güncel sezon oranı', len(oran))
