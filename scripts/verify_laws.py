#!/usr/bin/env python3
"""저장된 laws/*.json 이 국가법령정보센터 현행 원문과 글자 단위로 같은지 검사한다.

원문 HTML의 조문 문단(<p>)을 하나씩 꺼내 공백을 뺀 뒤 저장본에 그대로 들어 있는지 본다.
삭제된 조문("제N조 삭제 <날짜>")은 일부러 뺐으므로 따로 센다.
"""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_laws import BASE, INLINE_GLYPHS, LAWS, OUT, curl  # noqa: E402


def norm(s):
    return re.sub(r"\s+", "", html.unescape(s).replace("\xa0", " "))


def main():
    bad = 0
    for name in sys.argv[1:] or LAWS:
        data = json.loads((OUT / f"{name}.json").read_text(encoding="utf-8"))
        body = curl(f"{BASE}/LSW/lsInfoR.do",
                    data=f"lsiSeq={data['lsiSeq']}&chrClsCd=010202&efYd={data['efYd']}&ancYnChk=0&nwJoYnInfo=Y&efGubun=Y&vSct=*")
        body = re.sub(r"<script.*?</script>", "", body, flags=re.S)
        end = body.find("<!-- 부칙 영역")
        body = body[:end if end > 0 else len(body)]
        saved = norm(re.sub(r"\{\{그림:\d+\}\}", "", "".join(a["no"] + "(" + a["title"] + ")" + a["text"] for a in data["articles"])))
        heads = {norm(a.get(k, "")) for a in data["articles"] for k in ("chapter", "section")} - {""}
        figs = set(data.get("figs", {}))
        missing, deleted, total = [], 0, 0
        for block in re.split(r'<div class="pgroup"[^>]*>', body)[1:]:
            for p in re.findall(r"<p[^>]*>(.*?)</p>", block, re.S):
                for seq in re.findall(r"flDownload\.do\?flSeq=(\d+)", p):
                    if seq not in figs and seq not in INLINE_GLYPHS:
                        missing.append(f"그림 {seq}")
                p = re.sub(r'<img[^>]*flSeq=(\d+)[^>]*>', lambda m: INLINE_GLYPHS.get(m.group(1), ""), p)
                t = norm(re.sub(r"<[^>]+>", "", p))
                if not t:
                    continue
                total += len(t)
                t = re.sub(r"\[시행일:[^\]]*\]제\d+조(의\d+)?$", "", t)
                if re.fullmatch(r"제\d+조(의\d+)?삭제<[^>]*>", t):
                    deleted += 1
                elif t and t not in saved and not any(t.startswith(h) for h in heads):
                    missing.append(t[:120])
        status = "일치" if not missing else f"빠진 문단 {len(missing)}개"
        print(f"{name}: 원문 {total}자 · 삭제 조문 {deleted}개 제외 · 그림 {len(figs)}개 · {status}")
        for m in missing:
            print("   ", m)
        bad += len(missing)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
