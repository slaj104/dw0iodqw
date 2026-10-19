// 열차 운동 모델 (10량 전동차, 단일핸들 주간제어기 P4~N~B7~EB)
window.RS = window.RS || {};

RS.Physics = (function () {
  const R = RS.ROUTE;
  const KMH = 3.6;
  const G = 9.81;

  const P = {
    maxAccel: 3.0 / KMH,     // 기동가속도 3.0 km/h/s (만차 기준 아님, 공차 근사)
    basePowerSpeed: 40,      // 정출력 영역 시작 속도(km/h)
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

  // 주행저항 (m/s²), v: m/s
  function resistance(v) {
    const k = v * KMH;
    return 0.008 + 0.00008 * k + 0.0000025 * k * k;
  }

  function tractionMax(v, loadFactor) {
    const k = Math.max(v * KMH, 1);
    const a = P.maxAccel * Math.min(1, P.basePowerSpeed / k);
    return a / loadFactor; // 응하중 제동과 달리 역행은 하중에 따라 가속도 감소
  }

  function makeState(s) {
    return { s, v: 0, bAct: 0, tAct: 0, bDelay: 0, lastBCmd: 0 };
  }

  function cloneState(st) {
    return { s: st.s, v: st.v, bAct: st.bAct, tAct: st.tAct, bDelay: st.bDelay, lastBCmd: st.lastBCmd };
  }

  // env: { loadFactor, tractionCut(bool) }
  function step(st, notch, dt, env) {
    // 제동 지령
    const bc = brakeCmd(notch);
    if (bc > st.lastBCmd + 1e-6) st.bDelay = P.brakeDeadTime; // 제동 증가 지령 시 공주시간
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

    const grade = R.gradeAt(st.s);
    const aTrac = st.tAct * tractionMax(st.v, env.loadFactor);
    const aGrade = -G * grade / 1000;
    let a = aTrac + aGrade;
    const resist = st.v > 0.01 ? resistance(st.v) : 0;
    const retard = st.bAct + resist;

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

  return { P, KMH, G, notchName, brakeCmd, resistance, makeState, cloneState, step };
})();
