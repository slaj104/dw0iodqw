// 3D 선로·터널·역사·전차선·표지 생성 (운전 방향 좌표 u 기준, 코스마다 새로 생성)
// 텍스처: Poly Haven CC0 (assets/tex) → js/assets_bundle.js 로 묶여 있으면 사용, 없으면 코드로 생성
window.RS = window.RS || {};

RS.World = (function () {
  const STEP = 2;
  const loader = new THREE.TextureLoader();
  const FONT = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

  function assetTex(name, fallback) {
    const A = RS.ASSETS && RS.ASSETS.tex;
    let t = null;
    if (A && A[name]) t = loader.load(A[name]);
    else if (fallback) t = fallback();
    if (!t) return null;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }

  function noiseTexture(base, var_, w, h) {
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
    return new THREE.CanvasTexture(c);
  }

  function textTexture(draw, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function build(course) {
    const C = course;
    const scene = new THREE.Scene();

    // ───── 선형 ─────
    const N = Math.floor((C.uMax - C.uMin) / STEP) + 1;
    const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N);
    {
      let x = 0, y = 0, z = 0, th = 0;
      for (let i = 0; i < N; i++) {
        const u = C.uMin + i * STEP;
        X[i] = x; Y[i] = y; Z[i] = z; H[i] = th;
        let k = 0;
        for (const [a, b, rad] of C.curves) if (u >= a && u < b) k = 1 / rad;
        th += k * STEP;
        x += Math.sin(th) * STEP; z -= Math.cos(th) * STEP;
        y += C.gradeAt(u) / 1000 * STEP;
      }
    }
    const _f = {};
    function frame(u, out) {
      out = out || {};
      let f = (u - C.uMin) / STEP;
      if (f < 0) f = 0; if (f > N - 1.001) f = N - 1.001;
      const i = Math.floor(f), t = f - i;
      out.x = X[i] + (X[i + 1] - X[i]) * t;
      out.y = Y[i] + (Y[i + 1] - Y[i]) * t;
      out.z = Z[i] + (Z[i + 1] - Z[i]) * t;
      const th = H[i] + (H[i + 1] - H[i]) * t;
      out.rx = Math.cos(th); out.rz = Math.sin(th); out.th = th;
      return out;
    }
    function point(u, l, h, v3) {
      const f = frame(u, _f);
      v3 = v3 || new THREE.Vector3();
      return v3.set(f.x + f.rx * l, f.y + h, f.z + f.rz * l);
    }

    function sweep(u0, u1, step, prof, uS, vS) {
      const pos = [], uv = [], idx = [];
      let rows = 0, cols = 0;
      const tmp = new THREE.Vector3();
      for (let u = u0; u <= u1 + 1e-6; u += step) {
        const p = prof(u);
        cols = p.length;
        let s = 0;
        for (let j = 0; j < cols; j++) {
          if (j > 0) s += Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]);
          point(u, p[j][0], p[j][1], tmp);
          pos.push(tmp.x, tmp.y, tmp.z);
          uv.push(s * (uS || 0.25), (u - C.uMin) * (vS || 0.25));
        }
        rows++;
      }
      for (let r = 0; r < rows - 1; r++) for (let j = 0; j < cols - 1; j++) {
        const a = r * cols + j, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    function chunks(u0, u1, step, prof, mat, chunk, uS, vS) {
      chunk = chunk || 400;
      for (let a = u0; a < u1; a += chunk) {
        const b = Math.min(u1, a + chunk);
        if (b - a < step) continue;
        scene.add(new THREE.Mesh(sweep(a, b, step, prof, uS, vS), mat));
      }
    }
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    function instances(geo, mat, items) {
      if (!items.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((it, i) => {
        const f = frame(it.u, {});
        point(it.u, it.l, it.h, tmpP);
        tmpE.set(it.rx || 0, -f.th + (it.ry || 0), 0);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpP, tmpQ, one);
        im.setMatrixAt(i, tmpM);
      });
      scene.add(im);
      return im;
    }
    function plane(u, l, h, w, hh, mat, ry) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
      const f = frame(u, {});
      m.position.copy(point(u, l, h));
      m.rotation.y = -f.th + (ry || 0);
      scene.add(m);
      return m;
    }

    const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const stationWiden = (u) => {
      let w = 0;
      for (const st of C.stations) {
        const a = st.pStart - 15, b = st.pEnd + 15;
        w = Math.max(w, smooth(a - 25, a, u) * (1 - smooth(b, b + 25, u)));
      }
      return w;
    };
    const stationSide = (u) => {
      const st = C.stations.find(s => u >= s.pStart - 60 && u <= s.pEnd + 60);
      return st ? (st.side === 'R' ? 1 : -1) : 0;
    };
    const T = C.twist;
    const offA = C.otherOffset(T.start - 50), offB = C.otherOffset(T.end + 50);
    const otherSmooth = (u) => {
      if (u < T.start - 30) return offA;
      if (u > T.end + 30) return offB;
      if (u < T.start) return offA * (1 - smooth(T.start - 30, T.start, u));
      if (u > T.end) return offB * smooth(T.end, T.end + 30, u);
      return 0;
    };
    const otherOff = (u) => { const o = C.otherOffset(u); return o === null ? 0 : o; };

    // ───── 재질 ─────
    const ph = (o) => new THREE.MeshPhongMaterial(Object.assign({ side: THREE.DoubleSide, shininess: 8 }, o));
    const M = {
      tunnel: ph({ map: assetTex('concrete_wall_008_diff', () => noiseTexture('#77746e', 30, 128, 128)), normalMap: assetTex('concrete_wall_008_nor'), color: 0x8e8b84 }),
      slab: ph({ map: assetTex('gravel_concrete_diff', () => noiseTexture('#8d8a84', 22, 64, 64)), normalMap: assetTex('gravel_concrete_nor'), color: 0xa8a49c }),
      ballast: ph({ map: assetTex('gravel_stones_diff', () => noiseTexture('#7a746c', 90, 128, 128)), normalMap: assetTex('gravel_stones_nor'), color: 0xb0a89c }),
      ground: ph({ map: assetTex('leafy_grass_diff', () => noiseTexture('#5d6b47', 40, 128, 128)), normalMap: assetTex('leafy_grass_nor'), color: 0x8fb06a }),
      platform: ph({ map: assetTex('large_grey_tiles_diff', () => noiseTexture('#b8b4aa', 18, 128, 128)), normalMap: assetTex('large_grey_tiles_nor'), shininess: 30 }),
      wallTile: ph({ map: assetTex('long_white_tiles_diff', () => noiseTexture('#e8e6e0', 10, 128, 128)), normalMap: assetTex('long_white_tiles_nor'), shininess: 40 }),
      concrete: ph({ map: assetTex('concrete_wall_008_diff', () => noiseTexture('#8a8780', 20, 64, 64)), color: 0xc8c4bc }),
      rail: new THREE.MeshPhongMaterial({ color: 0x6f7378, shininess: 60, specular: 0x555555 }),
      railTop: new THREE.MeshBasicMaterial({ color: 0xc9cdd2 }),
      sleeper: new THREE.MeshLambertMaterial({ color: 0x5e5b55 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff1cf }),
      lampCool: new THREE.MeshBasicMaterial({ color: 0xf2f8ff }),
      wire: new THREE.MeshPhongMaterial({ color: 0x5a4a32, specular: 0x886644, shininess: 40 }),
      deadWire: new THREE.MeshBasicMaterial({ color: 0xe0782a }),
      yellow: new THREE.MeshLambertMaterial({ color: 0xf2c200, emissive: 0x2a2000, side: THREE.DoubleSide }),
      psdGlass: new THREE.MeshPhongMaterial({ color: 0xb7d8e6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, shininess: 90 }),
      psdFrame: new THREE.MeshPhongMaterial({ color: 0xc9ccd0, shininess: 50 }),
      pole: new THREE.MeshPhongMaterial({ color: 0x8a8f94 }),
      dark: new THREE.MeshLambertMaterial({ color: 0x2a2d32 }),
      sigHead: new THREE.MeshLambertMaterial({ color: 0x15171a }),
      green: new THREE.MeshBasicMaterial({ color: 0x3dff8a }),
    };

    const [T0, T1] = C.tunnel;
    const inT = (u) => u >= T0 && u <= T1;
    const tunnelRanges = [[Math.max(C.uMin, T0), Math.min(C.uMax, T1)]];
    const openRanges = [];
    if (T0 > C.uMin) openRanges.push([C.uMin, T0]);
    if (T1 < C.uMax) openRanges.push([T1, C.uMax]);

    // ───── 도상 ─────
    const bed = (o, open) => (u) => { const oo = typeof o === 'function' ? o(u) : o; return open ? [[oo - 3.3, -0.95], [oo - 1.7, -0.25], [oo + 1.7, -0.25], [oo + 3.3, -0.95]] : [[oo - 2.0, -0.35], [oo - 1.3, -0.25], [oo + 1.3, -0.25], [oo + 2.0, -0.35]]; };
    for (const [a, b] of tunnelRanges) chunks(a, b, 4, bed(0, false), M.slab, 400, 0.45, 0.45);
    for (const [a, b] of openRanges) chunks(a, b, 4, bed(0, true), M.ballast, 400, 0.5, 0.5);

    // ───── 레일 ─────
    const railProf = (l) => (u) => { const o = typeof l === 'function' ? l(u) : l; return [[o - 0.036, -0.17], [o - 0.036, -0.02], [o - 0.03, 0], [o + 0.03, 0], [o + 0.036, -0.02], [o + 0.036, -0.17]]; };
    for (const l of [-0.7175, 0.7175]) {
      chunks(C.uMin, C.uMax, 4, railProf(l), M.rail, 500);
      chunks(C.uMin, C.uMax, 4, () => [[l - 0.028, 0.003], [l + 0.028, 0.003]], M.railTop, 500);
    }
    const otherSegs = [[C.uMin, T.start - 1], [T.end + 1, C.uMax]];
    for (const [a, b] of otherSegs) {
      for (const [x, y] of tunnelRanges.concat(openRanges)) {
        const p = Math.max(a, x), q = Math.min(b, y);
        if (q - p < 8) continue;
        chunks(p, q, 4, bed(otherOff, !inT((p + q) / 2)), inT((p + q) / 2) ? M.slab : M.ballast, 400, 0.45, 0.45);
      }
      for (const l of [-0.7175, 0.7175]) chunks(a, b, 4, railProf((u) => otherOff(u) + l), M.rail, 500);
    }
    {
      const list = [];
      for (let u = C.uMin; u < C.uMax; u += 0.9) {
        list.push({ u, l: 0, h: -0.2 });
        const o = C.otherOffset(u);
        if (o !== null && Math.round(u / 0.9) % 2 === 0) list.push({ u, l: o, h: -0.2 });
      }
      instances(new THREE.BoxGeometry(2.4, 0.14, 0.24), M.sleeper, list);
    }

    // ───── 터널 ─────
    const tunnelProfile = (u) => {
      const o = otherSmooth(u), w = stationWiden(u), side = stationSide(u);
      let L = Math.min(0, o) - 3.0, R = Math.max(0, o) + 3.0;
      if (side > 0) R += 4.8 * w; else if (side < 0) L -= 4.8 * w;
      const top = 5.9 + 1.5 * w, mid = (L + R) / 2;
      return [[L, -0.4], [L, 4.2 + 0.9 * w], [L + 1.2, top - 0.4], [mid, top], [R - 1.2, top - 0.4], [R, 4.2 + 0.9 * w], [R, -0.4]];
    };
    for (const [a, b] of tunnelRanges) {
      chunks(a, b, 2, tunnelProfile, M.tunnel, 300, 0.22, 0.22);
      chunks(a, b, 4, (u) => { const p = tunnelProfile(u); return [[p[0][0], -0.38], [p[6][0], -0.38]]; }, M.concrete, 400, 0.25, 0.25);
      chunks(a, b, 4, (u) => { const p = tunnelProfile(u); return [[p[0][0] + 0.03, 0.6], [p[0][0] + 0.03, 0.85]]; }, M.dark, 500);
      chunks(a, b, 4, (u) => { const p = tunnelProfile(u); return [[p[6][0] - 0.03, 0.6], [p[6][0] - 0.03, 0.85]]; }, M.dark, 500);
      const lamps = [], br = [];
      for (let u = a; u < b; u += 12) {
        if (stationWiden(u) > 0.05) continue;
        const p = tunnelProfile(u);
        lamps.push({ u, l: p[0][0] + 0.06, h: 3.5 }); lamps.push({ u: u + 6, l: p[6][0] - 0.06, h: 3.5 });
      }
      for (let u = a; u < b; u += 8) br.push({ u, l: 0, h: 5.35 });
      instances(new THREE.BoxGeometry(0.07, 0.1, 1.0), M.lamp, lamps);
      instances(new THREE.BoxGeometry(1.0, 0.16, 0.12), M.wire, br);
      for (const edge of [a, b]) {
        if (edge <= C.uMin + 1 || edge >= C.uMax - 1) continue;
        const p = tunnelProfile(edge), L = p[0][0], R = p[6][0];
        const ry = edge === a ? Math.PI : 0;
        plane(edge, L - 15, 6, 30, 16, M.concrete, ry);
        plane(edge, R + 15, 6, 30, 16, M.concrete, ry);
        plane(edge, (L + R) / 2, 11, R - L, 10, M.concrete, ry);
      }
    }

    // ───── 지상 ─────
    for (const [a, b] of openRanges) {
      chunks(a, b, 8, () => [[-160, -2.0], [-9, -1.0], [9, -1.0], [160, -2.0]], M.ground, 400, 0.06, 0.06);
      const poles = [], arms = [];
      for (let u = a + 25; u < b; u += 50) {
        const o = otherOff(u);
        poles.push({ u, l: o > 0 ? -3.6 : 3.6, h: 3.4 }); poles.push({ u, l: o + (o > 0 ? 3.6 : -3.6), h: 3.4 });
        arms.push({ u, l: o / 2, h: 6.7 });
      }
      instances(new THREE.BoxGeometry(0.32, 9, 0.32), M.pole, poles);
      instances(new THREE.BoxGeometry(12, 0.14, 0.14), M.pole, arms);
    }

    // ───── 전차선 ─────
    const D = C.dead;
    const wire = (h, w, o) => (u) => { const oo = (o ? o(u) : 0); return [[oo - w, h], [oo + w, h], [oo + w, h - w * 2], [oo - w, h - w * 2], [oo - w, h]]; };
    for (const [a, b] of [[C.uMin, D.start], [D.end, C.uMax]]) {
      for (const [x, y] of tunnelRanges) { const p = Math.max(a, x), q = Math.min(b, y); if (q > p) chunks(p, q, 4, wire(5.1, 0.06), M.wire, 500); }
      for (const [x, y] of openRanges) { const p = Math.max(a, x), q = Math.min(b, y); if (q > p) { chunks(p, q, 4, wire(5.2, 0.012), M.wire, 500); chunks(p, q, 4, wire(6.4, 0.014), M.wire, 500); } }
    }
    chunks(D.start, D.end, 2, wire(5.1, 0.07), M.deadWire, 200);
    for (const u of [D.start, D.end]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.4, 1.2), new THREE.MeshBasicMaterial({ color: 0xa8582a }));
      const f = frame(u, {}); m.position.copy(point(u, 0, 5.0)); m.rotation.y = -f.th; scene.add(m);
    }
    for (const [a, b] of otherSegs) {
      for (const [x, y] of tunnelRanges) { const p = Math.max(a, x), q = Math.min(b, y); if (q > p) chunks(p, q, 4, wire(5.1, 0.06, otherOff), M.wire, 500); }
      for (const [x, y] of openRanges) { const p = Math.max(a, x), q = Math.min(b, y); if (q > p) chunks(p, q, 4, wire(5.2, 0.012, otherOff), M.wire, 500); }
    }

    // ───── 역사 ─────
    for (const st of C.stations) {
      const sd = st.side === 'R' ? 1 : -1;
      const a = st.pStart, b = st.pEnd;
      const edge = 1.65, depth = 4.6, hp = 1.1;
      const P = (l) => sd * l;
      const open = !inT(st.u);
      chunks(a, b, 5, () => [[P(edge), hp], [P(edge + depth), hp]], M.platform, 300, 0.3, 0.3);
      chunks(a, b, 5, () => [[P(edge), -0.3], [P(edge), hp]], M.concrete, 300);
      chunks(a, b, 5, () => [[P(edge + 0.15), hp + 0.01], [P(edge + 0.45), hp + 0.01]], M.yellow, 300, 1, 1);
      if (!open) {
        const band = new THREE.MeshPhongMaterial({ color: new THREE.Color(st.color), side: THREE.DoubleSide, shininess: 30 });
        chunks(a - 10, b + 10, 5, () => [[P(edge + depth + 0.15), hp + 1.7], [P(edge + depth + 0.15), hp + 2.5]], band, 300);
        chunks(a - 10, b + 10, 5, () => [[P(edge + depth + 0.16), hp], [P(edge + depth + 0.16), hp + 1.7]], M.wallTile, 300, 0.5, 0.5);
        chunks(a - 10, b + 10, 5, () => [[P(edge + depth + 0.16), hp + 2.5], [P(edge + depth + 0.16), hp + 4.6]], M.wallTile, 300, 0.5, 0.5);
      } else {
        chunks(a, b, 5, () => [[P(edge - 0.2), hp + 3.6], [P(edge + depth + 0.5), hp + 3.9]], M.pole, 300);
        const cols = [];
        for (let u = a + 6; u < b; u += 12) cols.push({ u, l: P(edge + depth - 0.6), h: hp + 1.8 });
        instances(new THREE.BoxGeometry(0.3, 3.6, 0.3), M.pole, cols);
      }
      const posts = [];
      for (let u = a + 2; u < b; u += 3.5) posts.push({ u, l: P(edge + 0.25), h: hp + 1.1 });
      instances(new THREE.BoxGeometry(0.12, 2.2, 0.16), M.psdFrame, posts);
      chunks(a + 2, b - 2, 5, () => [[P(edge + 0.25), hp + 0.1], [P(edge + 0.25), hp + 2.1]], M.psdGlass, 300);
      chunks(a + 2, b - 2, 5, () => [[P(edge + 0.25), hp + 2.15], [P(edge + 0.25), hp + 2.5]], M.psdFrame, 300);
      const lights = [];
      for (let u = a - 10; u < b + 10; u += 4) { lights.push({ u, l: P(edge + 2.2), h: open ? hp + 3.5 : 6.7 }); if (!open) lights.push({ u, l: 0, h: 7.0 }); }
      instances(new THREE.BoxGeometry(0.25, 0.08, 3.0), M.lampCool, lights);
      const tex = textTexture((g, w, h) => {
        g.fillStyle = '#f6f6f3'; g.fillRect(0, 0, w, h);
        g.fillStyle = st.color; g.fillRect(0, h - 28, w, 28);
        g.fillStyle = '#00a5de'; g.beginPath(); g.arc(74, h / 2 - 12, 48, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = `700 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(st.no, 74, h / 2 - 10);
        g.fillStyle = '#111'; g.font = `900 88px ${FONT}`; g.textAlign = 'left';
        g.fillText(st.name, 146, h / 2 - 30);
        g.font = `500 34px ${FONT}`; g.fillStyle = '#444'; g.fillText(st.en, 150, h / 2 + 38);
      }, 1024, 230);
      const signMat = new THREE.MeshBasicMaterial({ map: tex });
      for (let u = a + 20; u < b; u += 45) plane(u, P(edge + depth + 0.1), hp + 2.1, 4.6, 1.03, signMat, sd > 0 ? -Math.PI / 2 : Math.PI / 2);
      for (const u of [st.u - 60, st.u + 30]) plane(u, P(edge + 2.2), 4.8, 3.2, 0.72, signMat, 0);
      const stopTex = textTexture((g, w, h) => {
        g.fillStyle = '#ffd400'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
        g.fillStyle = '#111'; g.font = `900 150px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('10', w / 2, h / 2 + 8);
      }, 256, 256);
      plane(st.stop, P(edge + 0.8), hp + 2.9, 0.7, 0.7, new THREE.MeshBasicMaterial({ map: stopTex }), 0);
    }

    // ───── 표지 ─────
    const sideL = (u) => { const o = C.otherOffset(u); return o !== null && o < 0 ? 2.5 : -2.5; };
    const sign = (u, l, h, w, hh, draw, px) => {
      const tex = textTexture(draw, px || 256, Math.round((px || 256) * hh / w));
      return plane(u, l, h, w, hh, new THREE.MeshBasicMaterial({ map: tex }), 0);
    };
    const posts = [];
    const panel = (bg, fg, lines) => (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach((t, i) => { g.font = `900 ${t[1]}px ${FONT}`; g.fillText(t[0], w / 2, h * (i + 1) / (lines.length + 1)); });
    };
    for (const sg of C.signs) {
      const l = sideL(sg.u), u = sg.u;
      if (sg.type === 'limit') {
        sign(u, l, 2.3, 0.75, 0.75, (g, w, h) => {
          g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); g.fill();
          g.strokeStyle = '#d0021b'; g.lineWidth = 26; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 18, 0, 7); g.stroke();
          g.fillStyle = '#111'; g.font = `900 112px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(sg.v), w / 2, h / 2 + 6);
        });
        posts.push({ u, l, h: 0.7 });
      } else if (sg.type === 'limitEnd') {
        sign(u, l, 2.3, 0.7, 0.7, (g, w, h) => {
          g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, 7); g.fill();
          g.strokeStyle = '#222'; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 8, 0, 7); g.stroke();
          g.lineWidth = 16; g.beginPath(); g.moveTo(w * 0.25, h * 0.75); g.lineTo(w * 0.75, h * 0.25); g.stroke();
        });
        posts.push({ u, l, h: 0.7 });
      } else if (sg.type === 'deadNotice') sign(u, l, 2.6, 0.8, 1.0, panel('#fff', '#111', [['절연', 60], ['예고', 60]]));
      else if (sg.type === 'coast') sign(u, l, 2.6, 0.8, 1.0, panel('#111', '#ffd400', [['타행', 70]]));
      else if (sg.type === 'dead') sign(u, l, 2.6, 0.8, 1.0, panel('#ffd400', '#111', [['절연', 60], ['구간', 60]]));
      else if (sg.type === 'power') sign(u, l, 2.6, 0.8, 1.0, panel('#fff', '#0a7a2f', [['역행', 70]]));
      else if (sg.type === 'atsNotice') sign(u, l, 2.4, 0.9, 0.6, panel('#fff', '#c0392b', [['ATS 예고', 52]]));
      else if (sg.type === 'atcNotice') sign(u, l, 2.4, 0.9, 0.6, panel('#fff', '#1d4fa0', [['ATC 예고', 52]]));
    }
    instances(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6), M.pole, posts);
    for (const b of C.blocks) {
      if (b.k == null) continue;
      const u = b.start, l = sideL(u) * 0.94;
      sign(u, l, 1.35, 0.42, 0.56, (g, w, h) => {
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1d4fa0'; g.fillRect(0, 0, w, h * 0.32);
        g.fillStyle = '#fff'; g.font = `700 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('경계', w / 2, h * 0.17);
        g.fillStyle = '#111'; g.font = `900 ${b.k === 0 ? 70 : 120}px ${FONT}`;
        g.fillText(b.k === 0 ? '장내' : String(b.k), w / 2, h * 0.65);
      });
    }
    // ATS 구간 상치신호기 (진행)
    for (let i = 0; i < C.stations.length - 1; i++) {
      const A = C.stations[i], B = C.stations[i + 1];
      if (!C.isATS((A.stop + B.pStart) / 2)) continue;
      for (const u of [A.stop + 25, B.pStart - 180]) {
        const l = sideL(u) * 1.2, f = frame(u, {});
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.25, 0.25), M.sigHead);
        head.position.copy(point(u, l, 4.1)); head.rotation.y = -f.th; scene.add(head);
        for (const [dy, mat] of [[0.38, M.dark], [0, M.dark], [-0.38, M.green]]) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), mat);
          lamp.position.copy(point(u, l, 4.1 + dy)); lamp.rotation.y = -f.th; lamp.translateZ(0.13); scene.add(lamp);
        }
        instances(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6), M.pole, [{ u, l, h: 1.5 }]);
      }
    }
    C.segs.forEach(sg => sg.repower.filter(r => r.measure).forEach(r => sign(r.from, sideL(r.from), 2.0, 0.6, 0.8, panel('#fff', '#111', [['15', 80], ['량', 50]]))));
    for (let u = Math.ceil(C.uMin / 200) * 200; u < C.uMax; u += 200) {
      const km = (C.toS(u) / 1000).toFixed(1);
      sign(u, sideL(u) * 0.97, 0.45, 0.32, 0.22, (g, w, h) => {
        g.fillStyle = '#eee'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#111'; g.font = '700 60px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(km, w / 2, h / 2);
      }, 192);
    }

    // ───── 하늘 (Poly Haven CC0 HDRI 톤매핑 이미지) ─────
    let sky = null;
    if (RS.ASSETS && RS.ASSETS.tex && RS.ASSETS.tex.sky) {
      const t = loader.load(RS.ASSETS.tex.sky);
      sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -1;
      scene.add(sky);
    }

    // ───── 선행열차 ─────
    const leader = (function () {
      const group = [];
      const bodyTex = textTexture((g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e6e9ec'); gr.addColorStop(1, '#b9bec4');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1b6fc2'; g.fillRect(0, h * 0.62, w, h * 0.07);
        g.fillStyle = '#1f2a33';
        for (let x = 20; x < w - 40; x += 64) g.fillRect(x, h * 0.25, 44, h * 0.28);
        g.fillStyle = '#6d747b'; for (let x = 0; x < w; x += 128) g.fillRect(x + 100, h * 0.2, 18, h * 0.62);
      }, 512, 128);
      const body = new THREE.MeshPhongMaterial({ map: bodyTex, shininess: 50 });
      const plain = new THREE.MeshPhongMaterial({ color: 0xc9ced3, shininess: 50 });
      const tail = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
      for (let i = 0; i < 10; i++) {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.4, 19.5), [plain, plain, plain, plain, plain, plain]);
        b.material = [body, body, plain, plain, plain, plain]; // ±x(긴 측면)에 창문 텍스처
        b.position.y = 2.65; g.add(b);
        if (i === 9) for (const x of [-1.1, 1.1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.05), tail); t.position.set(x, 1.6, 9.78); g.add(t); }
        scene.add(g); group.push(g);
      }
      return {
        update(uFront, visible) {
          group.forEach((g, i) => {
            g.visible = visible;
            if (!visible) return;
            const f = frame(uFront - 10 - i * 20, {});
            g.position.set(f.x, f.y, f.z); g.rotation.y = -f.th;
          });
        },
      };
    })();

    function dispose() {
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose(); m.dispose(); });
      });
    }

    return { scene, frame, point, stationWiden, inTunnel: inT, tunnel: C.tunnel, leader, sky, dispose };
  }

  return { build };
})();
