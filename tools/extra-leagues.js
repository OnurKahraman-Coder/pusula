/**
 * football-data.co.uk "ek ligler" (new/<ÜLKE>.csv) -> data/raw/<sezon>/<KOD>.csv
 * Bu dosyalarda tüm sezonlar tek tabloda; ilk yarı skoru ve bwin oranı YOK.
 * Ana oran olarak piyasa ortalaması kapanış (AvgC) yazılır, yoksa Pinnacle kapanış (PSC).
 * Takvim yılı sezonu (ör. Norveç 2026) -> klasör 2627 (başlangıç yılı 2026).
 * Kullanım: node tools/extra-leagues.js   (update-live.js de çağırır)
 */
const fs = require('fs');
const path = require('path');

const RAW = path.join(path.resolve(__dirname, '..'), 'data', 'raw');
const EXTRA = { NOR: 'NOR' }; // kod -> new/<dosya>.csv
const UA = 'Mozilla/5.0 (compatible; Pusula/2.3; +https://github.com)';

function splitCsv(line) { return line.split(','); } // bu dosyalarda tırnaklı alan yok

function convert(text, code) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const h = splitCsv(lines[0]).map((x) => x.trim());
  const ix = (k) => h.indexOf(k);
  const I = { s: ix('Season'), d: ix('Date'), t: ix('Time'), h: ix('Home'), a: ix('Away'), hg: ix('HG'), ag: ix('AG'), r: ix('Res') };
  const odd = (row, keys) => {
    for (const trio of keys) {
      const vals = trio.map((k) => parseFloat(row[ix(k)]));
      if (vals.every((x) => x > 1)) return vals;
    }
    return ['', '', ''];
  };
  const bySeason = new Map();
  for (const l of lines.slice(1)) {
    const row = splitCsv(l);
    const y = parseInt(row[I.s], 10);
    if (!y || !row[I.h] || !row[I.a]) continue;
    const o = odd(row, [['AvgCH', 'AvgCD', 'AvgCA'], ['PSCH', 'PSCD', 'PSCA'], ['B365CH', 'B365CD', 'B365CA']]);
    const out = [code, row[I.d], row[I.t], row[I.h], row[I.a], row[I.hg], row[I.ag], row[I.r], ...o].join(',');
    if (!bySeason.has(y)) bySeason.set(y, []);
    bySeason.get(y).push(out);
  }
  return bySeason;
}

async function refresh() {
  const rep = [];
  for (const [code, file] of Object.entries(EXTRA)) {
    const r = await fetch(`https://www.football-data.co.uk/new/${file}.csv`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) throw new Error(`${code}: HTTP ${r.status}`);
    const text = await r.text();
    if (!/^﻿?Country,League,Season/.test(text)) throw new Error(`${code}: beklenmeyen içerik`);
    const bs = convert(text, code);
    for (const [y, rows] of bs) {
      const sc = String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');
      fs.mkdirSync(path.join(RAW, sc), { recursive: true });
      fs.writeFileSync(path.join(RAW, sc, `${code}.csv`),
        'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,AvgCH,AvgCD,AvgCA\n' + rows.join('\n') + '\n');
    }
    rep.push(`${code}: ${bs.size} sezon`);
  }
  return rep.join(', ');
}

module.exports = { refresh, convert };
if (require.main === module) refresh().then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
