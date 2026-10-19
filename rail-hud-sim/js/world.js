// 3D 선로/터널/역사 생성 (three.js, 텍스처는 모두 코드로 생성 → 저작권 문제 없음)
window.RS = window.RS || {};

RS.World = (function () {
  const R = RS.ROUTE;
  const STEP = 2;

  // ───────── 선형(중심선) ─────────
  const N = Math.floor((R.S_MAX - R.S_MIN) / STEP) + 1;
  const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N);
  (function buildAlignment() {
    let x = 0, y = 0, z = 0, th = 0;
    // s=0 을 원점으로 맞추기 위해 S_MIN 부터 적분한 뒤 평행이동
    for (let i = 0; i < N; i++) {
      const s = R.S_MIN + i * STEP;
      X[i] = x; Y[i] = y; Z[i] = z; H[i] = th;
      let k = 0;
      for (const [a, b, rad] of R.curves) if (s >= a && s < b) k = 1 / rad;
      th += k * STEP;
      x += Math.sin(th) * STEP;
      z -= Math.cos(th) * STEP;
      y += R.gradeAt(s) / 1000 * STEP;
    }
    const i0 = Math.round(-R.S_MIN / STEP);
    const ox = X[i0], oy = Y[i0], oz = Z[i0];
    for (let i = 0; i < N; i++) { X[i] -= ox; Y[i] -= oy; Z[i] -= oz; }
  })();

  function frame(s, out) {
    out = out || {};
    let f = (s - R.S_MIN) / STEP;
    if (f < 0) f = 0; if (f > N - 1.001) f = N - 1.001;
    const i = Math.floor(f), t = f - i;
    out.x = X[i] + (X[i + 1] - X[i]) * t;
    out.y = Y[i] + (Y[i + 1] - Y[i]) * t;
    out.z = Z[i] + (Z[i + 1] - Z[i]) * t;
    const th = H[i] + (H[i + 1] - H[i]) * t;
    out.fx = Math.sin(th); out.fz = -Math.cos(th);
    out.rx = Math.cos(th); out.rz = Math.sin(th);
    out.th = th;
    return out;
  }

  function point(s, l, h, v3) {
    const f = frame(s, _f);
    v3 = v3 || new THREE.Vector3();
    return v3.set(f.x + f.rx * l, f.y + h, f.z + f.rz * l);
  }
  const _f = {};

  // ───────── 프로시저럴 텍스처 ─────────
  function noiseTexture(base, var_, w, h, repeatX, repeatY, lines) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * var_;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    if (lines) lines(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 4;
    return t;
  }

  function textTexture(draw, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  // ───────── 스윕 지오메트리 ─────────
  // profileFn(s) → [[l,h],[l,h],...] (모든 s에서 점 개수 동일)
  // uvMode: v 좌표는 진행거리, u 는 단면 둘레길이
  function sweep(s0, s1, step, profileFn, uScale, vScale) {
    const pos = [], uv = [], idx = [];
    let rows = 0, cols = 0;
    const tmp = new THREE.Vector3();
    for (let s = s0; s <= s1 + 1e-6; s += step) {
      const prof = profileFn(s);
      cols = prof.length;
      let u = 0;
      for (let j = 0; j < cols; j++) {
        if (j > 0) u += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
        point(s, prof[j][0], prof[j][1], tmp);
        pos.push(tmp.x, tmp.y, tmp.z);
        uv.push(u * (uScale || 0.25), s * (vScale || 0.25));
      }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = r * cols + j, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // 구간 분할 (큰 메시 하나 대신 여러 덩어리 → 절두체 컬링 효과)
  function sweepChunks(scene, s0, s1, step, profileFn, mat, chunk, uS, vS) {
    chunk = chunk || 400;
    for (let a = s0; a < s1; a += chunk) {
      const b = Math.min(s1, a + chunk);
      const m = new THREE.Mesh(sweep(a, b, step, profileFn, uS, vS), mat);
      scene.add(m);
    }
  }

  function stationNear(s, pad) {
    return R.stations.find(st => s >= st.pStart - pad && s <= st.pEnd + pad) || null;
  }
  function smoothstep(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  // 역 구간 확폭 비율 (0~1)
  function stationWiden(s) {
    let w = 0;
    for (const st of R.stations) {
      const a = st.pStart - 15, b = st.pEnd + 15;
      w = Math.max(w, smoothstep(a - 25, a, s) * (1 - smoothstep(b, b + 25, s)));
    }
    return w;
  }
  function stationSideSign(s) {
    const st = stationNear(s, 60);
    if (!st) return 0;
    return st.side === 'R' ? 1 : -1;
  }
  // 상대선 위치 (단선터널 구간은 0으로 수렴시켜 터널 폭 축소)
  function otherOffSmooth(s) {
    const T = R.twist;
    if (s < T.start - 30) return -4;
    if (s > T.end + 30) return 4;
    if (s < T.start) return -4 * (1 - smoothstep(T.start - 30, T.start, s));
    if (s > T.end) return 4 * smoothstep(T.end, T.end + 30, s);
    return 0;
  }

  // ───────── 장면 구성 ─────────
  function build(scene) {
    const mats = {
      concrete: new THREE.MeshLambertMaterial({ map: noiseTexture('#6e6d69', 26, 128, 128, 1, 1), side: THREE.DoubleSide }),
      tunnel: new THREE.MeshLambertMaterial({ map: noiseTexture('#55534f', 30, 128, 128, 1, 1, (g, w, h) => {
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
        for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      }), side: THREE.DoubleSide }),
      slab: new THREE.MeshLambertMaterial({ map: noiseTexture('#7d7b76', 22, 64, 64, 1, 1), side: THREE.DoubleSide }),
      ballast: new THREE.MeshLambertMaterial({ map: noiseTexture('#6a645c', 90, 128, 128, 1, 1), side: THREE.DoubleSide }),
      rail: new THREE.MeshLambertMaterial({ color: 0x9aa0a6, emissive: 0x1a1c1f }),
      railTop: new THREE.MeshBasicMaterial({ color: 0xc9ced3 }),
      sleeper: new THREE.MeshLambertMaterial({ color: 0x5f5d58 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff3d6 }),
      lampCool: new THREE.MeshBasicMaterial({ color: 0xeaf4ff }),
      wire: new THREE.MeshLambertMaterial({ color: 0x3a3226, emissive: 0x0d0b08 }),
      deadWire: new THREE.MeshBasicMaterial({ color: 0xe0782a }),
      platform: new THREE.MeshLambertMaterial({ map: noiseTexture('#b8b4aa', 18, 128, 128, 1, 1, (g, w, h) => {
        g.strokeStyle = 'rgba(70,70,70,0.35)'; g.lineWidth = 1;
        for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
        for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      }), side: THREE.DoubleSide }),
      yellow: new THREE.MeshLambertMaterial({ color: 0xf2c200, emissive: 0x3a2e00, side: THREE.DoubleSide }),
      psdGlass: new THREE.MeshLambertMaterial({ color: 0x9fc6d6, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
      psdFrame: new THREE.MeshLambertMaterial({ color: 0xc9ccd0 }),
      ground: new THREE.MeshLambertMaterial({ map: noiseTexture('#5d6b47', 40, 128, 128, 1, 1), side: THREE.DoubleSide }),
      pole: new THREE.MeshLambertMaterial({ color: 0x8a8f94 }),
      wall: new THREE.MeshLambertMaterial({ map: noiseTexture('#9a9890', 14, 128, 128, 1, 1), side: THREE.DoubleSide }),
    };

    const T0 = R.tunnels[0][0], T1 = R.tunnels[0][1];

    // 도상 (터널: 콘크리트 도상 / 지상: 자갈 도상)
    sweepChunks(scene, R.S_MIN, T1, 4, () => [[-2.0, -0.35], [-1.3, -0.25], [1.3, -0.25], [2.0, -0.35]], mats.slab, 400, 0.4, 0.4);
    sweepChunks(scene, T1, R.S_MAX, 4, () => [[-3.2, -0.9], [-1.7, -0.25], [1.7, -0.25], [3.2, -0.9]], mats.ballast, 400, 0.5, 0.5);

    // 레일 (본선)
    const railProf = (l) => () => [[l - 0.035, -0.17], [l - 0.035, 0], [l + 0.035, 0], [l + 0.035, -0.17]];
    for (const l of [-0.7175, 0.7175]) {
      sweepChunks(scene, R.S_MIN, R.S_MAX, 4, railProf(l), mats.rail, 500);
      sweepChunks(scene, R.S_MIN, R.S_MAX, 4, () => [[l - 0.03, 0.002], [l + 0.03, 0.002]], mats.railTop, 500);
    }

    // 상대선 레일 + 도상
    for (const seg of [[R.S_MIN, R.twist.start], [R.twist.end, R.S_MAX]]) {
      const off = (s) => R.otherTrackOffset(s) || 0;
      sweepChunks(scene, seg[0], seg[1], 4, s => { const o = off(s); return [[o - 2.0, -0.35], [o - 1.3, -0.25], [o + 1.3, -0.25], [o + 2.0, -0.35]]; }, seg[0] > 10000 ? mats.ballast : mats.slab, 400, 0.4, 0.4);
      for (const l of [-0.7175, 0.7175]) {
        sweepChunks(scene, seg[0], seg[1], 4, s => { const o = off(s) + l; return [[o - 0.035, -0.17], [o - 0.035, 0], [o + 0.035, 0], [o + 0.035, -0.17]]; }, mats.rail, 500);
      }
    }

    // 침목 (Instanced)
    {
      const geo = new THREE.BoxGeometry(2.3, 0.12, 0.24);
      const list = [];
      for (let s = R.S_MIN; s < R.S_MAX; s += 1.0) {
        list.push([s, 0]);
        const o = R.otherTrackOffset(s);
        if (o !== null && Math.floor(s) % 2 === 0) list.push([s, o]);
      }
      const im = new THREE.InstancedMesh(geo, mats.sleeper, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      list.forEach(([s, l], i) => {
        const f = frame(s, {});
        point(s, l, -0.22, p);
        e.set(0, -f.th, 0);
        q.setFromEuler(e);
        m.compose(p, q, sc);
        im.setMatrixAt(i, m);
      });
      scene.add(im);
    }

    // 터널 단면
    const tunnelProfile = (s) => {
      const o = otherOffSmooth(s);
      const w = stationWiden(s);
      const side = stationSideSign(s);
      let L = Math.min(0, o) - 3.0, Rr = Math.max(0, o) + 3.0;
      if (side > 0) Rr += 4.6 * w; else if (side < 0) L -= 4.6 * w;
      const top = 5.9 + 1.4 * w;
      const mid = (L + Rr) / 2;
      return [[L, -0.4], [L, 4.2 + 0.8 * w], [L + 1.2, top - 0.4], [mid, top], [Rr - 1.2, top - 0.4], [Rr, 4.2 + 0.8 * w], [Rr, -0.4]];
    };
    sweepChunks(scene, T0, T1, 2, tunnelProfile, mats.tunnel, 300, 0.12, 0.12);
    // 터널 바닥
    sweepChunks(scene, T0, T1, 4, s => { const p = tunnelProfile(s); return [[p[0][0], -0.4], [p[6][0], -0.4]]; }, mats.concrete, 400, 0.2, 0.2);

    // 갱구(터널 입구) 벽면
    {
      const f = frame(T1, {});
      const prof = tunnelProfile(T1 - 1);
      const L = prof[0][0], Rr = prof[6][0];
      const mk = (w, h, l, y) => {
        const mm = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats.wall);
        const p = point(T1, l, y);
        mm.position.copy(p); mm.rotation.y = -f.th;
        scene.add(mm);
      };
      mk(30, 16, L - 15, 6);
      mk(30, 16, Rr + 15, 6);
      mk(Rr - L, 10, (L + Rr) / 2, 6.0 + 5);
    }

    // 지상 구간 지면 + 하늘
    sweepChunks(scene, T1, R.S_MAX, 8, () => [[-140, -1.4], [-8, -1.0], [8, -1.0], [140, -1.4]], mats.ground, 400, 0.05, 0.05);
    // 방음벽 / 옹벽 느낌의 측벽
    sweepChunks(scene, T1 + 2, 12600, 4, () => [[-9, -1.0], [-9, 3.5]], mats.wall, 400, 0.2, 0.2);
    sweepChunks(scene, T1 + 2, 12600, 4, () => [[9.5, -1.0], [9.5, 3.5]], mats.wall, 400, 0.2, 0.2);

    // 전차선: 터널(강체전차선) / 지상(가공전차선)
    const DS = R.deadSection;
    const wireProf = (h, w) => () => [[-w, h], [w, h], [w, h - w * 2], [-w, h - w * 2], [-w, h]];
    sweepChunks(scene, R.S_MIN, DS.start, 4, wireProf(5.1, 0.06), mats.wire, 500);
    sweepChunks(scene, DS.start, DS.end, 2, wireProf(5.1, 0.07), mats.deadWire, 200);
    sweepChunks(scene, DS.end, T1, 4, wireProf(5.1, 0.06), mats.wire, 500);
    sweepChunks(scene, T1, R.S_MAX, 4, wireProf(5.2, 0.012), mats.wire, 500);
    sweepChunks(scene, T1, R.S_MAX, 4, wireProf(6.4, 0.015), mats.wire, 500);
    // 상대선 전차선
    for (const seg of [[R.S_MIN, R.twist.start], [R.twist.end, T1]]) {
      sweepChunks(scene, seg[0], seg[1], 4, s => { const o = R.otherTrackOffset(s) || 0; return [[o - 0.06, 5.1], [o + 0.06, 5.1], [o + 0.06, 4.98], [o - 0.06, 4.98]]; }, mats.wire, 500);
    }

    const instances = (geo, mat, items) => {
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      items.forEach((it, i) => {
        const f = frame(it.s, {});
        point(it.s, it.l, it.h, p);
        e.set(it.rx || 0, -f.th + (it.ry || 0), 0);
        q.setFromEuler(e);
        m.compose(p, q, sc);
        im.setMatrixAt(i, m);
      });
      scene.add(im);
      return im;
    };

    // 터널 조명 + 강체전차선 지지물
    {
      const lamps = [], brackets = [];
      for (let s = T0; s < T1; s += 12) {
        const p = tunnelProfile(s);
        if (stationWiden(s) > 0.05) continue;
        lamps.push({ s, l: p[0][0] + 0.05, h: 3.4 });
        lamps.push({ s: s + 6, l: p[6][0] - 0.05, h: 3.4 });
      }
      for (let s = T0; s < T1; s += 8) brackets.push({ s, l: 0, h: 5.35 });
      instances(new THREE.BoxGeometry(0.06, 0.08, 0.9), mats.lamp, lamps);
      instances(new THREE.BoxGeometry(0.9, 0.18, 0.12), mats.wire, brackets);
    }

    // 지상 전철주 + 가동브래킷
    {
      const poles = [], arms = [];
      for (let s = T1 + 25; s < R.S_MAX; s += 50) {
        poles.push({ s, l: -4.2, h: 3.4 });
        poles.push({ s, l: 8.2, h: 3.4 });
        arms.push({ s, l: 2.0, h: 6.6 });
      }
      instances(new THREE.BoxGeometry(0.35, 9, 0.35), mats.pole, poles);
      instances(new THREE.BoxGeometry(12.6, 0.15, 0.15), mats.pole, arms);
    }

    // 역사
    for (const st of R.stations) buildStation(scene, st, mats, instances);

    // 표지류
    buildSigns(scene, mats);
  }

  function buildStation(scene, st, mats, instances) {
    const sd = st.side === 'R' ? 1 : -1;
    const a = st.pStart, b = st.pEnd;
    const edge = 1.65, depth = 4.4, ph = 1.1;
    const P = (l) => sd * l;
    const orient = (arr) => (sd > 0 ? arr : arr.slice().reverse().map(([l, h]) => [l, h]));
    // 승강장 상판
    sweepChunks(scene, a, b, 5, () => orient([[P(edge), ph], [P(edge + depth), ph]]), mats.platform, 300, 0.25, 0.25);
    // 승강장 측면
    sweepChunks(scene, a, b, 5, () => [[P(edge), -0.3], [P(edge), ph]], mats.concrete, 300);
    // 점자블록/안전선
    sweepChunks(scene, a, b, 5, () => orient([[P(edge + 0.15), ph + 0.01], [P(edge + 0.45), ph + 0.01]]), mats.yellow, 300, 1, 1);
    // 역 벽면 (역 색상 띠)
    const band = new THREE.MeshLambertMaterial({ color: new THREE.Color(st.color), side: THREE.DoubleSide });
    sweepChunks(scene, a - 10, b + 10, 5, () => [[P(edge + depth + 0.15), ph + 1.6], [P(edge + depth + 0.15), ph + 2.4]], band, 300);
    sweepChunks(scene, a - 10, b + 10, 5, () => [[P(edge + depth + 0.16), ph], [P(edge + depth + 0.16), ph + 1.6]], mats.wall, 300);

    // 스크린도어
    const posts = [], glass = [];
    for (let s = a + 2; s < b; s += 3.5) posts.push({ s, l: P(edge + 0.25), h: ph + 1.1 });
    instances(new THREE.BoxGeometry(0.12, 2.2, 0.15), mats.psdFrame, posts);
    sweepChunks(scene, a + 2, b - 2, 5, () => orient([[P(edge + 0.25), ph + 0.1], [P(edge + 0.25), ph + 2.1]]), mats.psdGlass, 300);
    sweepChunks(scene, a + 2, b - 2, 5, () => [[P(edge + 0.25), ph + 2.15], [P(edge + 0.25), ph + 2.45]], mats.psdFrame, 300);

    // 천장 조명 (밝은 형광등 라인)
    const lights = [];
    for (let s = a - 10; s < b + 10; s += 4) {
      lights.push({ s, l: P(edge + 2.0), h: 6.6 });
      lights.push({ s, l: 0, h: 6.9 });
    }
    instances(new THREE.BoxGeometry(0.25, 0.08, 3.0), mats.lampCool, lights);

    // 역명판 (승강장 벽면, 선로를 향함)
    const tex = textTexture((g, w, h) => {
      g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h);
      g.fillStyle = st.color; g.fillRect(0, h - 26, w, 26);
      g.fillStyle = '#00a5de'; g.beginPath(); g.arc(70, h / 2 - 10, 46, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(st.no, 70, h / 2 - 8);
      g.fillStyle = '#111'; g.font = 'bold 84px "Noto Sans KR", "Malgun Gothic", sans-serif'; g.textAlign = 'left';
      g.fillText(st.name, 140, h / 2 - 28);
      g.font = '34px sans-serif'; g.fillStyle = '#444';
      g.fillText(st.en, 144, h / 2 + 36);
    }, 1024, 220);
    const signMat = new THREE.MeshBasicMaterial({ map: tex });
    for (let s = a + 20; s < b; s += 45) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.0), signMat);
      const f = frame(s, {});
      m.position.copy(point(s, P(edge + depth + 0.1), ph + 2.0));
      m.rotation.y = -f.th + (sd > 0 ? -Math.PI / 2 : Math.PI / 2);
      scene.add(m);
    }
    // 승강장 위 매달린 역명판 (진행방향 정면을 향함)
    for (const s of [st.s - 60, st.s + 30]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7), signMat);
      const f = frame(s, {});
      m.position.copy(point(s, P(edge + 2.2), 4.8));
      m.rotation.y = -f.th;
      scene.add(m);
    }

    // 정지위치표 "10"
    const stopTex = textTexture((g, w, h) => {
      g.fillStyle = '#ffd400'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = '#111'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('10', w / 2, h / 2 + 8);
    }, 256, 256);
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: stopTex }));
    const fs = frame(st.stop, {});
    sm.position.copy(point(st.stop, P(edge + 0.8), ph + 2.9));
    sm.rotation.y = -fs.th;
    scene.add(sm);
  }

  function signMesh(scene, s, l, h, w, hh, draw, faceBack) {
    const tex = textTexture(draw, 256, Math.round(256 * hh / w));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ map: tex }));
    const f = frame(s, {});
    m.position.copy(point(s, l, h));
    m.rotation.y = -f.th + (faceBack ? Math.PI : 0);
    scene.add(m);
  }

  function buildSigns(scene) {
    const DS = R.deadSection;
    const sideL = (s) => { const o = R.otherTrackOffset(s); return o !== null && o < 0 ? 2.6 : -2.6; };
    const panel = (bg, fg, lines) => (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach((t, i) => { g.font = `bold ${t[1]}px "Noto Sans KR", sans-serif`; g.fillText(t[0], w / 2, h * (i + 1) / (lines.length + 1)); });
    };
    signMesh(scene, DS.start - 300, sideL(DS.start - 300), 2.6, 0.8, 1.0, panel('#ffffff', '#111', [['절연', 60], ['예고', 60]]));
    signMesh(scene, DS.start - 10, sideL(DS.start), 2.6, 0.8, 1.0, panel('#111', '#ffd400', [['역행', 60], ['OFF', 64]]));
    signMesh(scene, DS.end + 200, sideL(DS.end + 200), 2.6, 0.8, 1.0, panel('#ffffff', '#0a7a2f', [['역행', 60], ['ON', 64]]));
    // 교직 절연 애자 표시
    for (const s of [DS.start, DS.end]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 1.2), new THREE.MeshBasicMaterial({ color: 0xa8582a }));
      const f = frame(s, {});
      m.position.copy(point(s, 0, 5.0)); m.rotation.y = -f.th;
      scene.add(m);
    }
    // 곡선 제한속도표
    for (const [a, , rad] of R.curves) {
      const lim = rad ? (Math.abs(rad) <= 400 ? 60 : Math.abs(rad) <= 600 ? 70 : 0) : 0;
      if (!lim) continue;
      const s = a - 30 - 150;
      signMesh(scene, s, sideL(s), 2.2, 0.7, 0.7, (g, w, h) => {
        g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); g.fill();
        g.strokeStyle = '#d0021b'; g.lineWidth = 26; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 18, 0, 7); g.stroke();
        g.fillStyle = '#111'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(lim), w / 2, h / 2 + 6);
      });
    }
    // ATC 폐색 경계표
    for (const b of R.blocks) {
      if (b.start <= R.S_MIN + 1) continue;
      const s = b.start;
      signMesh(scene, s, sideL(s) * 0.92, 1.4, 0.35, 0.5, (g, w, h) => {
        g.fillStyle = '#1d4fa0'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff'; g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('B' + b.idx, w / 2, h / 2);
      });
    }
    // 거리표 (100 m 마다)
    for (let s = 0; s < R.S_MAX; s += 200) {
      signMesh(scene, s, sideL(s) * 0.95, 0.5, 0.32, 0.22, (g, w, h) => {
        g.fillStyle = '#eee'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#111'; g.font = 'bold 64px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText((s / 1000).toFixed(1), w / 2, h / 2);
      });
    }
  }

  // ───────── 열차 메시 (선행열차) ─────────
  function makeTrain(scene) {
    const group = [];
    const body = new THREE.MeshLambertMaterial({ color: 0xd9dde2 });
    const stripe = new THREE.MeshLambertMaterial({ color: 0x1b6fc2 });
    const tail = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.4, 19.5), body);
      b.position.y = 2.6; g.add(b);
      const st = new THREE.Mesh(new THREE.BoxGeometry(3.12, 0.3, 19.5), stripe);
      st.position.y = 2.2; g.add(st);
      if (i === 9) {
        for (const x of [-1.1, 1.1]) {
          const t = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.05), tail);
          t.position.set(x, 1.6, 9.78); g.add(t);
        }
      }
      scene.add(g);
      group.push(g);
    }
    return {
      update(sFront, visible) {
        group.forEach((g, i) => {
          const sc = sFront - 10 - i * 20;
          g.visible = visible;
          if (!visible) return;
          const f = frame(sc, {});
          g.position.set(f.x, f.y, f.z);
          g.rotation.y = -f.th;
        });
      },
    };
  }

  return { build, frame, point, makeTrain, stationWiden };
})();
