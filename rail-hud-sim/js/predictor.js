// 제동/주행 예측기: 운동 모델(physics.js)을 앞당겨 적분해서 결과를 예측
//  - 예상 정지위치, 제동 개시 지점(여유거리), 정위치 정차 권장 노치
//  - 타력/동력 운전 시 특정 지점 도달 속도 (교재 기준값 보정에 사용)
window.RS = window.RS || {};

RS.Predictor = (function () {
  const Ph = RS.Physics;
  const KMH = 3.6;

  function envOf(env, cut) { return { loadFactor: env.loadFactor, tractionCut: cut, gradeAt: env.gradeAt, tunnelAt: env.tunnelAt }; }

  // notch 를 유지했을 때 속도가 vTarget(m/s) 이하가 될 때까지
  function runUntil(st0, notch, vTarget, env, maxT) {
    const st = Ph.cloneState(st0);
    const e = envOf(env, true);
    let t = 0;
    while (t < (maxT || 180)) {
      if (st.v <= vTarget + 1e-3) return { s: st.s, t, ok: true };
      Ph.step(st, notch, 0.1, e);
      t += 0.1;
    }
    return { s: st.s, t, ok: false };
  }

  // 단계 제동 계획 [{notch, dur}] (마지막 단계는 계속 유지)
  function runPlan(st0, plan, vTarget, env) {
    const st = Ph.cloneState(st0);
    const e = envOf(env, true);
    let t = 0, k = 0, tk = 0;
    while (t < 180) {
      if (st.v <= vTarget + 1e-3) return { s: st.s, t };
      while (k < plan.length - 1 && tk >= plan[k].dur) { k++; tk = 0; }
      Ph.step(st, plan[k].notch, 0.1, e);
      t += 0.1; tk += 0.1;
    }
    return { s: st.s, t };
  }

  function predictStop(st, notch, env) {
    if (notch >= 0 || st.v < 0.05) return null;
    return runUntil(st, notch, 0, env).s;
  }

  // 지금 notch 로 제동하면 target(u, v)까지 남는 여유거리 (+: 아직 여유, -: 늦음)
  function brakeMargin(st, target, notch, env) {
    if (st.v <= target.v + 0.05) return { margin: Infinity, need: 0 };
    const r = runUntil(st, notch, target.v, env);
    return { margin: (target.u - st.s) - (r.s - st.s), need: r.s - st.s };
  }

  // target 을 지키는 최소 노치 (n0 이상)
  function minNotchFor(st, target, env, n0) {
    for (let n = n0 || 1; n <= 7; n++) {
      if (brakeMargin(st, target, -n, env).margin >= 0) return n;
    }
    return 8;
  }

  // 정위치 정차 최소 노치 (정지위치 + tol 을 넘지 않는 가장 약한 노치)
  function recommendNotch(st, stopU, env, tol) {
    for (let n = 1; n <= 7; n++) {
      const s = runUntil(st, -n, 0, env).s;
      if (s <= stopU + (tol == null ? 0.25 : tol)) return { notch: n, stopAt: s };
    }
    return { notch: 8, stopAt: runUntil(st, -7, 0, env).s };
  }

  // 타력(무동력)으로 uTarget 까지 갔을 때의 속도. 도중 정지하면 -1
  // vmaxCheck: [{start,end,v}] 를 넘는 최초 지점 반환
  function coast(st0, uTarget, env, limits) {
    const st = Ph.cloneState(st0);
    const e = envOf(env, true);
    let over = null, vmax = st.v;
    for (let t = 0; t < 400; t += 0.2) {
      if (st.s >= uTarget) return { v: st.v, over, vmax };
      Ph.step(st, 0, 0.2, e);
      vmax = Math.max(vmax, st.v);
      if (limits && !over) {
        for (const l of limits) if (st.s >= l.start && st.s <= l.end && st.v * KMH > l.v + 0.5) { over = { u: st.s, v: st.v * KMH, lim: l.v }; break; }
      }
      if (st.v <= 0.01) return { v: -1, over, vmax, stopU: st.s };
    }
    return { v: st.v, over, vmax };
  }

  // 동력 4단으로 offV(km/h) 까지 가속 후 타력으로 uTarget 도달 속도
  function powerThenCoast(st0, offV, uTarget, env) {
    const st = Ph.cloneState(st0);
    const e = envOf(env, false);
    for (let t = 0; t < 200 && st.v * KMH < offV && st.s < uTarget; t += 0.2) Ph.step(st, 4, 0.2, e);
    return coast(st, uTarget, env, null).v;
  }

  function brakingCurveSpeed(u, target, decel) {
    const d = target.u - u;
    if (d <= 0) return target.v;
    return Math.sqrt(target.v * target.v + 2 * decel * d);
  }

  return { runUntil, runPlan, predictStop, brakeMargin, minNotchFor, recommendNotch, coast, powerThenCoast, brakingCurveSpeed, KMH };
})();
