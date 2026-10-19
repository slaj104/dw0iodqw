// 과천선(4호선) 하행 노선 데이터: 남태령 → 금정
// 거리 원점(s=0)은 남태령역 승강장 중심. 단위: m
// ※ 역간거리·곡선·구배·속도제한은 졸업작품 시연용 근사값입니다.
//    실제 선로제원(선로일람표·종단면도)을 구하면 이 파일의 숫자만 바꾸면 됩니다.
window.RS = window.RS || {};

RS.ROUTE = (function () {
  const TRAIN_LEN = 200;      // 10량 편성 (20 m × 10)
  const PLATFORM_HALF = 105;  // 승강장 길이 210 m
  const STOP_OFFSET = 100;    // 정지위치표(10량) = 승강장 중심 + 100 m

  const stations = [
    { name: '남태령',       en: 'Namtaeryeong',               no: '433', s: 0,     side: 'R' },
    { name: '선바위',       en: 'Seonbawi',                   no: '434', s: 1700,  side: 'L' },
    { name: '경마공원',     en: 'Seoul Racecourse Park',      no: '435', s: 2900,  side: 'L' },
    { name: '대공원',       en: 'Seoul Grand Park',           no: '436', s: 3850,  side: 'L' },
    { name: '과천',         en: 'Gwacheon',                   no: '437', s: 4850,  side: 'L' },
    { name: '정부과천청사', en: 'Government Complex Gwacheon', no: '438', s: 5900,  side: 'L' },
    { name: '인덕원',       en: 'Indeogwon',                  no: '439', s: 8100,  side: 'L' },
    { name: '평촌',         en: 'Pyeongchon',                 no: '440', s: 9700,  side: 'L' },
    { name: '범계',         en: 'Beomgye',                    no: '441', s: 10750, side: 'L' },
    { name: '금정',         en: 'Geumjeong',                  no: '443', s: 13200, side: 'L' },
  ];
  stations.forEach((st, i) => {
    st.idx = i;
    st.stop = st.s + STOP_OFFSET;
    st.pStart = st.s - PLATFORM_HALF;
    st.pEnd = st.s + PLATFORM_HALF;
    st.color = ['#3b82c4', '#2f9e8f', '#c47a2f', '#5b8f2f', '#8f2f6b', '#2f5b8f', '#b5452f', '#6b6b2f', '#2f8f5b', '#7a4fb5'][i];
  });

  const S_MIN = -400;
  const S_MAX = 13700;

  // 평면곡선: [시점, 종점, 반경(+우곡선 / -좌곡선)]
  const curves = [
    [250, 550, -500],
    [600, 800, 350], [850, 1050, -350],      // 꽈배기(우→좌측통행 전환) S자 구간
    [1300, 1500, 600],
    [1950, 2300, -450],
    [2400, 2700, 800],
    [3050, 3300, -600],
    [3400, 3650, 500],
    [4000, 4300, 700],
    [4400, 4650, -800],
    [5050, 5450, -400],
    [6100, 6600, 500],
    [6900, 7500, -700],
    [7700, 7900, 1000],
    [8300, 8700, -600],
    [9000, 9450, 800],
    [9900, 10300, -500],
    [11000, 11600, 600],
    [12000, 12400, -900],
    [12700, 12950, 400],
  ];

  // 종단구배: [시점, 구배(‰)]  (+ 상구배 / - 하구배)
  const grades = [
    [S_MIN, 0], [140, -28], [1560, 0], [1840, -10], [2760, 0], [3040, 5], [3710, 0],
    [3990, -6], [4710, 0], [4990, 4], [5760, 0], [6040, -12], [7000, 8], [7960, 0],
    [8240, -5], [9560, 0], [9840, 3], [10610, 0], [10890, 10], [12000, 3], [13060, 0],
  ];

  // 선로 상 고정 속도제한 (곡선 외)
  const fixedLimits = [
    [12920, 13080, 45], // 금정 진입 분기기
  ];

  // 터널(지하) 구간. 그 외는 지상
  const tunnels = [[S_MIN, 11900]];

  // 교직 절연구간 (DC 1500 V 서울교통공사 ↔ AC 25 kV 코레일)
  const deadSection = { start: 1150, end: 1216 };

  // 상대선(상행선) 횡방향 위치: 남태령 구간은 우측통행 → 상행선이 좌측(-),
  // 꽈배기 구간 이후 좌측통행 → 상행선이 우측(+). 꽈배기 구간은 단선터널.
  const twist = { start: 600, end: 1100 };
  function otherTrackOffset(s) {
    if (s < twist.start) return -4.0;
    if (s > twist.end) return 4.0;
    return null;
  }

  const LINE_MAX = 80;
  const ATC_CODES = [0, 25, 40, 45, 60, 70, 80];

  function curveLimit(R) {
    const r = Math.abs(R);
    if (r <= 400) return 60;
    if (r <= 600) return 70;
    return 80;
  }

  // 선로 고정 제한속도 (곡선 + 분기기)
  function civilLimit(s) {
    let lim = LINE_MAX;
    for (const [a, b, R] of curves) {
      if (s >= a - 30 && s <= b + 30) lim = Math.min(lim, curveLimit(R));
    }
    for (const [a, b, v] of fixedLimits) if (s >= a && s <= b) lim = Math.min(lim, v);
    return lim;
  }

  function gradeAt(s) {
    let g = 0;
    for (const [a, v] of grades) { if (s >= a) g = v; else break; }
    return g;
  }

  function inTunnel(s) {
    return tunnels.some(([a, b]) => s >= a && s <= b);
  }

  function stationAt(s) {
    return stations.find(st => s >= st.pStart - 20 && s <= st.pEnd + 20) || null;
  }

  // ATC 폐색구간: 역 승강장 시점·정지위치 직후에 경계, 역간은 약 400 m 간격 분할
  const blocks = [];
  (function buildBlocks() {
    const bounds = [S_MIN];
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      if (i > 0) bounds.push(st.pStart - 5);
      bounds.push(st.stop + 15);
      const nx = stations[i + 1];
      if (nx) {
        const a = st.stop + 15, b = nx.pStart - 5;
        const n = Math.max(1, Math.round((b - a) / 400));
        for (let k = 1; k < n; k++) bounds.push(a + (b - a) * k / n);
      }
    }
    bounds.push(S_MAX);
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1];
      let lim = LINE_MAX;
      for (let s = a; s <= b; s += 5) lim = Math.min(lim, civilLimit(s));
      const civil = ATC_CODES.filter(c => c <= lim).pop();
      blocks.push({ idx: i, start: a, end: b, civil });
    }
  })();

  function blockIndexAt(s) {
    let lo = 0, hi = blocks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (blocks[mid].start <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  return {
    TRAIN_LEN, PLATFORM_HALF, STOP_OFFSET, S_MIN, S_MAX, LINE_MAX, ATC_CODES,
    stations, curves, grades, tunnels, deadSection, twist, blocks,
    otherTrackOffset, civilLimit, gradeAt, inTunnel, stationAt, blockIndexAt,
  };
})();
