// 4호선 과천선(+안산선 일부) 기능시험 구간: 남태령 ↔ 산본
//
// 노선 데이터는 "선로 거리 s"(남태령역 중심 = 0, 산본 방향 +)로 적고,
// makeCourse('down'|'up') 가 운전 방향 기준 좌표 u 로 바꿔 코스를 만든다.
//  - 역간거리: 영업거리 기준 (금정 0.0 / 범계 2.6 / 평촌 3.9 / 인덕원 5.5 / 정부과천청사 8.5 /
//    과천 9.5 / 대공원 10.5 / 경마공원 11.4 / 선바위 12.4 / 남태령 14.4 km, 금정~산본 2.3 km)
//  - 구배·경계표지·속도제한표지·취급 요령: 제2종 철도차량운전면허 표준교재 「기능교재」 4장
//    (기본 운전 취급법, 상선/하선) 서술을 바탕으로 배치. 정확한 위치(m)는 교재에 없으므로 근사값.
//  - 과천정보타운역(신설)은 교재(2023) 기준 시험 구간에 없어 제외.
window.RS = window.RS || {};

RS.LINE = (function () {
  const S_MIN = -500, S_MAX = 17200;
  const stations = [
    { name: '남태령',       en: 'Namtaeryeong',                no: '433', s: 0 },
    { name: '선바위',       en: 'Seonbawi',                    no: '434', s: 2000 },
    { name: '경마공원',     en: 'Seoul Racecourse Park',       no: '435', s: 3000 },
    { name: '대공원',       en: 'Seoul Grand Park',            no: '436', s: 3900 },
    { name: '과천',         en: 'Gwacheon',                    no: '437', s: 4900 },
    { name: '정부과천청사', en: 'Government Complex Gwacheon', no: '438', s: 5900 },
    { name: '인덕원',       en: 'Indeogwon',                   no: '439', s: 8900 },
    { name: '평촌',         en: 'Pyeongchon',                  no: '440', s: 10500 },
    { name: '범계',         en: 'Beomgye',                     no: '441', s: 11800 },
    { name: '금정',         en: 'Geumjeong',                   no: '443', s: 14400 },
    { name: '산본',         en: 'Sanbon',                      no: '444', s: 16700 },
  ];
  const colors = ['#3b82c4', '#2f9e8f', '#c47a2f', '#5b8f2f', '#8f2f6b', '#2f5b8f', '#b5452f', '#6b6b2f', '#2f8f5b', '#7a4fb5', '#3f7fa8'];
  stations.forEach((st, i) => { st.idx = i; st.color = colors[i]; });

  // 평면곡선 [시점, 종점, 반경(+우/-좌, 하선 진행 기준)]
  const curves = [
    [250, 420, 350], [460, 630, -350],            // 꽈배기(좌·우측 통행 전환) S곡선, 단선 터널
    [1100, 1500, 600], [2300, 2700, -700], [3300, 3600, 800], [4200, 4600, -900],
    [5200, 5600, 700], [6300, 6900, -800], [7300, 7900, 1000], [8300, 8700, -700],
    [9300, 9800, 900], [10900, 11400, -800], [12300, 12900, 700], [13400, 13800, -1200],
    [14560, 14950, 280],                          // 금정 고가교 R280
    [15400, 15900, -1000],
  ];

  // 종단구배 [시점, ‰] (하선 진행 기준, + 오름)
  const grades = [
    [S_MIN, 0], [100, 8], [350, 30], [700, -7], [900, -30], [1650, -2], [2130, 0],
    [2150, 18], [2550, 7], [3130, 0],
    [3150, 25], [3550, -5], [4030, 0],
    [4050, -5], [4200, -20], [4550, -5], [5030, 0],
    [5050, 2], [5400, 7], [5550, 8], [6030, 0],
    [6050, 4], [6300, 18], [7100, -15], [8100, -8], [8400, -18], [8790, -8], [9030, 0],
    [9150, 4], [9400, 19], [9900, -14], [10350, -3],
    [11930, -12], [12300, 13], [13000, 32], [14250, 0],
    [14550, 21], [15000, 25], [15500, 3], [16830, 0],
  ];

  const tunnel = [S_MIN, 13300];                       // 지하 구간 (금정 앞 갱구)
  const dead = { start: 760, end: 826 };               // 교직 절연구간 (66 m)
  const twist = { start: 250, end: 650 };              // 좌·우측 통행 전환 (단선 터널 2개)
  const atsFrom = 14400;                               // 금정 이남(산본 방향)은 ATS 구간
  const gradeAt = (s) => { let g = 0; for (const [a, v] of grades) { if (s >= a) g = v; else break; } return g; };
  return { S_MIN, S_MAX, stations, curves, grades, tunnel, dead, twist, atsFrom, gradeAt };
})();

