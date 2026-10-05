#!/usr/bin/env python3
"""별표 PDF를 앱에서 볼 수 있는 그림(app/byl/*.png)으로 바꾸고 목록을 app/byl/index.json 에 적는다.

- laws/별표/<법령>_별표<번호>.pdf (law.go.kr 별표)
- sources/광역철도운전취급세칙.pdf 의 [별표 N] 쪽
흑백 120dpi, 여백 잘라 16색으로 줄여 한 쪽에 50KB 안팎이 되게 한다.
"""
import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "byl"


def render(pdf, first, last, stem):
    files = []
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "120", "-gray", "-png", "-f", str(first), "-l", str(last), str(pdf), f"{tmp}/p"], check=True)
        for i, src in enumerate(sorted(Path(tmp).glob("p-*.png"))):
            dst = OUT / f"{stem}-{i + 1}.png"
            subprocess.run(["convert", str(src), "-trim", "+repage", "-bordercolor", "white", "-border", "12", "-colors", "16", "-depth", "4", str(dst)], check=True)
            files.append(f"byl/{dst.name}")
    return files


def pages(pdf):
    out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    return int(re.search(r"Pages:\s+(\d+)", out).group(1))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.png"):
        f.unlink()
    index = {}
    ids = {"철도안전법시행령": "dec", "철도안전법시행규칙": "rule"}
    for name, lid in ids.items():
        d = json.loads((ROOT / "laws" / f"{name}.json").read_text(encoding="utf-8"))
        for b in d["appendices"]:
            no = b["no"].replace("별표", "").strip()
            pdf = ROOT / "laws" / b["pdf"]
            key = f"{lid}-b{no.replace('의', '-')}"
            index[key] = {"law": lid, "no": no, "title": b["title"], "imgs": render(pdf, 1, pages(pdf), key)}
            print(key, len(index[key]["imgs"]))
    # 광역철도 세칙: 쪽마다 [별표 N] 이 시작하는 곳을 찾는다
    pdf = ROOT / "sources" / "광역철도운전취급세칙.pdf"
    n = pages(pdf)
    starts = []
    for p in range(1, n + 1):
        t = subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), "-layout", str(pdf), "-"], capture_output=True, text=True).stdout
        for m in re.finditer(r"\[별표\s*(\d+)\]\s*\n?\s*(.+)", t):
            starts.append((int(m.group(1)), p, re.sub(r"\s+", " ", m.group(2)).strip()))
    seen = {}
    for no, p, title in starts:
        seen.setdefault(no, (p, title))
    nos = sorted(seen)
    for i, no in enumerate(nos):
        p, title = seen[no]
        last = seen[nos[i + 1]][0] if i + 1 < len(nos) else n
        if i + 1 < len(nos) and last > p:
            # 다음 별표가 다음 쪽 첫머리에서 시작하면 그 쪽은 빼고, 같은 쪽에서 시작하면 포함한다
            last -= 1
        key = f"gw-b{no}"
        index[key] = {"law": "gw", "no": str(no), "title": title, "imgs": render(pdf, p, max(p, last), key)}
        print(key, p, last, title)
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.glob("*.png"))
    print(f"별표 {len(index)}개, 그림 {sum(len(v['imgs']) for v in index.values())}장, {size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
