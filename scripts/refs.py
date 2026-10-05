#!/usr/bin/env python3
"""조문 속 다른 조문 언급("법 제10조", "「철도사업법」 제2조제5호", "별표 1의2")을 찾아 연결 대상으로 바꾼다.

python3 scripts/refs.py 로 실행하면 우리 6개 법령 밖의 법(철도사업법, 철도산업발전기본법 등)에서
언급된 조문만 law.go.kr 에서 받아 laws/참조조문.json 에 저장한다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 앱 법령 id 와 그 법령 안에서 쓰는 약칭
OWN = {
    "철도안전법": "act", "철도안전법시행령": "dec", "철도안전법시행규칙": "rule",
    "철도차량운전규칙": "car", "도시철도운전규칙": "metro",
}
ALIAS = {  # (지금 읽는 법령, 약칭) -> 대상 법령 이름
    ("dec", "법"): "철도안전법", ("rule", "법"): "철도안전법", ("rule", "영"): "철도안전법시행령",
}
GLOBAL_ALIAS = {"기본법": "철도산업발전기본법"}
NOT_ON_LAWGOKR = {"운전취급규정", "열차운전시행세칙"}

REF = re.compile(
    r"(?:「(?P<q>[^」]+)」(?:\s*\(이하[^)]*\))?\s*"
    r"|(?<![가-힣])(?P<al>같은\s*법|이\s*법|법|영|기본법|규정)\s*)?"
    r"제(?P<jo>\d+)조(?:의(?P<jo2>\d+))?(?:\s*제(?P<hang>\d+)항)?(?:\s*제(?P<ho>\d+)호(?:의(?P<ho2>\d+))?)?"
)
BYL = re.compile(r"별표\s*(\d+)(?:의\s*(\d+))?")


def norm_law(name):
    return re.sub(r"\s+", "", name)


def find_refs(lid, line, last_law=None):
    """한 줄에서 언급을 찾는다. 돌려주는 값: [(시작, 끝, 대상법령이름|None(같은 법령), 조, 항, 호)], 마지막으로 언급된 법령"""
    out = []
    for m in REF.finditer(line):
        q, al = m.group("q"), m.group("al")
        al = re.sub(r"\s+", "", al) if al else None
        if q:
            law = norm_law(q)
            last_law = law
        elif al in ("같은법",):
            law = last_law
        elif al in ("이법", None):
            law = None
        elif al in GLOBAL_ALIAS:
            law = GLOBAL_ALIAS[al]
            last_law = law
        elif (lid, al) in ALIAS:
            law = ALIAS[(lid, al)]
            last_law = law
        elif al == "규정":
            law = "운전취급규정"
        else:
            law = None
        jo = "제" + m.group("jo") + "조" + ("의" + m.group("jo2") if m.group("jo2") else "")
        ho = m.group("ho") + ("의" + m.group("ho2") if m.group("ho2") else "") if m.group("ho") else None
        if law and OWN.get(law) == lid:
            law = None
        out.append((m.start(), m.end(), law, jo, m.group("hang"), ho))
    return out, last_law


def external_needs():
    needs = {}
    names = list(OWN) + ["광역철도운전취급세칙"]
    for name in names:
        lid = OWN.get(name, "gw")
        d = json.loads((ROOT / "laws" / f"{name}.json").read_text(encoding="utf-8"))
        for a in d["articles"]:
            last = None
            for line in a["text"].split("\n"):
                refs, last = find_refs(lid, line, last)
                for _, _, law, jo, _, _ in refs:
                    if law and law not in OWN and law not in NOT_ON_LAWGOKR:
                        needs.setdefault(law, set()).add(jo)
    return needs


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from fetch_laws import BASE, clean, curl, parse_articles  # noqa: F401
    needs = external_needs()
    path = ROOT / "laws" / "참조조문.json"
    store = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for law, jos in sorted(needs.items()):
        have = store.get(law, {}).get("articles", {})
        if all(j in have for j in jos):
            continue
        try:
            landing = curl(f"{BASE}/법령/{law}")
            seq = re.search(r"lsiSeq=(\d+)", landing).group(1)
            efyd = re.search(r"efYd=(\d+)", landing).group(1)
            body = curl(f"{BASE}/LSW/lsInfoR.do",
                        data=f"lsiSeq={seq}&chrClsCd=010202&efYd={efyd}&ancYnChk=0&nwJoYnInfo=Y&efGubun=Y&vSct=*")
        except Exception as e:  # noqa: BLE001
            print(f"{law}: 받지 못함 ({e})")
            continue
        arts = {a["no"]: a for a in parse_articles(body)}
        title = clean(re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S).group(1)) if "<h2" in body else law
        got = {j: {"title": arts[j]["title"], "text": arts[j]["text"]} for j in jos if j in arts}
        store[law] = {"name": title, "efYd": efyd, "src": f"{BASE}/법령/{law}", "articles": {**have, **got}}
        print(f"{law}: {len(got)}/{len(jos)}개 조문")
        path.write_text(json.dumps(store, ensure_ascii=False, indent=1), encoding="utf-8")
    print("참조 법령", len(store))


if __name__ == "__main__":
    main()