RS.ROUTE_CONST = { TRAIN_LEN: 200, PLATFORM_HALF: 105, STOP_OFFSET: 100, LINE_MAX: 80, ATC_CODES: [0, 15, 25, 40, 60, 70, 80] };

// ───────────────────────── 교재 4장 취급 요령 (방향별, 역간별) ─────────────────────────
// 위치(앵커): ['d', m] 출발역 정지위치+m, ['b', k, m] 도착역 k경계표지(0=장내경계)+m,
//             ['a', m] 도착역 정지위치+m, ['f', x] 역간 비율 위치
// 항목:
//  offV       : 동력 4단 후 OFF 속도
//  brakeTest  : 최초 역 발차 후 제동감도시험 (45 km/h 이하, 2단-4단-완해)
//  limits     : [시점, 종점, 속도, 환호] 속도제한표지 구간 (adu:true 이면 ADU 지시)
//  coast      : [{from, to, onV, notch, offV}] 내림 기울기 등 타력 중 속도 조절 제동
//  repower    : [{from, to, onV, offV}] 재동력
//  calls      : [{at, text}] 지적 확인 환호
//  stop       : { entry: 'start'|'mid', note }
//  note       : 역간 특징 설명 (교재 요약)
RS.TEXTBOOK = {
  down: [
    { from: '남태령', to: '선바위', offV: 70, brakeTest: true,
      note: '8‰·30‰ 오름 → 5경계 지나 7‰ 내림 → 4경계부터 30‰ 내림. 교류 전환 구간. 선바위는 승강장 중간 속도 조절 못하면 과주 (제동 취급 주의 역)',
      coast: [{ from: ['b', 3, 220], to: ['b', 1, 0], onV: 65, notch: 2, offV: 50 }],
      calls: [{ at: ['d', 10], text: '진로 개통 하선' }],
      stop: { entry: 'start', caution: true } },
    { from: '선바위', to: '경마공원', offV: 65,
      note: '18‰ 오름, 3경계부터 정차 지점까지 7‰ 오름',
      limits: [[['b', 1, 60], ['a', 160], 60]],
      stop: { entry: 'start' } },
    { from: '경마공원', to: '대공원', offV: 68,
      note: '25‰ 오름, 1경계부터 정차 지점까지 5‰ 내림 (정차제동 주의 역)',
      limits: [[['d', 150], ['f', 0.55], 75]],
      calls: [{ at: ['b', 0, -40], text: '진로 개통 하선' }],
      stop: { entry: 'start', caution: true } },
    { from: '대공원', to: '과천', offV: 40,
      note: '5‰·20‰ 내림, 1경계 전방부터 5‰ 내림. 과천 진입 속도 조절 못하면 과주 (정차제동 주의 역)',
      limits: [[['d', 130], ['f', 0.45], 65], [['b', 1, 40], ['a', 150], 60]],
      stop: { entry: 'start', caution: true } },
    { from: '과천', to: '정부과천청사', offV: 63,
      note: '2‰ 오름, 2경계부터 7‰, 1경계부터 8‰ 오름. 제동이 너무 빠르면 완해 후 재제동해야 하는 역',
      stop: { entry: 'start' } },
    { from: '정부과천청사', to: '인덕원', offV: 75,
      note: '4‰·18‰ 오름, 5경계부터 15‰ 내림, 2경계 전 8‰, 1경계 전 18‰ 내림, 승강장 8‰ 내림 (정차제동 주의 역)',
      coast: [{ from: ['b', 2, 0], to: ['b', 1, 0], onV: 70, notch: 2, offV: 45 }],
      calls: [{ at: ['b', 0, -40], text: '진로 개통 하선' }],
      stop: { entry: 'start', caution: true } },
    { from: '인덕원', to: '평촌', offV: 62,
      note: '5경계부터 4‰, 4경계 지나 19‰ 오름, 2경계 지나 14‰ 내림, 장내경계 전방부터 3‰ 내림 (제동 취급 주의 역)',
      limits: [[['d', 150], ['f', 0.4], 75]],
      stop: { entry: 'start', caution: true } },
    { from: '평촌', to: '범계', offV: 55,
      note: '범계 정차 위치까지 3‰ 내림',
      calls: [{ at: ['b', 0, -40], text: '진로 개통 하선' }],
      stop: { entry: 'start' } },
    { from: '범계', to: '금정', offV: 60,
      note: '12‰ 내림, 6경계 전방·5경계 부근 13‰ 오름, 4경계 부근 32‰ 오름, 금정 승강장부터 평탄. ATC → ATS 전환',
      limits: [[['d', 150], ['f', 0.3], 75], [['f', 0.4], ['b', 3, 60], 75],
               [['b', 1, 0], ['a', 120], 40, '주의 40키로', true]],
      repower: [{ from: ['b', 3, 60], to: ['b', 1, 0], onV: 50, offV: 57 },
                { from: ['b', 0, -150], to: ['a', -110], onV: 28, offV: 37 }],
      calls: [{ at: ['b', 1, 60], text: '장내 주의 2번선' }, { at: ['b', 0, -80], text: 'ATS 예고' }],
      stop: { entry: 'mid' }, atStop: 'toATS' },
    { from: '금정', to: '산본', offV: 38, ats: true,
      note: '21‰·25‰(R280 곡선) 오름, 제한 40 이하로 운전, 15량 서행 구역 통과 측정표를 지나면 동력, 약 70에서 OFF 후 산본까지 타력',
      limits: [[['d', 120], ['f', 0.42], 40]],
      repower: [{ from: ['d', 150], to: ['f', 0.4], onV: 30, offV: 38 },
                { from: ['f', 0.56], to: ['b', 2, 0], onV: 60, offV: 70, measure: true }],
      calls: [{ at: ['d', 5], text: '2번선 출발 진행, 안산선' }, { at: ['f', 0.56], text: '서행 해제' },
              { at: ['b', 0, -60], text: '장내 진행, 하본선' }],
      stop: { entry: 'start' } },
  ],
  up: [
    { from: '산본', to: '금정', offV: 50, brakeTest: true, ats: true,
      note: '25‰·21‰ 내림 무동력 구간, 금정 진입 고가교는 R280 곡선 제한 40. 금정 정차 후 ATS → ATC 전환',
      limits: [[['f', 0.58], ['a', -100], 40]],
      coast: [{ from: ['f', 0.3], to: ['f', 0.55], onV: 67, notch: 2, offV: 55 },
              { from: ['f', 0.55], to: ['f', 0.58], onV: 40, notch: 4, offV: 30 }],
      calls: [{ at: ['d', 5], text: '3번선 출발 진행' }, { at: ['f', 0.55], text: '제1 장내 진행, 상선' },
              { at: ['f', 0.62], text: '기적 (H)' }, { at: ['b', 0, -60], text: '제2 장내 진행, 5번선' },
              { at: ['b', 0, -20], text: 'ATC 예고' }],
      stop: { entry: 'start', entryV: [40, 47] }, atStop: 'toATC' },
    { from: '금정', to: '범계', offV: 40,
      note: '32‰·13‰ 내림을 지나 12‰ 오름, 1경계부터 정지 위치까지 3‰ 오름',
      limits: [[['d', 160], ['f', 0.35], 75], [['b', 2, 0], ['b', 1, 60], 75]],
      coast: [{ from: ['d', 200], to: ['f', 0.5], onV: 67, notch: 2, offV: 60 }],
      calls: [{ at: ['d', 5], text: '5번선 출발 진행 과천선' }],
      stop: { entry: 'start' } },
    { from: '범계', to: '평촌', offV: 63,
      note: '전체 구간 3‰ 오름',
      calls: [{ at: ['d', 5], text: '진로 개통 상선' }],
      stop: { entry: 'start' } },
    { from: '평촌', to: '인덕원', offV: 65,
      note: '14‰ 오름, 5경계 지나 19‰ 내림, 3경계 전방 4‰ 오름, 2경계부터 승강장까지 8‰ 오름',
      calls: [{ at: ['a', 40], text: '진로 개통 상선' }],
      stop: { entry: 'start' } },
    { from: '인덕원', to: '정부과천청사', offV: 75,
      note: '18‰·8‰·15‰ 오름, 5경계 지나 18‰ 내림, 2경계 지나 4‰ 내림, 승강장 8‰ 내림 (제동 취급 주의 역)',
      coast: [{ from: ['b', 4, 0], to: ['b', 1, 0], onV: 65, notch: 2, offV: 50 }],
      stop: { entry: 'start', caution: true } },
    { from: '정부과천청사', to: '과천', offV: 55,
      note: '8‰·7‰·2‰ 내림, 장내경계 전방부터 5‰ 오름. 곡선 정거장: 2단으로 진입하다 정지 위치 보고 4단',
      limits: [[['b', 1, 60], ['a', 150], 75]],
      stop: { entry: 'start' } },
    { from: '과천', to: '대공원', offV: 60,
      note: '5‰·20‰ 오름, 정지 위치까지 5‰ 오름. 상선 중 유일하게 재동력 취급 구간',
      limits: [[['f', 0.3], ['b', 0, -60], 65], [['a', 120], ['a', 500], 75]],
      repower: [{ from: ['d', 300], to: ['b', 1, 0], onV: 50, offV: 58 }],
      calls: [{ at: ['a', 30], text: '진로 개통 상선' }],
      stop: { entry: 'start' } },
    { from: '대공원', to: '경마공원', offV: 55,
      note: '3경계 지나 25‰ 내림, 1경계 지나 정지 위치까지 7‰ 내림. 승강장 중간에서 속도 조절 못하면 과주 (제동 취급 주의 역)',
      limits: [[['b', 1, 40], ['a', 160], 65]],
      stop: { entry: 'early', caution: true } },
    { from: '경마공원', to: '선바위', offV: 55,
      note: '7‰ 내림, 2경계 지나 18‰ 내림, 장내경계부터 2‰ 오름 (제동 취급 주의 역)',
      stop: { entry: 'start', caution: true } },
    { from: '선바위', to: '남태령', offV: 60,
      note: '2·3·7‰ 오름, 절연 구간 지나 30‰ 내림, 1경계부터 8‰ 내림 (제동 취급 주의 역). 직류 전환 구간',
      limits: [[['d', 200], ['f', 0.45], 65]],
      calls: [{ at: ['b', 1, 50], text: '진로 개통 상선' }, { at: ['b', 0, -60], text: '진로 개통 상선' }],
      stop: { entry: 'start', caution: true } },
  ],
};

