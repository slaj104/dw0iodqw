// 자동운전 검증: 상·하선 전 구간을 화면 없이 달려 정지 오차·속도 초과·ATC 개입을 출력
//   node tools/test_autopilot.js            (선행열차 없음)
//   node tools/test_autopilot.js leader     (선행열차 있음 → ADU 40모드/STOP 발생)
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { window: {}, Math, console }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['route', 'physics', 'atc', 'predictor', 'guide', 'sim']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx);
const leader = process.argv[2] === 'leader';
for (const dir of ['down', 'up']) {
  const S = new ctx.RS.Sim({ dir, auto: true, leader, load: 1.2 });
  while (!S.finished && S.t < 4000) { S.step(0.05); S.events.length = 0; }
  const m = Math.floor(S.t / 60), s = Math.floor(S.t % 60);
  console.log(`[${S.c.name}] 완주=${S.finished} 운행 ${m}분 ${s}초 · 속도초과 ${S.score.over.length}회 · ATC 개입 ${S.atc.interventions}회 · 제동감도시험 ${S.guide.bt} · 환호 ${S.score.calls.ok}/${S.score.calls.ok + S.score.calls.miss}`);
  console.log('  ' + S.score.stops.map(x => `${x.name} ${x.err >= 0 ? '+' : ''}${Math.round(x.err * 1000)}mm`).join(' · '));
}
