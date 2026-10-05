# 애니 NSFW 자동 검열기

[Anime NSFW segm/detailer](https://civitai.com/models/2619511) (YOLO26 세그멘테이션, [HuggingFace](https://huggingface.co/01miku/anime-nsfw-segm-yolo26)) 모델로
**남녀 성기와 남녀 항문만** 찾아서 **모자이크 / 블러 / 색칠**로 가려 줍니다.
유두와 얼굴은 기본적으로 건드리지 않습니다.

## 실행 방법 (Windows, 제일 쉬운 방법)

1. **파이썬 설치**: https://www.python.org/downloads/ 에서 받아 설치. 설치 첫 화면에서 **"Add python.exe to PATH" 체크** 필수.
2. **이 프로그램 받기**: GitHub 저장소 페이지에서 브랜치를 고르고 초록색 `Code` 버튼 → `Download ZIP` → 아무 폴더에 압축 풀기.
3. **`run_gui.bat` 더블클릭**. 처음 한 번은 필요한 프로그램 설치와 모델 다운로드 때문에 몇 분 걸립니다.
4. 브라우저가 열리면 그림을 올리고 **검열하기**. 결과 그림에서 우클릭 → 저장. 여러 장은 "여러 장" 탭에서 ZIP으로 받습니다.

검은 창은 프로그램이 돌아가는 동안 닫지 마세요.

## 설치 (직접 할 경우)

```bash
pip install -r requirements.txt
```

NVIDIA GPU가 있으면 [PyTorch CUDA 버전](https://pytorch.org/get-started/locally/)을 먼저 깔면 훨씬 빠릅니다.
모델 파일은 처음 실행할 때 `models/` 폴더에 자동으로 내려받습니다. (civitai에서 받은 `.pt`/`.onnx` 파일은 `--model 경로`로 지정 가능)

## 사용법

### GUI
```bash
python app.py        # 또는 Windows에서 run_gui.bat 더블클릭
```
브라우저가 열리면 이미지를 올리고 검열 방식·부위를 고른 뒤 "검열하기". 여러 장은 ZIP으로 받을 수 있습니다.

### 명령줄
```bash
python censor.py 그림.png                         # 모자이크 -> censored/그림.png
python censor.py 폴더 -o 결과폴더 -r              # 폴더 통째로 (하위 폴더 포함)
python censor.py 폴더 --mode blur                 # 블러
python censor.py 폴더 --mode fill --color "#FFFFFF"   # 흰색으로 칠하기
python censor.py 폴더 --pubic-hair                # 음모까지 가리기
python censor.py 폴더 --model nano                # 빠른 모델
```

| 옵션 | 설명 | 기본값 |
|---|---|---|
| `-m, --mode` | `mosaic` / `blur` / `fill` | mosaic |
| `--model` | `xl` / `medium` / `nano` 또는 모델 파일 경로 | xl |
| `--conf` | 검출 신뢰도 (낮추면 더 많이 잡고 오검출도 늘어남, 권장 0.25~0.8) | 0.3 |
| `--expand` | 마스크를 바깥으로 넓힐 px (`-1` = 이미지 크기에 맞춰 자동) | -1 |
| `--mosaic-size` | 모자이크 칸 크기 px (`0` = 긴 변의 1/100, 최소 4px) | 0 |
| `--blur` | 블러 커널 크기 (`0` = 자동) | 0 |
| `--color` | 색칠 색상 `#RRGGBB` 또는 `R,G,B` | #000000 |
| `--penis-pad` | 남자 성기 주변(고환 등)을 더 넓게 덮는 비율. 모델에 고환 항목이 없어서 넣은 옵션 | 0.2 |
| `--box` | 윤곽 대신 검출 사각형 전체를 가림 | 끔 |
| `--pubic-hair` / `--nipple` | 음모 / 유두도 가리기 | 끔 |
| `--format` | 출력 확장자 강제 (png, jpg, webp…) | 원본과 같음 |
| `--skip-clean` | 아무것도 검출 안 된 이미지는 저장 안 함 | 끔 |
| `--device` | `cpu`, `0`(GPU) 등 | 자동 |

## 참고
- 남녀 구분 없이 `anus`(항문), `penis`(남자 성기), `vagina`(여자 성기)를 모두 가립니다.
- 자동 검출이라 놓치는 경우가 있을 수 있습니다. 공개 전에는 결과를 꼭 눈으로 확인하세요. 놓치면 `--conf`를 낮추거나 `--expand`를 키워 보세요.
- PNG 투명도(알파 채널)는 유지됩니다. 한글 경로도 지원합니다.
