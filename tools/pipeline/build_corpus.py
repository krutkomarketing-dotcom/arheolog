"""Издания, страницы и упоминания памятников для прототипа.

1. Отбирает издания с текстовым слоем (каталог Поболя, монографии, МАБ, статьи
   из репозиториев) и извлекает постраничный текст с печатными номерами.
2. Для каждого памятника ищет его деревню (рус. и бел. написания из GeoNames)
   рядом со словом-типом памятника; упоминание засчитывается, если на странице
   есть и район, или название редкое (одно на весь каталог).
3. Страницы с упоминаниями упаковываются в пачки: текст + скан (JPEG) +
   прямоугольники подсветки найденного слова.

Запуск: python3 build_corpus.py out/sites_full.json site/
"""
import base64
import collections
import hashlib
import io
import json
import os
import re
import sys

import pymupdf

sys.path.insert(0, "/home/claude/arch/src")
import extract_text  # noqa: E402

ARCH = "/home/claude/arch"
BUNDLE = 20          # страниц в одном файле
IMG_W = 820         # ширина скана, px
MAX_MENTIONS_PER_BOOK = 2
MIN_CONF = 0.75

NORM = str.maketrans("ёіўэЁІЎЭ", "еиуеЕИУЕ")
TYPE_WORDS = r"городищ|гарадзішч|гарадзищ|курган|селищ|селішч|селиш|могильн|могільн|могилн|стоянк|стаянк|поселени|паселішч|замчищ|замчышч|клад|скарб|находк|знаходк"
TYPE_OF_WORD = [("hillfort", r"городищ|гарадзі?ш|замчи|замчы"), ("barrow", r"курган"),
                ("settlement", r"селищ|селішч|селиш|поселени|паселі"), ("camp", r"стоянк|стаянк"),
                ("cemetery", r"могил|могіл"), ("stray_find", r"клад|скарб|находк|знаходк")]


def norm(t):
    """Нормализация 1:1 по символам — смещения в тексте не меняются."""
    return t.translate(NORM).lower()


def stem(word):
    w = norm(word)
    w = re.sub(r"[^а-я\- ]", "", w).strip()
    if len(w) < 4:
        return None
    last = w.split(" ")[-1]
    cut = 2 if len(last) >= 7 else 1 if len(last) >= 5 else 0
    return w[: len(w) - cut] if cut else w


def gost(pub, page_label=None):
    """ГОСТ Р 7.0.100–2018, упрощённо."""
    if pub.get("citation_raw"):
        base = re.sub(r"\s*[–-]\s*С\.\s*\d+\s*[–-]\s*\d+\.?\s*$", "", pub["citation_raw"]).rstrip(". ")
        pages = re.search(r"С\.\s*\d+\s*[–-]\s*\d+", pub["citation_raw"])
        tail = f". – {pages.group(0)}" if pages else ""
        return f"{base}{tail}." + (f" – С. {page_label}." if page_label and not pages else "")
    a = pub["authors"]
    s = f"{a.split(',')[0] if a else ''} {pub['title']}"
    if a:
        s = f"{a}. {pub['title']}"
    s += f" / {pub['authorsShort']}" if pub.get("authorsShort") else ""
    s += f". – {pub['place']} : {pub['publisher']}, {pub['year']}."
    if pub.get("pagesTotal"):
        s += f" – {pub['pagesTotal']} с."
    if page_label:
        s += f" – С. {page_label}."
    return s


