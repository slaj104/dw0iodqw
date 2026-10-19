// 열차방호: ATC(차내신호, ADU) / ATS(금정~산본) + 선행열차
// 교재 8.2·8.4: 차내신호 STOP(0) / 15 / 25 / 40 / 60 / 70 / 80.
// 지시속도 초과 시 경고음 → 확인제동(제동 1단 이상) 없으면 상용제동 7단 자동 체결.
window.RS = window.RS || {};

RS.ATC = (function () {
  const KMH = 3.6;

  // 선행열차: ATC 구간에서만 운행, 각 역 25 s 정차, 지정 역에서 장시간 정차 → 40모드 등 발생
  class Leader {
    constructor(course, startStationIdx, enabled) {
      this.c = course;
      this.enabled = enabled;
      const st = course.stations[Math.min(startStationIdx, course.stations.length - 1)];
      this.s = st.stop; this.v = 0;
      this.nextStop = st.i; this.dwell = 35;
      this.longDwellAt = Math.min(course.stations.length - 2, st.i + 3);
    }
    update(dt) {
      if (!this.enabled) return;
      if (this.c.isATS(this.s + 50)) { this.enabled = false; return; } // ATS 구간 진입하면 관심 대상 아님
      if (this.dwell > 0) { this.dwell -= dt; if (this.dwell <= 0) this.nextStop++; return; }
      const st = this.c.stations[this.nextStop];
      let vT = Math.min(70, this.c.civilLimit(this.s) - 3) / KMH;
      if (st) {
        const d = st.stop - this.s;
        vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 0.65 * d)));
        if (d < 0.5 && this.v < 0.8) {
          this.s = st.stop; this.v = 0;
          this.dwell = st.i === this.longDwellAt ? 110 : 25;
          return;
        }
      }
      if (this.v < vT - 0.3) this.v += 0.7 * dt;
      else if (this.v > vT) this.v -= Math.min(0.9, (this.v - vT) * 2 + 0.3) * dt;
      this.v = Math.max(this.v, st ? 0.6 : 0);
      this.s += this.v * dt;
    }
    get rear() { return this.s - this.c.TRAIN_LEN; }
  }

  function codeFromGap(n) {
    if (n <= 1) return 0;   // STOP
    if (n === 2) return 25;
    if (n === 3) return 40;
    if (n === 4) return 60;
    return 80;
  }

  function computeCodes(course, leader) {
    let occ = Infinity;
    if (leader && leader.enabled) occ = course.blockIndexAt(Math.max(course.uMin, leader.rear));
    return course.blocks.map(b => (b.idx < occ ? Math.min(b.civil, codeFromGap(occ - b.idx)) : b.civil));
  }

  // 차상장치
  class OnBoard {
    constructor(course, mode) {
      this.c = course;
      this.mode = mode;              // ATCCgS 위치: 'ATC' | 'ATS'
      this.code = 80; this.prevCode = 80;
      this.braking = false;          // 상용 7단 자동 체결 중
      this.eb = false;               // 비상제동 (모드 불일치 등)
      this.ebReason = '';
      this.interventions = 0;
      this.codeDropT = 0;            // 지시속도 하강 후 경과 시간 (확인제동 판단)
      this.warn = false;
      this.events = [];
    }
    // u: 열차 앞 위치, vK: km/h, brake: 제동 핸들 단수
    update(dt, u, vK, brake, codes) {
      const region = this.c.atBoundary(u) ? this.mode : (this.c.isATS(u) ? 'ATS' : 'ATC');
      this.region = region;
      this.events.length = 0;
      // 모드 불일치 → 비상제동 (ATC 구간에서 ATS 모드는 차내신호 없음, ATS 구간에서 ATC 모드는 STOP)
      if (region !== this.mode && vK > 0.5 && !this.eb) {
        this.eb = true; this.ebReason = region === 'ATS' ? 'ATS 미전환 (ADU STOP)' : 'ATC 미전환';
        this.interventions++; this.events.push('eb');
      }
      if (this.eb && vK < 0.1 && region === this.mode) { this.eb = false; this.ebReason = ''; }
      if (this.mode === 'ATS') {
        this.code = null; this.braking = false; this.warn = false;
        return;
      }
      const bi = this.c.blockIndexAt(u);
      this.blockIdx = bi;
      const c = codes[bi];
      if (c !== this.code) {
        if (this.code !== null && c < this.code) this.events.push('down');
        else this.events.push('up');
        this.prevCode = this.code;
        this.code = c;
      }
      const over = vK > c + 0.5 && vK > 0.3;
      this.warn = over;
      if (over) this.codeDropT += dt; else this.codeDropT = 0;
      // 확인제동: 경고 후 1.5 s 안에 제동 1단 이상이면 운전자에게 맡김(단 +5 초과는 자동)
      if (!this.braking && over && ((this.codeDropT > 1.5 && brake < 1) || vK > c + 5)) {
        this.braking = true; this.interventions++; this.events.push('auto');
      } else if (this.braking && (vK < Math.max(c - 2, 0.1) || (c === 0 && vK < 0.1))) {
        this.braking = false;
      }
    }
    lookahead(u, codes, range) {
      const out = [];
      if (this.mode !== 'ATC') return out;
      let i = this.c.blockIndexAt(u) + 1;
      let last = codes[i - 1];
      while (i < this.c.blocks.length && this.c.blocks[i].start < u + range) {
        if (codes[i] !== last) out.push({ u: this.c.blocks[i].start, code: codes[i], label: this.c.blocks[i].label });
        last = codes[i];
        i++;
      }
      return out;
    }
  }

  return { Leader, OnBoard, computeCodes };
})();

