#!/usr/bin/env python3
"""laws/*.json 을 암기 웹앱용 데이터(app/data.json)로 정리한다.

- 개정 연혁 표시(<개정 ...>, [전문개정 ...] 등)를 걷어내고, 삭제된 조문·호는 뺀다.
- 철도안전법·시행령·시행규칙은 한 세트로 묶어, 법 조문 바로 뒤에 그 조문을 구체화한
  시행령·시행규칙 조문이 오게 단원을 만든다(법제처 3단 비교와 같은 순서).
- 조문 속 다른 조문 언급(법 제10조, 「철도사업법」 제2조제5호, 별표 1의2)을 연결 정보로 남긴다.
- 정의 조문에서 용어와 뜻을 뽑아 '용어 익히기' 단원을 만들고, 그 용어를 구체화한 하위 규정을 붙인다.
"""
import json
import re
import shutil
from pathlib import Path

from refs import BYL, OWN, find_refs

ROOT = Path(__file__).resolve().parent.parent
# (앱 id, 파일 이름, 짧은 이름)
LAWS = [
    ("act", "철도안전법", "철도안전법"),
    ("dec", "철도안전법시행령", "시행령"),
    ("rule", "철도안전법시행규칙", "시행규칙"),
    ("metro", "도시철도운전규칙", "도시철도운전규칙"),
    ("car", "철도차량운전규칙", "철도차량운전규칙"),
    ("gw", "광역철도운전취급세칙", "광역철도세칙"),
]
# 배우기 코스: (코스 id, 이름, 들어가는 법령) — 이 순서가 권하는 공부 순서다
COURSES = [
    ("set", "철도안전법령 (법·시행령·시행규칙)", ["act", "dec", "rule"]),
    ("metro", "도시철도운전규칙", ["metro"]),
    ("car", "철도차량운전규칙", ["car"]),
    ("gw", "광역철도 운전취급 세칙", ["gw"]),
]
UNIT_SIZE = 5       # 법령 하나짜리 코스: 단원당 조문 수
SET_UNIT_SIZE = 7   # 세트 코스: 단원당 조문 수(법+령+규칙 합계, 법 조문 하나에 딸린 묶음은 나누지 않는다)
TERMS_PER_UNIT = 6

NOTE = re.compile(r"<(?:개정|신설|삭제|본조신설|타법개정)[^>]*>|\[(?:전문개정|본조신설|제목개정|종전|시행일|제\d+조[^\]]*이동|단순위헌|헌법불합치)[^\]]*\]")
DELETED = re.compile(r"^\S*\s*삭제\s*(<[\d. ,]+>)?$")
DEF = re.compile(r"^(\d+(?:의\d+)?)\.\s*“([^”]+)”(?:이)?(?:란|라\s*함은|라고\s*함은)\s*(.+)$")


def clean_line(s):
    s = NOTE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def art_key(lid, no):
    """조문 번호를 ascii 문서 id로 바꾼다. 제10조의2 -> act-10-2"""
    return lid + "-" + "-".join(re.findall(r"\d+", no))


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


def line_refs(lid, lines, byl_keys):
    """[[줄, 시작, 끝, 대상, 조, 항, 호]] — 대상은 앱 법령 id, 'x:법령이름'(다른 법), 'b'(별표: 조 자리에 별표 key)"""
    out, last = [], None
    for li, ln in enumerate(lines):
        refs, last = find_refs(lid, ln, last)
        for s, e, law, jo, hang, ho in refs:
            if law is None:
                tgt = lid
            elif law in OWN:
                tgt = OWN[law]
            else:
                tgt = "x:" + law
            out.append([li, s, e, tgt, jo, hang or "", ho or ""])
        for m in BYL.finditer(ln):
            key = f"{lid}-b{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) else "")
            if key in byl_keys:
                out.append([li, m.start(), m.end(), "b", key, "", ""])
    return out


