// 열차방호장치 (ATC 차상신호 방식) + 선행열차
// 폐색구간별 속도코드 = min(선로 제한속도, 선행열차 점유로 인한 제한)
window.RS = window.RS || {};

RS.ATC = (function () {
  const R = RS.ROUTE;
  const KMH = 3.6;

  // 선행열차 (간단한 자동운전 모델)
  class Leader {
    constructor(startStationIdx, enabled) {
      this.enabled = enabled;
      const st = R.stations[Math.min(startStationIdx, R.stations.length - 1)];
      this.s = st.stop;
      this.v = 0;
      this.nextStop = st.idx;
      this.dwell = 30;
      // 과천역에서 장시간 정차 → 후속열차가 제한 코드를 받도록 하는 시나리오
      this.longDwellAt = 4;
    }
    update(dt) {
      if (!this.enabled) return;
      if (this.dwell > 0) {
        this.dwell -= dt;
        if (this.dwell <= 0) this.nextStop++;
        return;
      }
      const st = R.stations[this.nextStop];
      const vLimit = Math.min(70, R.civilLimit(this.s) - 3) / KMH;
      let vTarget = vLimit;
      if (st) {
        const d = st.stop - this.s;
        vTarget = Math.min(vTarget, Math.sqrt(Math.max(0, 2 * 0.7 * d)));
        if (d < 0.5 && this.v < 0.8) {
          this.s = st.stop; this.v = 0;
          this.dwell = st.idx === this.longDwellAt ? 120 : 25;
          return;
        }
      }
      if (this.v < vTarget - 0.3) this.v += 0.75 * dt;
      else if (this.v > vTarget) this.v -= Math.min(0.9, (this.v - vTarget) * 2 + 0.3) * dt;
      this.v = Math.max(this.v, st ? 0.6 : 0);
      this.s += this.v * dt;
      if (this.s > R.S_MAX + 5000) this.enabled = false;
    }
    get rear() { return this.s - R.TRAIN_LEN; }
  }

  function codeFromGap(n) {
    if (n <= 1) return 0;
    if (n === 2) return 25;
    if (n === 3) return 45;
    if (n === 4) return 60;
    return 80;
  }

  // 각 폐색의 현재 속도코드 계산
  function computeCodes(leader) {
    let occ = Infinity;
    if (leader && leader.enabled) occ = R.blockIndexAt(Math.max(R.S_MIN, leader.rear));
    return R.blocks.map(b => {
      let c = b.civil;
      if (occ !== Infinity) {
        if (b.idx >= occ) {
          // 선행열차 점유구간 이후는 고려하지 않음 (후속열차 진입 전 해소)
        } else {
          c = Math.min(c, codeFromGap(occ - b.idx));
        }
      }
      return c;
    });
  }

  // 차상장치: 현재 코드 수신, 과속 시 상용최대제동 자동체결
  class OnBoard {
    constructor() {
      this.code = 80;
      this.braking = false;
      this.interventions = 0;
      this.codeChanged = false;
      this.overspeedWarn = false;
    }
    update(sFront, vKmh, codes) {
      const bi = R.blockIndexAt(sFront);
      const c = codes[bi];
      this.codeChanged = c !== this.code;
      this.code = c;
      this.blockIdx = bi;
      this.overspeedWarn = vKmh > c - 2 && vKmh > 0.5;
      if (!this.braking && vKmh > c + 1) {
        this.braking = true;
        this.interventions++;
      } else if (this.braking && (vKmh < c - 1 || (c === 0 && vKmh < 0.1))) {
        this.braking = false;
      }
    }
    // 진행방향 전방 코드 변화 목록 (HUD 예측용)
    lookahead(sFront, codes, range) {
      const out = [];
      let i = R.blockIndexAt(sFront) + 1;
      let last = codes[i - 1];
      while (i < R.blocks.length && R.blocks[i].start < sFront + range) {
        if (codes[i] !== last) out.push({ s: R.blocks[i].start, code: codes[i] });
        last = codes[i];
        i++;
      }
      return out;
    }
  }

  return { Leader, OnBoard, computeCodes };
})();
