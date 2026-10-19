// 운전실 프레임 + 전면유리 HUD + 하단 계기판
window.RS = window.RS || {};

RS.HUD = (function () {
  let cab, hud, dash, gc, gh, gd, W = 0, H = 0, DH = 0, dpr = 1;
  let ws = null; // 전면유리 영역
  const COL = '#72ffb0', COL_DIM = 'rgba(114,255,176,0.55)', AMBER = '#ffc04d', RED = '#ff5050', CYAN = '#5fe3ff', WHITE = '#f2fff7';
  const FONT = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const MONO = 'Consolas, "D2Coding", "Roboto Mono", monospace';

  function init(c1, c2, c3) {
    cab = c1; hud = c2; dash = c3;
    gc = cab.getContext('2d'); gh = hud.getContext('2d'); gd = dash.getContext('2d');
    resize();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    DH = Math.round(H * 0.30);
    for (const c of [cab, hud]) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    dash.width = W * dpr; dash.height = DH * dpr; dash.style.width = W + 'px'; dash.style.height = DH + 'px';
    const bot = H - DH - H * 0.015;
    ws = { top: H * 0.035, bot, tl: W * 0.085, tr: W * 0.915, bl: W * 0.03, br: W * 0.97 };
    ws.cx = W / 2; ws.h = ws.bot - ws.top; ws.w = ws.br - ws.bl;
    drawCab();
  }

  function wsPath(g, inset) {
    const i = inset || 0, r = 26;
    const p = [[ws.tl + i, ws.top + i], [ws.tr - i, ws.top + i], [ws.br - i, ws.bot - i], [ws.bl + i, ws.bot - i]];
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = p[k], b = p[(k + 1) % 4], c = p[(k + 3) % 4];
      const ux = (b[0] - a[0]), uy = (b[1] - a[1]), ul = Math.hypot(ux, uy);
      const vx = (c[0] - a[0]), vy = (c[1] - a[1]), vl = Math.hypot(vx, vy);
      const s = [a[0] + vx / vl * r, a[1] + vy / vl * r], e = [a[0] + ux / ul * r, a[1] + uy / ul * r];
      if (k === 0) g.moveTo(s[0], s[1]); else g.lineTo(s[0], s[1]);
      g.quadraticCurveTo(a[0], a[1], e[0], e[1]);
    }
    g.closePath();
  }

  // 운전실 내부 (정적)
  function drawCab() {
    const g = gc;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#1d2126'); grd.addColorStop(0.6, '#2a2f35'); grd.addColorStop(1, '#14171a');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    // 유리창 구멍
    g.save();
    g.globalCompositeOperation = 'destination-out';
    wsPath(g, 0); g.fill();
    g.restore();
    // 창틀 고무
    g.lineWidth = 7; g.strokeStyle = '#0b0c0e'; wsPath(g, 0); g.stroke();
    g.lineWidth = 2; g.strokeStyle = '#3d444c'; wsPath(g, -5); g.stroke();
    // 유리 반사 (은은한 사선 하이라이트)
    g.save(); wsPath(g, 3); g.clip();
    const rg = g.createLinearGradient(ws.bl, ws.top, ws.br, ws.bot);
    rg.addColorStop(0, 'rgba(255,255,255,0.05)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.0)');
    rg.addColorStop(0.62, 'rgba(255,255,255,0.03)'); rg.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    // 와이퍼 (정지 위치)
    g.strokeStyle = '#08090a'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ws.bl + ws.w * 0.18, ws.bot - 4); g.lineTo(ws.bl + ws.w * 0.47, ws.bot - 22); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(ws.bl + ws.w * 0.18, ws.bot - 4); g.lineTo(ws.bl + ws.w * 0.30, ws.bot - 2); g.stroke();
    g.restore();
    // HUD 결상 영역 표시 (Combiner 경계, 매우 옅게)
    g.save(); wsPath(g, 3); g.clip();
    g.strokeStyle = 'rgba(160,255,210,0.06)'; g.lineWidth = 1;
    roundRect(g, ws.cx - ws.w * 0.36, ws.top + ws.h * 0.30, ws.w * 0.72, ws.h * 0.66, 16); g.stroke();
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function txt(g, s, x, y, size, color, align, font, weight) {
    g.font = `${weight || 600} ${size}px ${font || FONT}`;
    g.fillStyle = color; g.textAlign = align || 'left'; g.textBaseline = 'middle';
    if (g === gh) {
      // 밝은 배경(지상 구간)에서도 읽히도록 옅은 어두운 외곽선
      g.save(); g.shadowBlur = 0; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,16,8,0.45)'; g.lineWidth = Math.max(2, size / 9);
      g.strokeText(s, x, y); g.restore();
    }
    g.fillText(s, x, y);
  }

  function fmtDist(m) {
    if (!isFinite(m)) return '—';
    if (Math.abs(m) >= 1000) return (m / 1000).toFixed(2) + ' km';
    return Math.round(m) + ' m';
  }

  // ───────── HUD (매 프레임) ─────────
  function draw(d, project) {
    const g = gh;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!d.hudOn) return;
    g.save();
    wsPath(g, 4); g.clip();
    g.shadowColor = 'rgba(80,255,170,0.55)'; g.shadowBlur = 8;
    const blink = Math.floor(performance.now() / 280) % 2 === 0;
    const S = Math.max(0.65, Math.min(1.25, ws.h / 560)); // 화면 크기 비례

    drawAR(g, d, project, S);

    // ─ 상단: 다음역 / 출입문 / 전원 ─
    const topY = ws.top + 36 * S;
    if (d.station) {
      txt(g, `다음 정차  ${d.station.name}`, ws.cx, topY, 24 * S, COL, 'center');
      txt(g, `${fmtDist(d.station.dist)}   ·   출입문 ${d.station.side === 'L' ? '◀ 좌측' : '우측 ▶'}`, ws.cx, topY + 28 * S, 17 * S, COL_DIM, 'center');
    } else {
      txt(g, '종착 — 운행 종료', ws.cx, topY, 24 * S, COL, 'center');
    }
    txt(g, d.supply, ws.tl + 30 * S, topY, 17 * S, d.supply.startsWith('AC') ? CYAN : d.supply.startsWith('DC') ? COL : AMBER, 'left', MONO, 700);
    txt(g, `구배 ${d.grade > 0 ? '+' : ''}${d.grade}‰`, ws.tl + 30 * S, topY + 24 * S, 15 * S, COL_DIM, 'left', MONO);
    txt(g, d.clock, ws.tr - 30 * S, topY, 17 * S, COL_DIM, 'right', MONO);
    if (d.leaderDist !== null) txt(g, `선행열차 ${fmtDist(d.leaderDist)}`, ws.tr - 30 * S, topY + 24 * S, 15 * S, COL_DIM, 'right', FONT);

    // ─ 중앙 하단 클러스터 ─
    const baseY = ws.bot - ws.h * 0.30;
    const spX = ws.cx - 235 * S;
    // 속도
    const over = d.vKmh > d.code + 0.5;
    txt(g, String(Math.round(d.vKmh)), spX, baseY - 4 * S, 84 * S, over ? RED : WHITE, 'right', MONO, 700);
    txt(g, 'km/h', spX, baseY + 40 * S, 16 * S, COL_DIM, 'right', MONO);

    // 속도 테이프 (0~100)
    const tx = spX - 240 * S, ty = baseY + 66 * S, tw = 240 * S;
    g.strokeStyle = COL_DIM; g.lineWidth = 1.5;
    g.strokeRect(tx, ty, tw, 10 * S);
    g.fillStyle = over ? RED : COL;
    g.fillRect(tx, ty, tw * Math.min(1, d.vKmh / 100), 10 * S);
    const cx = tx + tw * Math.min(1, d.code / 100);
    g.fillStyle = AMBER; g.beginPath(); g.moveTo(cx, ty - 2); g.lineTo(cx - 7 * S, ty - 13 * S); g.lineTo(cx + 7 * S, ty - 13 * S); g.fill();
    for (let k = 0; k <= 100; k += 20) txt(g, String(k), tx + tw * k / 100, ty + 22 * S, 11 * S, COL_DIM, 'center', MONO);

    // ATC 허용속도 표지
    const atX = ws.cx - 140 * S, atY = baseY - 6 * S, r = 40 * S;
    g.lineWidth = 5 * S; g.strokeStyle = d.atcBraking ? RED : (d.code === 0 ? RED : AMBER);
    g.beginPath(); g.arc(atX, atY, r, 0, Math.PI * 2); g.stroke();
    txt(g, String(d.code), atX, atY + 2 * S, 38 * S, WHITE, 'center', MONO, 700);
    txt(g, 'ATC', atX, atY - r - 12 * S, 13 * S, COL_DIM, 'center', MONO);
    if (d.nextCodes.length) {
      const n = d.nextCodes[0];
      txt(g, `▸ ${n.code}`, atX, atY + r + 18 * S, 20 * S, n.code < d.code ? AMBER : COL, 'center', MONO, 700);
      txt(g, fmtDist(n.dist), atX, atY + r + 40 * S, 14 * S, COL_DIM, 'center', MONO);
    }

    // 제동 안내
    const gx = ws.cx - 40 * S, gy = baseY - 40 * S, gw = 330 * S;
    const gd_ = d.guidance;
    if (gd_) {
      const label = gd_.type === 'stop' ? `${gd_.name} 정차` : gd_.v === 0 ? 'ATC 0 코드 — 폐색 앞 정지' : `ATC ${gd_.v} km/h 감속`;
      txt(g, label, gx, gy - 4 * S, 15 * S, COL_DIM, 'left');
      if (gd_.type === 'stop' && d.vKmh < 0.5 && Math.abs(gd_.dist) < 15) {
        // 정차 완료 → 정지오차와 출입문 안내
        const e = -gd_.dist, ok = Math.abs(e) <= 1, can = Math.abs(e) <= 5;
        txt(g, '정차', gx, gy + 26 * S, 18 * S, COL, 'left');
        txt(g, `${e >= 0 ? '+' : ''}${e.toFixed(2)} m`, gx + 100 * S, gy + 26 * S, 30 * S, ok ? COL : can ? AMBER : RED, 'left', MONO, 700);
        txt(g, d.doors ? '승하차 중 — D: 출입문 닫기' : can ? 'D: 출입문 열기' : (e < 0 ? '미달 — 저속 전진' : '과주 — 출입문 취급 불가'), gx, gy + 58 * S, 16 * S, can ? COL : AMBER, 'left');
      } else if (!isFinite(gd_.margin)) {
        txt(g, '출발', gx, gy + 26 * S, 18 * S, COL, 'left');
        txt(g, `목표까지 ${fmtDist(gd_.dist)}`, gx, gy + 56 * S, 16 * S, COL_DIM, 'left');
      } else if (d.braking && gd_.type === 'stop' && d.predStop) {
        // 제동 중 → 예상 정지위치 표시
        const e = d.predStop.err;
        const ok = Math.abs(e) <= 1, warn = Math.abs(e) <= 5;
        const col = ok ? COL : warn ? AMBER : RED;
        txt(g, '예상 정지', gx, gy + 26 * S, 18 * S, COL, 'left');
        txt(g, `${e >= 0 ? '+' : ''}${e.toFixed(1)} m`, gx + 100 * S, gy + 26 * S, 30 * S, col, 'left', MONO, 700);
        txt(g, e > 1 ? '과주 예상 — 제동 추가' : e < -1 ? '미달 예상 — 제동 완화' : '정위치', gx, gy + 56 * S, 16 * S, col, 'left');
        // 정지위치 게이지 (-20 ~ +20 m)
        const bx = gx, by = gy + 76 * S, bw = gw;
        g.strokeStyle = COL_DIM; g.lineWidth = 1; g.strokeRect(bx, by, bw, 8 * S);
        g.fillStyle = WHITE; g.fillRect(bx + bw / 2 - 1, by - 6 * S, 2, 20 * S);
        const px = bx + bw / 2 + Math.max(-1, Math.min(1, e / 20)) * bw / 2;
        g.fillStyle = col; g.beginPath(); g.arc(px, by + 4 * S, 7 * S, 0, 7); g.fill();
        txt(g, '-20', bx, by + 22 * S, 11 * S, COL_DIM, 'left', MONO);
        txt(g, '+20 m', bx + bw, by + 22 * S, 11 * S, COL_DIM, 'right', MONO);
        if (d.rec) txt(g, `권장 B${d.rec}`, gx + gw, gy + 26 * S, 20 * S, d.rec === -d.notch ? COL : AMBER, 'right', MONO, 700);
      } else if (gd_.margin <= 0 && !d.braking) {
        if (blink) txt(g, '▼ 제동 개시', gx, gy + 30 * S, 34 * S, RED, 'left', FONT, 800);
        txt(g, `목표까지 ${fmtDist(gd_.dist)}`, gx, gy + 64 * S, 16 * S, AMBER, 'left');
        if (d.rec) txt(g, `권장 B${d.rec}`, gx + gw, gy + 30 * S, 20 * S, AMBER, 'right', MONO, 700);
      } else if (d.braking && gd_.type !== 'stop') {
        txt(g, '감속 중', gx, gy + 28 * S, 22 * S, COL, 'left');
        txt(g, `목표 ${gd_.v} km/h 까지 ${fmtDist(gd_.dist)}`, gx, gy + 56 * S, 16 * S, COL_DIM, 'left');
      } else {
        const m = gd_.margin;
        const col = m < 80 ? AMBER : COL;
        txt(g, '제동 개시까지', gx, gy + 26 * S, 18 * S, COL, 'left');
        txt(g, fmtDist(m), gx + gw, gy + 26 * S, 30 * S, col, 'right', MONO, 700);
        const frac = Math.max(0, Math.min(1, m / 400));
        g.strokeStyle = COL_DIM; g.lineWidth = 1; g.strokeRect(gx, gy + 50 * S, gw, 9 * S);
        g.fillStyle = col; g.fillRect(gx, gy + 50 * S, gw * frac, 9 * S);
        txt(g, `기준 B${d.planNotch} · 목표까지 ${fmtDist(gd_.dist)}`, gx, gy + 76 * S, 14 * S, COL_DIM, 'left');
      }
    }

    // 노치 / 출입문
    txt(g, d.notchName, ws.cx + 410 * S, baseY + 60 * S, 26 * S, d.notch < 0 ? AMBER : d.notch > 0 ? CYAN : COL, 'right', MONO, 700);
    if (d.doors) txt(g, '출입문 열림', ws.cx + 410 * S, baseY + 88 * S, 15 * S, AMBER, 'right');

    // ─ 경고 배너 ─
    let bannerY = ws.top + ws.h * 0.28;
    const banner = (text, col, sub) => {
      g.save(); g.shadowBlur = 0;
      g.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(g, ws.cx - 260 * S, bannerY - 22 * S, 520 * S, sub ? 64 * S : 44 * S, 10); g.fill();
      g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.restore();
      txt(g, text, ws.cx, bannerY, 22 * S, col, 'center', FONT, 800);
      if (sub) txt(g, sub, ws.cx, bannerY + 26 * S, 15 * S, col, 'center');
      bannerY += (sub ? 76 : 56) * S;
    };
    if (d.atcBraking && blink) banner('ATC 과속 — 상용최대제동 자동체결', RED, `허용 ${d.code} km/h`);
    else if (d.overspeedWarn && !d.atcBraking) banner('ATC 허용속도 근접', AMBER);
    if (d.dead) {
      if (d.dead.inDead) banner('교직 절연구간 — 타력 운전', AMBER, `역행 재개까지 ${fmtDist(d.dead.remain)}`);
      else if (d.dead.ahead < 400) banner(`절연구간 ${fmtDist(d.dead.ahead)} 앞 — 역행 OFF 준비`, AMBER, 'DC 1500 V → AC 25 kV 전환');
    }
    if (d.msg) banner(d.msg.text, d.msg.color || COL, d.msg.sub);

    g.restore();
  }

  // 증강현실(AR) 선로 겹침 표시
  function drawAR(g, d, project, S) {
    const line = (s, color, label, sub, width) => {
      if (s - d.ar.sCam > 380) label = null; // 먼 표식은 선만 표시 (겹침 방지)
      const a = project(s, -1.6, 0), b = project(s, 1.6, 0);
      if (!a || !b) return;
      g.strokeStyle = color; g.lineWidth = (width || 3) * Math.max(0.6, Math.min(2.2, Math.abs(b.x - a.x) / 60));
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      // 세로 기둥
      const t = project(s, 1.6, 1.6);
      if (t) { g.lineWidth = 1.5; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke(); }
      if (label) {
        const p = t || b;
        txt(g, label, p.x + 6, p.y, 14 * S, color, 'left', FONT, 700);
        if (sub) txt(g, sub, p.x + 6, p.y + 17 * S, 12 * S, color, 'left', MONO);
      }
    };
    // 예상 정지까지의 진로 카펫
    if (d.ar.predStop !== null && d.ar.predStop > d.ar.sCam + 6) {
      const pts = [], back = [];
      const s0 = d.ar.sCam + 6, s1 = d.ar.predStop;
      for (let s = s0; s <= s1; s += Math.max(2, (s1 - s0) / 60)) {
        const a = project(s, -0.9, 0.02), b = project(s, 0.9, 0.02);
        if (a && b) { pts.push(a); back.push(b); }
      }
      if (pts.length > 1) {
        const ok = Math.abs(d.predStop ? d.predStop.err : 0) <= 1;
        g.save(); g.shadowBlur = 0;
        g.fillStyle = ok ? 'rgba(114,255,176,0.13)' : 'rgba(255,192,77,0.13)';
        g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
        pts.forEach(p => g.lineTo(p.x, p.y));
        back.reverse().forEach(p => g.lineTo(p.x, p.y));
        g.closePath(); g.fill(); g.restore();
      }
    }
    for (const c of d.ar.codes) line(c.s, AMBER, `ATC ${c.code}`, null, 2);
    if (d.ar.stopMark !== null) line(d.ar.stopMark, WHITE, '정지위치', null, 3);
    if (d.ar.brakePoint !== null) line(d.ar.brakePoint, CYAN, '제동 개시', `B${d.planNotch} 기준`, 4);
    if (d.ar.predStop !== null) {
      const ok = Math.abs(d.predStop ? d.predStop.err : 0) <= 1;
      line(d.ar.predStop, ok ? COL : AMBER, '예상 정지', null, 4);
    }
    if (d.ar.dead) { line(d.ar.dead[0], AMBER, '절연 시작', null, 2); line(d.ar.dead[1], AMBER, null, null, 2); }
  }

  // ───────── 하단 계기판 ─────────
  function drawDash(d, chart) {
    const g = gd;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, DH);
    const grd = g.createLinearGradient(0, 0, 0, DH);
    grd.addColorStop(0, '#30363d'); grd.addColorStop(1, '#16191d');
    g.fillStyle = grd; g.fillRect(0, 0, W, DH);
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, W, 4);

    const pad = 14, h = DH - pad * 2;
    // 좌: TCMS 모니터
    const mw = Math.min(330, W * 0.24);
    monitor(g, pad, pad, mw, h, d);
    // 우: 주간제어기
    const cw = Math.min(150, W * 0.12);
    controller(g, W - pad - cw, pad, cw, h, d);
    // 중앙: 운전곡선
    runCurve(g, pad * 2 + mw, pad, W - mw - cw - pad * 4, h, d, chart);
  }

  function screen(g, x, y, w, h) {
    g.fillStyle = '#05080a'; roundRect(g, x, y, w, h, 8); g.fill();
    g.strokeStyle = '#4a525b'; g.lineWidth = 2; g.stroke();
  }

  function monitor(g, x, y, w, h, d) {
    screen(g, x, y, w, h);
    const f = Math.max(10, Math.min(14, h / 15));
    const rows = [
      ['속도', `${d.vKmh.toFixed(1)} km/h`],
      ['ATC 코드', `${d.code} km/h`],
      ['주간제어기', d.notchName + (d.atcBraking ? ' (ATC B7)' : '')],
      ['BC 압력', `${Math.round(d.bc)} kPa`],
      ['가속도', `${(d.accel * 3.6).toFixed(2)} km/h/s`],
      ['전차선', d.supply],
      ['위치', `${(d.s / 1000).toFixed(3)} km`],
      ['ATC 개입', `${d.interventions} 회`],
    ];
    txt(g, 'TCMS', x + 12, y + f + 4, f, '#7fb8ff', 'left', MONO, 700);
    txt(g, d.clock, x + w - 12, y + f + 4, f, '#7fb8ff', 'right', MONO, 700);
    const lh = (h - f * 3) / rows.length;
    rows.forEach((r, i) => {
      const yy = y + f * 2.6 + lh * (i + 0.5);
      txt(g, r[0], x + 12, yy, f, '#9aa5b1', 'left');
      txt(g, r[1], x + w - 12, yy, f, '#e8f0f8', 'right', MONO, 700);
    });
  }

  function controller(g, x, y, w, h, d) {
    screen(g, x, y, w, h);
    const items = ['P4', 'P3', 'P2', 'P1', 'N', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'EB'];
    const lh = (h - 16) / items.length;
    items.forEach((it, i) => {
      const n = 4 - i === -9 ? -8 : (i <= 4 ? 4 - i : -(i - 4));
      const val = it === 'EB' ? -8 : n;
      const on = val === d.notch;
      const yy = y + 8 + lh * (i + 0.5);
      if (on) { g.fillStyle = it[0] === 'P' ? '#1d6fb8' : it === 'N' ? '#2e7d4f' : it === 'EB' ? '#b82020' : '#b8861d'; g.fillRect(x + 8, yy - lh / 2 + 1, w - 16, lh - 2); }
      txt(g, it, x + w / 2, yy, Math.min(14, lh * 0.7), on ? '#fff' : '#7b8590', 'center', MONO, 700);
    });
  }

  function runCurve(g, x, y, w, h, d, c) {
    screen(g, x, y, w, h);
    const s0 = d.s - 150, s1 = d.s + 2350;
    const vMax = 100;
    const L = x + 34, Rr = x + w - 10, T = y + 22, B = y + h - 22;
    const sx = s => L + (s - s0) / (s1 - s0) * (Rr - L);
    const sy = v => B - v / vMax * (B - T);
    txt(g, '운전곡선 (거리-속도)', x + 10, y + 12, 12, '#7fb8ff', 'left', FONT, 700);
    // 격자
    g.strokeStyle = '#1a2229'; g.lineWidth = 1;
    for (let v = 0; v <= vMax; v += 20) { g.beginPath(); g.moveTo(L, sy(v)); g.lineTo(Rr, sy(v)); g.stroke(); txt(g, String(v), L - 6, sy(v), 10, '#5d6873', 'right', MONO); }
    g.save(); g.beginPath(); g.rect(L, T - 4, Rr - L, B - T + 8); g.clip();
    // 절연구간
    if (c.dead) { g.fillStyle = 'rgba(255,170,40,0.15)'; g.fillRect(sx(c.dead.start), T, sx(c.dead.end) - sx(c.dead.start), B - T); }
    // 역
    for (const st of c.stations) {
      if (st.stop < s0 - 200 || st.pStart > s1) continue;
      g.fillStyle = 'rgba(120,170,255,0.12)'; g.fillRect(sx(st.pStart), T, sx(st.pEnd) - sx(st.pStart), B - T);
      g.strokeStyle = '#ffffff'; g.beginPath(); g.moveTo(sx(st.stop), T); g.lineTo(sx(st.stop), B); g.stroke();
      txt(g, st.name, sx(st.s), B + 11, 11, '#a9c4ff', 'center');
    }
    // ATC 코드 (계단)
    g.strokeStyle = '#ffc04d'; g.lineWidth = 2; g.beginPath();
    let first = true;
    for (const b of c.blocks) {
      if (b.end < s0 || b.start > s1) continue;
      const a = sx(Math.max(b.start, s0)), e = sx(Math.min(b.end, s1)), yy = sy(b.code);
      if (first) { g.moveTo(a, yy); first = false; } else g.lineTo(a, yy);
      g.lineTo(e, yy);
    }
    g.stroke();
    // 제동 곡선
    g.setLineDash([5, 4]); g.strokeStyle = '#5fe3ff'; g.lineWidth = 1.5;
    for (const tg of c.targets) {
      g.beginPath();
      for (let s = Math.max(s0, tg.s - 1500); s <= tg.s; s += 8) {
        const v = RS.Predictor.brakingCurveSpeed(s, tg, c.planDecel) * 3.6;
        if (s === Math.max(s0, tg.s - 1500)) g.moveTo(sx(s), sy(Math.min(v, vMax))); else g.lineTo(sx(s), sy(Math.min(v, vMax)));
      }
      g.stroke();
    }
    g.setLineDash([]);
    // 주행 이력
    g.strokeStyle = '#72ffb0'; g.lineWidth = 2; g.beginPath();
    c.trail.forEach((p, i) => { if (i === 0) g.moveTo(sx(p[0]), sy(p[1])); else g.lineTo(sx(p[0]), sy(p[1])); });
    g.stroke();
    // 제동개시 / 예상정지
    if (c.brakePoint !== null) { g.strokeStyle = '#5fe3ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx(c.brakePoint), T); g.lineTo(sx(c.brakePoint), B); g.stroke(); }
    if (c.predStop !== null) { g.fillStyle = '#72ffb0'; g.beginPath(); g.arc(sx(c.predStop), sy(0), 5, 0, 7); g.fill(); }
    // 현재
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(d.s), sy(d.vKmh), 5, 0, 7); g.fill();
    g.restore();
    // 범례
    const lg = [['#ffc04d', 'ATC 허용'], ['#5fe3ff', `제동곡선(B${d.planNotch})`], ['#72ffb0', '실주행']];
    let lx = Rr;
    for (let i = lg.length - 1; i >= 0; i--) {
      g.font = `600 11px ${FONT}`;
      const tw = g.measureText(lg[i][1]).width;
      lx -= tw;
      txt(g, lg[i][1], lx, y + 12, 11, '#9aa5b1', 'left');
      g.fillStyle = lg[i][0]; g.fillRect(lx - 14, y + 10, 10, 3);
      lx -= 26;
    }
  }

  return { init, resize, draw, drawDash, get ws() { return ws; }, get size() { return { W, H, DH }; } };
})();
