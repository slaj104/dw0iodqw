#!/usr/bin/env python3
"""sources/광역철도운전취급세칙.pdf 를 laws/ 와 같은 형식(json, md)으로 변환한다.

이 세칙은 법령이 아니라 운영기관 세칙이라 국가법령정보센터에 없다.
PDF 텍스트를 줄 단위로 읽어 장·절·조문으로 나누고, 줄바꿈으로 잘린 문장을 이어 붙인다.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources" / "광역철도운전취급세칙.pdf"
NAME = "광역철도운전취급세칙"
ITEM = re.compile(r"^(?:[①-⑳]|\d+(?:의\d+)?\.\s|[가-하]\.\s(?!<)|\d+\)\s)")


def word_stats(lines):
    """줄 안쪽에서 각 낱말이 띄어 쓰인 횟수와 앞 글자에 붙어 쓰인 횟수를 센다."""
    spaced, glued = {}, {}
    for l in lines:
        for m in re.finditer(r"(?<=[가-힣])([가-힣]+[.,]?)|(?<= )([가-힣]+[.,]?)", l):
            if m.start() == 0:
                continue
            tok = m.group(0)
            for k in range(1, len(tok) + 1):
                d = glued if m.group(1) else spaced
                d[tok[:k]] = d.get(tok[:k], 0) + 1
    return spaced, glued


def joiner(prev, nxt, spaced, glued):
    # PDF는 한글을 글자 단위로 줄바꿈해서, 줄 끝이 낱말 중간인지 낱말 경계인지 알 수 없다.
    # 다음 줄 첫 낱말이 문서 안에서 주로 띄어 쓰이면 공백을, 주로 붙어 쓰이면 그대로 잇는다.
    if not (re.search(r"[가-힣]$", prev) and re.match(r"[가-힣]", nxt)):
        return " "
    tok = re.match(r"[가-힣]+[.,]?", nxt).group(0)
    return " " if spaced.get(tok, 0) > glued.get(tok, 0) else ""


def main():
    raw = subprocess.run(["pdftotext", "-layout", str(SRC), "-"], capture_output=True, text=True, check=True).stdout
    body, _, appx = raw.partition("[별표 1]")
    lines = [l.strip() for l in body.splitlines()]
    lines = [l for l in lines if l and not re.fullmatch(r"-\s*\d+\s*-", l)]
    head = [l for l in lines[:12] if re.match(r"(제정|개정|전부개정)\s", l)]
    for i, l in enumerate(lines):
        if re.match(r"부\s*칙", l):
            lines = lines[:i]
            break
    # 제목이 두 줄에 걸친 조문 머리(예: "제46조(ATC ... 경우의" + "운전)")를 한 줄로 합친다
    spaced, glued = word_stats(lines)
    merged = []
    for l in lines:
        if merged and re.match(r"제\d+조(?:의\d+)?\([^)]*$", merged[-1]):
            merged[-1] += joiner(merged[-1], l, spaced, glued) + l
        else:
            merged.append(l)
    lines = merged

    articles, chapter, section, cur = [], "", "", None
    for l in lines:
        if re.fullmatch(r"제\d+장\s+.+", l):
            chapter, section = re.sub(r"\s+", " ", l), ""
            continue
        if re.fullmatch(r"제\d+절\s+.+", l):
            section = re.sub(r"\s+", " ", l)
            continue
        if re.fullmatch(r"제\d+관\s+.+", l):
            section = section.split(" · ")[0] + " · " + re.sub(r"\s+", " ", l)
            continue
        m = re.match(r"(제\d+조(?:의\d+)?)\(([^)]*)\)\s*(.*)", l)
        if m:
            cur = {"no": m.group(1), "title": m.group(2), "paras": [m.group(3)] if m.group(3) else [],
                   "chapter": chapter, "section": section}
            articles.append(cur)
            continue
        if cur is None:
            continue
        if ITEM.match(l) or not cur["paras"]:
            cur["paras"].append(l)
        else:
            prev = cur["paras"][-1]
            cur["paras"][-1] = prev + joiner(prev, l, spaced, glued) + l
    out = []
    for a in articles:
        text = "\n".join(re.sub(r"<(개|신)\s*(정|설)", r"<\1\2", re.sub(r"\s+", " ", p)).strip() for p in a["paras"])
        out.append({"no": a["no"], "title": a["title"], "text": text, "chapter": a["chapter"], "section": a["section"]})

    bdir = ROOT / "laws" / "별표"
    bdir.mkdir(parents=True, exist_ok=True)
    (bdir / f"{NAME}_별표.txt").write_text("[별표 1]" + appx, encoding="utf-8")
    data = {"law": NAME, "title": "광역철도 운전취급 세칙", "info": " / ".join(head[-1:]) or "",
            "source": "sources/광역철도운전취급세칙.pdf (운영기관 세칙, 사용자 제공)",
            "articles": out, "appendices": [{"no": "별표 1~6", "title": "속도제한·표지 등", "txt": f"별표/{NAME}_별표.txt"}]}
    (ROOT / "laws" / f"{NAME}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    md = [f"# {data['title']}", "", f"- {data['info']}", f"- 출처: {data['source']}", ""]
    for a in out:
        md += [f"### {a['no']}({a['title']})", "", a["text"].replace("\n", "\n\n"), ""]
    md += ["## 별표", "", f"- [별표 1~6 텍스트](별표/{NAME}_별표.txt)"]
    (ROOT / "laws" / f"{NAME}.md").write_text("\n".join(md), encoding="utf-8")
    print(f"{NAME}: 조문 {len(out)}개")


if __name__ == "__main__":
    main()