// 차량 기기: 동력/제동 핸들, MCB·교직절환(ADS)·회생제동 차단, 공기압, 출입문
RS.Vehicle = (function () {
  class Vehicle {
    constructor(course, u) {
      this.c = course;
      this.power = 0;          // 동력 핸들 0(OFF)~4
      this.brake = 4;          // 제동 핸들 0(완해)~7, 8 = 비상
      const sup = course.supplyAt(u);
      this.ads = sup === 'NONE' ? 'DC' : sup; // 교직 절환 스위치
      this.mcb = true; this.mcbT = 0;
      this.regenCut = false;   // 회생제동 차단 스위치
      this.mr = 8.6; this.cm = false; // 주공기 압력(kg/㎠), 공기압축기
      this.doors = false;
      this.lastBrake = this.brake;
    }
    // 전차선 전원: 앞 판토그래프 ~ 마지막 판토그래프가 모두 절연구간을 지날 때까지 무전압 취급
    supply(u) {
      const D = this.c.dead;
      if (u > D.start + 20 && u < D.end + 180) return 'NONE';
      return this.c.supplyAt(u);
    }
    toggleADS() { this.ads = this.ads === 'DC' ? 'AC' : 'DC'; this.mcb = false; this.mcbT = 0; }
    update(dt, u) {
      const sup = this.supply(u);
      this.sup = sup;
      if (sup === 'NONE') { this.mcb = false; this.mcbT = 0; }
      else if (!this.mcb) {
        if (sup === this.ads) { this.mcbT += dt; if (this.mcbT > 1.5) this.mcb = true; }
        else this.mcbT = 0;
      }
      // 절연구간 직전(교재: 타행 표지 앞에서 미리 절환)에는 불일치로 보지 않음
      const D = this.c.dead, preDead = u > D.start - 400 && u < D.start;
      this.mismatch = sup !== 'NONE' && sup !== this.ads && !preDead;
      // 공기: 제동 완해 시 소비, 8.0 이하에서 압축기 기동 9.0 에서 정지
      if (this.brake < this.lastBrake) this.mr -= 0.035 * (this.lastBrake - this.brake);
      this.lastBrake = this.brake;
      this.mr -= 0.002 * dt;
      if (this.mr < 8.0) this.cm = true;
      if (this.cm) { this.mr += 0.045 * dt; if (this.mr >= 9.0) this.cm = false; }
    }
    // 물리 모델용 노치(+역행 / -제동 / -8 비상)
    notch(atcBrake, eb) {
      if (eb || this.brake === 8) return -8;
      if (atcBrake) return -Math.max(7, this.brake);
      if (this.brake > 0) return -this.brake;
      return this.power;
    }
    tractionCut() { return !this.mcb || this.doors || this.brake > 0; }
  }
  return { Vehicle };
})();
