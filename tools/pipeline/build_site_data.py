"""Финальные данные сайта для двух вариантов.

full  — со сканами страниц, полным текстом описаний и поиском по текстам изданий;
pages — публичная демо-версия (GitHub Pages): без сканов и полнотекста,
        описания обрезаны до короткой цитаты.

Запуск: python3 build_site_data.py full|pages OUT_DIR
"""
import collections
import json
import os
import re
import shutil
import sys

PROTO = "/home/claude/proto"
NOMI = "/home/claude/geo/nominatim_cache.json"
QUOTE_LEN = 280

OK_TYPES = {"village", "hamlet", "town", "city", "locality", "isolated_dwelling", "suburb", "neighbourhood", "farm", "allotments"}


def norm(s):
    return re.sub(r"[^а-я]", "", s.lower().replace("ё", "е").replace("і", "и").replace("ў", "у"))


def apply_nominatim(sites):
    try:
        cache = json.load(open(NOMI))
    except Exception:
        return 0
    n = 0
    for s in sites:
        if s["coords"]:
            continue
        village = re.sub(r"\s*\((?:[IVX]+)\)", "", s["placeName"]).split(" — ")[0]
        raion = s["region"]["raion"].replace(" р-н", "")
        res = cache.get(f"{village}, {raion} район, Беларусь") or []
        vk = norm(village)
        for r in res:
            county = (r.get("address", {}).get("county") or r.get("address", {}).get("state_district") or "")
            if norm(raion)[:5] not in norm(county):
                continue
            if r.get("addresstype") not in OK_TYPES and r.get("type") not in OK_TYPES:
                continue
            nm = norm(r.get("name") or "")
            if not (nm == vk or vk in nm or nm in vk):
                continue
            s["coords"] = {"lat": round(float(r["lat"]), 5), "lon": round(float(r["lon"]), 5),
                           "accuracy": "settlement", "accuracyM": 1500}
            s["geocode"] = {"method": "osm", "gid": None, "abandoned": False}
            if (r.get("name") or "") and norm(r["name"]) != vk:
                s["altNames"] = [r["name"]] + s["altNames"]
            n += 1
            break
    return n


DIRS = {"север": 0, "северо-восто": 45, "восто": 90, "юго-восто": 135, "юг": 180, "юго-запад": 225, "запад": 270, "северо-запад": 315}
DIR_NAMES = {"север": "север", "северо-восто": "северо-восток", "восто": "восток", "юго-восто": "юго-восток", "юг": "юг", "юго-запад": "юго-запад", "запад": "запад", "северо-запад": "северо-запад"}
OFFSET_RX = re.compile(
    r"в\s+(\d+(?:[,.]\d+)?)\s*(км|м)\.?\s+(?:к\s+|на\s+)?"
    r"(северо-западнее|северо-восточнее|юго-западнее|юго-восточнее|севернее|южнее|западнее|восточнее|"
    r"северо-запад\w*|северо-восток\w*|юго-запад\w*|юго-восток\w*|север\w*|юг\w*|запад\w*|восток\w*)"
    r"(?P<tail>[^.;]{0,60})", re.I)


