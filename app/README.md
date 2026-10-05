# 2종 철도법 암기장 (웹앱)

공개 주소(본인만 열람): https://claude.ai/artifact/8r8Zzpoho4ZdunxqrxnviV

- `index.html` — 앱 본체 (빈칸 퀴즈 · 암기카드 · 조문 찾기 · 내 기록)
- `data.json` — `scripts/build_study_data.py`가 `laws/*.json`에서 만든 학습 데이터

법령이 개정되면:

```
python3 scripts/fetch_laws.py
python3 scripts/build_study_data.py
```

빈칸은 숫자+단위(기간·금액·거리·비율), 이상/이하/초과/미만, 대통령령/국토교통부령,
권한 주체(국토교통부장관 등), 폐색 방식·신호·신호기 이름에서 만든다.
틀린 조문은 2분 뒤, 맞힌 조문은 10분 → 1일 → 3일 → 7일 → 16일 간격으로 다시 나온다.
