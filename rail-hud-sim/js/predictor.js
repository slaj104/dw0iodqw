// 제동 예측기
//  - 현재 제동노치를 유지했을 때의 예상 정지위치 (운동모델을 앞당겨 적분)
//  - 목표(정지위치·속도제한 시점)를 지키기 위한 제동 개시 지점
//  - 정위치 정차를 위한 권장 제동노치
window.RS = window.RS || {};

RS.Predictor = (function () {
  const Ph = RS.Physics;
  const KMH = 3.6;

  // 상태 st에서 notch를 유지했을 때 속도가 vTarget(m/s) 이하가 될 때까지 진행거리
  function runUntil(st0, notch, vTarget, env, maxT) {
    const st = Ph.cloneState(st0);
    const dt = 0.1;
    let t = 0;
    const e = { loadFactor: env.loadFactor, tractionCut: true };
    while (t < (maxT || 180)) {
      if (st.v <= vTarget + 1e-3) return { s: st.s, t, ok: true };
      Ph.step(st, notch, dt, e);
      t += dt;
    }
    return { s: st.s, t, ok: false };
  }

  function predictStop(st, notch, env) {
    if (notch >= 0 || st.v < 0.05) return null;
    return runUntil(st, notch, 0, env).s;
  }

  // 현재 상태가 지금 즉시 planNotch로 제동한다고 가정할 때, 목표까지 남는 여유거리
  //  여유 > 0 : 아직 제동 개시 지점 전, 여유 <= 0 : 이미 제동해야 함
  function brakeMargin(st, target, planNotch, env) {
    if (st.v <= target.v + 0.05) return { margin: Infinity, need: 0 };
    // 현재 역행 중이라면 역행이 풀리는 시간까지 포함되도록 상태 그대로 사용
    const r = runUntil(st, planNotch, target.v, env);
    const need = r.s - st.s;
    return { margin: (target.s - st.s) - need, need };
  }

  // 정지목표에 맞추기 위한 최소 노치 (B1~B7)
  function recommendNotch(st, stopS, env) {
    for (let n = 1; n <= 7; n++) {
      const s = runUntil(st, -n, 0, env).s;
      if (s <= stopS + 0.3) return { notch: n, stopAt: s };
    }
    return { notch: 8, stopAt: runUntil(st, -7, 0, env).s };
  }

  // HUD/운전곡선용: 목표점까지 planDecel 로 감속할 때의 허용속도 곡선
  function brakingCurveSpeed(s, target, decel) {
    const d = target.s - s;
    if (d <= 0) return target.v;
    return Math.sqrt(target.v * target.v + 2 * decel * d);
  }

  return { runUntil, predictStop, brakeMargin, recommendNotch, brakingCurveSpeed, KMH };
})();
