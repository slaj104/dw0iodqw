"""
애니 NSFW 이미지 자동 검열기

01miku 의 "Anime NSFW segm/detailer" (YOLO26 세그멘테이션) 모델로
성기(vagina, penis)와 항문(anus)을 찾아 모자이크 / 블러 / 단색 칠하기로 가립니다.
유두(nipple)와 얼굴은 기본적으로 건드리지 않습니다.

모델: https://huggingface.co/01miku/anime-nsfw-segm-yolo26
      https://civitai.com/models/2619511

사용 예:
    python censor.py 그림.png
    python censor.py 입력폴더 -o 출력폴더 --mode blur
    python censor.py 입력폴더 --mode fill --color "#000000" --expand 8
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

HF_BASE = "https://huggingface.co/01miku/anime-nsfw-segm-yolo26/resolve/main/"
MODELS = {
    "xl": "nsfw-anime-xl-x1280.pt",
    "medium": "nsfw-anime-medium-x1280.pt",
    "nano": "nsfw-anime-nano-x640.pt",
}
MODEL_IMGSZ = {"xl": 1280, "medium": 1280, "nano": 640}

# 모델 클래스: anus, nipple, penis, vagina, female face, male face, pubic hair
DEFAULT_CLASSES = ("anus", "penis", "vagina")
ALL_CENSORABLE = ("anus", "penis", "vagina", "pubic hair", "nipple")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
MODES = ("mosaic", "blur", "fill")


@dataclass
class CensorOptions:
    mode: str = "mosaic"            # mosaic | blur | fill
    classes: tuple[str, ...] = DEFAULT_CLASSES
    conf: float = 0.3               # 검출 신뢰도 임계값 (권장 0.25 ~ 0.8)
    expand: int = -1                # 마스크 확장 픽셀 (-1 = 이미지 크기에 맞춰 자동)
    mosaic_size: int = 0            # 모자이크 블록 크기 (0 = 자동, 긴 변의 1/100)
    blur_strength: int = 0          # 블러 커널 크기 (0 = 자동)
    color: tuple[int, int, int] = (0, 0, 0)  # 칠하기 색상 (BGR)
    use_box: bool = False           # 세그멘테이션 대신 박스 영역 전체를 가림
    penis_pad: float = 0.2          # 음경 영역 추가 확장 (검출 크기 대비 비율). 모델에 고환 클래스가 없어 주변까지 덮기 위함
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------- 모델 로딩

def resolve_model(model: str, models_dir: Path) -> tuple[Path, int]:
    """'xl' / 'medium' / 'nano' 또는 .pt/.onnx 경로를 받아 실제 파일 경로를 돌려줌.
    파일이 없으면 HuggingFace 에서 내려받는다."""
    if model in MODELS:
        path = models_dir / MODELS[model]
        if not path.exists():
            models_dir.mkdir(parents=True, exist_ok=True)
            url = HF_BASE + MODELS[model]
            print(f"[다운로드] {url}")
            tmp = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.replace(path)
        return path, MODEL_IMGSZ[model]

    path = Path(model)
    if not path.exists():
        raise FileNotFoundError(f"모델 파일을 찾을 수 없습니다: {path}")
    imgsz = 640 if "640" in path.name else 1280
    return path, imgsz


class Censor:
    def __init__(self, model: str = "xl", models_dir: str | Path = "models", device: str | None = None):
        from ultralytics import YOLO

        path, self.imgsz = resolve_model(model, Path(models_dir))
        self.model = YOLO(str(path), task="segment")
        self.device = device
        self.names: dict[int, str] = self.model.names

    # ------------------------------------------------------------ 검출

    def detect_mask(self, img: np.ndarray, opts: CensorOptions) -> tuple[np.ndarray, list[dict]]:
        """가릴 영역의 마스크(uint8, 0/255)와 검출 목록을 돌려준다."""
        h, w = img.shape[:2]
        mask = np.zeros((h, w), np.uint8)
        wanted = {i for i, n in self.names.items() if n in opts.classes}
        if not wanted:
            return mask, []

        r = self.model.predict(
            img, conf=opts.conf, imgsz=self.imgsz, classes=sorted(wanted),
            device=self.device, verbose=False, retina_masks=True,
        )[0]

        detections = []
        if r.boxes is None or len(r.boxes) == 0:
            return mask, detections

        cls = r.boxes.cls.int().tolist()
        confs = r.boxes.conf.tolist()
        boxes = r.boxes.xyxy.cpu().numpy().astype(int)
        polys = r.masks.xy if (r.masks is not None and not opts.use_box) else None

        for i, (c, p, b) in enumerate(zip(cls, confs, boxes)):
            name = self.names[c]
            detections.append({"class": name, "conf": round(p, 3), "box": b.tolist()})
            m = np.zeros((h, w), np.uint8)
            poly = polys[i] if polys is not None else None
            if poly is not None and len(poly) >= 3:
                cv2.fillPoly(m, [poly.astype(np.int32)], 255)
            else:
                x1, y1, x2, y2 = b
                cv2.rectangle(m, (x1, y1), (x2, y2), 255, -1)
            if name == "penis" and opts.penis_pad > 0:
                pad = round(max(b[2] - b[0], b[3] - b[1]) * opts.penis_pad)
                if pad > 0:
                    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad * 2 + 1, pad * 2 + 1))
                    m = cv2.dilate(m, k)
            mask |= m

        expand = opts.expand if opts.expand >= 0 else max(2, round(max(h, w) * 0.006))
        if expand > 0:
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (expand * 2 + 1, expand * 2 + 1))
            mask = cv2.dilate(mask, k)
        return mask, detections

    # ------------------------------------------------------------ 처리

    def process(self, img: np.ndarray, opts: CensorOptions) -> tuple[np.ndarray, list[dict]]:
        alpha = None
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        elif img.shape[2] == 4:
            alpha = img[:, :, 3]
            img = img[:, :, :3]

        mask, dets = self.detect_mask(img, opts)
        out = apply_censor(img, mask, opts) if dets else img.copy()

        if alpha is not None:
            out = np.dstack([out, alpha])
        return out, dets


def apply_censor(img: np.ndarray, mask: np.ndarray, opts: CensorOptions) -> np.ndarray:
    h, w = img.shape[:2]
    long_side = max(h, w)

    if opts.mode == "mosaic":
        # 일본식 기준: 블록 크기 = 긴 변의 1/100, 최소 4px
        block = opts.mosaic_size or max(4, round(long_side / 100))
        small = cv2.resize(img, (max(1, w // block), max(1, h // block)), interpolation=cv2.INTER_AREA)
        layer = cv2.resize(small, (small.shape[1] * block, small.shape[0] * block), interpolation=cv2.INTER_NEAREST)
        # 나누어 떨어지지 않는 가장자리 보정
        full = cv2.copyMakeBorder(layer, 0, max(0, h - layer.shape[0]), 0, max(0, w - layer.shape[1]),
                                  cv2.BORDER_REPLICATE)[:h, :w]
        # 마스크도 블록 단위로 맞춰서 모자이크 경계가 칸 모양이 되도록
        m_small = cv2.resize(mask, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_AREA)
        m_block = cv2.resize((m_small > 0).astype(np.uint8) * 255,
                             (small.shape[1] * block, small.shape[0] * block), interpolation=cv2.INTER_NEAREST)
        m_full = cv2.copyMakeBorder(m_block, 0, max(0, h - m_block.shape[0]), 0, max(0, w - m_block.shape[1]),
                                    cv2.BORDER_REPLICATE)[:h, :w]
        m_full = cv2.bitwise_or(m_full, mask)
        layer, mask = full, m_full

    elif opts.mode == "blur":
        k = opts.blur_strength or max(15, round(long_side / 25))
        k += (k + 1) % 2  # 홀수로
        layer = cv2.GaussianBlur(img, (k, k), 0)
        layer = cv2.GaussianBlur(layer, (k, k), 0)  # 두 번 걸어서 확실하게

    elif opts.mode == "fill":
        layer = np.empty_like(img)
        layer[:] = opts.color

    else:
        raise ValueError(f"알 수 없는 모드: {opts.mode}")

    out = img.copy()
    sel = mask > 0
    out[sel] = layer[sel]
    return out


# ---------------------------------------------------------------- 파일 입출력 (한글 경로 대응)

def imread(path: Path) -> np.ndarray | None:
    data = np.fromfile(str(path), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_UNCHANGED)


def imwrite(path: Path, img: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower()
    params = []
    if ext in (".jpg", ".jpeg", ".bmp") and img.ndim == 3 and img.shape[2] == 4:
        img = img[:, :, :3]
    if ext in (".jpg", ".jpeg"):
        params = [cv2.IMWRITE_JPEG_QUALITY, 95]
    elif ext == ".webp":
        params = [cv2.IMWRITE_WEBP_QUALITY, 95]
    ok, buf = cv2.imencode(ext, img, params)
    if not ok:
        raise IOError(f"저장 실패: {path}")
    buf.tofile(str(path))


def parse_color(s: str) -> tuple[int, int, int]:
    """'#RRGGBB' 또는 'R,G,B' -> BGR 튜플"""
    s = s.strip()
    if s.startswith("#"):
        s = s[1:]
        r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    else:
        r, g, b = (int(v) for v in s.split(","))
    return (b, g, r)


def collect_images(src: Path, recursive: bool) -> list[Path]:
    if src.is_file():
        return [src]
    it = src.rglob("*") if recursive else src.glob("*")
    return sorted(p for p in it if p.is_file() and p.suffix.lower() in IMAGE_EXTS)


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="애니 NSFW 이미지 성기/항문 자동 검열")
    ap.add_argument("input", help="이미지 파일 또는 폴더")
    ap.add_argument("-o", "--output", default="censored", help="출력 폴더 (기본: censored)")
    ap.add_argument("-m", "--mode", choices=MODES, default="mosaic", help="mosaic / blur / fill")
    ap.add_argument("--model", default="xl", help="xl / medium / nano 또는 .pt/.onnx 파일 경로 (기본: xl)")
    ap.add_argument("--models-dir", default=str(Path(__file__).parent / "models"), help="모델 저장 폴더")
    ap.add_argument("--conf", type=float, default=0.3, help="검출 신뢰도 임계값 (기본 0.3)")
    ap.add_argument("--expand", type=int, default=-1, help="마스크 확장 px (기본 -1 = 자동)")
    ap.add_argument("--mosaic-size", type=int, default=0, help="모자이크 블록 px (0 = 자동)")
    ap.add_argument("--blur", type=int, default=0, help="블러 강도/커널 px (0 = 자동)")
    ap.add_argument("--color", default="#000000", help="fill 모드 색상 (#RRGGBB 또는 R,G,B)")
    ap.add_argument("--pubic-hair", action="store_true", help="음모도 함께 가리기")
    ap.add_argument("--nipple", action="store_true", help="유두도 함께 가리기 (기본은 가리지 않음)")
    ap.add_argument("--box", action="store_true", help="윤곽 대신 검출 박스 전체를 가리기")
    ap.add_argument("--penis-pad", type=float, default=0.2,
                    help="음경 주변(고환 등) 추가로 덮는 비율, 검출 크기 대비 (기본 0.2, 0 = 끔)")
    ap.add_argument("--format", default=None, help="출력 확장자 강제 (예: png, jpg, webp)")
    ap.add_argument("-r", "--recursive", action="store_true", help="하위 폴더까지 처리")
    ap.add_argument("--device", default=None, help="cpu / 0 (GPU 번호) 등")
    ap.add_argument("--skip-clean", action="store_true", help="검출 없는 이미지는 출력하지 않음")
    args = ap.parse_args(argv)

    classes = list(DEFAULT_CLASSES)
    if args.pubic_hair:
        classes.append("pubic hair")
    if args.nipple:
        classes.append("nipple")

    opts = CensorOptions(
        mode=args.mode, classes=tuple(classes), conf=args.conf, expand=args.expand,
        mosaic_size=args.mosaic_size, blur_strength=args.blur,
        color=parse_color(args.color), use_box=args.box, penis_pad=args.penis_pad,
    )

    src = Path(args.input)
    if not src.exists():
        print(f"입력을 찾을 수 없습니다: {src}", file=sys.stderr)
        return 1
    files = collect_images(src, args.recursive)
    if not files:
        print("처리할 이미지가 없습니다.", file=sys.stderr)
        return 1

    censor = Censor(args.model, args.models_dir, args.device)
    out_dir = Path(args.output)
    base = src if src.is_dir() else src.parent

    total = 0
    for i, f in enumerate(files, 1):
        img = imread(f)
        if img is None:
            print(f"[{i}/{len(files)}] 읽기 실패: {f}")
            continue
        out, dets = censor.process(img, opts)
        summary = ", ".join(f"{d['class']}({d['conf']:.2f})" for d in dets) or "검출 없음"
        print(f"[{i}/{len(files)}] {f.name}: {summary}")
        if not dets and args.skip_clean:
            continue
        rel = f.relative_to(base)
        dst = out_dir / rel
        if args.format:
            dst = dst.with_suffix("." + args.format.lstrip("."))
        imwrite(dst, out)
        total += len(dets)

    print(f"완료: {len(files)}장, 검열 영역 {total}개 -> {out_dir.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
