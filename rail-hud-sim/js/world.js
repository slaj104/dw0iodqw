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

  function build(course, quality) {
    const C = course;
    const Q = quality == null ? 2 : quality; // 0 낮음, 1 보통, 2 높음
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

    function sweep(u0, u1, step, prof, uS, vS, light) {
      const pos = [], uv = [], idx = [], col = [];
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
          if (light) { const c = light(u, p[j][0], p[j][1]); col.push(c[0], c[1], c[2]); }
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
      if (light) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv2', g.attributes.uv);
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    // 재질이 vertexColors 이면 베이킹 조명(bake)을 정점 색으로 넣는다
    function chunks(u0, u1, step, prof, mat, chunk, uS, vS) {
      chunk = chunk || 400;
      const light = mat.vertexColors ? bake : null;
      for (let a = u0; a < u1; a += chunk) {
        const b = Math.min(u1, a + chunk);
        if (b - a < step) continue;
        const mesh = new THREE.Mesh(sweep(a, b, step, prof, uS, vS, light), mat);
        mesh.receiveShadow = !light;
        scene.add(mesh);
      }
    }
    const tmpC = new THREE.Color(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
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
        if (mat.userData.bake) { const c = bake(it.u, it.l, it.h); tmpC.setRGB(c[0], c[1], c[2]); im.setColorAt(i, tmpC); }
      });
      scene.add(im);
      return im;
    }
    // glTF 모델 배치 (Poly Haven CC0): 300 m 구역별 InstancedMesh, 구역마다 경계 구를 줘서 화면 밖은 안 그림
    const V3 = THREE.Vector3;
    function placeModel(name, items, opt) {
      const src = RS.MODELS && RS.MODELS[name];
      if (!src || !items.length) return;
      opt = opt || {};
      src.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(src), size = box.getSize(new V3());
      const s = opt.height ? opt.height / size.y : (opt.scale || 1);
      const parts = [];
      src.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        g.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        g.scale(s, s, s);
        if (g.attributes.uv && !g.attributes.uv2) g.setAttribute('uv2', g.attributes.uv);
        const mt = o.material.clone();
        if (opt.bake) mt.userData.bake = true;
        parts.push({ g, m: mt });
      });
      const rad = size.length() * s;
      const groups = {};
      items.forEach(it => { const k = Math.floor(it.u / 300); (groups[k] = groups[k] || []).push(it); });
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new V3(), sc = new V3();
      for (const k in groups) {
        const list = groups[k], pts = [];
        const mats = list.map(it => {
          const f = frame(it.u, {});
          point(it.u, it.l, it.h, pos);
          e.set(0, -f.th + (it.ry || 0), 0); q.setFromEuler(e);
          const ss = it.s || 1; sc.set(ss, ss, ss);
          pts.push(pos.clone());
          return m4.clone().compose(pos, q, sc);
        });
        const sphere = new THREE.Sphere().setFromPoints(pts); sphere.radius += rad;
        for (const p of parts) {
          const g2 = new THREE.BufferGeometry();
          g2.index = p.g.index; for (const a in p.g.attributes) g2.setAttribute(a, p.g.attributes[a]);
          g2.groups = p.g.groups; g2.boundingSphere = sphere;
          const im = new THREE.InstancedMesh(g2, p.m, list.length);
          mats.forEach((mm, i) => {
            im.setMatrixAt(i, mm);
            if (opt.bake) { const c = bake(list[i].u, list[i].l, list[i].h + 0.3); tmpC.setRGB(c[0], c[1], c[2]); im.setColorAt(i, tmpC); }
          });
          im.frustumCulled = true; im.castShadow = !!opt.shadow; im.receiveShadow = !!opt.shadow;
          scene.add(im);
        }
      }
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
    // PBR 재질: 색·노멀·ARM(R=AO, G=거칠기) 맵 (Poly Haven CC0 1K)
    const std = (name, o, fb) => {
      const arm = assetTex(name + '_arm');
      return new THREE.MeshStandardMaterial(Object.assign({
        side: THREE.DoubleSide, map: assetTex(name + '_diff', fb), normalMap: assetTex(name + '_nor'),
        normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1, metalness: 0,
        aoMap: arm, aoMapIntensity: 1, roughnessMap: arm,
      }, o));
    };
    const baked = (m) => { const n = m.clone(); n.vertexColors = true; return n; };
    const bakedInst = (m) => { const n = m.clone(); n.userData.bake = true; return n; };
    const M = {
      tunnel: std('concrete_wall_008', { color: 0x9c9890 }, () => noiseTexture('#77746e', 30, 128, 128)),
      slab: std('gravel_concrete', { color: 0xb0aca4, roughness: 0.95 }, () => noiseTexture('#8d8a84', 22, 64, 64)),
      ballast: std('gravel_stones', { color: 0xbab2a6 }, () => noiseTexture('#7a746c', 90, 128, 128)),
      ground: std('leafy_grass', { color: 0x9cbf74 }, () => noiseTexture('#5d6b47', 40, 128, 128)),
      platform: std('large_grey_tiles', { color: 0xb4b2ae, roughness: 0.7 }, () => noiseTexture('#b8b4aa', 18, 128, 128)),
      wallTile: std('long_white_tiles', { color: 0xd8d8d4, roughness: 0.45 }, () => noiseTexture('#e8e6e0', 10, 128, 128)),
      concrete: std('concrete_floor_02', { color: 0xc8c4bc }, () => noiseTexture('#8a8780', 20, 64, 64)),
      rail: std('rusty_metal_02', { color: 0x9a948c, metalness: 0.55, roughness: 0.75 }),
      railTop: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.9, roughness: 0.25 }),
      sleeper: std('concrete_floor_02', { color: 0x9a978f }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff1cf }),
      lampCool: new THREE.MeshBasicMaterial({ color: 0xf2f8ff }),
      wire: new THREE.MeshStandardMaterial({ color: 0x6a5236, metalness: 0.7, roughness: 0.45 }),
      deadWire: new THREE.MeshBasicMaterial({ color: 0xe0782a }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6, side: THREE.DoubleSide }),
      psdGlass: new THREE.MeshPhongMaterial({ color: 0xb7d8e6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, shininess: 90 }),
      psdFrame: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.6, roughness: 0.35 }),
      pole: new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.5, roughness: 0.55 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 0.8 }),
      sigHead: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }),
      green: new THREE.MeshBasicMaterial({ color: 0x3dff8a }),
    };
    M.sleeper.map && M.sleeper.map.repeat.set(1, 0.3);

    const [T0, T1] = C.tunnel;
    const inT = (u) => u >= T0 && u <= T1;

    // ───── 조명 베이킹 ─────
    // 터널 등(12 m 간격, 좌우 엇갈림)의 빛이 벽·바닥·레일에 떨어지는 밝기를 정점 색으로 미리 계산
    const lampsL = [], lampsR = [];
    for (let u = T0; u < T1; u += 12) {
      if (stationWidenRaw(u) > 0.05) continue;
      lampsL.push(u); lampsR.push(u + 6);
    }
    function stationWidenRaw(u) {
      let w = 0;
      for (const st of C.stations) { const a = st.pStart - 15, b = st.pEnd + 15; w = Math.max(w, smooth(a - 25, a, u) * (1 - smooth(b, b + 25, u))); }
      return w;
    }
    function lampSum(list, u, lw, l, h) {
      let s = 0;
      let lo = 0, hi = list.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] < u - 30) lo = m + 1; else hi = m; }
      for (let k = lo; k < list.length && list[k] < u + 30; k++) {
        const du = list[k] - u, dl = lw - l, dh = 3.5 - h;
        s += 1 / (1 + (du * du + dl * dl + dh * dh) / 7);
      }
      return s;
    }
    function bake(u, l, h) {
      if (!inT(u)) return [1, 1, 1];
      const w = stationWidenRaw(u);
      const o = otherSmoothRef(u);
      const L = Math.min(0, o) - 3.0, R = Math.max(0, o) + 3.0;
      const lamp = 0.9 * (lampSum(lampsL, u, L, l, h) + lampSum(lampsR, u, R, l, h));
      const day = Math.max(0, 1 - Math.min(u - T0, T1 - u) / 70) * (C.uMin < T0 || C.uMax > T1 ? 1 : 0);
      const base = 0.07;
      // 가짜 AO: 벽-바닥 접합부와 아치 시작부를 어둡게 (명암 강조)
      const dw = Math.min(Math.abs(l - L), Math.abs(R - l));
      const ao = (1 - 0.5 * Math.exp(-dw / 0.7) * Math.exp(-Math.max(0, h + 0.4) / 0.9)) * (1 - 0.25 * Math.exp(-Math.abs(h - 4.2) / 0.5) * Math.exp(-dw / 0.5)) * (h < -0.3 && dw > 1 ? 0.92 : 1);
      const lampA = lamp * ao, baseA = base * ao;
      const r = baseA + lampA * 1.0 + w * 1.05 * ao + day * 0.9;
      const g = baseA + lampA * 0.92 + w * 1.08 * ao + day * 0.95;
      const bl = baseA * 1.1 + lampA * 0.78 + w * 1.12 * ao + day * 1.0;
      return [r, g, bl];
    }
    const otherSmoothRef = (u) => otherSmooth(u);
    for (const k of ['tunnel', 'slab', 'concrete', 'rail', 'wire', 'dark', 'platform', 'wallTile', 'psdFrame']) M[k + 'B'] = baked(M[k]);
    M.sleeperB = bakedInst(M.sleeper); M.wireI = bakedInst(M.wire); M.poleB = bakedInst(M.pole);
    const tunnelRanges = [[Math.max(C.uMin, T0), Math.min(C.uMax, T1)]];
    const openRanges = [];
    if (T0 > C.uMin) openRanges.push([C.uMin, T0]);
    if (T1 < C.uMax) openRanges.push([T1, C.uMax]);

    // ───── 도상 ─────
    const bed = (o, open) => (u) => { const oo = typeof o === 'function' ? o(u) : o; return open ? [[oo - 3.3, -0.95], [oo - 1.7, -0.25], [oo + 1.7, -0.25], [oo + 3.3, -0.95]] : [[oo - 2.0, -0.35], [oo - 1.3, -0.25], [oo + 1.3, -0.25], [oo + 2.0, -0.35]]; };
    for (const [a, b] of tunnelRanges) chunks(a, b, 4, bed(0, false), M.slabB, 400, 0.45, 0.45);
    for (const [a, b] of openRanges) chunks(a, b, 4, bed(0, true), M.ballast, 400, 0.5, 0.5);

    // ───── 레일 ─────
    const railProf = (l) => (u) => { const o = typeof l === 'function' ? l(u) : l; return [[o - 0.036, -0.17], [o - 0.036, -0.02], [o - 0.03, 0], [o + 0.03, 0], [o + 0.036, -0.02], [o + 0.036, -0.17]]; };
    for (const l of [-0.7175, 0.7175]) {
      chunks(C.uMin, C.uMax, 4, railProf(l), M.railB, 500);
      chunks(C.uMin, C.uMax, 4, () => [[l - 0.028, 0.003], [l + 0.028, 0.003]], M.railTop, 500);
    }
    const otherSegs = [[C.uMin, T.start - 1], [T.end + 1, C.uMax]];
    for (const [a, b] of otherSegs) {
      for (const [x, y] of tunnelRanges.concat(openRanges)) {
        const p = Math.max(a, x), q = Math.min(b, y);
        if (q - p < 8) continue;
        chunks(p, q, 4, bed(otherOff, !inT((p + q) / 2)), inT((p + q) / 2) ? M.slabB : M.ballast, 400, 0.45, 0.45);
      }
      for (const l of [-0.7175, 0.7175]) chunks(a, b, 4, railProf((u) => otherOff(u) + l), M.railB, 500);
    }
    {
      const list = [];
      for (let u = C.uMin; u < C.uMax; u += 0.9) {
        list.push({ u, l: 0, h: -0.2 });
        const o = C.otherOffset(u);
        if (o !== null && Math.round(u / 0.9) % 2 === 0) list.push({ u, l: o, h: -0.2 });
      }
      instances(new THREE.BoxGeometry(2.4, 0.14, 0.24), M.sleeperB, list);
    }

    // ───── 터널 ─────
    const tunnelProfile = (u) => {
      const o = otherSmooth(u), w = stationWiden(u), side = stationSide(u);
      let L = Math.min(0, o) - 3.0, R = Math.max(0, o) + 3.0;
      if (side > 0) R += 4.8 * w; else if (side < 0) L -= 4.8 * w;
      const top = 5.9 + 1.5 * w, mid = (L + R) / 2, wt = 4.2 + 0.9 * w;
      const pts = [[L, -0.4], [L, 0.9], [L, 2.4], [L, wt]];
      for (let k = 1; k < 10; k++) { const an = Math.PI - Math.PI * k / 10; pts.push([mid + Math.cos(an) * (R - L) / 2, wt + Math.sin(an) * (top - wt)]); }
      pts.push([R, wt], [R, 2.4], [R, 0.9], [R, -0.4]);
      return pts;
    };
    for (const [a, b] of tunnelRanges) {
      chunks(a, b, 2, tunnelProfile, M.tunnelB, 300, 0.22, 0.22);
      chunks(a, b, 2, (u) => { const p = tunnelProfile(u), L = p[0][0], R = p[p.length - 1][0]; return [0, 0.08, 0.25, 0.5, 0.75, 0.92, 1].map(f => [L + (R - L) * f, -0.38]); }, M.concreteB, 400, 0.25, 0.25);
      // 꽈배기 경계에서 설비가 반대쪽 벽으로 옮겨가므로 구간을 끊어서 그림 (선로를 가로지르지 않게)
      const cuts = [T.start, T.end].filter(x => x > a && x < b).sort((x, y) => x - y);
      const subs = []; { let p0 = a; for (const c of cuts) { subs.push([p0, c - 4]); p0 = c + 4; } subs.push([p0, b]); }
      // 터널 설비: 대피통로(상대선 반대쪽 벽), 케이블 트레이, 소화 배관 — 역 구간에서는 접힘
      const outer = (u) => { const o = C.otherOffset(u); return o !== null && o > 0 ? -1 : 1; }; // 대피통로 쪽
      const wallX = (u, s) => { const p = tunnelProfile(u); return s < 0 ? p[0][0] : p[p.length - 1][0]; };
      const fold = (u) => 1 - stationWidenRaw(u);
      for (const [sa, sb] of subs) chunks(sa, sb, 4, (u) => { const s = outer(u), W = wallX(u, s), k = fold(u) * 0.85; return [[W - s * 0.02, 0.62 * fold(u) - 0.38 * (1 - fold(u))], [W - s * k, 0.62 * fold(u) - 0.38 * (1 - fold(u))], [W - s * k, -0.38]]; }, M.concreteB, 400, 0.4, 0.4);
      for (const [sa, sb] of subs) chunks(sa, sb, 4, (u) => { const s = outer(u), W = wallX(u, s), k = fold(u) * 0.85; return [[W - s * k, 0.66 * fold(u)], [W - s * k, 1.6 * fold(u)]]; }, M.darkB, 500);
      for (const hh of [1.55, 2.05]) {
        for (const [sa, sb] of subs) chunks(sa, sb, 4, (u) => { const s = -outer(u), W = wallX(u, s), k = fold(u); return [[W - s * 0.02, hh * k + 0.9 * (1 - k)], [W - s * 0.38 * k, hh * k + 0.9 * (1 - k)], [W - s * 0.38 * k, (hh + 0.12) * k + 0.9 * (1 - k)]]; }, M.darkB, 500);
      }
      const pipeMat = baked(ph({ color: 0x7a4a44, shininess: 30 }));
      for (const [sa, sb] of subs) chunks(sa, sb, 4, (u) => { const s = -outer(u), W = wallX(u, s), k = fold(u), cx = W - s * 0.22 * k, cy = 2.75; const r = 0.07 * k + 0.001; const pts = []; for (let q = 0; q <= 8; q++) { const an = q / 8 * Math.PI * 2; pts.push([cx + Math.cos(an) * r, cy + Math.sin(an) * r]); } return pts; }, pipeMat, 500);
      // 비상구 유도등 (녹색, 50 m 간격)
      const exitTex = textTexture((g, w, h) => {
        g.fillStyle = '#0a9a4a'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#eafff0'; g.font = `900 ${h * 0.55}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('비상구 →', w / 2, h / 2 + 2);
      }, 256, 96);
      const exitMat = new THREE.MeshBasicMaterial({ map: exitTex, side: THREE.DoubleSide });
      const exits = [];
      for (let u = a + 25; u < b; u += 50) { if (stationWidenRaw(u) > 0.01) continue; const s = outer(u); exits.push({ u, l: wallX(u, s) - s * 0.03, h: 1.15, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 }); }
      instances(new THREE.PlaneGeometry(0.55, 0.2), exitMat, exits);
      const pb = [], ub = [], fe = [];
      for (let u = a + 60; u < b; u += 120) {
        if (stationWidenRaw(u) > 0.01) continue;
        const s = outer(u);
        pb.push({ u, l: wallX(u, -s) + s * 0.06, h: 1.0, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
        ub.push({ u: u + 40, l: wallX(u + 40, s) - s * 0.3, h: 0.62, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
        fe.push({ u: u + 15, l: wallX(u + 15, s) - s * 0.2, h: 0.62, ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
      placeModel('power_box_01', pb, { height: 0.7, bake: true });
      placeModel('utility_box_01', ub, { height: 1.1, bake: true });
      placeModel('korean_fire_extinguisher_01', fe, { height: 0.62, bake: true });
      const lamps = [], br = [];
      for (let u = a; u < b; u += 12) {
        if (stationWiden(u) > 0.05) continue;
        const p = tunnelProfile(u);
        lamps.push({ u, l: p[0][0] + 0.06, h: 3.5 }); lamps.push({ u: u + 6, l: p[p.length - 1][0] - 0.06, h: 3.5 });
      }
      for (let u = a; u < b; u += 8) br.push({ u, l: 0, h: 5.35 });
      instances(new THREE.BoxGeometry(0.07, 0.1, 1.0), M.lamp, lamps);
      instances(new THREE.BoxGeometry(1.0, 0.16, 0.12), M.wireI, br);
      // 램프 글로우 (가산 혼합)
      const glowTex = textTexture((g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,240,205,0.95)'); gr.addColorStop(0.25, 'rgba(255,225,170,0.35)'); gr.addColorStop(1, 'rgba(255,210,150,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }, 128, 128);
      const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
      instances(new THREE.PlaneGeometry(2.4, 1.0), glowMat, lamps.map(it => ({ u: it.u, l: it.l + (it.l < 0 ? 0.08 : -0.08), h: it.h, ry: Math.PI / 2 })));
      for (const edge of [a, b]) {
        if (edge <= C.uMin + 1 || edge >= C.uMax - 1) continue;
        const p = tunnelProfile(edge), L = p[0][0], R = p[p.length - 1][0];
        const ry = edge === a ? Math.PI : 0;
        plane(edge, L - 15, 6, 30, 16, M.concrete, ry);
        plane(edge, R + 15, 6, 30, 16, M.concrete, ry);
        plane(edge, (L + R) / 2, 11, R - L, 10, M.concrete, ry);
      }
    }

    // ───── 지상 경관: 아파트 단지 · 방음벽 · 가로수 · 도로 · 고가도로 ─────
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const winTex = textTexture((g, w, h) => {
      g.fillStyle = '#e9e6df'; g.fillRect(0, 0, w, h);
      const fw = w / 4, fh = h / 8;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) {
        const x = i * fw, y = j * fh;
        g.fillStyle = '#d5d1c8'; g.fillRect(x, y + fh * 0.78, fw, fh * 0.1);           // 층 슬래브
        const lit = Math.random() < 0.18;
        g.fillStyle = lit ? '#f3e2a6' : (Math.random() < 0.5 ? '#5f7486' : '#4c5f70');
        g.fillRect(x + fw * 0.12, y + fh * 0.18, fw * 0.76, fh * 0.52);                 // 발코니 창
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + fw * 0.5, y + fh * 0.18, 2, fh * 0.52);
      }
    }, 256, 512);
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    const facade = (id, c) => new THREE.MeshStandardMaterial({ map: assetTex(id + '_diff', () => winTex), normalMap: assetTex(id + '_nor'), roughnessMap: assetTex(id + '_rough'), color: c, roughness: 1, metalness: 0.05 });
    const bMats = [facade('facade006', 0xffffff), facade('facade006', 0xf3ead8), facade('facade006', 0xe4ebee), facade('facade002', 0xffffff)];
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8c8f93 });
    function buildingGeo(w, h, d) {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv;
      // 면 순서 +x, -x, +y, -y, +z, -z (각 4정점): 창 1칸 = 폭 3 m × 높이 2.9 m 가 되도록 UV 배율
      const TW = RS.ASSETS && RS.ASSETS.tex && RS.ASSETS.tex.facade006_diff ? 18 : 12, TH = RS.ASSETS && RS.ASSETS.tex && RS.ASSETS.tex.facade006_diff ? 24 : 23.2;
      const sc = [[d / TW, h / TH], [d / TW, h / TH], [0, 0], [0, 0], [w / TW, h / TH], [w / TW, h / TH]];
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * sc[f][0], uv.getY(i) * sc[f][1]); }
      g.clearGroups(); g.addGroup(0, 12, 0); g.addGroup(12, 6, 1); g.addGroup(18, 18, 0);
      return g;
    }
    const treeTex = textTexture((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#5b4632'; g.fillRect(w / 2 - 6, h * 0.62, 12, h * 0.38);
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * w * 0.36;
        g.fillStyle = ['#2f5d2b', '#3b6e34', '#4b7f3c', '#28502a'][i % 4];
        g.beginPath(); g.arc(w / 2 + Math.cos(a) * r, h * 0.38 + Math.sin(a) * r * 0.9, 18 + Math.random() * 14, 0, 7); g.fill();
      }
    }, 128, 256);
    const treeMat = new THREE.MeshLambertMaterial({ map: treeTex, alphaTest: 0.5, side: THREE.DoubleSide });
    const barrierTex = textTexture((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(150,190,170,0.35)'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(90,100,105,1)'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14); g.fillRect(0, 0, 10, h);
      g.fillRect(w * 0.5, 0, 6, h);
    }, 128, 256);
    barrierTex.wrapS = barrierTex.wrapT = THREE.RepeatWrapping;
    const barrierMat = new THREE.MeshLambertMaterial({ map: barrierTex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const asphalt = new THREE.MeshLambertMaterial({ color: 0x4a4c50 });
    const stNear = (u, pad) => C.stations.some(s => u > s.pStart - pad && u < s.pEnd + pad);
    for (const [a, b] of openRanges) {
      const o = (u) => otherOff(u);
      // 아파트·상가
      for (const side of [-1, 1]) {
        for (let u = a + 40; u < b - 20; u += 38 + rnd() * 30) {
          const dist = 45 + rnd() * 110, w = 22 + rnd() * 18, d = 12 + rnd() * 5;
          const floors = rnd() < 0.25 ? 4 + Math.floor(rnd() * 4) : 12 + Math.floor(rnd() * 14);
          const h = floors * 2.9;
          const geo = buildingGeo(w, h, d);
          const m = new THREE.Mesh(geo, [bMats[Math.floor(rnd() * bMats.length)], roofMat]);
          m.castShadow = true; m.receiveShadow = true;
          const f = frame(u, {});
          m.position.copy(point(u, side * dist + (side > 0 ? Math.max(0, o(u)) : Math.min(0, o(u))), h / 2 - 2.0));
          m.rotation.y = -f.th + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3;
          scene.add(m);
        }
      }
      // 도로 (선로 양옆 25~32 m)
      for (const side of [-1, 1]) chunks(a, b, 8, () => [[side * 26 - 4, -1.9], [side * 26 + 4, -1.9]], asphalt, 400);
      // 방음벽 (역 주변 제외)
      const bl = (u) => (o(u) < 0 ? o(u) - 3.4 : -3.6), br = (u) => (o(u) > 0 ? o(u) + 3.4 : 3.6);
      for (let u = a + 30; u < b - 30; u += 300) {
        const e = Math.min(b - 30, u + 220);
        if (stNear(u, 80) || stNear(e, 80)) continue;
        chunks(u, e, 4, (x) => [[bl(x), -0.8], [bl(x), 3.2]], barrierMat, 300, 0.5, 0.25);
        chunks(u, e, 4, (x) => [[br(x), -0.8], [br(x), 3.2]], barrierMat, 300, 0.5, 0.25);
      }
      // 가로수
      const trees = [];
      for (let u = a + 10; u < b; u += 9 + rnd() * 10) {
        for (const side of [-1, 1]) if (rnd() < 0.7) trees.push({ u: u + rnd() * 5, l: side * (12 + rnd() * 9) + (side > 0 ? Math.max(0, o(u)) : Math.min(0, o(u))), h: 2.5 + rnd() * 0.5, ry: rnd() * 3 });
      }
      const lampsS = [], shrubs = [], boxes = [];
      for (let u = a + 20; u < b; u += 80) for (const side of [-1, 1]) lampsS.push({ u, l: side * 21.5 + (side > 0 ? Math.max(0, o(u)) : Math.min(0, o(u))), h: -1.9, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
      for (let u = a + 15; u < b; u += 16 + rnd() * 14) { const side = rnd() < 0.5 ? -1 : 1; shrubs.push({ u, l: side * (8 + rnd() * 10) + (side > 0 ? Math.max(0, o(u)) : Math.min(0, o(u))), h: -1.1, ry: rnd() * 6, s: 0.7 + rnd() * 0.6 }); }
      for (let u = a + 70; u < b; u += 160) boxes.push({ u, l: o(u) < 0 ? 3.3 : -3.3, h: -0.9, ry: o(u) < 0 ? -Math.PI / 2 : Math.PI / 2 });
      if (Q > 0) placeModel('street_lamp_01', lampsS, { height: 7.5 });
      if (Q > 0) placeModel('shrub_02', Q > 1 ? shrubs : shrubs.filter((x, i) => i % 2 === 0), { height: 1.6 });
      placeModel('utility_box_02', boxes, { height: 1.2, shadow: true });
      const tg = new THREE.PlaneGeometry(4.5, 7);
      instances(tg, treeMat, trees);
      instances(tg, treeMat, trees.map(x => ({ ...x, ry: x.ry + Math.PI / 2 })));
      // 고가도로 (선로를 가로지름)
      for (let k = 0; k < 2; k++) {
        const u = a + (b - a) * (0.3 + 0.35 * k);
        if (stNear(u, 120)) continue;
        const deck = new THREE.Mesh(new THREE.BoxGeometry(70, 1.2, 14), new THREE.MeshLambertMaterial({ map: assetTex('concrete_wall_008_diff', () => noiseTexture('#8a8780', 20, 64, 64)), color: 0xbdbab2 }));
        const f = frame(u, {});
        deck.position.copy(point(u, 0, 8.2)); deck.rotation.y = -f.th + Math.PI / 2; scene.add(deck);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(70, 1.0, 0.25), M.pole);
        for (const dz of [-6.9, 6.9]) { const r2 = rail.clone(); r2.position.copy(point(u + dz, 0, 9.3)); r2.rotation.y = -f.th + Math.PI / 2; scene.add(r2); }
        for (const l of [-9, 9, -25, 25]) instances(new THREE.BoxGeometry(1.6, 10, 1.6), M.pole, [{ u, l: l + (l > 0 ? Math.max(0, o(u)) : Math.min(0, o(u))), h: 3.2 }]);
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
      const pim = instances(new THREE.BoxGeometry(0.32, 9, 0.32), M.pole, poles); if (pim) pim.castShadow = true;
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
    const monitors = [], routeInd = [];
    // 스크린도어 5 m 모듈 (가운데 미닫이문 2 m + 고정 유리), 텍스처 가로 = 높이 방향, 세로 = 선로 방향
    const psdTex = textTexture((g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(170,205,220,0.20)'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(200,205,210,0.95)';
      g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);               // 모듈 경계 프레임
      g.fillRect(0, h * 0.3 - 6, w, 12); g.fillRect(0, h * 0.7 - 6, w, 12); // 문 프레임
      g.fillRect(0, h * 0.5 - 2, w, 4);                                     // 문 맞닿는 선
      g.fillRect(0, 0, 14, h); g.fillRect(w - 18, 0, 18, h);                // 하단·상단 레일
      g.fillStyle = 'rgba(255,210,0,0.9)'; g.fillRect(w * 0.5, h * 0.36, 20, h * 0.28); // 기대지 마세요 띠
      g.fillStyle = 'rgba(30,60,140,0.9)'; g.fillRect(w * 0.62, h * 0.33, 26, h * 0.08); g.fillRect(w * 0.62, h * 0.59, 26, h * 0.08);
    }, 256, 512);
    psdTex.wrapS = psdTex.wrapT = THREE.RepeatWrapping;
    const psdMat = new THREE.MeshPhongMaterial({ map: psdTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, shininess: 90 });
    const ceilTex = textTexture((g, w, h) => {
      g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#9da2a8'; g.lineWidth = 3;
      for (let x = 0; x <= w; x += w / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += h / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }, 256, 256);
    ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
    const ceilMat = ph({ map: ceilTex, shininess: 40 });
    const posterDraw = [
      (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2e7d4f'); gr.addColorStop(1, '#a8d08d'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `900 46px ${FONT}`; g.textAlign = 'center'; g.fillText('과천 나들이', w / 2, 80); g.font = `500 24px ${FONT}`; g.fillText('숲 · 공원 · 과학관', w / 2, 120); g.fillStyle = '#1f5a36'; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(30 + i * 35, h - 60 - (i % 3) * 25, 40, 0, 7); g.fill(); } },
      (g, w, h) => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.fillText('안전문에', w / 2, 90); g.fillText('기대지 마세요', w / 2, 140); g.beginPath(); g.arc(w / 2, 240, 55, 0, 7); g.lineWidth = 12; g.strokeStyle = '#d0021b'; g.stroke(); g.beginPath(); g.moveTo(w / 2 - 38, 278); g.lineTo(w / 2 + 38, 202); g.stroke(); },
      (g, w, h) => { g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h); g.fillStyle = '#00a5de'; g.fillRect(0, 0, w, 60); g.fillStyle = '#fff'; g.font = `800 30px ${FONT}`; g.textAlign = 'center'; g.fillText('4호선 노선도', w / 2, 42); g.strokeStyle = '#00a5de'; g.lineWidth = 8; g.beginPath(); g.moveTo(40, 90); g.lineTo(40, h - 30); g.stroke(); const n = ['남태령', '선바위', '경마공원', '대공원', '과천', '정부과천청사', '인덕원', '평촌', '범계', '금정', '산본']; n.forEach((s, i) => { const y = 95 + i * ((h - 130) / 10); g.fillStyle = '#fff'; g.beginPath(); g.arc(40, y, 9, 0, 7); g.fill(); g.lineWidth = 4; g.stroke(); g.fillStyle = '#222'; g.font = `600 20px ${FONT}`; g.textAlign = 'left'; g.fillText(s, 62, y + 7); }); },
      (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1d3557'); gr.addColorStop(1, '#457b9d'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#f1faee'; g.font = `900 38px ${FONT}`; g.textAlign = 'center'; g.fillText('철도 안전', w / 2, 90); g.font = `500 22px ${FONT}`; g.fillText('선로에 물건이 떨어지면', w / 2, 150); g.fillText('역 직원에게 알려 주세요', w / 2, 182); g.fillStyle = '#e63946'; g.fillRect(w / 2 - 60, 230, 120, 120); g.fillStyle = '#fff'; g.font = `900 60px ${FONT}`; g.fillText('!', w / 2, 315); },
    ].map(fn => new THREE.MeshPhongMaterial({ map: textTexture(fn, 256, 384), shininess: 60 }));
    const exitMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: textTexture((g, w, h) => {
      g.fillStyle = '#ffcc00'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#111'; g.font = `900 ${h * 0.42}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText('나가는 곳  Exit', 20, h / 2); g.textAlign = 'right'; g.fillText('1 · 2 · 3 →', w - 20, h / 2);
    }, 768, 96) });
    const ledMat = (txt) => new THREE.MeshBasicMaterial({ map: textTexture((g, w, h) => {
      g.fillStyle = '#060606'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff9f1a'; g.font = `700 ${h * 0.38}px ${FONT}`; g.textBaseline = 'middle';
      g.textAlign = 'left'; g.fillText(txt[0], 16, h * 0.3); g.fillText(txt[1], 16, h * 0.74);
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h); for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    }, 512, 96) });
    const dirText = C.d > 0 ? '오이도·산본 방면' : '당고개·남태령 방면';
    const benchMat = ph({ color: 0x7d8a94, shininess: 50 });
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
      chunks(a + 2, b - 2, 5, () => [[P(edge + 0.25), hp + 0.1], [P(edge + 0.25), hp + 2.1]], psdMat, 300, 0.5, 0.2);
      chunks(a + 2, b - 2, 5, () => [[P(edge + 0.25), hp + 2.15], [P(edge + 0.25), hp + 2.5]], M.psdFrame, 300);
      const lights = [];
      for (let u = a - 10; u < b + 10; u += 4) { lights.push({ u, l: P(edge + 1.2), h: hp + 3.52 }); lights.push({ u, l: P(edge + 3.4), h: hp + 3.52 }); if (!open) lights.push({ u, l: 0, h: 7.0 }); }
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

      // 천장(지하역), 광고·안내 포스터, 출구 안내판, LED 행선 안내기, 벤치
      if (!open) chunks(a - 10, b + 10, 5, () => [[P(edge - 0.1), hp + 3.6], [P(edge + depth + 0.16), hp + 3.6]], ceilMat, 300, 0.25, 0.25);
      let k = 0;
      for (let u = a + 8; u < b - 4; u += 22.5, k++) {
        if (((u - a - 20) % 45 + 45) % 45 < 6) continue; // 역명판 자리 피함
        if (!open) plane(u, P(edge + depth + 0.12), hp + 1.0, 1.1, 1.6, posterDraw[(k + st.idx) % posterDraw.length], sd > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
      for (const u of [st.u - 30, st.u + 70]) {
        const m = plane(u, P(edge + 2.2), hp + 3.05, 3.6, 0.45, exitMat, 0);
        instances(new THREE.BoxGeometry(0.03, 0.5, 0.03), M.pole, [{ u, l: P(edge + 2.2) - 1.5, h: hp + 3.35 }, { u, l: P(edge + 2.2) + 1.5, h: hp + 3.35 }]);
      }
      for (const u of [st.u - 75, st.u + 5]) {
        const next = C.stations[st.i + 1];
        plane(u, P(edge + 1.6), hp + 2.95, 2.4, 0.45, ledMat([`4  ${dirText}`, next ? `이번 열차  ${C.stations[C.endIdx].name} 행` : '이 열차는 종착역입니다']), 0);
      }
      const fx = [], tc = [], cams = [];
      for (let u = a + 18; u < b - 10; u += 38) fx.push({ u, l: P(edge + depth - 0.2), h: hp, ry: sd > 0 ? -Math.PI / 2 : Math.PI / 2 });
      for (let u = a + 30; u < b - 10; u += 55) tc.push({ u, l: P(edge + depth - 0.45), h: hp, ry: 0 });
      cams.push({ u: st.stop - 5, l: P(edge + 1.0), h: hp + 3.25, ry: Math.PI }, { u: st.pStart + 20, l: P(edge + 1.0), h: hp + 3.25, ry: Math.PI });
      placeModel('korean_fire_extinguisher_01', fx, { height: 0.62, bake: !open, shadow: open });
      placeModel('metal_trash_can', tc, { height: 0.95, bake: !open, shadow: open });
      placeModel('security_camera_01', cams, { height: 0.3, bake: !open });
      const benches = [];
      for (let u = a + 12; u < b - 10; u += 15) benches.push({ u, l: P(edge + depth - 0.55), h: hp + 0.45 });
      instances(new THREE.BoxGeometry(0.5, 0.1, 1.8), benchMat, benches);
      instances(new THREE.BoxGeometry(0.08, 0.45, 1.8), benchMat, benches.map(x => ({ ...x, l: x.l + P(0.25), h: hp + 0.7 })));

      // 승무원용 모니터 (CCTV + 승강장 안전문 정위치 표시: 미달/양호/초과, ±mm)
      {
        const mu = st.stop + 14, ml = P(edge + 1.1), mh = 3.55, toe = -sd * 0.28;
        const f = frame(mu, {});
        const grp = new THREE.Group();
        grp.position.copy(point(mu, ml, mh)); grp.rotation.y = -f.th + toe;
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.78, 0.14), M.sigHead); grp.add(box);
        const cv = document.createElement('canvas'); cv.width = 640; cv.height = 256;
        const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
        const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.7), new THREE.MeshBasicMaterial({ map: tex })); scr.position.z = 0.075; grp.add(scr);
        const hang = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), M.pole); hang.position.y = 1.1; grp.add(hang);
        scene.add(grp);
        const mon = { st, cv, tex, last: '' };
        mon.update = (state) => drawMonitor(mon, state);
        drawMonitor(mon, { err: null });
        monitors[st.i] = mon;
      }
      // 신호기: ATC 구간 = 진로 개통 표시기 (ATS 구간 출발신호기는 아래 상치신호기에서 설치)
      {
        const su = st.stop + 28, sl = P(2.35), f = frame(su, {});
        if (st.i < C.stations.length - 1 && !C.isATS(su + 10)) {
          const grp = new THREE.Group();
          grp.position.copy(point(su, sl, 3.4)); grp.rotation.y = -f.th;
          grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.2), M.sigHead));
          const on = new THREE.MeshBasicMaterial({ map: textTexture((g, w, h) => {
            g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#f4f8ff'; g.shadowColor = '#cfe6ff'; g.shadowBlur = 18;
            for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(w * (0.15 + k * 0.117), h / 2, 13, 0, 7); g.fill(); }
          }, 256, 128) });
          const off = new THREE.MeshBasicMaterial({ map: textTexture((g, w, h) => {
            g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h);
            g.fillStyle = '#2a2d31';
            for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(w * (0.15 + k * 0.117), h / 2, 13, 0, 7); g.fill(); }
            g.fillStyle = '#ff3a2a'; g.shadowColor = '#ff3a2a'; g.shadowBlur = 16; g.beginPath(); g.arc(w / 2, h / 2, 16, 0, 7); g.fill();
          }, 256, 128) });
          const face = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.36), on); face.position.z = 0.105; grp.add(face);
          scene.add(grp);
          instances(new THREE.BoxGeometry(0.06, 2.0, 0.06), M.pole, [{ u: su, l: sl, h: 4.6 }]);
          routeInd.push({ u: su, set(v) { face.material = v ? on : off; } });
        }
      }
    }

    // 모니터 화면 그리기 (값이 바뀔 때만 갱신)
    function drawMonitor(mon, s) {
      let status = '접근', col = '#9fb3c8', val = '', unit = '';
      if (s.err != null) {
        const e = s.err;
        if (Math.abs(e) <= 0.5) { status = '양호'; col = '#3dff8a'; }
        else if (e < 0) { status = '미달'; col = '#ffd23d'; }
        else { status = '초과'; col = '#ff4b3d'; }
        if (Math.abs(e) < 10) { val = `${e >= 0 ? '+' : '-'}${String(Math.abs(Math.round(e * 1000))).padStart(3, '0')}`; unit = 'mm'; }
        else { val = `${e >= 0 ? '+' : '-'}${Math.abs(e).toFixed(1)}`; unit = 'm'; }
        if (!s.stopped && e < -0.5) { status = s.err < -10 ? '접근' : '미달'; }
      }
      const key = status + val + (s.doors ? 'D' : '');
      if (key === mon.last) return;
      mon.last = key;
      const g = mon.cv.getContext('2d'), w = mon.cv.width, h = mon.cv.height;
      g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
      // CCTV (승강장 영상)
      const cx = 8, cy = 30, cw = 380, ch = h - 38;
      const gr = g.createLinearGradient(0, cy, 0, cy + ch); gr.addColorStop(0, '#2b3036'); gr.addColorStop(1, '#5c5e5f');
      g.fillStyle = gr; g.fillRect(cx, cy, cw, ch);
      g.fillStyle = '#8c8e8c'; g.beginPath(); g.moveTo(cx, cy + ch); g.lineTo(cx + cw, cy + ch); g.lineTo(cx + cw * 0.62, cy + ch * 0.38); g.lineTo(cx + cw * 0.52, cy + ch * 0.38); g.fill();
      g.strokeStyle = '#d8c23a'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + cw * 0.2, cy + ch); g.lineTo(cx + cw * 0.53, cy + ch * 0.4); g.stroke();
      for (let k = 0; k < 6; k++) {
        const t = k / 6, x0 = cx + cw * (0.05 + 0.08 * t), x = x0 + (cx + cw * 0.5 - x0) * t * 0.9;
        g.fillStyle = s.doors ? '#1b2a33' : '#7fa6b8'; g.globalAlpha = 0.8;
        g.fillRect(x, cy + ch * (0.22 + 0.15 * t), 34 * (1 - t * 0.8), ch * (0.55 - 0.35 * t));
        g.globalAlpha = 1;
      }
      g.fillStyle = '#e8e8e8'; g.font = '700 16px monospace'; g.fillText('CAM1 ' + mon.st.name, cx + 6, cy + 18);
      // 정위치 표시
      g.fillStyle = '#123a7a'; g.fillRect(0, 0, w, 26);
      g.fillStyle = '#fff'; g.font = `700 18px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillText(`${mon.st.name}  승강장 안전문`, 10, 14);
      g.textAlign = 'center';
      g.fillStyle = '#e8eef4'; g.font = `700 20px ${FONT}`; g.fillText('정위치', 515, 52);
      g.fillStyle = col; g.font = `900 64px ${FONT}`; g.fillText(status, 515, 112);
      g.fillStyle = col; g.font = '700 46px monospace'; g.fillText(val, 515, 182);
      g.fillStyle = '#9fb3c8'; g.font = '700 20px monospace'; g.fillText(unit, 515, 220);
      mon.tex.needsUpdate = true;
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

    // ───── 열차 메시 (선행열차 · 반대편 교행열차) ─────
    const bodyTex = textTexture((g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e6e9ec'); gr.addColorStop(1, '#b9bec4');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b6fc2'; g.fillRect(0, h * 0.62, w, h * 0.07);
      g.fillStyle = '#1f2a33';
      for (let x = 20; x < w - 40; x += 64) g.fillRect(x, h * 0.25, 44, h * 0.28);
      g.fillStyle = '#6d747b'; for (let x = 0; x < w; x += 128) g.fillRect(x + 100, h * 0.2, 18, h * 0.62);
    }, 512, 128);
    const faceTex = textTexture((g, w, h) => {
      g.fillStyle = '#d7dbe0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#16202a'; g.fillRect(w * 0.08, h * 0.12, w * 0.84, h * 0.38);   // 전면 유리
      g.fillStyle = '#1b6fc2'; g.fillRect(0, h * 0.62, w, h * 0.06);
      g.fillStyle = '#ff9f1a'; g.font = `700 ${h * 0.09}px ${FONT}`; g.textAlign = 'center'; g.fillText('4  산본', w / 2, h * 0.09);
      g.fillStyle = '#2a2e33'; g.fillRect(w * 0.42, h * 0.55, w * 0.16, h * 0.4);    // 관통문
    }, 256, 256);
    function makeTrain(headlights) {
      const group = [];
      const body = new THREE.MeshPhongMaterial({ map: bodyTex, shininess: 50 });
      const plain = new THREE.MeshPhongMaterial({ color: 0xc9ced3, shininess: 50 });
      const face = new THREE.MeshPhongMaterial({ map: faceTex, shininess: 60 });
      const tail = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
      const head = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
      const roofM = new THREE.MeshPhongMaterial({ color: 0x8d9298 });
      for (let i = 0; i < 10; i++) {
        const g = new THREE.Group();
        const endF = i === 0 ? face : plain, endR = i === 9 ? face : plain;
        const b = new THREE.Mesh(new THREE.BoxGeometry(3.1, 3.4, 19.5), [body, body, roofM, plain, endR, endF]);
        b.position.y = 2.65; g.add(b);
        if (i === 0 && headlights) for (const x of [-1.05, 1.05]) { const t2 = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), head); t2.position.set(x, 1.55, -9.77); t2.rotation.y = Math.PI; g.add(t2); }
        if (i === 9) for (const x of [-1.1, 1.1]) { const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.05), tail); t2.position.set(x, 1.6, 9.78); g.add(t2); }
        if (i % 2 === 1) { const pan = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.6), M.pole); pan.position.set(0, 4.75, 4); g.add(pan); }
        scene.add(g); group.push(g);
      }
      return {
        group,
        // uFront: 앞 끝 위치, dir: +1 = 우리와 같은 방향, -1 = 마주 오는 방향, lat: 횡 위치
        update(uFront, visible, dir, lat) {
          dir = dir || 1;
          group.forEach((g, i) => {
            g.visible = visible;
            if (!visible) return;
            const uc = uFront - dir * (10 + i * 20);
            const f = frame(uc, {});
            const l = typeof lat === 'function' ? lat(uc) : (lat || 0);
            g.position.set(f.x + f.rx * l, f.y, f.z + f.rz * l); g.rotation.y = -f.th + (dir < 0 ? Math.PI : 0);
          });
        },
      };
    }
    const leader = makeTrain(false);
    const opposite = makeTrain(true);

    // 표지·하늘·모니터 같은 자체 발광 그림은 톤매핑에서 제외 (색이 바래지 않게)
    scene.traverse(o => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach(m => { if (m.isMeshBasicMaterial && m.blending !== THREE.AdditiveBlending) m.toneMapped = false; });
    });

    function dispose() {
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose(); m.dispose(); });
      });
    }

    return { scene, frame, point, stationWiden, inTunnel: inT, tunnel: C.tunnel, leader, opposite, sky, dispose, monitors, routeInd, otherOff: C.otherOffset };
  }

  return { build };
})();
