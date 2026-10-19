// 열차 운동 모델 (10량 전동차, 동력 핸들 1~4단 / 제동 핸들 1~7단·비상)
window.RS = window.RS || {};

RS.Physics = (function () {
  const KMH = 3.6;
  const G = 9.81;

  const P = {
    maxAccel: 3.0 / KMH,     // 기동가속도 3.0 km/h/s (정토크 영역)
    basePowerSpeed: 35,      // 정토크 → 정출력 전환 속도(km/h)
    charSpeed: 70,           // 정출력 → 특성 영역(가속도 ∝ 1/V²) 전환 속도(km/h)
    brakeStep: 0.5 / KMH,    // 상용제동 1노치당 0.5 km/h/s → B7 = 3.5 km/h/s
    ebDecel: 4.5 / KMH,      // 비상제동 4.5 km/h/s
    brakeApplyRate: 0.9,     // 제동력 상승률 (m/s³)  ─ 공기제동 응답지연 모사
    brakeReleaseRate: 1.4,
    brakeDeadTime: 0.35,     // 제동 지령 후 실제 체결까지 공주시간(s)
    tracRate: 0.8,           // 역행 jerk 제한 (1/s, 노치비율 기준)
  };

  function notchName(n) {
    if (n > 0) return 'P' + n;
    if (n === 0) return 'N';
    if (n === -8) return 'EB';
    return 'B' + (-n);
  }

  function brakeCmd(n) {
    if (n >= 0) return 0;
    if (n === -8) return P.ebDecel;
    return P.brakeStep * (-n);
  }

  // 주행저항 (m/s²), v: m/s — 터널 안에서는 공기저항 항이 커짐 (터널 저항 계수 1.6)
  function resistance(v, tunnel) {
    const k = v * KMH;
    return 0.008 + 0.00008 * k + 0.0000025 * k * k * (tunnel ? 1.6 : 1);
  }

  // 견인 특성: 정토크(0~35) → 정출력(35~70, a∝1/V) → 특성 영역(70~, a∝1/V²)
  function tractionMax(v, loadFactor) {
    const k = Math.max(v * KMH, 1), b = P.basePowerSpeed, c = P.charSpeed;
    let a = P.maxAccel;
    if (k > c) a *= (b / c) * (c / k) * (c / k);
    else if (k > b) a *= b / k;
    return a / loadFactor; // 응하중 제동과 달리 역행은 하중에 따라 가속도 감소
  }

  // 저속에서 회생제동이 줄고 공기제동(제륜자)으로 넘어가며 마찰계수가 커져 감속도가 약간 증가
  // (교재: 정차 직전 1단으로 충격 방지)
  function brakeFactor(v) {
    const k = v * KMH;
    return k < 12 ? 1 + 0.18 * (1 - k / 12) : 1;
  }

  function makeState(s) {
    return { s, v: 0, bAct: 0, tAct: 0, bDelay: 0, lastBCmd: 0 };
  }

  function cloneState(st) {
    return { s: st.s, v: st.v, bAct: st.bAct, tAct: st.tAct, bDelay: st.bDelay, lastBCmd: st.lastBCmd };
  }

  // env: { loadFactor, tractionCut(bool), gradeAt(u) 열차 전체 평균 환산구배, tunnelAt(u) }
  function step(st, notch, dt, env) {
    // 제동 지령
    const bc = brakeCmd(notch);
    if (bc > st.lastBCmd + 1e-6 && st.bAct < 0.02) st.bDelay = P.brakeDeadTime; // 완해 상태에서 제동 지령 시 공주시간
    st.lastBCmd = bc;
    if (st.bDelay > 0) {
      st.bDelay -= dt;
    } else {
      const d = bc - st.bAct;
      const r = (d > 0 ? P.brakeApplyRate : P.brakeReleaseRate) * dt;
      st.bAct += Math.max(-r, Math.min(r, d));
    }
    if (bc < st.bAct && st.bDelay > 0) st.bDelay = 0;

    // 역행 지령
    const tCmd = (notch > 0 && !env.tractionCut) ? notch / 4 : 0;
    const dT = tCmd - st.tAct;
    const rT = P.tracRate * dt * (dT > 0 ? 1 : 2.5);
    st.tAct += Math.max(-rT, Math.min(rT, dT));
    if (env.tractionCut && st.tAct > 0) st.tAct = Math.max(0, st.tAct - 3 * dt);

    const grade = env.gradeAt(st.s);
    const aTrac = st.tAct * tractionMax(st.v, env.loadFactor);
    const aGrade = -G * grade / 1000;
    let a = aTrac + aGrade;
    const resist = st.v > 0.01 ? resistance(st.v, env.tunnelAt ? env.tunnelAt(st.s) : false) : 0;
    const retard = st.bAct * brakeFactor(st.v) + resist;

    if (st.v <= 0.0001) {
      // 정지 중: 제동력이 구배력을 이기면 정지 유지
      if (a > retard) { st.v += (a - retard) * dt; }
      else st.v = 0;
    } else {
      st.v += (a - retard) * dt;
      if (st.v < 0) st.v = 0;
    }
    st.s += st.v * dt;
    return st;
  }

  return { P, KMH, G, notchName, brakeCmd, resistance, tractionMax, brakeFactor, makeState, cloneState, step };
})();
