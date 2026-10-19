// 시뮬레이션 코어 (렌더링과 분리 → 브라우저/노드 공용)
//  차량·방호장치·가이드·자동운전·채점·지적확인 환호를 한 곳에서 진행
window.RS = window.RS || {};

RS.Sim = (function () {
  const Ph = RS.Physics, KMH = 3.6;
  const DWELL = 20;

  class Sim {
    constructor(o) {
      const c = this.c = RS.makeCourse(o.dir, o.startIdx, o.endIdx);
      this.o = o;
      const A = c.stations[c.startIdx];
      this.st = Ph.makeState(A.stop);
      this.veh = new RS.Vehicle.Vehicle(c, A.stop);
      this.env = { loadFactor: o.load || 1.2, gradeAt: c.gradeAt };
      this.atc = new RS.ATC.OnBoard(c, c.isATS(A.stop + 30) ? 'ATS' : 'ATC');
      this.leader = new RS.ATC.Leader(c, c.startIdx + 1, !!o.leader && !c.isATS(A.stop + 30));
      this.codes = RS.ATC.computeCodes(c, this.leader);
      this.guide = new RS.Guide.Advisor(c, this.env);
      this.auto = !!o.auto;
      this.t = 0; this.evalT = 0; this.adv = null; this.look = [];
      this.doors = false; this.dwell = 0; this.served = false;
      this.finished = false;
      this.events = [];             // 효과음/표시용 이벤트
      this.msgs = [];
      this.score = { stops: [], over: [], overNow: false, calls: { ok: 0, miss: 0 }, eb: 0, items: {} };
      this.callState = c.calls.map(cl => ({ ...cl, state: 'wait' }));
      this.dynCalls = [];
      this.autoT = 0; this.cool = {};
      this.departT = null; this.arrivals = [];
      this.trail = [];
      this.depU = A.stop;
      this.lastV = 0; this.accel = 0;
    }

    get u() { return this.st.s; }
    get vK() { return this.st.v * KMH; }
    get seg() { return this.c.segs[this.guide.seg]; }
    get nextStation() { const s = this.seg; return s ? s.B : null; }

    flash(text, color, sec, sub) { this.msgs.push({ text, color, sub, t: sec || 3 }); }

    // ───── 입력 ─────
    input(a, n) {
      const V = this.veh;
      if (this.finished) return;
      if (['powerUp', 'powerDown', 'power4', 'brakeUp', 'brakeDown', 'brakeSet', 'eb'].includes(a) && this.auto && !this.fromAuto) {
        this.auto = false; this.flash('자동운전 해제 (수동 개입)', '#ffc04d', 2.5);
      }
      switch (a) {
        case 'powerUp': V.power = Math.min(4, V.power + 1); break;
        case 'powerDown': V.power = Math.max(0, V.power - 1); break;
        case 'power4': V.power = 4; break;
        case 'brakeUp': V.brake = Math.min(8, V.brake + 1); break;
        case 'brakeDown': V.brake = Math.max(0, V.brake - 1); break;
        case 'brakeSet': V.brake = n; break;
        case 'eb': V.brake = 8; break;
        case 'doors': this.toggleDoors(); break;
        case 'ads':
          if (V.power > 0) { this.flash('동력 OFF 후 교직 절환', '#ffc04d', 2); break; }
          V.toggleADS(); this.events.push('switch');
          this.pushCall(V.ads === 'AC' ? '교류 전환' : '직류 전환');
          this.flash(`교직 절환 스위치 ${V.ads} 위치 → MCB 차단`, null, 2.5); break;
        case 'regen':
          V.regenCut = !V.regenCut; this.events.push('switch');
          this.pushCall(V.regenCut ? '회생 차단' : '회생 복귀');
          this.flash(V.regenCut ? '회생제동 차단 스위치 개방' : '회생제동 정상 복귀', null, 2); break;
        case 'cgs': this.toggleCgS(); break;
        case 'horn': this.events.push('horn'); break;
        case 'buzzer': this.events.push('buzzer'); break;
        case 'call': this.ackCall(); break;
        case 'auto':
          this.auto = !this.auto;
          this.flash(this.auto ? '자동운전 시작' : '자동운전 해제', this.auto ? '#5fe3ff' : '#ffc04d', 2.5);
          break;
      }
      if (a.startsWith('brake') || a.startsWith('power') || a === 'eb') this.events.push('notch');
    }

    toggleCgS() {
      const V = this.veh, A = this.atc;
      if (this.st.v > 0.01) { this.flash('ATCCgS 전환은 정차 후', '#ffc04d', 2); return; }
      if (V.brake < 4) { this.flash('제동 핸들 4단 이상에서 전환 가능', '#ffc04d', 2); return; }
      A.mode = A.mode === 'ATC' ? 'ATS' : 'ATC';
      A.eb = false;
      this.events.push('switch');
      this.pushCall(A.mode === 'ATC' ? 'ATC 전환' : 'ATS 전환');
      this.flash(`ATCCgS → ${A.mode}`, '#5fe3ff', 2.5);
      this.score.items.cgs = true;
    }

    toggleDoors() {
      const B = this.nextStation;
      if (this.doors) {
        if (this.dwell < 8) { this.flash('승객 승하차 중…', '#ffc04d', 1.5); return; }
        this.doors = false; this.veh.doors = false; this.events.push('doorClose');
        this.pushCall('출입문 닫힘'); this.pushCall('안전문 닫힘');
        this.served = false;
        if (B && B.i === this.c.endIdx) { this.finish(); return; }
        this.guide.onServed();
        this.depU = this.u;
        this.flash('출입문 닫힘 — 발차', null, 2);
        return;
      }
      if (!B || this.st.v > 0.01) { this.flash('정차 후 출입문을 여세요', '#ffc04d', 1.5); return; }
      const err = this.u - B.stop;
      if (err < -5) { this.flash(`정위치 미달 ${(-err).toFixed(1)} m — 저속 전진`, '#ffc04d', 2.5); return; }
      if (err > 5) { this.flash(`정위치 초과 ${err.toFixed(1)} m — 출입문 취급 불가`, '#ff5050', 2.5); return; }
      this.doors = true; this.veh.doors = true; this.dwell = 0; this.served = true;
      this.events.push('doorOpen');
      const mm = Math.round(err * 1000);
      const grade = Math.abs(err) <= 0.5 ? '정위치' : err > 0 ? '초과' : '미달';
      this.score.stops.push({ name: B.name, err, grade, t: this.t, sched: this.sched(B.i) });
      this.arrivals.push({ i: B.i, t: this.t });
      this.pushCall(Math.abs(err) <= 0.5 ? '정위치' : err > 0 ? '정위치 초과' : '정위치 미달');
      this.pushCall('출입문 열림'); this.pushCall('안전문 열림');
      this.flash(`${B.name} ${grade}  ${mm >= 0 ? '+' : ''}${mm} mm`, grade === '정위치' ? '#72ffb0' : '#ffc04d', 3.5, `출입문 ${B.side === 'L' ? '좌측' : '우측'} 열림`);
    }

    sched(i) {
      const ref = RS.REF && RS.REF[this.c.dir];
      if (this.demo) return null;
      if (!ref) return null;
      const a = ref.arr[i], a0 = ref.dep[this.c.startIdx];
      return a == null || a0 == null ? null : a - a0;
    }

    // ───── 지적 확인 환호 ─────
    pushCall(text) { this.dynCalls.push({ text, state: 'active', t0: this.t, dyn: true }); }
    activeCalls() {
      return this.callState.filter(c => c.state === 'active').concat(this.dynCalls.filter(c => c.state === 'active'));
    }
    ackCall() {
      const a = this.activeCalls().sort((x, y) => (x.t0 || 0) - (y.t0 || 0))[0];
      if (!a) return;
      a.state = 'ok'; this.score.calls.ok++; this.events.push('call');
    }
    updateCalls() {
      const u = this.u;
      for (const c of this.callState) {
        if (c.state === 'wait' && u >= c.u - 25) { c.state = 'active'; c.t0 = this.t; }
        if (c.state === 'active' && (this.t - c.t0 > 9 && u > c.u + 40)) { c.state = 'miss'; this.score.calls.miss++; }
      }
      for (const c of this.dynCalls) if (c.state === 'active' && this.t - c.t0 > 10) { c.state = 'miss'; this.score.calls.miss++; }
      if (this.dynCalls.length > 40) this.dynCalls = this.dynCalls.filter(c => c.state === 'active');
    }

    // ───── 진행 ─────
    step(dt) {
      if (this.finished) return;
      const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) this.tick(h);
      this.accel = this.accel * 0.85 + ((this.st.v - this.lastV) / Math.max(dt, 1e-3)) * 0.15;
      this.lastV = this.st.v;
      for (const m of this.msgs) m.t -= dt;
      this.msgs = this.msgs.filter(m => m.t > 0);
      if (!this.trail.length || this.u - this.trail[this.trail.length - 1][0] > 4) {
        this.trail.push([this.u, this.vK]);
        if (this.trail.length > 900) this.trail.shift();
      }
    }

    tick(dt) {
      const c = this.c, V = this.veh;
      this.t += dt;
      this.leader.update(dt);
      this.codes = RS.ATC.computeCodes(c, this.leader);
      const vK = this.vK;
      this.atc.update(dt, this.u, vK, V.brake, this.codes);
      for (const e of this.atc.events) this.events.push('atc_' + e);
      V.update(dt, this.u);
      const notch = V.notch(this.atc.braking, this.atc.eb);
      Ph.step(this.st, notch, dt, { loadFactor: this.env.loadFactor, tractionCut: V.tractionCut() || this.atc.braking || this.atc.eb, gradeAt: c.gradeAt });
      if (this.doors) { this.dwell += dt; this.st.v = 0; }

      // 가이드 · 자동운전 (10 Hz)
      this.evalT -= dt;
      if (this.evalT <= 0) {
        this.evalT = 0.1;
        this.look = this.atc.lookahead(this.u, this.codes, 2000);
        this.adv = this.guide.evaluate(this.view(0.1));
        if (this.auto) this.autoDrive(0.1);
        this.updateCalls();
        this.checkScore();
      }

      // 정차역 통과(과주) 판정
      const B = this.nextStation;
      if (B && !this.doors && this.u > B.stop + 20) {
        this.score.stops.push({ name: B.name, err: this.u - B.stop, grade: '실패', t: this.t });
        this.flash(`${B.name} 정차 실패 (과주)`, '#ff5050', 3);
        if (B.i === c.endIdx) { this.finish(); return; }
        this.guide.onServed();
      }
      if (this.u > c.uMax - 50) this.finish();
    }

    view(dt) {
      const V = this.veh;
      return {
        st: this.st, dt, t: this.t, power: V.power, brake: V.brake, mode: this.atc.mode, code: this.atc.code,
        look: this.look, regenCut: V.regenCut, ads: V.ads, mcb: V.mcb, sup: V.sup, mismatch: V.mismatch,
        doors: this.doors, dwell: this.dwell, dwellNeed: DWELL, served: this.served, accel: this.accel,
      };
    }

    checkScore() {
      const c = this.c, u = this.u, vK = this.vK, B = this.nextStation;
      let lim = c.civilLimit(u), why = lim < c.LINE_MAX ? `제한 ${lim}` : '';
      if (this.atc.mode === 'ATC' && this.atc.code != null && this.atc.code < lim) { lim = this.atc.code; why = `ADU ${lim}`; }
      if (B && u >= B.pStart && u <= B.pStart + 30 && lim > 60) { lim = 60; why = '승강장 진입 60'; }
      this.limNow = lim;
      const over = vK > lim + 1;
      if (over && !this.score.overNow) { this.score.over.push({ u, why, v: vK, lim }); this.events.push('overspeed'); }
      if (over) { const o = this.score.over[this.score.over.length - 1]; o.v = Math.max(o.v, vK); }
      this.score.overNow = over;
      if (this.veh.brake === 8 && vK > 1 && !this.ebCounted) { this.score.eb++; this.ebCounted = true; }
      if (this.veh.brake !== 8) this.ebCounted = false;
      // 교직 절연구간 취급 확인
      const D = c.dead;
      if (!this.score.items.deadChecked && u > D.start) {
        this.score.items.deadChecked = true;
        this.score.items.regenCut = this.veh.regenCut;
        this.score.items.adsBefore = this.veh.ads === (D.toAC ? 'AC' : 'DC');
        this.score.items.coastIn = this.veh.power === 0;
      }
      if (this.score.items.deadChecked && !this.score.items.regenBackChecked && u > D.end + c.TRAIN_LEN + 300) {
        this.score.items.regenBackChecked = true; this.score.items.regenBack = !this.veh.regenCut;
      }
    }

    // ───── 자동운전: 가이드 지시를 그대로 핸들·스위치에 반영 ─────
    autoDrive(dt) {
      const a = this.adv, V = this.veh;
      if (!a) return;
      this.fromAuto = true;
      this.autoT += dt;
      for (const k in this.cool) this.cool[k] -= dt;
      const ready = (k, s) => { if ((this.cool[k] || 0) > 0) return false; this.cool[k] = s; return true; };
      // 제동 핸들: 1단씩 (0.2 s), 출발 시 완해는 즉시
      const tb = a.brake;
      if (V.brake !== tb && ready('b', 0.2)) {
        if (tb === 0 && this.st.v < 0.05 && a.act === 'depart') V.brake = 0;
        else V.brake += Math.sign(tb - V.brake);
        this.events.push('notch');
      }
      // 동력 핸들: 4단 바로 투입 (교재 원칙), OFF 즉시
      if (V.brake === 0 && V.power !== a.power) { V.power = a.power; this.events.push('notch'); }
      if (V.brake > 0) V.power = 0;
      // 스위치·출입문
      if (a.act === 'regen' && ready('regen', 1.5)) this.input('regen');
      if (a.act === 'ads' && V.power === 0 && ready('ads', 2.5)) this.input('ads');
      if (a.act === 'cgs' && V.brake >= 4 && ready('cgs', 1.5)) this.input('cgs');
      if (a.act === 'openDoors' && ready('door', 1.5)) this.input('doors');
      if (a.act === 'closeDoors' && ready('door', 1.0)) this.input('doors');
      if (this.activeCalls().length && ready('call', 0.6)) this.ackCall();
      this.fromAuto = false;
    }

    finish() {
      if (this.finished) return;
      this.finished = true;
      this.events.push('finish');
    }
  }
  Sim.DWELL = DWELL;
  return Sim;
})();
