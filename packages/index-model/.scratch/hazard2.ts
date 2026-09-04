import { loadDataset, rateSeriesFor, calibrateDataset } from '../src/dataset.js';
import { defaultWindows } from '../src/calibration.js';
import { computeSeries } from '../src/core.js';
import { periodRange, addMonths } from '../src/period.js';

const d = loadDataset();
const w = defaultWindows(d.latest);
const allOcc = [...d.archive.series.keys()].filter(k => k !== 'LNU04000000').sort();
const set = allOcc.map(id => {
  const rs = rateSeriesFor(d, id, id);
  const cal = calibrateDataset({ ...d, rateSeries: [rs] }, w)[0]!;
  const p = { attachmentShock: cal.attachmentShock, levelLine: cal.levelLine, levelLineByMonth: cal.levelLineByMonth };
  return {
    id,
    single: new Map(computeSeries({ ...rs, parameters: p }, '2000-03', d.latest).map(o => [o.period, o])),
    mm: new Map(computeSeries({ ...rs, parameters: p }, '2000-03', d.latest, { levelLineMode:'month_matched', baseEffectGuard:false }).map(o => [o.period, o])),
    generic: new Map(computeSeries({ ...rs, parameters: { attachmentShock: 2.0, levelLine: cal.levelLine } }, '2000-03', d.latest).map(o => [o.period, o])),
  };
});
const B: [string, number, number][] = [['at or past',-Infinity,0],['0-0.25',0,0.25],['0.25-0.5',0.25,0.5],['0.5-1',0.5,1],['1-2',1,2],['2-4',2,4],['>4',4,Infinity]];
const TARGET = [[65.6,32],[30.0,20],[12.2,74],[3.6,720],[4.7,1644],[4.7,1524],[4.8,684]];

function run(openKey: 'single'|'mm'|'generic', lookFrom: number, lookTo: number, label: string) {
  const c = B.map(()=>({n:0,o:0}));
  for (const s of set) for (const p of periodRange('2010-01','2025-06')) {
    if (p >= '2020-01' && p <= '2021-12') continue;
    const o = s.single.get(p); if (!o || o.ebar===null) continue;
    const dist = o.levelLine - o.ebar;
    let idx = dist<=0?0:B.findIndex(([,lo,hi],i)=> i>0 && dist>=lo && dist<hi);
    if (idx<0) idx = B.length-1;
    let opened=false;
    for (let k=lookFrom;k<=lookTo;k++) if (s[openKey].get(addMonths(p,k))?.open) { opened=true; break; }
    c[idx]!.n++; if(opened) c[idx]!.o++;
  }
  const line = c.map((x,i)=>`${(100*x.o/x.n).toFixed(1)}/${x.n}`).join('  ');
  const match = c.every((x,i)=> x.n===TARGET[i]![1] && Math.abs(100*x.o/x.n - TARGET[i]![0])<0.05);
  console.log((match?'MATCH ':'      ')+label.padEnd(28), line);
}
console.log('target                             ', TARGET.map(t=>`${t[0].toFixed(1)}/${t[1]}`).join('  '));
run('single',1,12,'single, m+1..m+12');
run('single',1,13,'single, m+1..m+13');
run('mm',1,12,'month-matched openness');
run('generic',1,12,'generic 2.0 attachment');
run('single',0,12,'single, m..m+12');
run('single',1,18,'single, m+1..m+18');
run('single',1,24,'single, m+1..m+24');
