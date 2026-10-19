// 운전 가이드 (HUD 안내 + 자동운전 공용 두뇌)
//
// 1) 교재 4장 기본 운전 취급(역간별 "약 ○○km/h에서 동력 OFF", "○○km/h에서 제동 2단, ○○에서 완해",
//    "승강장 초입 초제동 2단 → 추가 4단 → 계단 완해 → 1단 정차 → 4단 유지")을 기준 지시로 낸다.
// 2) 기관사가 기준을 벗어나거나(늦은 OFF, 과속, 늦은 제동…) 선로 조건(ATC 코드, 제한표지, 승강장 진입 60)
//    때문에 기준대로 하면 안 될 때는 운동 모델로 다시 계산한 값(몇 단 / 몇 km/h에서 완해)을 [보정]으로 낸다.
window.RS = window.RS || {};

RS.Guide = (function () {
  const Pr = RS.Predictor, KMH = 3.6;
  const ENTRY_MAX = 60;           // 승강장 진입 속도 60 km/h 이하 (교재 1.2 나. 5))

  class Advisor {
    constructor(course, env) {
      this.c = course; this.env = env;
      this.seg = course.startIdx;
      this.reset();
      this.bt = 'pending'; // 교재 1.2 나. 3): 최초 역 발차 시 45 km/h 이하에서 제동감도시험
    }
    reset() {
      this.phase = 'stopped';      // stopped → power → coast → stop
      this.stopBraking = false; this.stopT0 = 0;
      this.active = null;          // 진행 중인 감속 제동 {notch, releaseV, why, tag}
      this.powerTo = null;         // 진행 중인 재동력 {offV, why, tag}
      this.done = {};              // 교재 항목 처리 여부
      this.btT = 0;
    }
    onDepart() { this.phase = 'power'; }
    onServed() {                   // 출입문 닫힘 → 다음 역간
      this.seg++;
      this.reset();
      const sg = this.c.segs[this.seg];
      if (this.bt !== 'none' && this.bt !== 'done') this.bt = 'missed';
    }

    evaluate(x) {
      const c = this.c, env = this.env, st = x.st;
      const seg = c.segs[this.seg];
      const B = seg ? seg.B : null;
      const u = st.s, v = st.v, vK = v * KMH;
      const adv = {
        main: '', sub: '', tag: '교재', reason: '', power: 0, brake: 0, act: null,
        upcoming: [], brakePointU: null, predStopU: null, stopU: B ? B.stop : null, rec: null,
        seg, phase: this.phase, bt: this.bt,
      };
      if (!seg) { adv.main = '운행 종료'; adv.sub = '사업 종료'; adv.brake = 4; return adv; }

      // ── 현재 상한 속도
      let vCeil = c.civilLimit(u);
      let ceilWhy = vCeil < c.LINE_MAX ? `제한 ${vCeil}` : '';
      if (x.mode === 'ATC' && x.code != null && x.code < vCeil) { vCeil = x.code; ceilWhy = x.code === 0 ? 'ADU STOP' : `ADU ${x.code}`; }
      if (u >= B.pStart && u <= B.pEnd && ENTRY_MAX < vCeil && !this.stopBraking) { vCeil = ENTRY_MAX; ceilWhy = '승강장 60'; }

      this.upcoming(adv, x, seg, B);

      // ══════════ 정차 중 ══════════
      if (v < 0.05) {
        const err = u - B.stop;
        if (x.doors) {
          const left = Math.max(0, x.dwellNeed - x.dwell);
          adv.main = '승하차 중'; adv.sub = left > 0 ? `${Math.ceil(left)}초 후 출입문 닫기 (O)` : '출입문 닫기 (O)';
          adv.brake = 4; adv.tag = '정차';
          if (left <= 0) adv.act = 'closeDoors';
          return adv;
        }
        if (Math.abs(err) < 6 && !x.served && this.phase !== 'stopped') {
          // 도착 정차
          adv.brake = 4; adv.tag = '정차';
          if (seg.atStop && x.mode !== (seg.atStop === 'toATS' ? 'ATS' : 'ATC')) {
            adv.main = seg.atStop === 'toATS' ? 'ATC → ATS 전환 (T)' : 'ATS → ATC 전환 (T)';
            adv.sub = '제동 핸들 4단 이상에서 ATCCgS 전환'; adv.act = 'cgs';
            return adv;
          }
          adv.main = '정차 — 제동 4단 유지';
          adv.sub = `${Math.abs(err) <= 0.5 ? '정위치' : err > 0 ? '정위치 초과' : '정위치 미달'} ${err >= 0 ? '+' : ''}${(err * 1000).toFixed(0)} mm · 출입문 열기 (O)`;
          adv.act = 'openDoors';
          return adv;
        }
        if (this.stopBraking && err < -1.0 && u > B.pStart - 300) {
          adv.main = '정위치 미달 — 저속 전진'; adv.sub = `${(-err).toFixed(1)} m · 제동 완해, 동력 1단`; adv.tag = '보정';
          adv.power = 1; adv.brake = 0; return adv;
        }
        // 발차 준비
        const expect = c.isATS(u + 30) ? 'ATS' : 'ATC';
        if (x.mode !== expect) {
          adv.main = expect === 'ATS' ? 'ATC → ATS 전환 (T)' : 'ATS → ATC 전환 (T)';
          adv.sub = '제동 4단 이상에서 전환'; adv.brake = 4; adv.act = 'cgs'; adv.tag = '교재'; return adv;
        }
        if (x.mismatch) { adv.main = '교직 절환 스위치 확인 (C)'; adv.sub = `전차선 ${x.sup} · ADS ${x.ads}`; adv.brake = 4; adv.act = 'ads'; adv.tag = '절연'; return adv; }
        const stopAhead = x.mode === 'ATC' && (x.code === 0 || x.look.some(l => l.code === 0 && l.u - u < 80));
        this.phase = 'stopped';
        if (stopAhead) { adv.main = 'ADU STOP — 정차 대기'; adv.sub = '선행열차 점유 · 진행 신호 대기'; adv.brake = 4; adv.tag = 'ATC'; return adv; }
        adv.main = '발차 — 제동 완해 + 동력 4단';
        adv.sub = '제동 핸들 완해와 동시에 4단 투입이 원칙';
        adv.power = 4; adv.brake = 0; adv.act = 'depart';
        return adv;
      }

      // ══════════ 주행 중 ══════════
      if (this.phase === 'stopped') this.phase = 'power';
      const cands = [];
      const put = (pri, o) => cands.push({ pri, ...o });

      // ── 정차 제동 (교재: 초입 초제동 2단 → 추가 4단 → 계단 완해 → 1단 정차)
      if (!this.stopBraking && u > seg.A.stop + 30) {
        const plan = [{ notch: -2, dur: 1.5 }, { notch: -4, dur: 999 }];
        const r = Pr.runPlan(st, plan, 0, env);
        const m = (B.stop - 4) - r.s;
        if (m > 0) adv.brakePointU = u + m;
        adv.stopMargin = m;
        if (m <= 0) { this.stopBraking = true; this.stopT0 = x.t; this.phase = 'stop'; this.active = null; this.powerTo = null; this.wasBraking = x.brake >= 2; }
      }
      if (this.stopBraking) {
        const dt0 = x.t - this.stopT0;
        const cur = x.brake;
        if (cur > 0) adv.predStopU = Pr.predictStop(st, -Math.min(cur, 8), env);
        const errCur = adv.predStopU != null ? adv.predStopU - B.stop : null;
        // 현재 노치로 허용 범위 안에 서면 그대로 유지 (불필요한 노치 왕복 방지)
        const lo = vK < 15 ? -0.45 : -3;
        let n;
        if (cur > 0 && cur < 8 && errCur !== null && errCur <= 0.15 && errCur >= lo) n = cur;
        else n = Pr.recommendNotch(st, B.stop, env, 0.05).notch;
        if (vK < 5 && n >= 8) n = Math.max(cur, 4);
        adv.rec = n;
        const pred1 = n === 1 ? Pr.predictStop(st, -1, env) : null;
        let o;
        if (n >= 8) o = { main: '제동 7단 — 과주 예상', sub: '상용 7단으로도 정지위치 초과', brake: 7, tag: '보정' };
        else if (dt0 < 1.5 && n <= 4 && !this.wasBraking) o = { main: '초제동 2단', sub: seg.stop.entry === 'mid' ? '승강장 중간 초제동' : '승강장 초입 초제동 → 추가 4단', brake: 2, tag: '교재' };
        else if (pred1 !== null && pred1 < B.stop - 1.0) o = { main: vK < 4 ? '완해 · 동력 1단' : '제동 완해', sub: `1단 유지 시 ${(B.stop - pred1).toFixed(1)} m 미달`, brake: 0, power: vK < 4 ? 1 : 0, tag: '보정' };
        else if (vK < 7 && n <= 1) o = { main: '1단으로 정차', sub: '정차 직전 1단 → 정차 후 4단 유지', brake: 1, tag: '교재' };
        else if (n > cur) o = { main: `추가 제동 ${n}단`, sub: errCur !== null ? `현재 ${cur}단 유지 시 정지위치 +${errCur.toFixed(1)} m 과주` : '정지위치 맞춤', brake: n, tag: n > 4 ? '보정' : '교재' };
        else if (n < cur) o = { main: `${n}단으로 계단 완해`, sub: errCur !== null ? `${cur}단 유지 시 ${(-errCur).toFixed(1)} m 미달` : '', brake: n, tag: '교재' };
        else o = { main: `제동 ${n}단 유지`, sub: errCur !== null ? `예상 정지 ${errCur >= 0 ? '+' : ''}${errCur.toFixed(2)} m` : '', brake: n, tag: '교재' };
        if (n > 4 && o.tag === '보정' && !o.reason) o.reason = '진입 속도 과다 → 기준(4단)보다 강한 제동 필요';
        put(80, o);
      }

      // ── 과속 (현재 상한 초과)
      if (vK > vCeil + 0.5) {
        const n = vK - vCeil > 5 ? 4 : 2;
        put(100, { main: `감속 — 제동 ${n}단`, sub: `${Math.max(0, vCeil - 3)} km/h에서 완해 (${ceilWhy})`, brake: n, tag: '보정', reason: `${ceilWhy} 초과 +${(vK - vCeil).toFixed(0)} km/h` });
        this.active = { notch: n, releaseV: Math.max(0, vCeil - 3), why: ceilWhy, tag: '보정' };
      }

      // ── 전방 제한 조건 (ATC 코드 하강, 제한표지, 승강장 진입 60)
      if (!this.stopBraking) {
        const cons = [];
        if (x.mode === 'ATC') for (const lc of x.look) cons.push({ u: lc.u, v: lc.code, why: lc.code === 0 ? `ADU STOP (${lc.label})` : `ADU ${lc.code}` });
        for (const l of c.limits) if (l.start > u && l.start < u + 2000) cons.push({ u: l.start, v: l.v, why: l.adu ? `ADU ${l.v}` : `제한 ${l.v}` });
        if (B.pStart > u) cons.push({ u: B.pStart, v: ENTRY_MAX, why: '승강장 진입 60' });
        let worst = null;
        for (const k of cons) {
          if (k.v >= vK) continue;
          const tv = Math.max(0, k.v - 2) / KMH;
          const m = Pr.brakeMargin(st, { u: k.u, v: tv }, -2, env).margin;
          k.margin = m;
          if (!worst || m < worst.margin) worst = k;
        }
        if (worst) {
          if (adv.brakePointU === null || u + worst.margin < adv.brakePointU) { adv.brakePointU = u + Math.max(0, worst.margin); adv.bpWhy = worst.why; }
          if (worst.margin <= 0) {
            const n = Pr.minNotchFor(st, { u: worst.u, v: Math.max(0, worst.v - 2) / KMH }, env, 2);
            const rel = worst.v === 0 ? 0 : Math.max(0, worst.v - 4);
            this.active = { notch: Math.min(7, n), releaseV: rel, why: worst.why, tag: n > 2 ? '보정' : '교재', untilU: worst.u,
              reason: n >= 8 ? `${worst.why}까지 ${Math.round(worst.u - u)} m — 7단으로도 초과 불가피` : n > 2 ? `${worst.why}까지 ${Math.round(worst.u - u)} m → ${n}단 필요` : '' };
          }
        }
      }

      // ── 교재 타력 중 제동 (예: "65km/h에서 제동 2단, 50km/h에서 완해")
      if (!this.stopBraking) {
        seg.coast.forEach((it, i) => {
          const key = 'c' + i;
          if (this.done[key] || u < it.from || u > it.to) return;
          if (vK >= it.onV - 0.3) {
            const n = Pr.minNotchFor(st, { u: it.to, v: it.offV / KMH }, env, it.notch);
            const late = vK > it.onV + 2;
            this.active = { notch: Math.min(7, n), releaseV: it.offV, why: `기준 ${it.onV}→${it.offV}`, tag: n > it.notch || late ? '보정' : '교재', key,
              reason: n > it.notch ? `기준 ${it.onV} km/h 초과(+${(vK - it.onV).toFixed(0)}) · 구간 끝까지 ${Math.round(it.to - u)} m → ${n}단 필요` : '' };
            this.done[key] = true;
          }
        });
      }

      // ── 타력 중 내림 기울기로 상한에 근접하면 억속 제동 (실시간)
      if (!this.stopBraking && !this.active && x.power === 0 && vK > vCeil - 1.5 && (x.accel || 0) > 0.01) {
        this.active = { notch: 2, releaseV: Math.max(0, vCeil - 6), why: `${ceilWhy || '최고속도'} 근접`, tag: '보정', reason: '타력 중 내림 기울기로 속도 상승 → 억속 제동' };
      }

      // ── 진행 중 감속 제동 유지/완해
      if (this.active && !this.stopBraking) {
        const a = this.active;
        if (vK <= a.releaseV + 0.3 || (a.untilU && u > a.untilU + 5 && vK <= vCeil - 1)) {
          this.active = null;
          if (x.brake > 0) put(60, { main: '제동 완해', sub: `${Math.round(vK)} km/h · ${a.why}`, brake: 0, tag: a.tag });
        } else {
          put(70, { main: `제동 ${a.notch}단`, sub: `${a.releaseV} km/h에서 완해 · ${a.why}`, brake: a.notch, tag: a.tag, reason: a.reason || '' });
        }
      }

      // ── 교직 절연구간 (교재 4장: 절연 예고 → 회생 차단 → 타행 → 교류/직류 전환 → 절연 구간 → 역행 → 회생 복귀)
      const D = c.dead, notice = D.start - 260, coastU = D.start - 70, powerU = D.end + c.TRAIN_LEN + 10;
      const target = D.toAC ? 'AC' : 'DC';
      if (u >= notice - 10 && u < powerU + 40) {
        if (u < powerU && !x.regenCut) put(55, { main: '회생 차단 (R)', sub: '절연 예고 — 회생제동 차단 스위치 개방', act: 'regen', tag: '절연', keep: true });
        else if (u >= coastU - 20 && u < D.start && x.power > 0) put(56, { main: '타행 — 동력 OFF', sub: '주간제어기 0 위치', power: 0, tag: '절연', keep: true });
        else if (u >= coastU - 20 && u < D.start + 20 && x.ads !== target) put(56, { main: target === 'AC' ? '교류 전환 (C)' : '직류 전환 (C)', sub: '교직 절환 스위치 → MCB 차단 확인', act: 'ads', power: 0, tag: '절연', keep: true });
        else if (u >= coastU - 20 && u < powerU) put(40, { main: '절연 구간 — 타행', sub: `역행 표지까지 ${Math.round(powerU - u)} m`, power: 0, tag: '절연', keep: true });
        else if (u >= powerU && x.regenCut) put(55, { main: '역행 · 회생 복귀 (R)', sub: '회생제동 차단 스위치 정상 위치', act: 'regen', tag: '절연', keep: true });
      }
      if (x.mismatch) put(57, { main: '교직 절환 스위치 확인 (C)', sub: `전차선 ${x.sup} / ADS ${x.ads} 불일치 → MCB 투입 불능`, act: 'ads', tag: '보정', keep: true });

      // ── 제동감도시험 (최초 역 발차 후 45 km/h 이하에서 2단-4단-완해)
      const inDeadZone = u >= coastU - 40 && u < powerU;
      if (this.bt !== 'none' && this.bt !== 'done' && this.bt !== 'missed' && !this.stopBraking && !inDeadZone) {
        if (this.bt === 'pending' && vK >= 40) { this.bt = 'b2'; this.btT = 0; this.btV0 = vK; }
        if (this.bt === 'b2') {
          if (x.brake >= 2) this.btT += x.dt; if (this.btT > 1.5) { this.bt = 'b4'; this.btT = 0; }
          put(65, { main: '제동감도시험 — 제동 2단', sub: '동력 OFF → 2단 → 4단 → 완해', brake: 2, tag: '교재' });
        } else if (this.bt === 'b4') {
          if (x.brake >= 4) this.btT += x.dt; if (this.btT > 1.5) { this.bt = 'rel'; }
          put(65, { main: '제동감도시험 — 제동 4단', sub: '감속도·BC 압력 확인', brake: 4, tag: '교재' });
        } else if (this.bt === 'rel') {
          if (x.brake === 0) { this.bt = 'done'; this.btDrop = this.btV0 - vK; this.phase = 'power'; }
          put(65, { main: '완해 — "제동 감도 양호"', sub: '이어서 동력 4단', brake: 0, tag: '교재' });
        }
        if (this.bt === 'pending' && vK > 46) this.bt = 'missed';
      }

      // ── 동력 운전 (교재 OFF 속도, 상한·ATC 고려 보정)
      if (!this.stopBraking && !this.active) {
        let offV = seg.offV, offWhy = '';
        if (vCeil - 3 < offV) { offV = vCeil - 3; offWhy = ceilWhy; }
        const ahead = this.nearestLimitAhead(x, u, 350);
        if (ahead && ahead.v - 3 < offV) { offV = ahead.v - 3; offWhy = ahead.why; }
        if (this.phase === 'power') {
          const btWait = this.bt === 'pending';
          const target = btWait ? Math.min(offV, 43) : offV;
          if (vK >= target - 0.5) {
            this.phase = 'coast';
          } else {
            const tag = offWhy ? '보정' : '교재';
            put(30, { main: '동력 4단', sub: btWait ? `약 ${Math.round(target)} km/h에서 OFF → 제동감도시험` : `약 ${Math.round(target)} km/h에서 동력 OFF`, power: 4, tag,
              reason: offWhy ? `기준 ${seg.offV} km/h → ${offWhy} 때문에 ${Math.round(target)} km/h` : '' });
          }
        }
        if (this.phase === 'coast' && x.power > 0 && !this.powerTo) {
          const over = vK - offV;
          put(35, { main: '동력 OFF', sub: over > 1.5 ? `기준 ${Math.round(offV)} km/h 초과 +${over.toFixed(0)}` : `${Math.round(vK)} km/h · 타력 운전`, power: 0, tag: over > 1.5 ? '보정' : '교재' });
        }
      }

      // ── 교재 재동력 (예: "50km/h에서 다시 동력, 58km/h에서 OFF", 15량 측정표 지나 동력)
      if (!this.stopBraking && !this.active) {
        seg.repower.forEach((it, i) => {
          const key = 'r' + i;
          if (this.done[key] || u < it.from || u > it.to) return;
          if (vK <= it.onV + 0.3 || it.measure) {
            const offV = Math.min(it.offV, vCeil - 2);
            this.powerTo = { offV, why: it.measure ? '15량 측정표 통과' : `기준 ${it.onV}→${it.offV}`, tag: '교재', key };
            this.done[key] = true;
          }
        });
        // 타력으로 승강장까지 못 가거나 너무 늦으면 재동력 (실시간 계산)
        if (!this.powerTo && this.phase === 'coast' && B.pStart - u > 300 && x.power === 0 && (x.t % 1) < 0.15) {
          const r = Pr.coast(st, B.pStart, env, null);
          if (r.v >= 0 && r.v * KMH < 22 || r.v < 0) {
            let pick = null;
            for (let X = Math.ceil(vK / 5) * 5 + 5; X <= vCeil - 3; X += 5) {
              if (Pr.powerThenCoast(st, X, B.pStart, env) * KMH >= 35) { pick = X; break; }
            }
            if (pick === null) pick = Math.max(vK + 5, vCeil - 3);
            this.powerTo = { offV: pick, why: r.v < 0 ? `타력 시 승강장 ${Math.round(B.pStart - (r.stopU || u))} m 전 정차` : `타력 시 승강장 진입 ${Math.round(r.v * KMH)} km/h`, tag: '보정' };
          }
        }
        if (this.powerTo) {
          const p = this.powerTo;
          if (vK >= p.offV - 0.5 || u >= B.pStart - 50) {
            this.powerTo = null;
            if (x.power > 0) put(36, { main: '동력 OFF', sub: `${Math.round(vK)} km/h`, power: 0, tag: p.tag });
          } else put(31, { main: '동력 4단', sub: `약 ${Math.round(p.offV)} km/h에서 OFF · ${p.why}`, power: 4, tag: p.tag });
        }
      }

      // ── 기본: 타력
      if (!cands.length) put(0, { main: '타력 운전', sub: this.coastHint(adv, u), power: 0, brake: 0, tag: '교재' });

      cands.sort((a, b) => b.pri - a.pri);
      const top = cands[0];
      Object.assign(adv, { main: top.main, sub: top.sub || '', tag: top.tag || '교재', reason: top.reason || '' });
      // 핸들 목표: 제동은 최댓값, 제동이 있으면 동력 0
      let brake = 0, power = 0, act = null;
      for (const k of cands) {
        if (k.brake != null) brake = Math.max(brake, k.brake);
        if (k.act && !act) act = k.act;
      }
      const pc = cands.find(k => k.power != null);
      power = pc ? pc.power : 0;
      if (cands.some(k => k.tag === '절연' && k.power === 0)) power = 0;
      if (brake > 0) power = 0;
      adv.brake = brake; adv.power = power; adv.act = act;
      adv.cands = cands;
      return adv;
    }

    nearestLimitAhead(x, u, range) {
      let best = null;
      for (const l of this.c.limits) if (l.start > u && l.start < u + range && (!best || l.v < best.v)) best = { v: l.v, why: l.adu ? `ADU ${l.v}` : `제한 ${l.v}` };
      if (x.mode === 'ATC') for (const lc of x.look) if (lc.u < u + range && (!best || lc.code < best.v)) best = { v: lc.code, why: `ADU ${lc.code}` };
      return best;
    }

    coastHint(adv, u) {
      const n = adv.upcoming[0];
      return n ? `다음: ${n.text} (${Math.round(n.dist)} m)` : '';
    }

    // 다음 취급 목록 (거리순)
    upcoming(adv, x, seg, B) {
      const u = x.st.s, list = [];
      for (const cl of this.c.calls) if (cl.u > u - 5 && cl.u < u + 900) list.push({ dist: cl.u - u, text: '☞ ' + cl.text, kind: 'call' });
      seg.coast.forEach((it, i) => { if (!this.done['c' + i] && it.to > u && it.from < u + 1500) list.push({ dist: Math.max(0, it.from - u), text: `${it.onV} km/h 되면 제동 ${it.notch}단 → ${it.offV} 완해`, kind: 'tb' }); });
      seg.repower.forEach((it, i) => { if (!this.done['r' + i] && it.to > u && it.from < u + 1500) list.push({ dist: Math.max(0, it.from - u), text: it.measure ? `측정표 지나 동력 4단 → ${it.offV} OFF` : `${it.onV} km/h 되면 동력 4단 → ${it.offV} OFF`, kind: 'tb' }); });
      if (B.pStart > u && B.pStart < u + 1500) list.push({ dist: B.pStart - u, text: `${B.name} 승강장 ${seg.stop.entry === 'mid' ? '중간' : '초입'} · 초제동 2단 → 4단`, kind: 'stop' });
      list.sort((a, b) => a.dist - b.dist);
      adv.upcoming = list.slice(0, 5);
    }
  }

  return { Advisor };
})();
