# 애니 NSFW 자동 검열기

[Anime NSFW segm/detailer](https://civitai.com/models/2619511) (YOLO26 세그멘테이션, [HuggingFace](https://huggingface.co/01miku/anime-nsfw-segm-yolo26)) 모델로
**성기(음부·음경)와 항문만** 찾아서 **모자이크 / 블러 / 색칠**로 가려 줍니다.
유두와 얼굴은 기본적으로 건드리지 않습니다.

## 설치

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
| `--box` | 윤곽 대신 검출 사각형 전체를 가림 | 끔 |
| `--pubic-hair` / `--nipple` | 음모 / 유두도 가리기 | 끔 |
| `--format` | 출력 확장자 강제 (png, jpg, webp…) | 원본과 같음 |
| `--skip-clean` | 아무것도 검출 안 된 이미지는 저장 안 함 | 끔 |
| `--device` | `cpu`, `0`(GPU) 등 | 자동 |

## 참고
- 자동 검출이라 놓치는 경우가 있을 수 있습니다. 공개 전에는 결과를 꼭 눈으로 확인하세요. 놓치면 `--conf`를 낮추거나 `--expand`를 키워 보세요.
- PNG 투명도(알파 채널)는 유지됩니다. 한글 경로도 지원합니다.
