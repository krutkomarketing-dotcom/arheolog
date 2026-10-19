"""Каталог электронной библиотеки ИА РАН (archaeolog.ru).

Для каждого раздела проходит страницы списка (?page=N), открывает
страницу выпуска и берёт заголовок (выходные данные) и ссылку на PDF.
Запуск: python3 catalog_iaran.py data/iaran.jsonl
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://archaeolog.ru"
SECTIONS = [
    "el-series/mia",           # Материалы и исследования по археологии СССР
    "el-series/arch-sssr",     # Археология СССР (20 т.)
    "el-periodical/ksia",      # Краткие сообщения ИИМК/ИА
    "el-periodical/sov-arch",  # Советская археология
    "el-periodical/ros-arch",  # Российская археология
    "el-periodical/arch-otkr", # Археологические открытия (2002+)
]
UA = "ArchMapResearchBot/0.1 (non-commercial scholarly index)"
DELAY = 1.0


def get(url):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if i == 2:
                print(f"  ! {url}: {e}", file=sys.stderr)
            time.sleep(4 * (i + 1))
    return None


def list_issues(sec):
    seen = []
    for page in range(1, 200):
        s = get(f"{BASE}/el-bib/el-cat/{sec}?page={page}")
        time.sleep(DELAY)
        if not s:
            break
        found = re.findall(rf"/el-bib/el-cat/{re.escape(sec)}/[a-z0-9_-]+", s)
        new = [f for f in dict.fromkeys(found) if f not in seen]
        if not new:
            break
        seen += new
    return seen


def issue_info(path):
    s = get(BASE + path)
    time.sleep(DELAY)
    if not s:
        return None
    title = re.search(r"<h1[^>]*>(.*?)</h1>", s, re.S)
    title = html.unescape(re.sub(r"<[^>]+>|\s+", " ", title.group(1))).strip() \
        if title else ""
    pdfs = [urllib.parse.urljoin(BASE, p) for p in dict.fromkeys(
        re.findall(r'href="([^"]+\.pdf)"', s, re.I))]
    return {"source": "iaran", "page": BASE + path, "title": title,
            "pdfs": pdfs}


def main():
    out = open(sys.argv[1] if len(sys.argv) > 1 else "data/iaran.jsonl",
               "w", encoding="utf-8")
    for sec in SECTIONS:
        issues = list_issues(sec)
        print(f"{sec}: {len(issues)}", file=sys.stderr)
        for p in issues:
            info = issue_info(p)
            if info:
                info["section"] = sec
                out.write(json.dumps(info, ensure_ascii=False) + "\n")
                out.flush()


if __name__ == "__main__":
    main()