// ───────────────────────── 방향별 코스 생성 ─────────────────────────
RS.makeCourse = function (dir, startIdx, endIdx) {
  const L = RS.LINE, C = RS.ROUTE_CONST;
  const d = dir === 'down' ? 1 : -1;
  const SUM = L.S_MIN + L.S_MAX;
  const toU = (s) => (d > 0 ? s : SUM - s);
  const toS = (u) => (d > 0 ? u : SUM - u);
  const uMin = L.S_MIN, uMax = L.S_MAX;

  const order = d > 0 ? L.stations.slice() : L.stations.slice().reverse();
  const stations = order.map((st, i) => {
    const u = toU(st.s);
    const isMetro = st.s < (L.twist.start + L.twist.end) / 2;
    return {
      ...st, i, u, stop: u + C.STOP_OFFSET, pStart: u - C.PLATFORM_HALF, pEnd: u + C.PLATFORM_HALF,
      side: isMetro ? 'R' : 'L', // 서울교통공사 구간 우측통행 → 승강장 우측, 코레일 좌측통행 → 좌측
    };
  });

  const curves = L.curves.map(([a, b, R]) => d > 0 ? [a, b, R] : [toU(b), toU(a), -R]).sort((x, y) => x[0] - y[0]);
  const gradeAt = (u) => d * L.gradeAt(toS(u));
  const span = (a, b) => { const x = toU(a), y = toU(b); return [Math.min(x, y), Math.max(x, y)]; };
  const tunnel = span(L.tunnel[0], L.tunnel[1]);
  const [ds, de] = span(L.dead.start, L.dead.end);
  const dead = { start: ds, end: de, toAC: d > 0 };
  const [ts, te] = span(L.twist.start, L.twist.end);
  const twist = { start: ts, end: te };
  const isMetro = (u) => toS(u) < (L.twist.start + L.twist.end) / 2;
  const otherOffset = (u) => (u >= twist.start && u <= twist.end) ? null : (isMetro(u) ? -4 : 4);
  // ATC/ATS 경계: 금정 정차 후 절환. 하선은 금정 발차 후 ATS, 상선은 금정 도착까지 ATS
  const gjStop = stations.find(s => s.name === '금정').stop;
  const isATS = (u) => (d > 0 ? u > gjStop + 15 : u < gjStop + 15);
  const gjSt = stations.find(s => s.name === '금정');
  const atBoundary = (u) => u > gjSt.pStart - 10 && u < gjStop + 40; // 금정 구내: 어느 모드든 허용
  // 전차선 전원: 절연구간 기준 남태령 쪽 DC 1500 V(서울교통공사), 선바위 쪽 AC 25 kV(코레일)
  const supplyAt = (u) => {
    if (u >= dead.start && u <= dead.end) return 'NONE';
    const sideDC = d > 0 ? u < dead.start : u > dead.end;
    return sideDC ? 'DC' : 'AC';
  };

  // ATC 폐색 경계 (도착역 기준 장내경계=0, 1경계, 2경계 …)
  const blocks = [];
  const bnds = [{ u: uMin, label: '시점' }];
  const segBounds = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const A = stations[i], B = stations[i + 1];
    const a = A.stop + 15, b = B.pStart - 5;
    const n = Math.max(2, Math.round((b - a) / 330));
    const list = [];
    for (let k = 0; k <= n; k++) {
      const u = b - (b - a) * k / n;
      list.push(u);
    }
    segBounds.push(list); // list[k] = k경계 (k=0 장내경계, k=n 출발 직후)
    for (let k = n; k >= 0; k--) bnds.push({ u: list[k], label: k === 0 ? `${B.name} 장내경계` : `${B.name} ${k}경계`, k, seg: i });
  }
  bnds.push({ u: uMax, label: '종점' });
  for (let i = 0; i < bnds.length - 1; i++) {
    if (bnds[i + 1].u - bnds[i].u < 1) continue;
    blocks.push({ idx: blocks.length, start: bnds[i].u, end: bnds[i + 1].u, label: bnds[i].label, k: bnds[i].k, seg: bnds[i].seg });
  }

  // 앵커 해석
  const segs = RS.TEXTBOOK[dir].map((tb, i) => ({ ...tb, i, A: stations[i], B: stations[i + 1], bnd: segBounds[i] }));
  function anchor(seg, an) {
    const A = seg.A, B = seg.B, list = seg.bnd;
    switch (an[0]) {
      case 'd': return A.stop + an[1];
      case 'a': return B.stop + an[1];
      case 'b': return list[Math.min(an[1], list.length - 1)] + (an[2] || 0);
      case 'f': return A.stop + (B.pStart - A.stop) * an[1];
    }
    return 0;
  }

  const limits = [], calls = [], signs = [];
  segs.forEach(seg => {
    seg.offV = seg.offV || 60;
    seg.coast = (seg.coast || []).map(c => ({ ...c, from: anchor(seg, c.from), to: anchor(seg, c.to) }));
    seg.repower = (seg.repower || []).map(c => ({ ...c, from: anchor(seg, c.from), to: anchor(seg, c.to) }));
    (seg.limits || []).forEach(([fa, ta, v, call, adu]) => {
      const lim = { start: anchor(seg, fa), end: anchor(seg, ta), v, adu: !!adu, seg: seg.i };
      limits.push(lim);
      if (!adu) {
        signs.push({ u: lim.start, type: 'limit', v });
        signs.push({ u: lim.end, type: 'limitEnd' });
        calls.push({ u: lim.start, text: `제한 ${v}키로` });
        calls.push({ u: lim.end + C.TRAIN_LEN * 0, text: '제한 해제' });
      } else {
        calls.push({ u: lim.start, text: call });
      }
    });
    (seg.calls || []).forEach(c => calls.push({ u: anchor(seg, c.at), text: c.text }));
    // 1경계표지 전방 "○○ 접근"
    calls.push({ u: seg.bnd[1] - 30, text: `${seg.B.name} 접근` });
  });
  // 교직 절연구간 표지·환호
  const deadSigns = [
    { u: dead.start - 260, type: 'deadNotice', text: '절연 예고' },
    { u: dead.start - 70, type: 'coast', text: '타행' },
    { u: dead.start, type: 'dead', text: '절연 구간' },
    { u: dead.end + C.TRAIN_LEN + 10, type: 'power', text: '역행' },
  ];
  deadSigns.forEach(sg => { signs.push(sg); calls.push({ u: sg.u, text: sg.text }); });
  // ATC/ATS 예고 표지
  const gj = stations.find(s => s.name === '금정');
  signs.push({ u: gj.pStart - 80, type: d > 0 ? 'atsNotice' : 'atcNotice' });

  calls.sort((a, b) => a.u - b.u);
  calls.forEach((c, i) => { c.id = i; });

  const civilLimit = (u) => {
    let v = C.LINE_MAX;
    for (const l of limits) if (u >= l.start && u <= l.end) v = Math.min(v, l.v);
    return v;
  };
  // 폐색 코드(선로 조건): 구간 내 최소 제한속도를 ATC 코드로 (10 km/h 이상 낮으면 상위 코드)
  const CODES = [25, 40, 60, 70, 80];
  blocks.forEach(b => {
    let lim = C.LINE_MAX;
    for (let u = b.start; u <= b.end; u += 5) lim = Math.min(lim, civilLimit(u));
    let c = CODES.filter(x => x <= lim).pop() || 25;
    b.civil = c;
  });
  const blockIndexAt = (u) => {
    let lo = 0, hi = blocks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (blocks[mid].start <= u) lo = mid; else hi = mid - 1; }
    return lo;
  };

  // 열차 전체(200 m)에 걸친 평균 환산구배 = 구배 + 곡선저항(600/R ‰), 5 m 간격으로 미리 계산
  const EG = 5, egN = Math.ceil((uMax - uMin) / EG) + 1;
  const eg = new Float32Array(egN);
  const curveRes = (u) => { for (const [a, b, R] of curves) if (u >= a && u < b) return 600 / Math.abs(R); return 0; };
  for (let k = 0; k < egN; k++) {
    const u = uMin + k * EG;
    let sum = 0, n = 0;
    for (let x = u - C.TRAIN_LEN; x <= u; x += 10) { sum += gradeAt(x) + curveRes(x); n++; }
    eg[k] = sum / n;
  }
  const effGradeAt = (u) => { const k = Math.round((u - uMin) / EG); return eg[k < 0 ? 0 : k >= egN ? egN - 1 : k]; };
  const tunnelAt = (u) => u >= tunnel[0] && u <= tunnel[1];

  const s0 = Math.max(0, Math.min(startIdx || 0, stations.length - 2));
  const s1 = Math.max(s0 + 1, Math.min(endIdx == null ? stations.length - 1 : endIdx, stations.length - 1));

  return {
    dir, d, name: dir === 'down' ? '하선 (남태령 → 산본)' : '상선 (산본 → 남태령)',
    uMin, uMax, toS, toU, stations, curves, gradeAt, effGradeAt, tunnelAt, tunnel, dead, twist, isMetro, otherOffset, isATS, atBoundary, supplyAt,
    blocks, blockIndexAt, limits, civilLimit, calls, signs, segs, startIdx: s0, endIdx: s1,
    TRAIN_LEN: C.TRAIN_LEN, LINE_MAX: C.LINE_MAX,
  };
};