def main():
    out = {"laws": [], "courses": [], "units": [], "course": [], "figs": {}, "byl": {}, "ext": {}}
    imgdir = ROOT / "app" / "img"
    shutil.rmtree(imgdir, ignore_errors=True)
    imgdir.mkdir(parents=True)
    byl = json.loads((ROOT / "app" / "byl" / "index.json").read_text(encoding="utf-8"))
    out["byl"] = byl
    ext_path = ROOT / "laws" / "참조조문.json"
    ext = json.loads(ext_path.read_text(encoding="utf-8")) if ext_path.exists() else {}

    raw, arts_of, terms_of = {}, {}, {}
    for lid, fname, short in LAWS:
        d = json.loads((ROOT / "laws" / f"{fname}.json").read_text(encoding="utf-8"))
        raw[lid] = d
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
            refs = line_refs(lid, lines, byl)
            arts.append([a["no"], a["title"], lines, art_key(lid, a["no"]), a.get("pending", ""), refs])
            if a["title"] == "정의":
                for ln in lines:
                    m = DEF.match(ln)
                    if m:
                        terms.append({"ho": m.group(1), "term": m.group(2), "def": m.group(3), "art": idx})
                    elif terms and re.match(r"^[가-하]\.\s", ln) and terms[-1]["art"] == idx:
                        terms[-1]["def"] += "\n" + ln
            a["_idx"] = idx
        arts_of[lid], terms_of[lid] = arts, terms
        out["laws"].append({"id": lid, "name": d["title"], "short": short,
                            "info": d.get("info", ""), "src": d["source"], "arts": arts})

    # 다른 법 조문: 실제로 언급된 것만
    for L in out["laws"]:
        for art in L["arts"]:
            for r in art[5]:
                if r[3].startswith("x:"):
                    name = r[3][2:]
                    e = ext.get(name)
                    if e and r[4] in e["articles"]:
                        x = out["ext"].setdefault(name, {"name": e["name"], "src": e["src"], "arts": {}})
                        a = e["articles"][r[4]]
                        x["arts"][r[4]] = [a["title"], [clean_line(t) for t in a["text"].split("\n") if clean_line(t)]]

    # 받지 못한 다른 법(사내 규정 등)을 가리키는 연결은 버린다
    for L in out["laws"]:
        for art in L["arts"]:
            art[5] = [r for r in art[5] if not r[3].startswith("x:") or r[4] in out["ext"].get(r[3][2:], {}).get("arts", {})]

    # 시행령·시행규칙 조문이 어느 법 조문을 구체화하는지: 첫 줄에서 처음 언급한 법(또는 영) 조문
    by_no = {lid: {a[0]: i for i, a in enumerate(arts_of[lid])} for lid in arts_of}
    parent = {}  # (lid, idx) -> 법 idx

    def first_target(lid, art, want):
        for r in art[5]:
            if r[0] == 0 and r[3] == want and r[4] in by_no[want]:
                return by_no[want][r[4]], r[6]
        return None, None

    for lid in ("dec", "rule"):
        prev = 0
        for i, art in enumerate(arts_of[lid]):
            p, _ = first_target(lid, art, "act")
            if p is None and lid == "rule":
                q, _ = first_target(lid, art, "dec")
                if q is not None:
                    p = parent.get(("dec", q))
            if p is None:
                p = prev
            parent[(lid, i)] = p
            prev = p
    children = {}
    for (lid, i), p in parent.items():
        children.setdefault(p, []).append((lid, i))
    for p in children:
        children[p].sort(key=lambda x: (0 if x[0] == "dec" else 1, x[1]))

    # 용어: 법 제2조 N호를 구체화한 하위 규정(예: 운행장애 -> 시행규칙 제1조의4)
    def term_links(lid, t):
        links = []
        for sub in ("dec", "rule") if lid == "act" else ():
            for i, art in enumerate(arts_of[sub]):
                for r in art[5]:
                    if r[0] == 0 and r[3] == "act" and r[4] == arts_of["act"][t["art"]][0] and r[6] == t["ho"]:
                        links.append([sub, i])
                        break
        return links

    def term_units(cid, lids):
        terms = []
        for lid in lids:
            for t in terms_of[lid]:
                lines = t["def"].split("\n")
                terms.append([t["term"], t["def"], lid, t["art"], line_refs(lid, lines, byl), term_links(lid, t)])
        units = []
        for i, grp in enumerate(chunks(terms, TERMS_PER_UNIT) if terms else []):
            units.append({"id": f"{cid}-t{i + 1}", "course": cid, "kind": "terms",
                          "title": f"용어 익히기 {i + 1}", "sub": " · ".join(t[0] for t in grp), "terms": grp})
        return units

    def label(items):
        first, last = items[0], items[-1]
        f = arts_of[first[0]][first[1]][0]
        l_ = arts_of[last[0]][last[1]][0]
        return f if (first == last) else f"{f}~{l_}"

    for cid, cname, lids in COURSES:
        units = term_units(cid, lids)
        main_lid = lids[0]
        d = raw[main_lid]
        # 장·절별로 법 조문을 모은다
        groups, key = [], None
        for a in d["articles"]:
            if "_idx" not in a:
                continue
            k = (a.get("chapter", ""), a.get("section", ""))
            if k != key:
                groups.append((k, []))
                key = k
            groups[-1][1].append(a["_idx"])
        n = 0
        for (ch, sec), idxs in groups:
            if cid == "set":
                blocks = [[(main_lid, i)] + children.get(i, []) for i in idxs]
                parts, cur = [], []
                for b in blocks:
                    if cur and len(cur) + len(b) > SET_UNIT_SIZE:
                        parts.append(cur)
                        cur = []
                    cur = cur + b
                if cur:
                    parts.append(cur)
            else:
                parts = [[(main_lid, i) for i in p] for p in chunks(idxs, UNIT_SIZE)]
            for j, part in enumerate(parts):
                n += 1
                title = sec.split(" · ")[0] if sec else ch
                title = re.sub(r"^제\d+(장|절)\s*", "", title) or arts_of[part[0][0]][part[0][1]][1]
                if len(parts) > 1:
                    title += f" ({j + 1}/{len(parts)})"
                mains = [x for x in part if x[0] == main_lid]
                sub = (ch + " · " if ch and sec else "") + "법 " * (cid == "set") + label(mains)
                if cid == "set":
                    nd = sum(1 for x in part if x[0] == "dec")
                    nr = sum(1 for x in part if x[0] == "rule")
                    sub += (f" · 시행령 {nd}" if nd else "") + (f" · 시행규칙 {nr}" if nr else "")
                units.append({"id": f"{cid}-u{n}", "course": cid, "kind": "arts", "title": title, "sub": sub,
                              "items": [list(x) for x in part]})
        out["courses"].append({"id": cid, "name": cname, "laws": lids})
        out["units"] += units
        out["course"] += [u["id"] for u in units]
        na = sum(len(u.get("items", [])) for u in units)
        print(f"{cname}: 단원 {len(units)}개, 조문 {na}개, 용어 {sum(len(u.get('terms', [])) for u in units)}개")

    # 모든 조문이 어느 단원엔가 정확히 한 번 들어갔는지 확인
    seen = {}
    for u in out["units"]:
        for lid, i in u.get("items", []):
            seen[(lid, i)] = seen.get((lid, i), 0) + 1
    total = sum(len(a) for a in arts_of.values())
    assert len(seen) == total and all(v == 1 for v in seen.values()), (len(seen), total)
    (ROOT / "app" / "data.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("전체 단원", len(out["units"]), "· 조문", total, "· 다른 법 조문", sum(len(x["arts"]) for x in out["ext"].values()))


if __name__ == "__main__":
    main()
