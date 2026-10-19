"""Харвестер DSpace-репозиториев белорусских вузов.

Ищет по ключевым словам через simple-search, по каждому найденному
handle забирает полную карточку (?mode=full): поля dc.* и ссылки на PDF.
Каждый хост обходится в своём потоке, с паузой между запросами.

Запуск: python3 harvest_dspace.py data/dspace.jsonl
"""
import concurrent.futures as cf
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

REPOS = {
    "msu": "https://libr.msu.by",       # МГУ им. Кулешова
    "psu": "https://elib.psu.by",       # Полоцкий ГУ
    "bsu": "https://elib.bsu.by",       # БГУ
    "gsu": "https://elib.gsu.by",       # Гомельский ГУ
    "brsu": "https://rep.brsu.by",      # Брестский ГУ
    "polessu": "https://rep.polessu.by",  # Полесский ГУ
}

QUERIES = [
    "археолог*", "археалаг*", "археалог*", "гарадзішч*", "городищ*",
    "курган*", "могільнік*", "могильник*", "селішч*", "селищ*",
    "стаянк*", "раскоп*", "нумізмат*", "кераміка*",
]

DELAY = 1.2
RPP = 100
UA = "ArchMapResearchBot/0.1 (non-commercial scholarly index)"

# Признаки «точно археология»
ARCH_SUBJ = re.compile(r"археолог|археалог|археалаг|нумізмат|нумизмат", re.I)
ARCH_UDC = re.compile(r"^\s*90[234]")
ARCH_SERIES = re.compile(
    r"Матэрыялы па археалогіі|Археалогія Беларусі|Гістарычна-археалагічны|"
    r"Археологические открытия|Acta archaeologica|Беларускія старажытнасці|"
    r"Белорусские древности|Археалогія і нумізматыка", re.I)
SITE_WORDS = re.compile(
    r"гарадзішч|городищ|курган|могільнік|могильник|селішч|селищ|стаянк|"
    r"стоянк|раскоп|замчышч|замчищ|паселішч|поселени", re.I)


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # сеть рвётся — ждём и пробуем ещё
            if i == tries - 1:
                print(f"  ! {url}: {e}", file=sys.stderr)
                return None
            time.sleep(5 * (i + 1))


def search_handles(base):
    handles = set()
    for q in QUERIES:
        start = 0
        while True:
            url = (f"{base}/simple-search?query={urllib.parse.quote(q)}"
                   f"&rpp={RPP}&start={start}")
            page = get(url)
            time.sleep(DELAY)
            if not page:
                break
            found = set(re.findall(r'href="/handle/(\d+/\d+)"', page))
            new = found - handles
            handles |= found
            total = re.search(r"(?:of|из)\s+(\d+)", page)
            total = int(total.group(1)) if total else 0
            start += RPP
            if not new or start >= total:
                break
    return handles


def parse_item(base, handle, page):
    fields = {}
    for name, val in re.findall(
            r'<td[^>]*class="metadataFieldLabel[^"]*"[^>]*>(dc\.[\w.]+)'
            r'.*?<td[^>]*class="metadataFieldValue[^"]*"[^>]*>(.*?)</td>',
            page, re.S):
        val = html.unescape(re.sub(r"<[^>]+>", " ", val)).strip()
        val = re.sub(r"\s+", " ", val)
        fields.setdefault(name, []).append(val)
    pdfs = sorted(set(
        urllib.parse.urljoin(base, h) for h in re.findall(
            r'href="(/bitstream/[^"]+?\.pdf)(?:\?[^"]*)?"', page, re.I)))
    return {"repo": base, "handle": handle, "url": f"{base}/handle/{handle}",
            "fields": fields, "pdfs": pdfs}


def classify(rec):
    f = rec["fields"]
    text = " ".join(" ".join(v) for v in f.values())
    subj = " ".join(f.get("dc.subject", []))
    udc = f.get("dc.identifier.udc", [""])[0]
    title = " ".join(f.get("dc.title", []))
    reasons = []
    if ARCH_SUBJ.search(subj):
        reasons.append("subject")
    if ARCH_UDC.search(udc):
        reasons.append("udc")
    if ARCH_SERIES.search(text):
        reasons.append("series")
    if SITE_WORDS.search(title):
        reasons.append("title")
    rec["arch_reasons"] = reasons
    rec["arch"] = "yes" if reasons else "maybe"
    return rec


def harvest_repo(key, base, out_lock, out):
    t0 = time.time()
    handles = search_handles(base)
    print(f"[{key}] найдено handle: {len(handles)}", file=sys.stderr)
    n = 0
    for h in sorted(handles):
        page = get(f"{base}/handle/{h}?mode=full")
        time.sleep(DELAY)
        if not page:
            continue
        rec = classify(parse_item(base, h, page))
        rec["repo_key"] = key
        with out_lock:
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
        n += 1
    print(f"[{key}] готово: {n} карточек за {time.time()-t0:.0f} с",
          file=sys.stderr)
    return key, n


def main():
    import threading
    path = sys.argv[1] if len(sys.argv) > 1 else "data/dspace.jsonl"
    only = sys.argv[2].split(",") if len(sys.argv) > 2 else list(REPOS)
    lock = threading.Lock()
    with open(path, "a", encoding="utf-8") as out, \
            cf.ThreadPoolExecutor(len(only)) as ex:
        futs = [ex.submit(harvest_repo, k, REPOS[k], lock, out) for k in only]
        for f in cf.as_completed(futs):
            print("done", f.result(), file=sys.stderr)


if __name__ == "__main__":
    main()