def publications():
    pubs = []

    def add(**kw):
        kw["id"] = len(pubs) + 1
        pubs.append(kw)
        return kw

    add(key="pobol1983", file=f"{ARCH}/library/user/Pobol1983.pdf", authors="Поболь, Л. Д.",
        authorsShort="Л. Д. Поболь", title="Археологические памятники Белоруссии : Железный век",
        place="Минск", publisher="Наука и техника", year=1983, pagesTotal=456, lang="ru",
        scanSource="скан из библиотеки проекта", kind="catalog", offset=1)
    add(key="shadyro1985", file=f"{ARCH}/library/user/Shadyro1985.pdf", authors="Шадыро, В. И.",
        authorsShort="В. И. Шадыро ; под ред. А. Г. Митрофанова",
        title="Ранний железный век северной Белоруссии", place="Минск", publisher="Наука и техника",
        year=1985, pagesTotal=126, lang="ru", scanSource="скан из библиотеки проекта", kind="monograph")
    add(key="zviaruha2005", file="/home/claude/books/zv.pdf", authors="Звяруга, Я. Г.",
        authorsShort="Я. Г. Звяруга",
        title="Беларускае Павілле ў жалезным веку і раннім сярэднявякоўі (Матэрыялы па археалогіі Беларусі. Вып. 10)",
        place="Мінск", publisher="Інстытут гісторыі НАН Беларусі", year=2005, pagesTotal=176, lang="be",
        scanSource="knihi.com", kind="monograph")
    # МАБ и монографии ИА РАН с текстовым слоем
    for f, src in (("catalog_hb_books.jsonl", "history.by"), ("catalog_seeds.jsonl", "archaeolog.ru")):
        for l in open(f"{ARCH}/library/{f}", encoding="utf-8"):
            r = json.loads(l)
            if not r.get("file") or r.get("duplicate") or (r.get("pages") or 0) < 40 or (r.get("text_layer") or 0) < 0.5:
                continue
            if "Звяруга" in r["title"] or "Смоленской" in r["title"]:
                continue
            t = r["title"]
            m = re.match(r"(.+?)\s*/\s*(?:Отв\.\s*ред\.|Под\s*ред\.)\s*([^.]+?\.\s*[^.]+?\.\s*[А-ЯЁ][а-яё]+)", t)
            year = re.search(r"\b(19\d\d|20\d\d)\b", t)
            mab = re.search(r"Вып\. (\d+)", t)
            if "Матэрыялы па археалогіі" in t:
                yr = {23: 2012, 24: 2013, 25: 2014}.get(int(mab.group(1)) if mab else 0)
                add(key=f"mab{mab.group(1) if mab else ''}", file=f"{ARCH}/library/{r['file']}", authors="",
                    title=f"Матэрыялы па археалогіі Беларусі. Вып. {mab.group(1) if mab else '?'}",
                    place="Мінск", publisher="Беларуская навука", year=yr, pagesTotal=r["pages"], lang="be",
                    scanSource="history.by (Институт истории НАН Беларуси)", kind="collection")
            else:
                ed = re.match(r"^([А-ЯЁ][а-яё]+ [А-ЯЁ]\.[А-ЯЁ]\.)\s*(.+?)\.\s*(М\.|Л\.)", t)
                authors = ""
                title = t.split(" М.:")[0].split(" М.;")[0].split(" Л.:")[0]
                if ed:
                    fam, ini = ed.group(1).split(" ")
                    authors = f"{fam}, {ini[:2]} {ini[2:]}".strip()
                    title = ed.group(2)
                add(key="ia-" + hashlib.sha1(r["file"].encode()).hexdigest()[:8], file=f"{ARCH}/library/{r['file']}",
                    authors=authors, title=title.strip(" ."), place="Москва",
                    publisher="Наука" if "Наука" in t else "Изд-во АН СССР",
                    year=int(year.group(1)) if year else None, pagesTotal=r["pages"], lang="ru",
                    scanSource=src, kind="monograph", citation_raw=None, fullTitle=t)
    # статьи из репозиториев вузов
    for f in sorted(os.listdir(f"{ARCH}/library")):
        if not f.startswith("catalog_dspace"):
            continue
        for l in open(f"{ARCH}/library/{f}", encoding="utf-8"):
            r = json.loads(l)
            if not r.get("file") or r.get("duplicate") or (r.get("text_layer") or 0) < 0.5 or not r.get("pages"):
                continue
            add(key=f"ds-{hashlib.sha1(r['pdf_url'].encode()).hexdigest()[:8]}", file=f"{ARCH}/library/{r['file']}",
                authors="; ".join(r.get("authors") or []), title=r["title"], place="", publisher="",
                year=int(r["year"]) if str(r.get("year", "")).isdigit() else None,
                pagesTotal=r["pages"], lang=r.get("lang") or "", scanSource=r["landing"],
                kind="article", citation_raw=r.get("citation") or None)
    return pubs


def page_texts(pub):
    out = f"/home/claude/proto/out/text/{pub['key']}.pages.jsonl"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if not os.path.exists(out):
        extract_text.process(pub["file"], out)
    pages = [json.loads(l) for l in open(out, encoding="utf-8")]
    if pub.get("offset") is not None:  # у Поболя печатный номер = страница PDF − 1
        for p in pages:
            p["printed_page"] = p["pdf_page"] - pub["offset"]
    return pages


