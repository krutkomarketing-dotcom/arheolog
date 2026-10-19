"""Скачивалка книг в библиотеку проекта.

Берёт записи из каталогов (dspace.jsonl, iaran.jsonl, seeds.jsonl),
скачивает PDF с паузами по хостам и ведёт library/catalog.jsonl:
метаданные для ГОСТ-ссылки, откуда скачано, sha256, число страниц,
есть ли текстовый слой, совпадает ли число страниц с выходными данными.

Запуск: python3 download.py LIBRARY_DIR CATALOG.jsonl [--only-arch]
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "ArchMapResearchBot/0.1 (non-commercial scholarly index)"
HOST_DELAY = {"history.by": 6.0}
DEFAULT_DELAY = 2.0
MAX_BYTES = 300 * 1024 * 1024
_last = {}


def polite_wait(host):
    d = HOST_DELAY.get(host, DEFAULT_DELAY)
    wait = _last.get(host, 0) + d - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()


def fetch(url, dest):
    host = urllib.parse.urlsplit(url).hostname
    for i in range(4):
        polite_wait(host)
        try:
            # кириллица в путях — экранируем, не трогая уже экранированное
            safe = urllib.parse.quote(url, safe=":/%?=&#+@,;")
            req = urllib.request.Request(safe, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r, \
                    open(dest + ".part", "wb") as f:
                n = 0
                while chunk := r.read(1 << 16):
                    n += len(chunk)
                    if n > MAX_BYTES:
                        raise IOError("слишком большой файл")
                    f.write(chunk)
            os.replace(dest + ".part", dest)
            return True, ""
        except Exception as e:
            err = str(e)
            time.sleep(10 * (i + 1))
    return False, err


def normalize(rec):
    """Приводит записи из разных каталогов к одному виду."""
    if "fields" in rec:  # DSpace
        f = rec["fields"]
        first = lambda k: (f.get(k) or [""])[0]
        return {
            "source": rec["repo_key"], "landing": rec["url"],
            "title": first("dc.title"),
            "authors": f.get("dc.contributor.author", []),
            "year": first("dc.date.issued")[:4],
            "citation": first("dc.identifier.citation"),
            "lang": first("dc.language.iso"),
            "pdfs": rec["pdfs"], "arch": rec.get("arch", "maybe"),
        }
    return {  # iaran / seeds уже в простом виде
        "source": rec.get("source", "seed"),
        "landing": rec.get("page") or rec.get("landing", ""),
        "title": rec.get("title", ""), "authors": rec.get("authors", []),
        "year": rec.get("year", ""), "citation": rec.get("citation", rec.get("title", "")),
        "lang": rec.get("lang", ""), "pdfs": rec.get("pdfs", []),
        "arch": rec.get("arch", "yes"),
    }


def expected_pages(citation):
    m = re.search(r"[СсCPр]\.\s*(\d+)\s*[–—-]\s*(\d+)", citation or "")
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if 0 < b - a < 2000:
            return b - a + 1
    return None


def inspect_pdf(path):
    import pymupdf
    d = pymupdf.open(path)
    n = len(d)
    sample = range(0, n, max(1, n // 20))
    chars = [len(d[i].get_text().strip()) for i in sample]
    text_ratio = sum(c > 200 for c in chars) / max(1, len(chars))
    return n, round(text_ratio, 2)


def main():
    lib, cat_in = sys.argv[1], sys.argv[2]
    only_arch = "--only-arch" in sys.argv
    os.makedirs(lib, exist_ok=True)
    # у каждого входного каталога свой журнал, чтобы параллельные
    # запуски не писали в один файл
    stem = os.path.splitext(os.path.basename(cat_in))[0]
    out_path = os.path.join(lib, f"catalog_{stem}.jsonl")
    done = set()
    hashes = {}
    if os.path.exists(out_path):
        for l in open(out_path, encoding="utf-8"):
            r = json.loads(l)
            done.add(r["pdf_url"])
            if r.get("sha256"):
                hashes[r["sha256"]] = r["file"]
    out = open(out_path, "a", encoding="utf-8")
    ok = fail = skip = 0
    for line in open(cat_in, encoding="utf-8"):
        rec = normalize(json.loads(line))
        if only_arch and rec["arch"] != "yes":
            continue
        for url in rec["pdfs"]:
            if url in done:
                skip += 1
                continue
            sub = os.path.join(lib, rec["source"])
            os.makedirs(sub, exist_ok=True)
            fname = hashlib.sha1(url.encode()).hexdigest()[:16] + ".pdf"
            dest = os.path.join(sub, fname)
            good, err = fetch(url, dest)
            row = dict(rec, pdf_url=url, file=None, ok=good, error=err)
            row.pop("pdfs", None)
            if good:
                with open(dest, "rb") as f:
                    head = f.read(5)
                if head != b"%PDF-":
                    os.remove(dest)
                    row.update(ok=False, error="не PDF (заглушка/HTML)")
                else:
                    sha = hashlib.sha256(open(dest, "rb").read()).hexdigest()
                    if sha in hashes:
                        os.remove(dest)
                        row.update(file=hashes[sha], sha256=sha, duplicate=True)
                    else:
                        try:
                            pages, tr = inspect_pdf(dest)
                        except Exception as e:
                            pages, tr = None, None
                            row["error"] = f"битый PDF: {e}"
                        exp = expected_pages(rec["citation"])
                        row.update(file=os.path.relpath(dest, lib), sha256=sha,
                                   pages=pages, text_layer=tr,
                                   expected_pages=exp,
                                   pages_mismatch=bool(exp and pages and
                                                       abs(exp - pages) > 1))
                        hashes[sha] = row["file"]
            ok += row["ok"]
            fail += not row["ok"]
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
            done.add(url)
    print(f"скачано {ok}, ошибок {fail}, уже было {skip}", file=sys.stderr)


if __name__ == "__main__":
    main()
