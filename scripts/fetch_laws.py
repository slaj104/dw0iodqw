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
    chapter = section = ""
    for block in re.split(r'<div class="pgroup"[^>]*>', body)[1:]:
        paras = [clean(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", block, re.S)]
        paras = [p for p in paras if p]
        if not paras:
            continue
        head = re.sub(r"\s*<[^>]*>\s*$", "", paras[0])
        if re.match(r"제\d+장(?:의\d+)?\s", head):
            chapter, section = head, ""
            continue
        if re.match(r"제\d+절(?:의\d+)?\s", head):
            section = head
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
            "chapter": chapter,
            "section": section,
        })
    return articles


def split_pending(articles):
    """law.go.kr 은 시행일이 뒤로 정해진 개정 조문을 '[시행일: …] 제N조' 꼬리표와 함께 이어 붙여 보여준다.
    한 블록에 붙어 들어온 새 조문(예: 제79조의2)을 떼어 내고, 시행 예정일을 pending 필드에 적는다."""
    out = []
    for a in articles:
        cur = dict(a, text="")
        lines = a["text"].split("\n")
        for i, ln in enumerate(lines):
            m = re.match(r"(제\d+조(?:의\d+)?)\(([^)]*)\)\s*(.*)", ln)
            if i > 0 and m and m.group(1) != a["no"]:
                out.append(cur)
                cur = dict(a, no=m.group(1), title=m.group(2), text=m.group(3))
                continue
            cur["text"] = (cur["text"] + "\n" + ln) if cur["text"] else ln
        out.append(cur)
    for a in out:
        m = re.search(r"\[시행일:\s*([\d.\s]+?)\.?\]\s*" + re.escape(a["no"]) + r"\s*$", a["text"])
        if m:
            a["pending"] = re.sub(r"\s+", "", m.group(1)).replace(".", "-")
            a["text"] = a["text"][:m.start()] + "[시행일: " + m.group(1).strip() + ".]"
    return out


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


def write_md(name, data):
    md = [f"# {data['title']}", "", f"- {data['info']}" if data["info"] else "", f"- 시행일: {data['efYd']}", f"- 출처: {data['source']}", ""]
    for a in data["articles"]:
        md += [f"### {a['no']}({a['title']})" if a["title"] else f"### {a['no']}", ""]
        if a.get("pending"):
            md += [f"> {a['pending']} 시행 예정인 개정 내용이 반영된 조문입니다.", ""]
        md += [a["text"].replace("\n", "\n\n"), ""]
    if data["appendices"]:
        md += ["## 별표", ""] + [f"- [{b['no']}] {b['title']} — [PDF]({b['pdf']}) · [텍스트]({b['txt']})" for b in data["appendices"]]
    (OUT / f"{name}.md").write_text("\n".join(md), encoding="utf-8")


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
        arts = split_pending(parse_articles(body))
        print(f"{name}: 조문 {len(arts)}개 (시행 {efyd})")
        bylpo = fetch_byl(body, name, set())
        data = {"law": name, "title": title, "info": info, "lsiSeq": seq, "efYd": efyd,
                "source": f"{BASE}/법령/{name}", "articles": arts, "appendices": bylpo}
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        write_md(name, data)
        index.append({"law": name, "efYd": efyd, "articles": len(arts), "appendices": len(bylpo)})
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
