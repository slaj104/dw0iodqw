#!/usr/bin/env python3
"""laws/*.json 을 암기 웹앱용 데이터(app/data.json)로 정리한다.

개정 연혁 표시(<개정 ...>, [전문개정 ...] 등)를 걷어내고, 삭제된 조문은 뺀다.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAWS = [
    ("act", "철도안전법", "철도안전법"),
    ("dec", "철도안전법시행령", "시행령"),
    ("rule", "철도안전법시행규칙", "시행규칙"),
    ("car", "철도차량운전규칙", "철도차량운전규칙"),
    ("metro", "도시철도운전규칙", "도시철도운전규칙"),
]

NOTE = re.compile(r"<(?:개정|신설|삭제|본조신설|타법개정)[^>]*>|\[(?:전문개정|본조신설|제목개정|종전|시행일|제\d+조[^\]]*이동|단순위헌|헌법불합치)[^\]]*\]")

DELETED = re.compile(r"^\S*\s*삭제\s*(<[\d. ,]+>)?$")


def clean_line(s):
    s = NOTE.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    out = {"laws": []}
    for lid, fname, short in LAWS:
        d = json.loads((ROOT / "laws" / f"{fname}.json").read_text(encoding="utf-8"))
        arts = []
        for a in d["articles"]:
            lines = [clean_line(x) for x in a["text"].split("\n")]
            lines = [x for x in lines if x and not DELETED.match(x)]
            if not lines or lines[0].startswith("삭제"):
                continue
            arts.append([a["no"], a["title"], lines])
        out["laws"].append({"id": lid, "name": d["title"], "short": short,
                            "info": d["info"], "src": d["source"], "arts": arts})
        print(f"{short}: {len(arts)}개 조문")
    (ROOT / "app" / "data.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