def snippet(text, a, b, width=260):
    s = max(0, a - width // 2)
    e = min(len(text), b + width // 2)
    if s > 0:
        sp = text.find(" ", s)
        s = sp + 1 if 0 <= sp < a else s
    if e < len(text):
        sp = text.rfind(" ", b, e)
        e = sp if sp > b else e
    frag = text[s:e]
    pre = "…" if s > 0 else ""
    post = "…" if e < len(text) else ""
    return pre + frag + post, a - s + len(pre), b - s + len(pre)


def site_needles(site):
    names = set(site.get("gazetteerNames") or [])
    base = re.sub(r"\s*\([^)]*\)", "", site["placeName"]).split(" — ")[0]
    names.add(base)
    out = []
    for n in names:
        st = stem(n)
        if st and len(st) >= 4:
            out.append(st)
    return sorted(set(out), key=len, reverse=True)


def main():
    sites_path, site_dir = sys.argv[1], sys.argv[2]
    no_scans = "--no-scans" in sys.argv
    sites = json.load(open(sites_path, encoding="utf-8"))
    pubs = publications()
    print("изданий:", len(pubs), file=sys.stderr)

    texts = {}
    for p in pubs:
        try:
            texts[p["id"]] = page_texts(p)
        except Exception as e:
            print("  ! текст", p["key"], e, file=sys.stderr)
    pubs = [p for p in pubs if p["id"] in texts]

    # частота ключа названия по каталогу: редкие названия можно ловить без района
    name_freq = collections.Counter(stem(re.sub(r"\s*\([^)]*\)", "", s["placeName"]).split(" — ")[0]) for s in sites)
    mentions = []

    # 1) каталог Поболя: каждая запись — упоминание на своей странице
    pob = next(p for p in pubs if p["key"] == "pobol1983")
    pob_pages = {pg["printed_page"]: pg for pg in texts[pob["id"]]}
    for s in sites:
        pg = pob_pages.get(s["catalog"]["page"])
        if not pg:
            continue
        txt = pg["text"]
        nt = norm(txt)
        hit = None
        # в каталоге заголовок записи набран капслоком: «312 (185). СТОРОЖЕВЦЫ (I)»
        for nd in site_needles(s) + [norm(s["placeName"][:5])]:
            for mm in re.finditer(re.escape(nd), nt):
                i = mm.start()
                if txt[i:i + 2].isupper():
                    hit = (i, i + len(nd))
                    break
            if hit:
                break
        if not hit:
            num = re.search(rf"(?<!\d){s['catalog']['num']}\s*[.,(]", txt)
            if num:
                hit = (num.start(), num.start() + len(str(s['catalog']['num'])))
        if hit:
            # расширяем до конца слова
            b = hit[1]
            while b < len(txt) and txt[b].isalpha():
                b += 1
            sn, ha, hb = snippet(txt, hit[0], b)
        else:
            sn, ha, hb = (s["description"][:260] + "…"), 0, 0
        mentions.append({"siteId": s["id"], "publicationId": pob["id"], "pdfPage": pg["pdf_page"],
                         "page": s["catalog"]["page"], "snippet": sn, "hit": [ha, hb],
                         "word": txt[hit[0]:b] if hit else None,
                         "confidence": 1.0, "verified": True, "source": "catalog"})

    # 2) остальные издания: деревня рядом со словом-типом
    raion_stems = {}
    for s in sites:
        r = s["region"]["raion"].replace(" р-н", "")
        raion_stems[s["id"]] = norm(r)[:5]
    needle_index = collections.defaultdict(list)
    for s in sites:
        if not s.get("coords"):
            continue
        for nd in site_needles(s):
            needle_index[nd].append(s)
    big_rx = re.compile(r"(?<![а-я])(" + "|".join(re.escape(n) for n in sorted(needle_index, key=len, reverse=True)) + r")[а-я]{0,4}(?![а-я])")
    type_rx = re.compile(TYPE_WORDS)
    per_book = collections.Counter()
    for p in pubs:
        if p["key"] == "pobol1983" or "--catalog-only" in sys.argv:
            continue
        for pg in texts[p["id"]]:
            txt = pg["text"]
            if len(txt) < 200:
                continue
            nt = norm(txt)
            for m in big_rx.finditer(nt):
                nd = m.group(1)
                a, b = m.start(), m.end()
                window = nt[max(0, a - 220): b + 220]
                tw = type_rx.search(window)
                if not tw:
                    continue
                if not txt[a:a + 1].isupper():
                    continue  # название деревни — с заглавной; «глубокой», «столбиками» отсекаем
                for s in needle_index[nd]:
                    if per_book[(s["id"], p["id"])] >= MAX_MENTIONS_PER_BOOK:
                        continue
                    if raion_stems[s["id"]][:4] == nd[:4]:
                        continue  # Могилёв в Могилёвском р-не: город упоминается повсюду
                    if re.match(r"(город|горад|селищ|замок|замак|курган|слобод|глубок|красн|нов|стар|больш|мал)", nd):
                        continue  # нарицательные и слишком частые названия
                    rs = raion_stems[s["id"]]
                    has_raion = rs in nt
                    rare = name_freq.get(stem(re.sub(r"\s*\([^)]*\)", "", s["placeName"]).split(" — ")[0]), 0) <= 1 and len(nd) >= 6
                    if not has_raion:
                        continue
                    same_type = any(t == s["type"] and re.search(rx, tw.group(0)) for t, rx in TYPE_OF_WORD)
                    conf = 0.55 + 0.2 * has_raion + 0.1 * same_type + 0.05 * (len(nd) >= 7)
                    if conf < MIN_CONF:
                        continue
                    sn, ha, hb = snippet(txt, a, b)
                    key_ = (s["id"], p["id"], pg["pdf_page"])
                    if any((x["siteId"], x["publicationId"], x["pdfPage"]) == key_ for x in mentions[-50:]):
                        continue
                    per_book[(s["id"], p["id"])] += 1
                    mentions.append({"siteId": s["id"], "publicationId": p["id"], "pdfPage": pg["pdf_page"],
                                     "page": pg["printed_page"] or pg["pdf_page"], "snippet": sn, "hit": [ha, hb],
                                     "word": txt[a:b], "confidence": round(min(conf, 0.92), 2),
                                     "verified": False, "source": "auto"})
    for i, m in enumerate(mentions):
        m["id"] = i + 1
    print("упоминаний:", len(mentions), collections.Counter(m["source"] for m in mentions), file=sys.stderr)
    print("памятников с упоминаниями вне каталога:", len({m["siteId"] for m in mentions if m["source"] == "auto"}), file=sys.stderr)

    # 3) пачки страниц: только страницы с упоминаниями
    need = collections.defaultdict(set)
    for m in mentions:
        need[m["publicationId"]].add(m["pdfPage"])
    os.makedirs(f"{site_dir}/pages", exist_ok=True)
    page_index = {}
    total_img = 0
    for p in pubs:
        pages = sorted(need.get(p["id"], []))
        if not pages:
            continue
        doc = pymupdf.open(p["file"])
        tmap = {pg["pdf_page"]: pg for pg in texts[p["id"]]}
        words_by_page = collections.defaultdict(set)
        for m in mentions:
            if m["publicationId"] == p["id"] and m.get("word"):
                words_by_page[m["pdfPage"]].add(m["word"])
        for ci in range(0, len(pages), BUNDLE):
            chunk = pages[ci: ci + BUNDLE]
            name = f"{p['id']}-{ci // BUNDLE}.json"
            bundle = {}
            for n in chunk:
                pg = doc[n - 1]
                zoom = IMG_W / pg.rect.width
                if no_scans:
                    pix, jpg = None, b""
                else:
                    pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
                    jpg = pix.tobytes("jpeg", jpg_quality=42)
                    total_img += len(jpg)
                hl = {}
                for w in words_by_page[n]:
                    rects = pg.search_for(w)[:4]
                    hl[w] = [[round(r.x0 / pg.rect.width, 4), round(r.y0 / pg.rect.height, 4),
                              round(r.width / pg.rect.width, 4), round(r.height / pg.rect.height, 4)] for r in rects]
                t = tmap.get(n, {})
                bundle[n] = {"label": str(t.get("printed_page") or n),
                             "text": "" if no_scans else t.get("text", ""),
                             "w": pix.width if pix else None, "h": pix.height if pix else None,
                             "img": ("data:image/jpeg;base64," + base64.b64encode(jpg).decode()) if jpg else None,
                             "hl": hl}
                page_index[f"{p['id']}:{n}"] = name
            json.dump(bundle, open(f"{site_dir}/pages/{name}", "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"страниц со сканом: {len(page_index)}, сканы {total_img/1e6:.1f} МБ", file=sys.stderr)

    # 4) полный текст для поиска по изданиям (без сканов), лениво грузится
    fulltext = []
    for p in pubs:
        for pg in texts[p["id"]]:
            if len(pg["text"]) > 80:
                fulltext.append([p["id"], pg["pdf_page"], str(pg["printed_page"] or pg["pdf_page"]), pg["text"]])
    if not no_scans:
        json.dump(fulltext, open(f"{site_dir}/data/fulltext.json", "w"), ensure_ascii=False, separators=(",", ":"))

    pubs_out = []
    for p in pubs:
        q = {k: p.get(k) for k in ("id", "authors", "title", "place", "publisher", "year", "pagesTotal", "lang", "scanSource", "kind")}
        q["citationBase"] = gost(p)
        q["citationRaw"] = p.get("citation_raw")
        q["authorsShort"] = p.get("authorsShort")
        pubs_out.append(q)
    json.dump({"publications": pubs_out, "mentions": mentions, "pageIndex": page_index},
              open(f"{site_dir}/data/corpus.json", "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