def apply_offsets(sites):
    """«Городище в 1,5 км юго-западнее деревни» → сдвигаем точку от центра деревни.
    Берём только первую фразу и только если она про сам населённый пункт,
    а не про другую деревню («в 2 км от д. Иваново»)."""
    import math
    n = 0
    for s in sites:
        c = s["coords"]
        if not c or c["accuracy"] != "settlement":
            continue
        desc = re.sub(r"(\w)\s*[-—–]\s+(\w)", r"\1-\2", s["description"])  # «юго- западнее» → «юго-западнее»
        m = OFFSET_RX.search(desc)
        if not m:
            continue
        tail = m.group("tail")
        other = re.search(r"от\s+(?:д\.|дер\.|с\.|г\.\s*п\.|пос\.|деревни|села)?\s*([А-ЯЁ][а-яё\-]+)", tail)
        place = re.sub(r"\s*\([IVX]+\)", "", s["placeName"]).split(" — ")[0]
        if other and norm(other.group(1))[:5] != norm(place)[:5]:
            continue
        if re.search(r"от\s+(?:р\.|реки|оз\.|озера|ст\.|станции|шоссе|дороги|урочищ|кладбищ|моста|церкв)", tail):
            continue
        dist = float(m.group(1).replace(",", ".")) * (1 if m.group(2).lower() == "км" else 0.001)
        if not 0.05 <= dist <= 8:
            continue
        word = m.group(3).lower()
        if word in ("юго", "северо"):
            continue  # направление оборвано переносом — не угадываем
        key = next((k for k in sorted(DIRS, key=len, reverse=True) if word.startswith(k)), None)
        if key is None:
            continue
        az = math.radians(DIRS[key])
        dlat = dist * math.cos(az) / 111.2
        dlon = dist * math.sin(az) / (111.2 * math.cos(math.radians(c["lat"])))
        s["coords"] = {"lat": round(c["lat"] + dlat, 5), "lon": round(c["lon"] + dlon, 5),
                       "accuracy": "approx", "accuracyM": int(min(1000, max(300, dist * 250)))}
        s["geocode"] = dict(s["geocode"], offset={"km": dist, "dir": DIR_NAMES[key], "phrase": m.group(0)[:len(m.group(0)) - len(tail)].strip()})
        n += 1
    return n


# ───────── шифры (как Fornsök: район + номер внутри района) ─────────
TR = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюяіў", ["a","b","v","h","d","e","io","zh","z","i","j","k","l","m","n","o","p","r","s","t","u","f","ch","c","ch","sh","sch","","y","","e","iu","ia","i","u"]))
OBL = {"Брестская обл.": "BR", "Витебская обл.": "VI", "Гомельская обл.": "HO", "Гродненская обл.": "HR", "Минская обл.": "MN", "Могилёвская обл.": "MA"}


def translit(t):
    return "".join(TR.get(ch, ch) if ch.islower() else TR.get(ch.lower(), ch).capitalize() for ch in t)


def assign_codes(sites):
    """BY-VI-ORS-007: область, район (3–4 буквы), номер в районе по порядку каталога.
    Шифр не зависит от координат, поэтому не меняется при их уточнении."""
    abbr = {}
    by_obl = collections.defaultdict(set)
    for s in sites:
        by_obl[s["region"]["oblast"]].add(s["region"]["raion"])
    for obl, raions in by_obl.items():
        used = {}
        for r in sorted(raions):
            base = translit(r.replace(" р-н", "")).upper().replace("-", "")
            n = 3
            while base[:n] in used and n < len(base):
                n += 1
            used[base[:n]] = r
            abbr[r] = base[:n]
    seq = collections.Counter()
    for s in sorted(sites, key=lambda x: (x["region"]["oblast"], x["region"]["raion"], x["catalog"]["num"])):
        r = s["region"]["raion"]
        seq[r] += 1
        s["catalogCode"] = s["code"]
        s["code"] = f"BY-{OBL.get(s['region']['oblast'], 'XX')}-{abbr[r]}-{seq[r]:03d}"


# ───────── названия (как Pleiades: каждое со своим языком и происхождением) ─────────
def build_names(s):
    names = []
    seen = set()

    def add(name, lang, kind, note=""):
        k = norm(name)
        if not k or k in seen:
            return
        seen.add(k)
        names.append({"name": name, "lang": lang, "kind": kind, "note": note})
    base = re.sub(r"\s*\([IVX]+\)$", "", s["placeName"])
    add(base, "ru", "catalog", "написание в каталоге Поболя (1983)")
    for n in s.get("gazetteerNames") or []:
        add(n, "be" if re.search("[ІіЎў]", n) else "ru", "official", "справочник населённых пунктов")
    for n in s.get("altNames") or []:
        clean = re.sub(r"\s*\(бел\.\)$", "", n)
        add(clean, "be" if re.search("[ІіЎў]", clean) or "(бел.)" in n else "ru", "official", "OpenStreetMap / GeoNames")
    m = re.search(r"урочищ\w*\s+([А-ЯЁ][а-яё\-]+(?:\s+[А-ЯЁ][а-яё\-]+)?)", s["description"])
    if m:
        add(m.group(1), "ru", "folk", "урочище, по описанию")
    add(translit(base), "lat", "translit", "транслитерация")
    return names


