#!/usr/bin/env python3
"""국가법령정보센터(law.go.kr)에서 2종 필기 '철도 관련 법' 현행 원문을 받아 laws/ 에 저장한다.

산출물:
  laws/<법령명>.md    사람이 읽는 조문 원문
  laws/<법령명>.json  학습 프로그램용 조문 데이터
  laws/별표/          시행규칙 등 별표 PDF + 텍스트
"""
import html
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "laws"
BASE = "https://www.law.go.kr"
LAWS = [
    "철도안전법",
    "철도안전법시행령",
    "철도안전법시행규칙",
    "철도차량운전규칙",
    "도시철도운전규칙",
]


def curl(url, data=None, binary=False):
    # law.go.kr 은 프록시 경유 시 연결이 자주 끊겨서 재시도한다.
    cmd = ["curl", "-sS", "-f", "-m", "90", url]
    if data:
        cmd += ["-X", "POST", "-d", data]
    for i in range(8):
        r = subprocess.run(cmd, capture_output=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout if binary else r.stdout.decode("utf-8", "ignore")
        time.sleep(2 + i * 2)
    raise RuntimeError(f"다운로드 실패: {url}")


def clean(fragment):
    t = re.sub(r"<[^>]+>", "", fragment)
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def parse_articles(body):
    articles = []
    last_no = 0
    for block in body.split('<div class="pgroup">')[1:]:
        paras = [clean(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", block, re.S)]
        paras = [p for p in paras if p]
        if not paras:
            continue
        m = re.match(r"(제\d+조(?:의\d+)?)\s*(?:\(([^)]*)\))?\s*(.*)", paras[0])
        if not m:
            continue
        no = int(re.match(r"제(\d+)", m.group(1)).group(1))
        if no < last_no - 1:  # 조문 번호가 다시 처음부터 시작하면 부칙이다
            break
        last_no = no
        first = m.group(3).strip()
        lines = ([first] if first else []) + paras[1:]
        articles.append({
            "no": m.group(1),
            "title": m.group(2) or "",
            "text": "\n".join(lines),
        })
    return articles


def fetch_byl(body, name, seen):
    # 별표 PDF 링크: [별표 N] 제목 ... flSeq=...(PDF)
    pat = (r'\[별표\s*([0-9의 ]+)\]\s*([^<]*?)\s*</a>\s*<a href="flDownload\.do\?gubun=&amp;flSeq=\d+'
           r'&amp;bylClsCd=\d+"[^>]*>\s*<img alt="HWP[^>]*>\s*</a>\s*<a href="flDownload\.do\?gubun=&amp;flSeq=(\d+)'
           r'&amp;bylClsCd=(\d+)"[^>]*>\s*<img alt="PDF')
    d = OUT / "별표"
    d.mkdir(exist_ok=True)
    out = []
    for no, title, seq, cls in re.findall(pat, body):
        no = no.replace(" ", "")
        if (name, no) in seen:
            continue
        seen.add((name, no))
        stem = f"{name}_별표{no}"
        pdf = d / f"{stem}.pdf"
        pdf.write_bytes(curl(f"{BASE}/LSW/flDownload.do?gubun=&flSeq={seq}&bylClsCd={cls}", binary=True))
        subprocess.run(["pdftotext", "-layout", str(pdf), str(d / f"{stem}.txt")], check=False)
        out.append({"no": f"별표 {no}", "title": clean(title), "pdf": f"별표/{stem}.pdf", "txt": f"별표/{stem}.txt"})
        print(f"   - [별표 {no}] {clean(title)}")
    return out


def main():
    OUT.mkdir(exist_ok=True)
    index = []
    for name in sys.argv[1:] or LAWS:
        landing = curl(f"{BASE}/법령/{name}")
        seq = re.search(r"lsiSeq=(\d+)", landing).group(1)
        efyd = re.search(r"efYd=(\d+)", landing).group(1)
        body = curl(f"{BASE}/LSW/lsInfoR.do",
                    data=f"lsiSeq={seq}&chrClsCd=010202&efYd={efyd}&ancYnChk=0&nwJoYnInfo=Y&efGubun=Y&vSct=*")
        title = clean(re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S).group(1)) if "<h2" in body else name
        info = clean(m.group(1)) if (m := re.search(r'<div class="ct_sub">(.*?)</div>', body, re.S)) else ""
        arts = parse_articles(body)
        print(f"{name}: 조문 {len(arts)}개 (시행 {efyd})")
        bylpo = fetch_byl(body, name, set())
        data = {"law": name, "title": title, "info": info, "lsiSeq": seq, "efYd": efyd,
                "source": f"{BASE}/법령/{name}", "articles": arts, "appendices": bylpo}
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        md = [f"# {title}", "", f"- {info}" if info else "", f"- 시행일: {efyd}", f"- 출처: {data['source']}", ""]
        for a in arts:
            md += [f"### {a['no']}({a['title']})" if a["title"] else f"### {a['no']}", "", a["text"].replace("\n", "\n\n"), ""]
        if bylpo:
            md += ["## 별표", ""] + [f"- [{b['no']}] {b['title']} — [PDF]({b['pdf']}) · [텍스트]({b['txt']})" for b in bylpo]
        (OUT / f"{name}.md").write_text("\n".join(md), encoding="utf-8")
        index.append({"law": name, "efYd": efyd, "articles": len(arts), "appendices": len(bylpo)})
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
