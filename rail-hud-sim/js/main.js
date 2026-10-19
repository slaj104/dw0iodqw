// 메인: 화면 구성 · 입력 · 렌더링 루프 · 메뉴/결과
(function () {
  const KMH = 3.6;

  // ───── 폰트(Noto Sans KR, OFL) 로드 ─────
  const fontReady = (async () => {
    const F = RS.ASSETS && RS.ASSETS.font;
    if (!F || !window.FontFace) return;
    const list = [];
    for (const k in F) {
      const w = k.split('-').pop();
      const ff = new FontFace('Noto Sans KR', `url(${F[k]})`, { weight: w, unicodeRange: k.includes('latin') ? 'U+0000-00FF,U+2000-206F' : undefined });
      list.push(ff.load().then(f => document.fonts.add(f)).catch(() => {}));
    }
    await Promise.all(list);
  })();

  // ───── three.js ─────
  const glCanvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1800);
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a342c, 0.2);
  const sun = new THREE.DirectionalLight(0xfff4e0, 0);
  const head = new THREE.SpotLight(0xfff6e0, 1.6, 280, 0.42, 0.5, 1.2);
  const SKY = new THREE.Color(0xa8c8e8), DARK = new THREE.Color(0x07080a);
  let world = null, sim = null, scene = new THREE.Scene();
  const opts = { hud: true, guide: true };

  RS.HUD.init(document.getElementById('cab'), document.getElementById('hud'), document.getElementById('dash'));
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    glCanvas.style.width = w + 'px'; glCanvas.style.height = h + 'px';
    camera.aspect = w / h; camera.updateProjectionMatrix();
    RS.HUD.resize();
  }
  window.addEventListener('resize', onResize);
  onResize();

  function startGame(o) {
    if (world) world.dispose();
    sim = new RS.Sim(o);
    world = RS.World.build(sim.c);
    scene = world.scene;
    scene.add(ambient, hemi, sun, sun.target, head, head.target);
    scene.fog = new THREE.Fog(0x07080a, 40, 420);
    scene.background = DARK.clone();
    const A = sim.c.stations[sim.c.startIdx];
    sim.flash(`${A.name} 출발 — ${sim.c.name}`, null, 4);
    const q = new URLSearchParams(location.search);
    if (q.has('u')) { // 시연용: ?u=거리(m)&v=속도
      sim.st.s = Number(q.get('u')); sim.st.v = Number(q.get('v') || 0) / KMH; sim.veh.brake = 0;
      const idx = sim.c.stations.findIndex(s => s.stop > sim.st.s + 1) - 1;
      sim.guide.seg = Math.max(0, idx); sim.guide.reset(); sim.guide.phase = 'coast'; sim.guide.bt = 'none';
      sim.veh.ads = sim.c.supplyAt(sim.st.s) === 'NONE' ? sim.veh.ads : sim.c.supplyAt(sim.st.s);
      sim.atc.mode = sim.c.isATS(sim.st.s) ? 'ATS' : 'ATC';
      sim.lastV = sim.st.v;
      sim.callState.forEach(cl => { if (cl.u < sim.st.s + 20) cl.state = 'skip'; });
      sim.demo = true; // 정시 판정 제외
      sim.msgs.length = 0;
      sim.flash(`시연 모드 — ${(c0 => c0.toS(sim.st.s) / 1000)(sim.c).toFixed(2)} km 지점`, null, 2.5);
    }
  }

  // ───── 입력 ─────
  window.addEventListener('keydown', (e) => {
    if (!sim || sim.finished || !running) return;
    const k = e.key, K = k.length === 1 ? k.toLowerCase() : k;
    let used = true;
    if (K === 'w') sim.input(e.shiftKey ? 'power4' : 'powerUp');
    else if (K === 's') sim.input('powerDown');
    else if (K === 'q') sim.input('power4');
    else if (K === 'a') { sim.veh.power = 0; sim.input('powerDown'); }
    else if (k === 'ArrowDown') sim.input('brakeUp');
    else if (k === 'ArrowUp') sim.input('brakeDown');
    else if (k >= '1' && k <= '7') sim.input('brakeSet', Number(k));
    else if (k === '0' || k === '`') sim.input('brakeSet', 0);
    else if (k === ' ' || k === 'Backspace') sim.input('eb');
    else if (K === 'o') sim.input('doors');
    else if (K === 'c') sim.input('ads');
    else if (K === 'r') sim.input('regen');
    else if (K === 't') sim.input('cgs');
    else if (K === 'f') sim.input('call');
    else if (K === 'h') sim.input('horn');
    else if (K === 'b') sim.input('buzzer');
    else if (K === 'p') sim.input('auto');
    else if (K === 'g') { opts.guide = !opts.guide; sim.flash(opts.guide ? 'HUD 운전 가이드 켬' : 'HUD 운전 가이드 끔 (비교 시연)', null, 2); }
    else if (K === 'u') { opts.hud = !opts.hud; }
    else if (K === 'm') sim.flash(RS.Audio.toggleMute() ? '소리 끔' : '소리 켬', null, 1.5);
    else if (k === 'Escape') showMenu();
    else used = false;
    if (used) e.preventDefault();
  });
  window.addEventListener('wheel', (e) => { if (sim && running && !sim.finished) sim.input(e.deltaY > 0 ? 'brakeUp' : 'brakeDown'); }, { passive: true });

  // ───── 투영 ─────
  const _v = new THREE.Vector3();
  function project(u, l, h) {
    world.point(u, l, h, _v);
    _v.project(camera);
    if (_v.z > 1 || _v.z < -1) return null;
    const { W, H } = RS.HUD.size;
    return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H };
  }

  function updateCamera() {
    const u = sim.u, vK = sim.vK;
    const eye = world.point(u - 1.2, -0.55, 2.75, new THREE.Vector3());
    eye.y += Math.sin(sim.t * 9) * 0.006 * Math.min(1, vK / 60);
    const look = world.point(u + 60, -0.3, 2.75 - 60 * Math.tan(9 * Math.PI / 180), new THREE.Vector3());
    camera.position.copy(eye); camera.lookAt(look); camera.updateMatrixWorld();
    head.position.copy(world.point(u, 0, 1.4, new THREE.Vector3()));
    head.target.position.copy(world.point(u + 80, 0, 0, new THREE.Vector3()));
    const [T0, T1] = world.tunnel;
    const out = world.inTunnel(u) ? Math.max(0, Math.min(1, Math.max((u - (T1 - 350)) / 350, ((T0 + 350) - u) / 350))) : 1;
    const stW = world.stationWiden(u + 40);
    ambient.intensity = 0.32 + 0.45 * stW + 0.4 * out;
    hemi.intensity = 0.15 + 0.55 * out;
    sun.intensity = 0.7 * out; sun.position.copy(camera.position).add(new THREE.Vector3(200, 300, 100)); sun.target.position.copy(camera.position);
    head.intensity = 1.6 * (1 - out * 0.8);
    scene.background.copy(DARK).lerp(SKY, out);
    scene.fog.color.copy(DARK).lerp(SKY, out);
    scene.fog.near = 40 + 200 * out; scene.fog.far = 420 + 1100 * out + 120 * stW;
    if (world.sky) { world.sky.position.copy(camera.position); world.sky.visible = out > 0.02; }
  }

  const fmtClock = (t) => { const x = Math.floor(6 * 3600 + 30 * 60 + t); return [Math.floor(x / 3600) % 24, Math.floor(x / 60) % 60, x % 60].map(n => String(n).padStart(2, '0')).join(':'); };
  const fmtRun = (t) => `${Math.floor(t / 60)}분 ${String(Math.floor(t % 60)).padStart(2, '0')}초`;

  // ───── 루프 ─────
  let running = false, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    if (!sim) { renderer.render(scene, camera); return; }
    if (running && !sim.finished) sim.step(dt);
    handleEvents();
    updateCamera();
    const ld = sim.leader.enabled ? sim.leader.rear - sim.u : null;
    world.leader.update(sim.leader.s, sim.leader.enabled && ld < 1500 && ld > -50);
    updateStationDevices(dt);
    renderer.render(scene, camera);
    drawHUD();
    RS.Audio.update(dt, { vK: sim.vK, tAct: sim.st.tAct, bAct: sim.st.bAct, tunnel: world.inTunnel(sim.u), cm: sim.veh.cm, regen: !sim.veh.regenCut, alarm: sim.atc.warn || sim.atc.braking });
    if (sim.finished && running) { running = false; setTimeout(showResult, 1200); }
  }

  // 승강장 모니터(정위치 표시) · 진로 개통 표시기
  let devT = 0;
  function posState() {
    const B = sim.nextStation;
    if (!B || B.stop - sim.u > 300) return null;
    return { st: B, err: sim.u - B.stop, stopped: sim.st.v < 0.05, doors: sim.doors };
  }
  function updateStationDevices(dt) {
    const p = posState();
    if (p && world.monitors[p.st.i]) world.monitors[p.st.i].update(p);
    devT -= dt;
    if (devT > 0) return;
    devT = 0.5;
    const c = sim.c;
    for (const r of world.routeInd) {
      const bi = c.blockIndexAt(r.u + 10);
      r.set(!(sim.codes && sim.codes[bi] === 0));
    }
  }

  function handleEvents() {
    for (const e of sim.events) {
      if (e === 'notch') RS.Audio.notch();
      else if (e === 'atc_down' || e === 'atc_up') RS.Audio.codeChange();
      else if (e === 'doorOpen') RS.Audio.doorOpen();
      else if (e === 'doorClose') RS.Audio.doorClose();
      else if (e === 'horn') RS.Audio.play('horn', 0.7);
      else if (e === 'buzzer') RS.Audio.buzzer();
      else if (e === 'call' || e === 'switch') RS.Audio.call();
    }
    sim.events.length = 0;
    if (sim.veh.brake < (sim._lastB || 0) && sim.veh.brake === 0 && sim.vK < 3) RS.Audio.play('air_release', 0.15);
    sim._lastB = sim.veh.brake;
  }

  function drawHUD() {
    const c = sim.c, st = sim.st, vK = sim.vK, a = sim.adv || {}, B = sim.nextStation;
    const sCam = sim.u - 1.2;
    const look = sim.look || [];
    const stopBraking = sim.guide.stopBraking;
    const predStopU = a.predStopU != null ? a.predStopU : null;
    const ref = RS.REF && RS.REF[c.dir];
    const refV = ref ? ref.v[Math.round((sim.u - ref.u0) / ref.step)] : null;
    // 정시 운행: 마지막 도착역의 실제 도착 시각 - 기준 운전선도 도착 시각 (+ 지연)
    const lastStop = sim.score.stops[sim.score.stops.length - 1];
    const sched = lastStop && lastStop.sched != null ? lastStop.t - lastStop.sched : null;
    const limits = c.limits.filter(l => !l.adu && l.start - sCam > 5 && l.start - sCam < 700).map(l => ({ u: l.start, v: l.v }));
    const D = c.dead;
    const d = {
      hudOn: opts.hud, guideOn: opts.guide, auto: sim.auto,
      vKmh: vK, u: sim.u, km: c.toS(sim.u) / 1000, mode: sim.atc.mode, code: sim.atc.code, civil: c.civilLimit(sim.u), limNow: sim.limNow == null ? 80 : sim.limNow,
      nextCode: look.length ? { code: look[0].code, dist: look[0].u - sim.u } : null,
      station: B ? { name: B.name, dist: B.stop - sim.u, side: B.side } : null,
      adv: opts.guide ? a : null, calls: sim.activeCalls().map(x => x.text),
      power: sim.veh.power, brake: sim.veh.brake, braking: sim.veh.brake > 0,
      stopBraking: stopBraking && opts.guide, predErr: predStopU != null && B ? predStopU - B.stop : null, rec: a.rec,
      bp: opts.guide && a.brakePointU != null && !stopBraking && sim.veh.brake === 0 ? { dist: a.brakePointU - sim.u, why: a.bpWhy || `${B ? B.name : ''} 초제동 2단` } : null,
      atcBraking: sim.atc.braking, atcWarn: sim.atc.warn && !sim.atc.braking, eb: sim.atc.eb, ebReason: sim.atc.ebReason,
      ads: sim.veh.ads, sup: sim.veh.sup || 'DC', mcb: sim.veh.mcb, regenCut: sim.veh.regenCut, cm: sim.veh.cm,
      bc: st.bAct / RS.Physics.P.ebDecel * 4.2, mr: sim.veh.mr,
      grade: c.gradeAt(sim.u), clock: fmtClock(sim.t), runTime: fmtRun(sim.t), doors: sim.doors,
      msg: sim.msgs[sim.msgs.length - 1] || null, sched,
      leaderDist: sim.leader.enabled && sim.leader.rear - sim.u > 0 && sim.leader.rear - sim.u < 3000 ? sim.leader.rear - sim.u : null,
      refV, sCam, pos: posState(),
      ar: {
        stopMark: B && B.stop - sCam < 900 && B.stop - sCam > 3 ? B.stop : null,
        brakePoint: opts.guide && a.brakePointU != null && !stopBraking && a.brakePointU - sCam > 3 && a.brakePointU - sCam < 900 ? a.brakePointU : null,
        bpText: a.bpWhy ? `→ ${a.bpWhy}` : '초제동 2단',
        predStop: opts.guide && predStopU != null && predStopU - sCam > 5 ? predStopU : null,
        codes: look.filter(x => x.u - sCam < 700 && x.u - sCam > 5),
        limits,
        dead: D.start - sCam > 5 && D.start - sCam < 500 ? [D.start, D.end] : null,
      },
    };
    RS.HUD.draw(d, project);
    const codes = sim.codes;
    RS.HUD.drawDash(d, {
      stations: c.stations, dead: D, trail: sim.trail, ref,
      note: sim.seg ? sim.seg.note : '',
      limitAt: (u) => { let v = c.civilLimit(u); if (sim.atc.mode === 'ATC' && !c.isATS(u)) v = Math.min(v, codes[c.blockIndexAt(u)]); return v; },
      brakePoint: d.ar.brakePoint, predStop: predStopU,
    });
  }

  // ───── 메뉴 / 결과 ─────
  const menu = document.getElementById('menu'), result = document.getElementById('result');
  const selD = document.getElementById('dir'), selS = document.getElementById('startSt'), selE = document.getElementById('endSt');
  function fillStations() {
    const c = RS.makeCourse(selD.value);
    selS.innerHTML = ''; selE.innerHTML = '';
    c.stations.forEach((st, i) => {
      if (i < c.stations.length - 1) selS.add(new Option(`${st.no} ${st.name}`, i));
      if (i > 0) selE.add(new Option(`${st.no} ${st.name}`, i));
    });
    selE.value = c.stations.length - 1;
  }
  selD.addEventListener('change', fillStations);
  fillStations();

  function showMenu() { running = false; menu.classList.remove('hidden'); result.classList.add('hidden'); }
  document.getElementById('startBtn').addEventListener('click', async () => {
    RS.Audio.init();
    await fontReady;
    let a = Number(selS.value), b = Number(selE.value);
    if (b <= a) b = a + 1;
    opts.guide = document.getElementById('optGuide').checked;
    startGame({
      dir: selD.value, startIdx: a, endIdx: b,
      leader: document.getElementById('optLeader').checked,
      load: 1 + Number(document.getElementById('optLoad').value) / 100 * 0.6,
      auto: document.getElementById('optAuto').checked,
    });
    menu.classList.add('hidden');
    running = true; last = performance.now();
  });
  document.getElementById('againBtn').addEventListener('click', showMenu);

  function showResult() {
    const S = sim.score;
    const okStops = S.stops.filter(s => s.grade !== '실패');
    const pos = okStops.filter(s => Math.abs(s.err) <= 0.5).length;
    const rows = S.stops.map(s => {
      const diff = s.sched != null ? s.t - s.sched : null;
      return `<tr><td>${s.name}</td><td>${s.grade === '실패' ? '과주 통과' : (s.err >= 0 ? '+' : '') + Math.round(s.err * 1000) + ' mm'}</td>
        <td class="${s.grade === '정위치' ? 'gS' : s.grade === '실패' ? 'gX' : 'gC'}">${s.grade}</td>
        <td>${diff == null ? '-' : (diff >= 0 ? '+' : '') + Math.round(diff) + '초'}</td></tr>`;
    }).join('');
    const callTot = S.calls.ok + S.calls.miss;
    const it = S.items;
    const yes = (v) => v ? '<span class="gS">양호</span>' : '<span class="gX">미흡</span>';
    const bt = sim.guide.bt;
    const total = sim.t;
    document.getElementById('resultBody').innerHTML = `
      <p>${sim.c.name} · 운행시간 <b>${fmtRun(total)}</b> · 정위치(±500 mm) <b>${pos}/${S.stops.length}</b> · 속도 초과 <b>${S.over.length}회</b> · ATC 개입 <b>${sim.atc.interventions}회</b></p>
      <table><thead><tr><th>역</th><th>정지 오차</th><th>판정</th><th>기준 대비</th></tr></thead><tbody>${rows}</tbody></table>
      <table><tbody>
        <tr><td>제동감도시험 (최초 발차 후 45 km/h 이하 2단-4단-완해)</td><td>${bt === 'done' ? yes(true) : bt === 'none' ? '-' : yes(false)}</td></tr>
        <tr><td>절연구간: 회생 차단 → 교직 절환 → 타행 진입 → 회생 복귀</td><td>${it.deadChecked ? yes(it.regenCut && it.adsBefore && it.coastIn && it.regenBack !== false) : '-'}</td></tr>
        <tr><td>금정 ATCCgS 전환</td><td>${it.cgs ? yes(true) : '-'}</td></tr>
        <tr><td>지적 확인 환호 (F)</td><td>${callTot ? `${S.calls.ok}/${callTot} (${Math.round(S.calls.ok / callTot * 100)}%)` : '-'}</td></tr>
        <tr><td>정차 목적 비상제동 사용</td><td>${S.eb ? `<span class="gX">${S.eb}회</span>` : '<span class="gS">없음</span>'}</td></tr>
      </tbody></table>
      ${S.over.length ? `<p class="small">속도 초과: ${S.over.slice(0, 8).map(o => `${o.why} → ${o.v.toFixed(1)} km/h`).join(' · ')}</p>` : ''}
      <p class="small">기준: 교재 1.2 — 정지 위치 ±500 mm 정위치, 승강장 진입 60 km/h 이하, 시험 운행 시간 40분. 기준 대비 시간은 교재대로 운전한 자동운전 결과와 비교한 값.</p>`;
    result.classList.remove('hidden');
  }

  requestAnimationFrame(frame);
})();
