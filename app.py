"""
웹 GUI (Gradio)

    python app.py
브라우저에서 http://127.0.0.1:7860 을 열어 사용합니다.
"""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

import cv2
import gradio as gr

from censor import DEFAULT_CLASSES, Censor, CensorOptions, imread, imwrite, parse_color

MODELS_DIR = Path(__file__).parent / "models"
_cache: dict[str, Censor] = {}

MODE_LABELS = {"모자이크": "mosaic", "블러": "blur", "색칠": "fill"}
CLASS_LABELS = {"항문": "anus", "음경": "penis", "음부": "vagina", "음모": "pubic hair", "유두": "nipple"}


def get_censor(model: str) -> Censor:
    if model not in _cache:
        _cache[model] = Censor(model, MODELS_DIR)
    return _cache[model]


def build_opts(mode, classes, conf, expand, mosaic, blur, color, use_box) -> CensorOptions:
    return CensorOptions(
        mode=MODE_LABELS[mode],
        classes=tuple(CLASS_LABELS[c] for c in classes),
        conf=conf, expand=int(expand), mosaic_size=int(mosaic), blur_strength=int(blur),
        color=parse_color(color or "#000000"), use_box=use_box,
    )


def run_single(image, model, mode, classes, conf, expand, mosaic, blur, color, use_box):
    if image is None:
        return None, "이미지를 올려주세요."
    bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    out, dets = get_censor(model).process(bgr, build_opts(mode, classes, conf, expand, mosaic, blur, color, use_box))
    info = "\n".join(f"{d['class']}  conf={d['conf']:.2f}  box={d['box']}" for d in dets) or "검출 없음"
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB), info


def run_batch(files, model, mode, classes, conf, expand, mosaic, blur, color, use_box):
    if not files:
        return None, "파일을 올려주세요."
    censor = get_censor(model)
    opts = build_opts(mode, classes, conf, expand, mosaic, blur, color, use_box)
    tmp = Path(tempfile.mkdtemp(prefix="censored_"))
    log = []
    for f in files:
        p = Path(f if isinstance(f, str) else f.name)
        img = imread(p)
        if img is None:
            log.append(f"{p.name}: 읽기 실패")
            continue
        out, dets = censor.process(img, opts)
        imwrite(tmp / p.name, out)
        log.append(f"{p.name}: " + (", ".join(d["class"] for d in dets) or "검출 없음"))
    zpath = tmp.with_suffix(".zip")
    with zipfile.ZipFile(zpath, "w") as z:
        for p in tmp.iterdir():
            z.write(p, p.name)
    return str(zpath), "\n".join(log)


with gr.Blocks(title="NSFW 자동 검열기") as demo:
    gr.Markdown("## 애니 NSFW 자동 검열기\n성기·항문 영역을 찾아 모자이크 / 블러 / 색칠로 가립니다. (유두는 기본 제외)")

    with gr.Row():
        with gr.Column(scale=1):
            model = gr.Radio(["xl", "medium", "nano"], value="xl", label="모델 (xl = 가장 정확, nano = 가장 빠름)")
            mode = gr.Radio(list(MODE_LABELS), value="모자이크", label="검열 방식")
            classes = gr.CheckboxGroup(
                list(CLASS_LABELS), label="가릴 부위",
                value=[k for k, v in CLASS_LABELS.items() if v in DEFAULT_CLASSES],
            )
            conf = gr.Slider(0.05, 0.9, value=0.3, step=0.05, label="검출 신뢰도 (낮을수록 많이 잡음)")
            expand = gr.Slider(-1, 60, value=-1, step=1, label="마스크 확장 px (-1 = 자동)")
            mosaic = gr.Slider(0, 80, value=0, step=1, label="모자이크 크기 px (0 = 자동)")
            blur = gr.Slider(0, 301, value=0, step=2, label="블러 강도 (0 = 자동)")
            color = gr.ColorPicker(value="#000000", label="색칠 색상")
            use_box = gr.Checkbox(False, label="윤곽 대신 사각형 박스 전체 가리기")

        with gr.Column(scale=2):
            with gr.Tab("한 장"):
                with gr.Row():
                    inp = gr.Image(type="numpy", label="원본", image_mode="RGB")
                    out = gr.Image(type="numpy", label="결과", format="png")
                btn = gr.Button("검열하기", variant="primary")
                info = gr.Textbox(label="검출 결과", lines=4)
            with gr.Tab("여러 장 (ZIP 다운로드)"):
                files = gr.File(file_count="multiple", file_types=["image"], label="이미지들")
                btn2 = gr.Button("일괄 검열", variant="primary")
                zipout = gr.File(label="결과 ZIP")
                log = gr.Textbox(label="로그", lines=8)

    params = [model, mode, classes, conf, expand, mosaic, blur, color, use_box]
    btn.click(run_single, [inp, *params], [out, info])
    btn2.click(run_batch, [files, *params], [zipout, log])


if __name__ == "__main__":
    demo.launch(inbrowser=True)
