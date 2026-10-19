// 기준 운전선도 생성: 자동운전(교재 기본 운전 취급)으로 전 구간을 달린 결과를 js/ref_data.js 로 저장
//   node tools/build_ref.js
// route.js / guide.js 를 고친 뒤 다시 실행하면 HUD 의 기준 운전선도·정시 판정이 갱신된다.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { window: {}, Math, console }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['route', 'physics', 'atc', 'predictor', 'guide', 'sim']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx);

const STEP = 20, out = {};
for (const dir of ['down', 'up']) {
  const S = new ctx.RS.Sim({ dir, auto: true, leader: false, load: 1.2 });
  const c = S.c, n = Math.ceil((c.uMax - c.uMin) / STEP) + 1;
  const v = new Array(n).fill(0), arr = {}, dep = { [c.startIdx]: 0 };
  let wasDoors = false;
  while (!S.finished && S.t < 4000) {
    S.step(0.05); S.events.length = 0;
    const k = Math.round((S.u - c.uMin) / STEP);
    if (k >= 0 && k < n) v[k] = Math.max(v[k], Math.round(S.vK * 10) / 10);
    if (S.doors && !wasDoors) arr[S.nextStation.i] = Math.round(S.t);
    if (!S.doors && wasDoors) dep[S.guide.seg] = Math.round(S.t);
    wasDoors = S.doors;
  }
  out[dir] = { u0: c.uMin, step: STEP, v, arr, dep, total: Math.round(S.t) };
  console.log(dir, 'total', Math.round(S.t), 's', JSON.stringify(arr));
}
fs.writeFileSync(path.join(root, 'js', 'ref_data.js'),
  '// 자동 생성: node tools/build_ref.js (교재 기본 운전 취급을 따른 자동운전 결과 = 기준 운전선도)\n' +
  'window.RS = window.RS || {};\nRS.REF = ' + JSON.stringify(out) + ';\n');
