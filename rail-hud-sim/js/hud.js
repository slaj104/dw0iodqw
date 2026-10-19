// 운전실 프레임 + 전면유리 HUD + 하단 계기판(TCMS, 운전곡선, 투핸들)
window.RS = window.RS || {};

RS.HUD = (function () {
  let cab, hud, dash, gc, gh, gd, W = 0, H = 0, DH = 0, dpr = 1, ws = null;
  const COL = '#72ffb0', DIM = 'rgba(114,255,176,0.6)', AMBER = '#ffc04d', RED = '#ff5050', CYAN = '#5fe3ff', WHITE = '#f2fff7';
  const FONT = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const MONO = 'Consolas, "D2Coding", "Roboto Mono", monospace';
  const TAGCOL = { '교재': COL, '보정': AMBER, 'ATC': AMBER, '절연': CYAN, '정차': COL };

  function init(c1, c2, c3) { cab = c1; hud = c2; dash = c3; gc = cab.getContext('2d'); gh = hud.getContext('2d'); gd = dash.getContext('2d'); resize(); }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    DH = Math.round(Math.max(170, H * 0.27));
    for (const c of [cab, hud]) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    dash.width = W * dpr; dash.height = DH * dpr; dash.style.width = W + 'px'; dash.style.height = DH + 'px';
    const bot = H - DH - H * 0.012;
    ws = { top: H * 0.03, bot, tl: W * 0.07, tr: W * 0.93, bl: W * 0.02, br: W * 0.98 };
    ws.cx = W / 2; ws.h = ws.bot - ws.top; ws.w = ws.br - ws.bl;
    drawCab();
  }

  function wsPath(g, inset) {
    const i = inset || 0, r = 26;
    const p = [[ws.tl + i, ws.top + i], [ws.tr - i, ws.top + i], [ws.br - i, ws.bot - i], [ws.bl + i, ws.bot - i]];
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = p[k], b = p[(k + 1) % 4], c = p[(k + 3) % 4];
      const ux = b[0] - a[0], uy = b[1] - a[1], ul = Math.hypot(ux, uy), vx = c[0] - a[0], vy = c[1] - a[1], vl = Math.hypot(vx, vy);
      const s = [a[0] + vx / vl * r, a[1] + vy / vl * r], e = [a[0] + ux / ul * r, a[1] + uy / ul * r];
      if (k === 0) g.moveTo(s[0], s[1]); else g.lineTo(s[0], s[1]);
      g.quadraticCurveTo(a[0], a[1], e[0], e[1]);
    }
    g.closePath();
  }

  function drawCab() {
    const g = gc;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#1b1f24'); grd.addColorStop(0.6, '#262b31'); grd.addColorStop(1, '#121417');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.save(); g.globalCompositeOperation = 'destination-out'; wsPath(g, 0); g.fill(); g.restore();
    g.lineWidth = 8; g.strokeStyle = '#0a0b0d'; wsPath(g, 0); g.stroke();
    g.lineWidth = 2; g.strokeStyle = '#3d444c'; wsPath(g, -6); g.stroke();
    g.save(); wsPath(g, 3); g.clip();
    const rg = g.createLinearGradient(ws.bl, ws.top, ws.br, ws.bot);
    rg.addColorStop(0, 'rgba(255,255,255,0.05)'); rg.addColorStop(0.35, 'rgba(255,255,255,0)'); rg.addColorStop(0.62, 'rgba(255,255,255,0.025)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#08090a'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(ws.bl + ws.w * 0.16, ws.bot - 4); g.lineTo(ws.bl + ws.w * 0.45, ws.bot - 20); g.stroke();
    g.restore();
  }

  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function txt(g, s, x, y, size, color, align, font, weight) {
    g.font = `${weight || 600} ${size}px ${font || FONT}`;
    g.fillStyle = color; g.textAlign = align || 'left'; g.textBaseline = 'middle';
    if (g === gh) { g.save(); g.shadowBlur = 0; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,14,8,0.5)'; g.lineWidth = Math.max(2, size / 8); g.strokeText(s, x, y); g.restore(); }
    g.fillText(s, x, y);
    return g.measureText(s).width;
  }
  const fmtD = (m) => !isFinite(m) ? '—' : Math.abs(m) >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  function chip(g, x, y, label, col, on, S) {
    g.save(); g.shadowBlur = 0; g.font = `700 ${13 * S}px ${FONT}`;
    const w = g.measureText(label).width + 16 * S;
    rr(g, x, y - 11 * S, w, 22 * S, 6 * S);
    if (on) { g.fillStyle = col; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1; }
    g.strokeStyle = on ? col : 'rgba(114,255,176,0.25)'; g.lineWidth = 1.5; g.stroke(); g.restore();
    txt(g, label, x + 8 * S, y, 13 * S, on ? col : 'rgba(114,255,176,0.4)', 'left', FONT, 700);
    return w + 6 * S;
  }

  // ───────── 전면유리 HUD ─────────
  function draw(d, project) {
    const g = gh;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!d.hudOn) return;
    g.save(); wsPath(g, 4); g.clip();
    g.shadowColor = 'rgba(80,255,170,0.5)'; g.shadowBlur = 8;
    const blink = Math.floor(performance.now() / 280) % 2 === 0;
    const S = Math.max(0.62, Math.min(1.2, Math.min(ws.h / 560, ws.w / 1300)));

    drawAR(g, d, project, S);

    // 상단 좌: 상태 칩
    const y0 = ws.top + 30 * S;
    let x = ws.tl + 26 * S;
    x += chip(g, x, y0, d.mode, d.mode === 'ATC' ? COL : CYAN, true, S);
    x += chip(g, x, y0, `ADS ${d.ads}`, d.ads === 'AC' ? CYAN : COL, true, S);
    x += chip(g, x, y0, d.sup === 'NONE' ? '무전압' : d.sup === 'AC' ? 'AC 25kV' : 'DC 1500V', d.sup === 'NONE' ? AMBER : d.sup === 'AC' ? CYAN : COL, true, S);
    x += chip(g, x, y0, d.mcb ? 'MCB ON' : 'MCB OFF', d.mcb ? COL : AMBER, true, S);
    x += chip(g, x, y0, '회생차단', AMBER, d.regenCut, S);
    if (d.auto) chip(g, x, y0, 'AUTO 자동운전', CYAN, true, S);
    txt(g, `${d.grade > 0 ? '▲' : d.grade < 0 ? '▼' : '─'} ${Math.abs(d.grade)}‰  ·  ${d.km.toFixed(2)} km`, ws.tl + 26 * S, y0 + 26 * S, 13 * S, DIM, 'left', MONO);

    // 상단 중앙: 다음역 · 정시
    if (d.station) {
      txt(g, `다음 정차  ${d.station.name}`, ws.cx, y0, 23 * S, COL, 'center', FONT, 800);
      const sch = d.sched == null ? '' : `   ·   ${d.sched > 3 ? `지연 +${Math.round(d.sched)}초` : d.sched < -3 ? `조기 ${Math.round(d.sched)}초` : '정시'}`;
      txt(g, `${fmtD(d.station.dist)}   ·   출입문 ${d.station.side === 'L' ? '◀ 좌측' : '우측 ▶'}${sch}`, ws.cx, y0 + 26 * S, 15 * S, d.sched > 15 ? AMBER : DIM, 'center');
    }
    txt(g, d.clock, ws.tr - 26 * S, y0, 16 * S, DIM, 'right', MONO, 700);
    if (d.leaderDist != null) txt(g, `선행열차 ${fmtD(d.leaderDist)}`, ws.tr - 26 * S, y0 + 22 * S, 13 * S, DIM, 'right');

    // ── 운전 가이드 박스
    const a = d.adv;
    if (a && d.guideOn) {
      const bw = Math.min(600 * S, ws.w * 0.44), bx = ws.cx - bw / 2 - ws.w * 0.04, by = ws.top + ws.h * 0.16, bh = 96 * S;
      const tc = TAGCOL[a.tag] || COL;
      g.save(); g.shadowBlur = 0; rr(g, bx, by, bw, bh, 12 * S); g.fillStyle = 'rgba(0,20,12,0.28)'; g.fill();
      g.strokeStyle = tc; g.lineWidth = a.tag === '보정' ? 2.5 : 1.5; g.stroke(); g.restore();
      if (a.tag !== '교재') chip(g, bx + 12 * S, by + 20 * S, a.tag, tc, true, S);
      txt(g, a.main, bx + 14 * S, by + 52 * S, 28 * S, a.tag === '보정' && blink ? AMBER : WHITE, 'left', FONT, 800);
      txt(g, a.sub || '', bx + 14 * S, by + 80 * S, 15 * S, tc, 'left', FONT, 600);
      if (a.reason) txt(g, '↳ ' + a.reason, bx + 14 * S, by + bh + 52 * S, 13 * S, AMBER, 'left', FONT, 700);
      if (d.calls.length) {
        const c = d.calls[0], cx = bx, cy = by + bh + 22 * S;
        g.save(); g.shadowBlur = 0; g.font = `800 ${16 * S}px ${FONT}`;
        const w = g.measureText(`☞ ${c}`).width + 70 * S;
        rr(g, cx, cy - 15 * S, w, 30 * S, 8 * S); g.fillStyle = blink ? 'rgba(95,227,255,0.22)' : 'rgba(95,227,255,0.1)'; g.fill();
        g.strokeStyle = CYAN; g.lineWidth = 1.5; g.stroke(); g.restore();
        txt(g, `☞ ${c}`, cx + 10 * S, cy, 16 * S, CYAN, 'left', FONT, 800);
        txt(g, '[F]', cx + w - 10 * S, cy, 13 * S, CYAN, 'right', MONO, 700);
        if (d.calls.length > 1) txt(g, `+${d.calls.length - 1}`, cx + w + 8 * S, cy, 13 * S, CYAN, 'left', MONO);
      }
      const lx = ws.tr - 30 * S, ly = ws.top + ws.h * 0.16, maxW = lx - 70 * S - (bx + bw + 16 * S);
      txt(g, '다음 취급', lx, ly, 13 * S, DIM, 'right', FONT, 700);
      (a.upcoming || []).slice(0, 5).forEach((it, i) => {
        const yy = ly + (i + 1) * 22 * S;
        g.font = `600 ${13.5 * S}px ${FONT}`;
        let s = it.text;
        while (g.measureText(s).width > maxW && s.length > 4) s = s.slice(0, -2);
        if (s !== it.text) s += '…';
        txt(g, s, lx - 70 * S, yy, 13.5 * S, it.kind === 'call' ? CYAN : it.kind === 'stop' ? WHITE : COL, 'right', FONT, 600);
        txt(g, fmtD(it.dist), lx, yy, 13 * S, DIM, 'right', MONO, 700);
      });
    }

    // ── 정위치 표시 (승강장 모니터와 같은 값)
    if (d.pos) {
      const e = d.pos.err, px = ws.tl + 30 * S, py = ws.top + ws.h * 0.40, pw = 210 * S, ph = 116 * S;
      let st = '접근', col = DIM;
      if (Math.abs(e) <= 0.5) { st = '양호'; col = COL; } else if (e > 0) { st = '초과'; col = RED; } else if (e > -10 || d.pos.stopped) { st = '미달'; col = AMBER; }
      const val = Math.abs(e) < 10 ? `${e >= 0 ? '+' : '-'}${String(Math.abs(Math.round(e * 1000))).padStart(3, '0')} mm` : `${e >= 0 ? '+' : '-'}${Math.abs(e).toFixed(1)} m`;
      g.save(); g.shadowBlur = 0; rr(g, px, py, pw, ph, 10 * S); g.fillStyle = 'rgba(0,20,12,0.3)'; g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); g.restore();
      txt(g, `${d.pos.st.name} 정위치`, px + 12 * S, py + 18 * S, 13 * S, DIM, 'left', FONT, 700);
      txt(g, '정지위치까지', px + pw - 12 * S, py + 18 * S, 11 * S, DIM, 'right', FONT, 600);
      txt(g, st, px + 12 * S, py + 56 * S, 30 * S, col, 'left', FONT, 900);
      txt(g, val, px + pw - 12 * S, py + 58 * S, 24 * S, col, 'right', MONO, 800);
      const by = py + 90 * S, bw = pw - 24 * S, bx = px + 12 * S;
      g.strokeStyle = DIM; g.lineWidth = 1; g.strokeRect(bx, by, bw, 8 * S);
      g.fillStyle = 'rgba(114,255,176,0.35)'; g.fillRect(bx + bw / 2 - bw * 0.05, by, bw * 0.1, 8 * S);
      const mx = bx + bw / 2 + Math.max(-1, Math.min(1, e / 5)) * bw / 2;
      g.fillStyle = col; g.beginPath(); g.arc(mx, by + 4 * S, 6 * S, 0, 7); g.fill();
      txt(g, '-5 m', bx, by + 18 * S, 9 * S, DIM, 'left', MONO); txt(g, '+5 m', bx + bw, by + 18 * S, 9 * S, DIM, 'right', MONO);
    }

    // ── 하단 클러스터
    const baseY = ws.bot - ws.h * 0.24;
    const spX = ws.cx - 250 * S;
    const over = d.vKmh > d.limNow + 0.5;
    txt(g, String(Math.round(d.vKmh)), spX, baseY - 4 * S, 82 * S, over ? RED : WHITE, 'right', MONO, 700);
    txt(g, 'km/h', spX, baseY + 40 * S, 15 * S, DIM, 'right', MONO);
    const tx = spX - 250 * S, ty = baseY + 64 * S, tw = 250 * S;
    g.strokeStyle = DIM; g.lineWidth = 1.5; g.strokeRect(tx, ty, tw, 10 * S);
    g.fillStyle = over ? RED : COL; g.fillRect(tx, ty, tw * Math.min(1, d.vKmh / 100), 10 * S);
    { const cx = tx + tw * Math.min(1, d.limNow / 100); g.fillStyle = AMBER; g.beginPath(); g.moveTo(cx, ty - 2); g.lineTo(cx - 6 * S, ty - 12 * S); g.lineTo(cx + 6 * S, ty - 12 * S); g.fill(); }
    if (d.refV != null) { const cx = tx + tw * Math.min(1, d.refV / 100); g.strokeStyle = CYAN; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, ty + 12 * S); g.lineTo(cx, ty + 20 * S); g.stroke(); }
    for (let k = 0; k <= 100; k += 20) txt(g, String(k), tx + tw * k / 100, ty + 26 * S, 10 * S, DIM, 'center', MONO);

    const atX = ws.cx - 150 * S, atY = baseY - 4 * S, r = 38 * S;
    g.lineWidth = 5 * S; g.strokeStyle = d.atcBraking || d.eb ? RED : d.mode === 'ATS' ? CYAN : d.code === 0 ? RED : AMBER;
    g.beginPath(); g.arc(atX, atY, r, 0, Math.PI * 2); g.stroke();
    if (d.mode === 'ATS') txt(g, 'ATS', atX, atY + 2 * S, 22 * S, CYAN, 'center', MONO, 800);
    else txt(g, d.code === 0 ? 'STOP' : String(d.code), atX, atY + 2 * S, (d.code === 0 ? 20 : 34) * S, WHITE, 'center', MONO, 800);
    txt(g, d.mode === 'ATS' ? '신호 G 진행' : 'ADU', atX, atY - r - 11 * S, 12 * S, DIM, 'center', FONT, 700);
    if (d.nextCode) {
      txt(g, `▸ ${d.nextCode.code === 0 ? 'STOP' : d.nextCode.code}`, atX, atY + r + 16 * S, 17 * S, d.nextCode.code < (d.code || 99) ? AMBER : COL, 'center', MONO, 800);
      txt(g, fmtD(d.nextCode.dist), atX, atY + r + 34 * S, 12 * S, DIM, 'center', MONO);
    }
    if (d.civil < 80) {
      const lx = atX + 88 * S;
      g.save(); g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(lx, atY, 26 * S, 0, 7); g.fill();
      g.strokeStyle = '#e0242c'; g.lineWidth = 6 * S; g.beginPath(); g.arc(lx, atY, 23 * S, 0, 7); g.stroke();
      g.font = `900 ${20 * S}px ${MONO}`; g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(d.civil), lx, atY + 1);
      g.restore();
      txt(g, '제한', lx, atY - 36 * S, 12 * S, DIM, 'center', FONT, 700);
    }

    const gx = ws.cx + 30 * S, gy = baseY - 30 * S, gw = 300 * S;
    if (d.stopBraking && d.predErr != null) {
      const e = d.predErr, ok = Math.abs(e) <= 0.5, warn = Math.abs(e) <= 3, col = ok ? COL : warn ? AMBER : RED;
      txt(g, `${d.station ? d.station.name : ''} 예상 정지`, gx, gy, 15 * S, DIM, 'left', FONT, 700);
      txt(g, `${e >= 0 ? '+' : ''}${e.toFixed(2)} m`, gx, gy + 30 * S, 32 * S, col, 'left', MONO, 800);
      if (d.rec) txt(g, `권장 ${Math.min(7, d.rec)}단`, gx + gw, gy + 30 * S, 22 * S, d.rec === d.brake ? COL : AMBER, 'right', FONT, 800);
      const by = gy + 58 * S;
      g.strokeStyle = DIM; g.lineWidth = 1; g.strokeRect(gx, by, gw, 8 * S);
      g.fillStyle = 'rgba(114,255,176,0.35)'; g.fillRect(gx + gw / 2 - gw * 0.025, by, gw * 0.05, 8 * S);
      g.fillStyle = WHITE; g.fillRect(gx + gw / 2 - 1, by - 6 * S, 2, 20 * S);
      const px = gx + gw / 2 + Math.max(-1, Math.min(1, e / 10)) * gw / 2;
      g.fillStyle = col; g.beginPath(); g.arc(px, by + 4 * S, 7 * S, 0, 7); g.fill();
      txt(g, '-10', gx, by + 20 * S, 10 * S, DIM, 'left', MONO); txt(g, '±0.5 m 정위치', gx + gw / 2, by + 20 * S, 10 * S, DIM, 'center'); txt(g, '+10 m', gx + gw, by + 20 * S, 10 * S, DIM, 'right', MONO);
    } else if (d.bp && d.bp.dist < 900) {
      const m = d.bp.dist, col = m < 80 ? AMBER : COL;
      if (m <= 1 && !d.braking) { if (blink) txt(g, '▼ 제동 개시', gx, gy + 20 * S, 30 * S, RED, 'left', FONT, 900); }
      else {
        txt(g, `제동 개시까지 · ${d.bp.why}`, gx, gy, 14 * S, DIM, 'left', FONT, 700);
        txt(g, fmtD(m), gx + gw, gy + 26 * S, 28 * S, col, 'right', MONO, 800);
        g.strokeStyle = DIM; g.lineWidth = 1; g.strokeRect(gx, gy + 50 * S, gw, 8 * S);
        g.fillStyle = col; g.fillRect(gx, gy + 50 * S, gw * Math.max(0, Math.min(1, m / 400)), 8 * S);
      }
    }
    txt(g, `P${d.power}`, ws.cx + 440 * S, baseY + 50 * S, 22 * S, d.power > 0 ? CYAN : DIM, 'right', MONO, 800);
    txt(g, d.brake === 8 ? 'EB' : `B${d.brake}`, ws.cx + 440 * S, baseY + 76 * S, 22 * S, d.brake === 8 ? RED : d.brake > 0 ? AMBER : DIM, 'right', MONO, 800);
    if (d.doors) txt(g, '출입문 열림', ws.cx + 440 * S, baseY + 100 * S, 13 * S, AMBER, 'right');

    // 안내방송 자막
    if (d.caption) {
      g.save(); g.shadowBlur = 0;
      g.font = `600 ${14 * S}px ${FONT}`;
      let s = d.caption;
      const maxW = ws.w * 0.38, ccx = ws.cx + 70 * S;
      const lines = [];
      while (s.length) { let n = s.length; while (g.measureText(s.slice(0, n)).width > maxW && n > 5) n--; lines.push(s.slice(0, n)); s = s.slice(n).trimStart(); if (lines.length > 2) break; }
      const ch = (lines.length * 20 + 14) * S, cw = maxW + 50 * S, cx = ccx - cw / 2, cy = ws.bot - ch - 12 * S;
      rr(g, cx, cy, cw, ch, 8 * S); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill(); g.restore();
      txt(g, '안내방송', cx + 10 * S, cy + 16 * S, 11 * S, CYAN, 'left', FONT, 800);
      lines.forEach((l, i) => txt(g, l, ccx + 20 * S, cy + (17 + i * 20) * S, 14 * S, WHITE, 'center', FONT, 600));
    }

    let bannerY = ws.top + ws.h * 0.53;
    const banner = (text, col, sub) => {
      g.save(); g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,0.3)'; rr(g, ws.cx - 260 * S, bannerY - 20 * S, 520 * S, sub ? 60 * S : 40 * S, 10); g.fill();
      g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.restore();
      txt(g, text, ws.cx, bannerY, 20 * S, col, 'center', FONT, 800);
      if (sub) txt(g, sub, ws.cx, bannerY + 24 * S, 14 * S, col, 'center');
      bannerY -= (sub ? 70 : 50) * S;
    };
    if (d.eb && blink) banner(`비상제동 — ${d.ebReason}`, RED, '정차 후 ATCCgS 전환 (T)');
    if (d.atcBraking && blink) banner('ATC 상용제동 7단 자동 체결', RED, `지시속도 ${d.code} km/h 초과 — 확인제동 미취급`);
    else if (d.atcWarn) banner(`ADU ${d.code} 초과 — 확인제동 (제동 1단 이상)`, AMBER);
    if (d.msg) banner(d.msg.text, d.msg.color || COL, d.msg.sub);
    g.restore();
  }

  function drawAR(g, d, project, S) {
    const line = (u, color, label, sub, width) => {
      const far = u - d.sCam > 380;
      const a = project(u, -1.6, 0), b = project(u, 1.6, 0);
      if (!a || !b) return;
      g.strokeStyle = color; g.lineWidth = (width || 3) * Math.max(0.6, Math.min(2.2, Math.abs(b.x - a.x) / 60));
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      const t = project(u, 1.6, 1.6);
      if (t) { g.lineWidth = 1.5; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke(); }
      if (label && !far) { const p = t || b; txt(g, label, p.x + 6, p.y, 13 * S, color, 'left', FONT, 700); if (sub) txt(g, sub, p.x + 6, p.y + 16 * S, 11 * S, color, 'left', FONT); }
    };
    if (d.ar.predStop != null && d.ar.predStop > d.sCam + 6) {
      const pts = [], back = [], s0 = d.sCam + 6, s1 = d.ar.predStop;
      for (let u = s0; u <= s1; u += Math.max(2, (s1 - s0) / 60)) { const a = project(u, -0.9, 0.02), b = project(u, 0.9, 0.02); if (a && b) { pts.push(a); back.push(b); } }
      if (pts.length > 1) {
        const ok = d.predErr != null && Math.abs(d.predErr) <= 0.5;
        g.save(); g.shadowBlur = 0; g.fillStyle = ok ? 'rgba(114,255,176,0.14)' : 'rgba(255,192,77,0.14)';
        g.beginPath(); g.moveTo(pts[0].x, pts[0].y); pts.forEach(p => g.lineTo(p.x, p.y)); back.reverse().forEach(p => g.lineTo(p.x, p.y)); g.closePath(); g.fill(); g.restore();
      }
    }
    for (const c of d.ar.codes) line(c.u, AMBER, `ADU ${c.code === 0 ? 'STOP' : c.code}`, null, 2);
    for (const l of d.ar.limits) line(l.u, '#ff7a7a', `제한 ${l.v}`, null, 2);
    if (d.ar.stopMark != null) line(d.ar.stopMark, WHITE, '정지위치', null, 3);
    if (d.ar.brakePoint != null) line(d.ar.brakePoint, CYAN, '제동 개시', d.ar.bpText || '', 4);
    if (d.ar.predStop != null) line(d.ar.predStop, d.predErr != null && Math.abs(d.predErr) <= 0.5 ? COL : AMBER, '예상 정지', null, 4);
    if (d.ar.dead) { line(d.ar.dead[0], CYAN, '절연 구간', null, 2); line(d.ar.dead[1], CYAN, null, null, 2); }
  }

  // ───────── 하단 계기판 ─────────
  function drawDash(d, chart) {
    const g = gd;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, DH);
    const grd = g.createLinearGradient(0, 0, 0, DH); grd.addColorStop(0, '#30363d'); grd.addColorStop(1, '#15181c');
    g.fillStyle = grd; g.fillRect(0, 0, W, DH);
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, W, 4);
    const pad = 12, h = DH - pad * 2;
    const mw = Math.min(300, W * 0.23), cw = Math.min(170, W * 0.14);
    monitor(g, pad, pad, mw, h, d);
    handles(g, W - pad - cw, pad, cw, h, d);
    runCurve(g, pad * 2 + mw, pad, W - mw - cw - pad * 4, h, d, chart);
  }
  function screen(g, x, y, w, h) { g.fillStyle = '#05080a'; rr(g, x, y, w, h, 8); g.fill(); g.strokeStyle = '#4a525b'; g.lineWidth = 2; g.stroke(); }

  function monitor(g, x, y, w, h, d) {
    screen(g, x, y, w, h);
    const rows = [
      ['속도', `${d.vKmh.toFixed(1)} km/h`],
      [d.mode === 'ATS' ? 'ATS' : 'ADU', d.mode === 'ATS' ? '진행' : d.code === 0 ? 'STOP' : `${d.code}`],
      ['동력 / 제동', `${d.power ? d.power + '단' : 'OFF'} / ${d.brake === 8 ? '비상' : d.brake ? d.brake + '단' : '완해'}`],
      ['BC / MR', `${d.bc.toFixed(1)} / ${d.mr.toFixed(1)} kg/㎠`],
      ['전차선', d.sup === 'NONE' ? '무전압' : d.sup === 'AC' ? 'AC 25 kV' : 'DC 1500 V'],
      ['MCB · ADS', `${d.mcb ? 'ON' : 'OFF'} · ${d.ads}${d.regenCut ? ' · 회생차단' : ''}`],
      ['CM · 승차율', `${d.cm ? '구동' : '정지'} · ${d.loadPct}%`],
      ['운행 시간', d.runTime],
    ];
    const f = Math.max(10, Math.min(13, h / 14));
    txt(g, 'TCMS', x + 10, y + f, f, '#7fb8ff', 'left', MONO, 700);
    txt(g, d.clock, x + w - 10, y + f, f, '#7fb8ff', 'right', MONO, 700);
    const lh = (h - f * 2.6) / rows.length;
    rows.forEach((r, i) => { const yy = y + f * 2.2 + lh * (i + 0.5); txt(g, r[0], x + 10, yy, f, '#9aa5b1', 'left'); txt(g, r[1], x + w - 10, yy, f, '#e8f0f8', 'right', MONO, 700); });
  }

  function handles(g, x, y, w, h, d) {
    screen(g, x, y, w, h);
    const half = w / 2;
    const P = ['4', '3', '2', '1', 'OFF'], B = ['완해', '1', '2', '3', '4', '5', '6', '7', '비상'];
    txt(g, '동력', x + half / 2, y + 12, 11, '#9aa5b1', 'center', FONT, 700);
    txt(g, '제동', x + half + half / 2, y + 12, 11, '#9aa5b1', 'center', FONT, 700);
    const lhP = (h - 26) / P.length, lhB = (h - 26) / B.length;
    P.forEach((it, i) => {
      const v = 4 - i, on = v === d.power, yy = y + 22 + lhP * (i + 0.5);
      if (on) { g.fillStyle = v ? '#1d6fb8' : '#2e7d4f'; g.fillRect(x + 6, yy - lhP / 2 + 1, half - 10, lhP - 2); }
      if (d.guideOn && d.adv && d.adv.power === v && !on && d.adv.brake === 0) { g.strokeStyle = CYAN; g.lineWidth = 1.5; g.strokeRect(x + 6, yy - lhP / 2 + 1, half - 10, lhP - 2); }
      txt(g, it, x + half / 2, yy, Math.min(13, lhP * 0.6), on ? '#fff' : '#6b7580', 'center', MONO, 700);
    });
    B.forEach((it, i) => {
      const on = i === d.brake, yy = y + 22 + lhB * (i + 0.5);
      if (on) { g.fillStyle = i === 8 ? '#b82020' : i ? '#b8861d' : '#2e7d4f'; g.fillRect(x + half + 4, yy - lhB / 2 + 1, half - 10, lhB - 2); }
      if (d.guideOn && d.adv && d.adv.brake === i && !on) { g.strokeStyle = CYAN; g.lineWidth = 1.5; g.strokeRect(x + half + 4, yy - lhB / 2 + 1, half - 10, lhB - 2); }
      txt(g, it, x + half + half / 2, yy, Math.min(12, lhB * 0.6), on ? '#fff' : '#6b7580', 'center', FONT, 700);
    });
  }

  function runCurve(g, x, y, w, h, d, c) {
    screen(g, x, y, w, h);
    const s0 = d.u - 150, s1 = d.u + 2350, vMax = 100;
    const L = x + 30, R = x + w - 8, T = y + 34, Bt = y + h - 20;
    const sx = s => L + (s - s0) / (s1 - s0) * (R - L), sy = v => Bt - v / vMax * (Bt - T);
    txt(g, '운전곡선', x + 10, y + 12, 12, '#7fb8ff', 'left', FONT, 800);
    if (c.note) {
      g.font = `500 11px ${FONT}`;
      let s = '구간: ' + c.note;
      while (g.measureText(s).width > w - 90 && s.length > 10) s = s.slice(0, -2);
      if (s.length < ('구간: ' + c.note).length) s += '…';
      txt(g, s, x + 70, y + 12, 11, '#9aa5b1', 'left', FONT, 500);
    }
    g.strokeStyle = '#1a2229'; g.lineWidth = 1;
    for (let v = 0; v <= vMax; v += 20) { g.beginPath(); g.moveTo(L, sy(v)); g.lineTo(R, sy(v)); g.stroke(); txt(g, String(v), L - 5, sy(v), 9, '#5d6873', 'right', MONO); }
    g.save(); g.beginPath(); g.rect(L, T - 4, R - L, Bt - T + 8); g.clip();
    if (c.dead) { g.fillStyle = 'rgba(95,227,255,0.12)'; g.fillRect(sx(c.dead.start), T, sx(c.dead.end) - sx(c.dead.start), Bt - T); }
    for (const st of c.stations) {
      if (st.stop < s0 - 200 || st.pStart > s1) continue;
      g.fillStyle = 'rgba(120,170,255,0.12)'; g.fillRect(sx(st.pStart), T, sx(st.pEnd) - sx(st.pStart), Bt - T);
      g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(sx(st.stop), T); g.lineTo(sx(st.stop), Bt); g.stroke();
      txt(g, st.name, sx(st.u), Bt + 10, 10, '#a9c4ff', 'center');
    }
    g.strokeStyle = '#ffc04d'; g.lineWidth = 2; g.beginPath();
    let first = true;
    for (let u = s0; u <= s1; u += 10) { const v = c.limitAt(u); if (first) { g.moveTo(sx(u), sy(v)); first = false; } else g.lineTo(sx(u), sy(v)); }
    g.stroke();
    if (c.ref) {
      g.setLineDash([3, 3]); g.strokeStyle = 'rgba(160,200,255,0.75)'; g.lineWidth = 1.5; g.beginPath(); first = true;
      for (let u = s0; u <= s1; u += c.ref.step) { const k = Math.round((u - c.ref.u0) / c.ref.step); const v = c.ref.v[k]; if (v == null) continue; if (first) { g.moveTo(sx(u), sy(v)); first = false; } else g.lineTo(sx(u), sy(v)); }
      g.stroke(); g.setLineDash([]);
    }
    g.strokeStyle = '#72ffb0'; g.lineWidth = 2; g.beginPath();
    c.trail.forEach((p, i) => { if (i === 0) g.moveTo(sx(p[0]), sy(p[1])); else g.lineTo(sx(p[0]), sy(p[1])); });
    g.stroke();
    if (c.brakePoint != null) { g.strokeStyle = '#5fe3ff'; g.lineWidth = 2; g.beginPath(); g.moveTo(sx(c.brakePoint), T); g.lineTo(sx(c.brakePoint), Bt); g.stroke(); }
    if (c.predStop != null) { g.fillStyle = '#72ffb0'; g.beginPath(); g.arc(sx(c.predStop), sy(0), 5, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(sx(d.u), sy(d.vKmh), 5, 0, 7); g.fill();
    g.restore();
    const lg = [['#ffc04d', '상한(ADU·제한)'], ['rgba(160,200,255,0.9)', '기준 운전선도'], ['#72ffb0', '실주행']];
    let lx = R;
    for (let i = lg.length - 1; i >= 0; i--) {
      g.font = `600 10px ${FONT}`; const tw = g.measureText(lg[i][1]).width; lx -= tw;
      txt(g, lg[i][1], lx, y + 26, 10, '#9aa5b1', 'left'); g.fillStyle = lg[i][0]; g.fillRect(lx - 13, y + 25, 10, 3); lx -= 24;
    }
  }

  return { init, resize, draw, drawDash, get ws() { return ws; }, get size() { return { W, H, DH }; } };
})();
