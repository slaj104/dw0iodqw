// 메인 루프: 입력 · 시뮬레이션 · 렌더링
(function () {
  const R = RS.ROUTE, Ph = RS.Physics, Pr = RS.Predictor, W3 = RS.World, KMH = 3.6;

  // ───── three.js 준비 ─────
  const glCanvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1600);
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a342c, 0.2);
  const head = new THREE.SpotLight(0xfff6e0, 1.6, 260, 0.42, 0.5, 1.2);
  scene.add(ambient, hemi, head, head.target);
  const SKY = new THREE.Color(0x9fc3e6), DARK = new THREE.Color(0x07080a);
  scene.fog = new THREE.Fog(0x07080a, 40, 420);
  scene.background = DARK.clone();

  W3.build(scene);
  const leaderMesh = W3.makeTrain(scene);

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

  // ───── 시뮬레이션 상태 ─────
  let G = null;
  const opts = { leader: true, load: 1.0, planNotch: 4, hud: true };

  function newGame(startIdx, endIdx) {
    const st = R.stations[startIdx];
    G = {
      t: 0, clock0: 6 * 3600 + 30 * 60,
      train: Ph.makeState(st.stop),
      notch: -7, atc: new RS.ATC.OnBoard(),
      leader: new RS.ATC.Leader(startIdx + 1, opts.leader),
      codes: [], nextStop: startIdx + 1, endIdx,
      doors: false, doorTimer: 0, dwellDone: true, results: [],
      trail: [], msg: null, msgT: 0, pred: null, predT: 0,
      running: true, finished: false, accel: 0, lastV: 0,
      deadStall: false,
    };
    G.codes = RS.ATC.computeCodes(G.leader);
    // 시연용: ?s=11800&v=60 처럼 주소에 붙이면 임의 위치·속도에서 시작
    const q = new URLSearchParams(location.search);
    if (q.has('s')) {
      G.train.s = Number(q.get('s')); G.train.v = Number(q.get('v') || 0) / KMH; G.notch = 0;
      G.nextStop = R.stations.findIndex(x => x.stop > G.train.s - 1);
      G.leader = new RS.ATC.Leader(Math.max(0, G.nextStop), q.get('leader') === '1' && opts.leader);
      G.lastV = G.train.v;
      flash(`시연 모드 — ${(G.train.s / 1000).toFixed(2)} km 지점에서 시작`, null, 3);
      return;
    }
    flash(`${st.name} 출발 준비 — 주간제어기를 N으로 놓고 역행하세요`, null, 4);
  }

  function flash(text, color, sec, sub) { G.msg = { text, color, sub }; G.msgT = sec || 3; }

  // ───── 입력 ─────
  function setNotch(n) {
    n = Math.max(-8, Math.min(4, n));
    if (n !== G.notch) { G.notch = n; RS.Audio.notch(); }
  }
  window.addEventListener('keydown', (e) => {
    if (!G || !G.running) return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'q' || k === 'Q') { setNotch(G.notch === -8 ? -7 : G.notch + 1); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'z' || k === 'Z') { setNotch(G.notch === -7 ? -8 : G.notch - 1); e.preventDefault(); }
    else if (k === ' ' || k === 'Backspace') { setNotch(-8); e.preventDefault(); }
    else if (k === 'n' || k === 'N') setNotch(0);
    else if (k === 'd' || k === 'D') toggleDoors();
    else if (k === 'h' || k === 'H') opts.hud = !opts.hud;
    else if (k === 'm' || k === 'M') flash(RS.Audio.toggleMute() ? '소리 끔' : '소리 켬', null, 1.5);
    else if (k === 'Escape') showMenu();
  });
  window.addEventListener('wheel', (e) => { if (G && G.running) setNotch(G.notch + (e.deltaY > 0 ? -1 : 1)); }, { passive: true });

  function nextStation() { return R.stations[G.nextStop] || null; }

  function toggleDoors() {
    const st = nextStation();
    if (G.doors) {
      if (G.doorTimer < 6) { flash('승객 승하차 중…', '#ffc04d', 1.5); return; }
      G.doors = false; RS.Audio.door();
      G.nextStop++;
      flash('출입문 닫힘 — 출발 가능', null, 2);
      return;
    }
    if (!st || G.train.v > 0.01) { flash('정차 후 출입문을 여세요', '#ffc04d', 1.5); return; }
    const err = G.train.s - st.stop;
    if (err < -5) { flash(`정지위치 미달 ${(-err).toFixed(1)} m — 조금 더 전진하세요`, '#ffc04d', 2.5); return; }
    if (err > 5) { flash(`정지위치 과주 ${err.toFixed(1)} m — 출입문 취급 불가`, '#ff5050', 2.5); return; }
    G.doors = true; G.doorTimer = 0; RS.Audio.door();
    const grade = Math.abs(err) <= 0.5 ? 'S' : Math.abs(err) <= 1 ? 'A' : Math.abs(err) <= 2 ? 'B' : 'C';
    G.results.push({ name: st.name, err, grade });
    flash(`${st.name} 정차  ${err >= 0 ? '+' : ''}${err.toFixed(2)} m  [${grade}]`, grade === 'C' ? '#ffc04d' : '#72ffb0', 3.5,
      `출입문 ${st.side === 'L' ? '좌측' : '우측'} 열림`);
    if (st.idx === G.endIdx) setTimeout(finish, 2500);
  }

  // ───── 1 스텝 ─────
  const DS = R.deadSection;
  function tractionCut() {
    const s = G.train.s;
    return G.doors || G.deadStall || (s > DS.start + 25 && s < DS.end + 175);
  }
  function supplyText() {
    const s = G.train.s;
    if (s > DS.start + 25 && s < DS.end + 175) return '무전압 (절연)';
    return s <= DS.start + 25 ? 'DC 1500 V' : 'AC 25 kV';
  }

  function step(dt) {
    G.t += dt;
    G.leader.update(dt);
    G.codes = RS.ATC.computeCodes(G.leader);
    const vK = G.train.v * KMH;
    G.atc.update(G.train.s, vK, G.codes);
    if (G.atc.codeChanged) RS.Audio.codeChange();
    let eff = G.notch;
    if (G.atc.braking) eff = Math.min(eff, -7);
    Ph.step(G.train, eff, dt, { loadFactor: opts.load, tractionCut: tractionCut() });
    if (G.doors) { G.doorTimer += dt; G.train.v = 0; }

    // 정차역 통과(과주) 판정
    const st = nextStation();
    if (st && !G.doors && G.train.s > st.stop + 15) {
      G.results.push({ name: st.name, err: G.train.s - st.stop, grade: 'X' });
      flash(`${st.name} 정차 실패 (과주)`, '#ff5050', 3);
      if (st.idx === G.endIdx) { setTimeout(finish, 1500); }
      G.nextStop++;
    }
    // 절연구간 정차
    if (G.train.v === 0 && G.train.s > DS.start + 25 && G.train.s < DS.end + 175 && !G.deadStall) {
      flash('절연구간 내 정차! (실제: 구원운전 필요)', '#ff5050', 4);
    }
  }

  // ───── 제동 예측 (10 Hz) ─────
  function predict() {
    const env = { loadFactor: opts.load };
    const st = nextStation();
    const tr = G.train;
    const targets = [];
    if (st) targets.push({ type: 'stop', s: st.stop, v: 0, name: st.name });
    const look = G.atc.lookahead(tr.s, G.codes, 1800);
    for (const c of look) if (c.code * 1 < tr.v * KMH + 0.01) targets.push({ type: 'atc', s: c.s, v: Math.max(0, c.code - 2) / KMH, code: c.code });
    // 현재 블록 코드가 이미 0 이면 블록 끝이 정지목표
    let best = null;
    for (const tg of targets) {
      const r = Pr.brakeMargin(tr, tg, -opts.planNotch, env);
      tg.margin = r.margin; tg.dist = tg.s - tr.s;
      if (!best || tg.margin < best.margin) best = tg;
    }
    const braking = G.notch < 0 || G.atc.braking;
    const eff = G.atc.braking ? Math.min(G.notch, -7) : G.notch;
    const ps = braking ? Pr.predictStop(tr, eff, env) : null;
    let rec = null;
    if (best && best.type === 'stop' && (braking || best.margin < 60) && tr.v > 0.5) rec = Pr.recommendNotch(tr, best.s, env).notch;
    G.pred = { targets, best, predStop: ps, rec, look };
  }

  // ───── 화면 투영 ─────
  const _v = new THREE.Vector3();
  function project(s, l, h) {
    W3.point(s, l, h, _v);
    _v.project(camera);
    if (_v.z > 1 || _v.z < -1) return null;
    const { W, H } = RS.HUD.size;
    return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H };
  }

  function updateCamera() {
    const s = G.train.s;
    const eye = W3.point(s - 1.2, -0.55, 2.75, new THREE.Vector3());
    const vK = G.train.v * KMH;
    eye.y += Math.sin(G.t * 9) * 0.006 * Math.min(1, vK / 60);
    const look = W3.point(s + 60, -0.3, 2.75 - 60 * Math.tan(9 * Math.PI / 180), new THREE.Vector3());
    camera.position.copy(eye); camera.lookAt(look);
    camera.updateMatrixWorld();
    head.position.copy(W3.point(s, 0, 1.4, new THREE.Vector3()));
    head.target.position.copy(W3.point(s + 80, 0, 0, new THREE.Vector3()));

    // 지하/지상 조명 전환
    const T1 = R.tunnels[0][1];
    const out = Math.max(0, Math.min(1, (s - (T1 - 350)) / 350));
    const stW = W3.stationWiden(s + 40);
    ambient.intensity = 0.32 + 0.45 * stW + 0.45 * out;
    hemi.intensity = 0.15 + 0.6 * out;
    head.intensity = 1.6 * (1 - out * 0.8);
    scene.background.copy(DARK).lerp(SKY, out);
    scene.fog.color.copy(DARK).lerp(SKY, out);
    scene.fog.near = 40 + 200 * out; scene.fog.far = 420 + 900 * out + 120 * stW;
  }

  function fmtClock(t) {
    const x = Math.floor(G.clock0 + t);
    const h = Math.floor(x / 3600) % 24, m = Math.floor(x / 60) % 60, s = x % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // ───── 프레임 ─────
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    if (!G) { renderer.render(scene, camera); return; }
    if (G.running) {
      const sub = Math.ceil(dt / (1 / 120));
      for (let i = 0; i < sub; i++) step(dt / sub);
      G.accel = G.accel * 0.9 + ((G.train.v - G.lastV) / Math.max(dt, 1e-3)) * 0.1;
      G.lastV = G.train.v;
      G.predT -= dt;
      if (G.predT <= 0 || !G.pred) { predict(); G.predT = 0.1; }
      if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) G.msg = null; }
      if (G.trail.length === 0 || G.train.s - G.trail[G.trail.length - 1][0] > 4) {
        G.trail.push([G.train.s, G.train.v * KMH]);
        if (G.trail.length > 600) G.trail.shift();
      }
      RS.Audio.update(dt, G.train.v * KMH, G.train.tAct, G.train.bAct, G.atc.braking || G.atc.overspeedWarn && G.train.v * KMH > G.atc.code);
    }
    updateCamera();
    const ld = G.leader.enabled ? G.leader.rear - G.train.s : null;
    leaderMesh.update(G.leader.s, G.leader.enabled && ld < 1500 && ld > -50);
    renderer.render(scene, camera);
    drawHUD();
  }

  function drawHUD() {
    const tr = G.train, vK = tr.v * KMH, st = nextStation(), p = G.pred || {};
    const braking = G.notch < 0 || G.atc.braking;
    const best = p.best || null;
    const sCam = tr.s - 1.2;
    const predErr = (p.predStop !== null && p.predStop !== undefined && st) ? p.predStop - st.stop : null;
    const dsAhead = DS.start - tr.s;
    const inDead = tr.s > DS.start + 25 && tr.s < DS.end + 175;
    const ldist = G.leader.enabled ? G.leader.rear - tr.s : null;
    const d = {
      hudOn: opts.hud,
      vKmh: vK, code: G.atc.code, s: tr.s,
      nextCodes: (p.look || []).slice(0, 1).map(c => ({ code: c.code, dist: c.s - tr.s })),
      station: st ? { name: st.name, dist: st.stop - tr.s, side: st.side } : null,
      guidance: best ? { type: best.type, margin: best.margin, dist: best.dist, name: best.name, v: best.code } : null,
      braking, predStop: predErr !== null ? { err: predErr } : null,
      rec: p.rec && p.rec <= 7 ? p.rec : (p.rec === 8 ? 7 : null),
      notch: G.notch, notchName: Ph.notchName(G.notch), planNotch: opts.planNotch,
      atcBraking: G.atc.braking, overspeedWarn: G.atc.overspeedWarn && vK > G.atc.code - 2,
      supply: supplyText(), grade: R.gradeAt(tr.s), clock: fmtClock(G.t),
      dead: (dsAhead < 600 && tr.s < DS.end + 175) ? { inDead, remain: DS.end + 175 - tr.s, ahead: dsAhead } : null,
      doors: G.doors, msg: G.msg,
      leaderDist: ldist !== null && ldist > 0 && ldist < 3000 ? ldist : null,
      bc: tr.bAct / (Ph.P.ebDecel) * 450, accel: G.accel, interventions: G.atc.interventions,
      ar: {
        sCam,
        stopMark: st && st.stop - sCam < 900 ? st.stop : null,
        brakePoint: best && best.margin > 2 && best.margin < 900 && !braking ? tr.s + best.margin : null,
        predStop: p.predStop !== null && p.predStop !== undefined && p.predStop - sCam > 5 ? p.predStop : null,
        codes: (p.look || []).filter(c => c.s - sCam < 700 && c.s - sCam > 5),
        dead: dsAhead > 5 && dsAhead < 500 ? [DS.start, DS.end] : null,
      },
    };
    RS.HUD.draw(d, project);
    const blocksView = R.blocks.map((b, i) => ({ start: b.start, end: b.end, code: G.codes[i] }));
    const targets = [];
    if (st) targets.push({ s: st.stop, v: 0 });
    (p.targets || []).filter(t => t.type === 'atc').forEach(t => targets.push({ s: t.s, v: t.v }));
    RS.HUD.drawDash(d, {
      stations: R.stations, blocks: blocksView, dead: DS, trail: G.trail, targets,
      planDecel: Ph.brakeCmd(-opts.planNotch),
      brakePoint: d.ar.brakePoint, predStop: p.predStop !== undefined ? p.predStop : null,
    });
  }

  // ───── 메뉴 / 결과 ─────
  const menu = document.getElementById('menu');
  const result = document.getElementById('result');
  const selS = document.getElementById('startSt'), selE = document.getElementById('endSt');
  R.stations.forEach((st, i) => {
    if (i < R.stations.length - 1) selS.add(new Option(`${st.no} ${st.name}`, i));
    if (i > 0) selE.add(new Option(`${st.no} ${st.name}`, i));
  });
  selE.value = R.stations.length - 1;

  function showMenu() {
    if (G) G.running = false;
    menu.classList.remove('hidden'); result.classList.add('hidden');
  }
  document.getElementById('startBtn').addEventListener('click', () => {
    RS.Audio.init();
    opts.leader = document.getElementById('optLeader').checked;
    opts.load = 1 + Number(document.getElementById('optLoad').value) / 100 * 0.6;
    opts.planNotch = Number(document.getElementById('optPlan').value);
    let a = Number(selS.value), b = Number(selE.value);
    if (b <= a) b = a + 1;
    newGame(a, b);
    menu.classList.add('hidden');
  });
  document.getElementById('againBtn').addEventListener('click', showMenu);

  function finish() {
    if (!G || G.finished) return;
    G.finished = true; G.running = false;
    const rows = G.results.map(r => `<tr><td>${r.name}</td><td>${r.grade === 'X' ? '과주 통과' : (r.err >= 0 ? '+' : '') + r.err.toFixed(2) + ' m'}</td><td class="g${r.grade}">${r.grade}</td></tr>`).join('');
    const ok = G.results.filter(r => r.grade !== 'X');
    const avg = ok.length ? ok.reduce((a, r) => a + Math.abs(r.err), 0) / ok.length : 0;
    const m = Math.floor(G.t / 60), s = Math.floor(G.t % 60);
    document.getElementById('resultBody').innerHTML = `
      <p>운행시간 <b>${m}분 ${s}초</b> · 평균 정지오차 <b>${avg.toFixed(2)} m</b> · ATC 개입 <b>${G.atc.interventions}회</b></p>
      <table><thead><tr><th>역</th><th>정지오차</th><th>등급</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="small">S: ±0.5 m 이내 · A: ±1 m · B: ±2 m · C: ±5 m · X: 정차 실패</p>`;
    result.classList.remove('hidden');
  }

  requestAnimationFrame(frame);
  // 메뉴 배경용 초기 카메라
  G = null;
  const e0 = W3.point(R.stations[0].stop - 1.2, -0.55, 2.75, new THREE.Vector3());
  camera.position.copy(e0); camera.lookAt(W3.point(R.stations[0].stop + 60, -0.3, -6.7, new THREE.Vector3()));
  ambient.intensity = 0.8;
})();
