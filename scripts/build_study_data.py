#!/usr/bin/env python3
"""laws/*.json 을 암기 웹앱용 데이터(app/data.json)로 정리한다.

- 개정 연혁 표시(<개정 ...>, [전문개정 ...] 등)를 걷어내고, 삭제된 조문·호는 뺀다.
- 처음 공부하는 사람이 순서대로 따라갈 수 있게 단원(장·절 기준, 5조문 이하)을 만든다.
- 정의 조문에서 용어와 뜻을 뽑아 '용어 익히기' 단원을 만든다.
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# (앱 id, 파일 이름, 짧은 이름) — 아래 순서가 처음 공부하는 사람에게 권하는 코스 순서다
LAWS = [
    ("act", "철도안전법", "철도안전법"),
    ("metro", "도시철도운전규칙", "도시철도운전규칙"),
    ("car", "철도차량운전규칙", "철도차량운전규칙"),
    ("gw", "광역철도운전취급세칙", "광역철도세칙"),
    ("dec", "철도안전법시행령", "시행령"),
    ("rule", "철도안전법시행규칙", "시행규칙"),
]
UNIT_SIZE = 5
TERMS_PER_UNIT = 6

NOTE = re.compile(r"<(?:개정|신설|삭제|본조신설|타법개정)[^>]*>|\[(?:전문개정|본조신설|제목개정|종전|시행일|제\d+조[^\]]*이동|단순위헌|헌법불합치)[^\]]*\]")
DELETED = re.compile(r"^\S*\s*삭제\s*(<[\d. ,]+>)?$")
DEF = re.compile(r"^\d+(?:의\d+)?\.\s*“([^”]+)”(?:이)?(?:란|라\s*함은|라고\s*함은)\s*(.+)$")


def clean_line(s):
    s = NOTE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def art_key(lid, no):
    """조문 번호를 ascii 문서 id로 바꾼다. 제10조의2 -> act-10-2"""
    nums = re.findall(r"\d+", no)
    return lid + "-" + "-".join(nums)


def chunks(items, size):
    """items 를 size 이하 크기로, 서로 크기 차이가 1 이하가 되게 나눈다."""
    n = max(1, -(-len(items) // size))
    q, r = divmod(len(items), n)
    out, i = [], 0
    for k in range(n):
        step = q + (1 if k < r else 0)
        out.append(items[i:i + step])
        i += step
    return out


def main():
    out = {"laws": [], "units": [], "course": [], "figs": {}}
    imgdir = ROOT / "app" / "img"
    shutil.rmtree(imgdir, ignore_errors=True)
    imgdir.mkdir(parents=True)
    for lid, fname, short in LAWS:
        d = json.loads((ROOT / "laws" / f"{fname}.json").read_text(encoding="utf-8"))
        for seq, f in d.get("figs", {}).items():
            src = ROOT / "laws" / f["file"]
            shutil.copy(src, imgdir / src.name)
            out["figs"][seq] = {"src": f"img/{src.name}", "alt": f["alt"]}
        arts, terms = [], []
        for a in d["articles"]:
            lines = [clean_line(x) for x in a["text"].split("\n")]
            lines = [x for x in lines if x and not DELETED.match(x)]
            if not lines or lines[0].startswith("삭제"):
                continue
            idx = len(arts)
            arts.append([a["no"], a["title"], lines, art_key(lid, a["no"]), a.get("pending", "")])
            if a["title"] == "정의":
                for ln in lines:
                    m = DEF.match(ln)
                    if m:
                        terms.append([m.group(1), m.group(2), idx])
                    elif terms and re.match(r"^[가-하]\.\s", ln) and terms[-1][2] == idx:
                        terms[-1][1] += " " + ln
            a["_idx"] = idx
        out["laws"].append({"id": lid, "name": d["title"], "short": short,
                            "info": d.get("info", ""), "src": d["source"], "arts": arts})

        # 용어 단원
        for i, grp in enumerate(chunks(terms, TERMS_PER_UNIT) if terms else []):
            uid = f"{lid}-t{i + 1}"
            out["units"].append({"id": uid, "law": lid, "kind": "terms",
                                 "title": f"용어 익히기 {i + 1}", "sub": " · ".join(t[0] for t in grp), "terms": grp})
            out["course"].append(uid)

        # 조문 단원: 장·절이 같은 조문끼리 묶고, 5개가 넘으면 나눈다
        groups, key = [], None
        for a in d["articles"]:
            if "_idx" not in a:
                continue
            k = (a.get("chapter", ""), a.get("section", ""))
            if not k[0]:
                k = ("", "")
            if k != key or (not k[0] and len(groups[-1][1]) >= UNIT_SIZE):
                groups.append((k, []))
                key = k
            groups[-1][1].append(a["_idx"])
        n = 0
        for (ch, sec), idxs in groups:
            parts = chunks(idxs, UNIT_SIZE)
            for j, part in enumerate(parts):
                n += 1
                first, last = arts[part[0]][0], arts[part[-1]][0]
                rng = first if first == last else f"{first}~{last}"
                title = sec.split(" · ")[0] if sec else ch
                title = re.sub(r"^제\d+(장|절)\s*", "", title) or arts[part[0]][1]
                if len(parts) > 1:
                    title += f" ({j + 1}/{len(parts)})"
                sub = (ch + " · " if ch and sec else "") + rng
                out["units"].append({"id": f"{lid}-u{n}", "law": lid, "kind": "arts", "title": title, "sub": sub, "arts": part})
                out["course"].append(f"{lid}-u{n}")
        print(f"{short}: 조문 {len(arts)}개, 용어 {len(terms)}개, 단원 {n}개")
    (ROOT / "app" / "data.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("전체 단원", len(out["units"]))


if __name__ == "__main__":
    main()