# ───────── литература и архивы (как Canmore) ─────────
ARCHIVE_RX = re.compile(r"Отч[её]т|Справаздач|архив|ГАМ[ОВ]|ГАВО|ГАГО|колл\.|Колл\.|ЛО ИА|ЛОИА|ЛО НА|НА ИИ|\bф\.\s*\d|инв\.|Дневник|полев", re.I)
AUTHOR_RX = re.compile(r"^((?:[А-ЯЁA-ZІЎŁŚŻ]\.\s?){1,2}[А-ЯЁA-ZІЎŁŚŻ][\w'’\-]+(?:,\s*(?:[А-ЯЁA-ZІЎŁŚŻ]\.\s?){1,2}[А-ЯЁA-ZІЎŁŚŻ][\w'’\-]+)*|[ЕE]\.\s?и\s?В\.\s?[А-ЯЁ]\w+|[А-ЯЁ][а-яё]+\.\.\.)\.?\s*,?\s*")


def collapse_spaced(t):
    return re.sub(r"(?<![\w])((?:\w ){2,}\w)(?!\w)", lambda k: k.group(1).replace(" ", ""), t)


def parse_refs(refs):
    out = []
    for raw in refs:
        prev_author = None
        for part in re.split(r";\s*", raw):
            t = collapse_spaced(re.sub(r"\s+", " ", part)).strip(" .,")
            t = re.sub(r"(\w)-\s+(\w)", r"\1\2", t)
            if len(t) < 4:
                continue
            m = AUTHOR_RX.match(t)
            author = m.group(1).strip(" .,") if m else None
            if author:
                prev_author = author
            elif re.match(r"^\d{4}", t) and prev_author:
                author = prev_author
            year = re.search(r"\b(1[6-9]\d\d|20[0-2]\d)[а-яa-z]?\b", t)
            kind = "archive" if ARCHIVE_RX.search(t) else "pub"
            out.append({"kind": kind, "author": author, "year": year.group(0) if year else None, "text": t})
    return out


# ───────── единая шкала периодов (как ARIADNE / PeriodO) ─────────
PERIODS = [("paleolithic", "Палеолит", -10000, -9001), ("mesolithic", "Мезолит", -9000, -5001), ("neolithic", "Неолит", -5000, -2001),
           ("bronze", "Бронзовый век", -2000, -801), ("early_iron", "Ранний железный век", -800, 500),
           ("early_medieval", "Раннее средневековье", 501, 1000), ("medieval", "Средневековье", 1001, 1500), ("modern", "Новое время", 1501, 1800)]


def periods_of(d):
    if d.get("from") is None:
        return []
    return [pid for pid, _, a, b in PERIODS if d["from"] <= b and d["to"] >= a]


def short(text, n=QUOTE_LEN):
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


