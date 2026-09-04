import { loadDataset, rateSeriesFor, calibrateDataset, frozenParameters } from '../src/dataset.js';
import { defaultWindows } from '../src/calibration.js';
import { computeSeries } from '../src/core.js';
import { periodRange, addMonths } from '../src/period.js';

const d = loadDataset();
const w = defaultWindows(d.latest);
const aggId = 'LNU04000000';
const allOcc = [...d.archive.series.keys()].filter(k => k !== aggId).sort();
const bindable = d.rateSeries.map(s => s.seriesId);
console.log('occupation series', allOcc.length, 'bindable', bindable.length);

function build(ids: string[]) {
  return ids.map(id => {
    const rs = rateSeriesFor(d, id, id);
    const cal = calibrateDataset({ ...d, rateSeries: [rs] }, w)[0]!;
    const obs = computeSeries({ ...rs, parameters: { attachmentShock: cal.attachmentShock, levelLine: cal.levelLine } }, '2000-03', d.latest);
    return { id, cal, byPeriod: new Map(obs.map(o => [o.period, o])) };
  });
}

const buckets = [
  ['at or past', -Infinity, 0],
  ['0-0.25', 0, 0.25],
  ['0.25-0.5', 0.25, 0.5],
  ['0.5-1', 0.5, 1],
  ['1-2', 1, 2],
  ['2-4', 2, 4],
  ['>4', 4, Infinity],
] as const;

function run(ids: string[], lastMonth: string, exclFn: (p:string)=>boolean, label: string) {
  const set = build(ids);
  const counts = buckets.map(() => ({ n: 0, open: 0 }));
  for (const s of set) {
    for (const p of periodRange('2010-01', lastMonth)) {
      if (exclFn(p)) continue;
      const o = s.byPeriod.get(p);
      if (!o || o.ebar === null) continue;
      const dist = o.levelLine - o.ebar;
      let opened = false;
      for (let k = 1; k <= 12; k++) {
        const n = s.byPeriod.get(addMonths(p, k));
        if (n?.open) { opened = true; break; }
      }
      const bi = buckets.findIndex(([, lo, hi]) => dist > lo && dist <= hi);
      const idx = dist <= 0 ? 0 : bi;
      counts[idx]!.n++; if (opened) counts[idx]!.open++;
    }
  }
  const total = counts.reduce((a,c)=>a+c.n,0);
  console.log(label, 'total', total, counts.map((c,i)=>`${buckets[i]![0]}:${(100*c.open/c.n).toFixed(1)}%/${c.n}`).join(' '));
}

const excl = (p:string) => p >= '2020-01' && p <= '2021-12';
run(allOcc, '2025-06', excl, '29 series to 2025-06');
run(allOcc, '2025-07', excl, '29 series to 2025-07');
run(bindable, '2025-06', excl, '15 series to 2025-06');
run(allOcc, d.latest, excl, '29 series to latest');
