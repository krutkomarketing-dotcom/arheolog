"""Сбор ссылок на PDF с сайта Института истории НАН (history.by).

Обходит страницы серий (МАБ, ГАЗ) и годовые страницы публикаций,
собирает ссылки /wp-content/uploads/*.pdf с текстом ссылки.
Сайт рвёт соединения при частых запросах, поэтому пауза 6 с.
Запуск: python3 crawl_historyby.py data/historyby.jsonl
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "ArchMapResearchBot/0.1 (non-commercial scholarly index)"
BASE = "https://history.by"
PAGES = ["/mab/", "/en/mab/", "/gaz/", "/en/gaz/", "/vydanni/", "/publ/"] + \
    [f"/publ-{y}/" for y in range(2000, 2027)] + \
    [f"/en/publ-{y}/" for y in range(2000, 2027)]
ARCH = re.compile(
    r"archie|archeo|arheo|archae|МАБ|MAB|ГАЗ|GAZ|археал|археол|"
    r"zbornik|старажыт|starazhyt|kurhan|harad", re.I)


def get(url):
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(20 * (i + 1))
    return None


def main():
    out = open(sys.argv[1], "w", encoding="utf-8")
    seen = set()
    for p in PAGES:
        s = get(BASE + p)
        time.sleep(6)
        if not s:
            continue
        n = 0
        for href, text in re.findall(
                r'<a[^>]+href="([^"]+?\.pdf)"[^>]*>(.*?)</a>', s, re.S | re.I):
            url = urllib.parse.urljoin(BASE, href)
            if url in seen:
                continue
            seen.add(url)
            text = html.unescape(re.sub(r"<[^>]+>|\s+", " ", text)).strip()
            name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            rec = {"source": "historyby", "landing": BASE + p,
                   "title": text or name, "pdfs": [url],
                   "arch": "yes" if ARCH.search(name + " " + text + " " + p)
                   else "maybe"}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n += 1
        out.flush()
        print(f"{p}: +{n}", file=sys.stderr)


if __name__ == "__main__":
    main()