def main():
    variant, out = sys.argv[1], sys.argv[2]
    full = variant == "full"
    os.makedirs(f"{out}/data", exist_ok=True)
    sites = json.load(open(f"{PROTO}/out/sites_full.json", encoding="utf-8"))
    added = apply_nominatim(sites)
    shifted = apply_offsets(sites)
    corpus = json.load(open(f"{PROTO}/site_full/data/corpus.json", encoding="utf-8"))

    def collapse(t):
        return re.sub(r"(?<![А-Яа-яЁё])((?:[А-ЯЁа-яё] ){2,}[А-ЯЁа-яё])(?![А-Яа-яЁё])", lambda k: k.group(1).replace(" ", ""), t)

    mentions = collections.defaultdict(list)
    for m in corpus["mentions"]:
        mm = dict(m)
        a, b = mm["hit"]
        if b > a:
            pre, word, post = collapse(mm["snippet"][:a]), mm["snippet"][a:b], collapse(mm["snippet"][b:])
            mm["snippet"] = pre + word + post
            mm["hit"] = [len(pre), len(pre) + len(word)]
        else:
            mm["snippet"] = collapse(mm["snippet"])
        if not full:
            a, b = mm["hit"]
            # короткая цитата: ~200 символов вокруг названия
            s0 = max(0, a - 90)
            e0 = min(len(mm["snippet"]), b + 110)
            pre = "…" if s0 > 0 else ""
            post = "…" if e0 < len(mm["snippet"]) else ""
            mm["snippet"] = pre + mm["snippet"][s0:e0] + post
            mm["hit"] = [a - s0 + len(pre), b - s0 + len(pre)]
        mentions[m["siteId"]].append(mm)

    assign_codes(sites)
    out_sites = []
    for s in sites:
        s["names"] = build_names(s)
        s["literature"] = parse_refs(s["refs"])
        s["dating"]["periods"] = periods_of(s["dating"])
        d = {k: s[k] for k in ("id", "code", "catalogCode", "type", "name", "placeName", "altNames", "names", "dating", "coords", "region",
                               "locationText", "catalog", "finds", "refs", "literature", "updatedAt", "geocode")}
        d["description"] = s["description"] if full else short(s["description"])
        d["descriptionTruncated"] = (not full) and len(s["description"]) > QUOTE_LEN
        d["mentions"] = mentions.get(s["id"], [])
        if not full:
            for f in d["finds"]:
                f["item"] = short(f["item"], 120)
        out_sites.append(d)

    used_pubs = {m["publicationId"] for m in corpus["mentions"]}
    pubs = corpus["publications"] if full else [p for p in corpus["publications"] if p["id"] in used_pubs]
    meta = {
        "variant": variant,
        "generatedAt": "2026-10-20",
        "stats": {
            "sites": len(out_sites),
            "withCoords": sum(1 for s in out_sites if s["coords"]),
            "geocodeOSM": added,
            "shiftedByDescription": shifted,
            "mentions": sum(len(v) for v in mentions.values()),
            "publications": len(pubs),
        },
        "sources": [
            "Поболь Л. Д. Археологические памятники Белоруссии: Железный век. Минск, 1983 — каталог, разобран автоматически",
            "Координаты: GeoNames и OpenStreetMap (Nominatim), центр населённого пункта",
        ],
    }
    json.dump({"meta": meta, "sites": out_sites}, open(f"{out}/data/sites.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    json.dump({"publications": pubs, "pageIndex": corpus["pageIndex"] if full else {}},
              open(f"{out}/data/corpus.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    shutil.copy(f"{PROTO}/site/data/basemap.json", f"{out}/data/basemap.json")
    if full:
        if os.path.exists(f"{out}/pages"):
            shutil.rmtree(f"{out}/pages")
        shutil.copytree(f"{PROTO}/site_full/pages", f"{out}/pages")
        # полнотекст только по изданиям про Беларусь
        ft = json.load(open(f"{PROTO}/site_full/data/fulltext.json", encoding="utf-8"))
        P = {p["id"]: p for p in corpus["publications"]}
        keep = {pid for pid, p in P.items() if p["kind"] != "article" or re.search(
            r"Беларус|Белорус|археалог|археолог", (p.get("citationRaw") or "") + p["title"])}
        ft = [r for r in ft if r[0] in keep]
        json.dump(ft, open(f"{out}/data/fulltext.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(variant, meta["stats"], file=sys.stderr)


if __name__ == "__main__":
    main()
