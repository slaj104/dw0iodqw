# 2종 철도법 암기장 (웹앱)

공개 주소(본인만 열람): https://claude.ai/artifact/8r8Zzpoho4ZdunxqrxnviV

- `index.html` — 앱 본체 (배우기 · 복습 퀴즈 · 조문 찾기 · 내 기록)
- `data.json` — `scripts/build_study_data.py`가 `laws/*.json`에서 만든 학습 데이터

법령이 개정되면:

```
python3 scripts/fetch_laws.py
python3 scripts/parse_gwangyeok.py   # 광역철도 세칙 PDF를 바꿨을 때
python3 scripts/build_study_data.py
```

빈칸은 숫자+단위(기간·금액·거리·비율), 이상/이하/초과/미만, 대통령령/국토교통부령,
권한 주체(국토교통부장관 등), 폐색 방식·신호·신호기 이름에서 만든다.
틀린 조문은 2분 뒤, 맞힌 조문은 10분 → 1일 → 3일 → 7일 → 16일 간격으로 다시 나온다.

배우기는 법마다 '용어 익히기'(정의 조문에서 뽑은 용어) → 장·절 단위 단원(5조문 이하) 순서다.
단원 안에서는 조문 읽기 → 바로 확인 문제를 반복하고, 끝낸 조문만 복습 퀴즈에 나온다.
'쉽게 풀어 설명 듣기'는 페이지의 AI 호출 기능으로 설명을 만들고, 한 번 만든 설명은 저장해 다시 쓴다.
