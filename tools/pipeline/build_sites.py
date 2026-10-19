"""Каталог Поболя 1983 → памятники прототипа (формат api.md).

Геокодинг: деревня + район по GeoNames (BY.txt). Точность «settlement»:
координаты центра населённого пункта, а не самого памятника.
Тип, датировка и категории находок проставляются автоматически по тексту
описания, у каждой записи есть пометка об этом.

Запуск: python3 build_sites.py pobol1983.jsonl BY.txt out/sites_full.json
"""
import collections
import difflib
import json
import re
import sys

LAT2CYR = str.maketrans("ABCEHKMOPTXYaceopxyiI", "АВСЕНКМОРТХУасеорхуіІ")


def key(s):
    s = s.translate(LAT2CYR).lower().replace("ё", "е").replace("і", "и").replace("ў", "у")
    return re.sub(r"[^а-я]", "", s)


def collapse_spaced(text):
    """«С у п р у н» → «Супрун» (разрядка фамилий в OCR)."""
    return re.sub(r"(?<![А-Яа-яЁё])((?:[А-ЯЁа-яё] ){2,}[А-ЯЁа-яё])(?![А-Яа-яЁё])",
                  lambda m: m.group(1).replace(" ", ""), text)


def tidy(text):
    text = collapse_spaced(text)
    text = re.sub(r"\s+([,.;:)])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def title_name(raw):
    """«ГОРОДОК—СТАРЫЙ МОКРЕЦ (I)» → «Городок — Старый Мокрец (I)»."""
    raw = re.sub(r"\s+", " ", raw).strip(" .,")
    raw = re.sub(r"(?<=[А-ЯЁ]) (?=[А-ЯЁ]\b)", "", raw)  # «ДОБРЫ Й» → «ДОБРЫЙ»
    def cap(w):
        if re.fullmatch(r"\(?[IVXІ]+\)?", w):
            return w.replace("І", "I")
        return "-".join(p[:1] + p[1:].lower() for p in w.split("-"))
    out = " ".join(cap(w) for w in raw.split(" "))
    out = re.sub(r"\s*[—-]\s*(?=[А-ЯЁ])", " — ", out) if "—" in raw else out
    return out.replace("(", "(").replace(" )", ")")


def fix_ocr_spacing(raw):
    """«КЛИМ ОВКА» → «КЛИМОВКА»: склеиваем куски, если хоть один из них короче 3 букв
    или не похож на самостоятельное слово."""
    words = raw.split(" ")
    out = []
    for w in words:
        if out and re.fullmatch(r"[А-ЯЁ]+", w) and re.fullmatch(r"[А-ЯЁ]+", out[-1]) and (
                len(w) <= 2 or len(out[-1]) <= 2 or not re.search(r"(ЫЙ|ИЙ|ОЙ|АЯ|ЯЯ|ОЕ|ЕЕ|ЫЕ|ИЕ)$", out[-1])
                and not re.search(r"(ЫЙ|ИЙ|ОЙ|АЯ|ОЕ|ЕЕ)$", w) and len(out[-1]) < 4):
            out[-1] += w
        else:
            out.append(w)
    return " ".join(out)


def display_name(raw, place):
    roman = re.findall(r"\(([IVXІ]+)\)", raw)
    suffix = f" ({roman[0].replace('І', 'I')})" if roman else ""
    if place and "—" not in raw:
        return place["ru"] + suffix
    main = re.sub(r"\s*\([^()]*\)", "", raw)
    parts = [title_name(fix_ocr_spacing(p)) for p in re.split(r"\s*—\s*", main) if p.strip()]
    return " — ".join(parts) + suffix


def name_variants(raw):
    s = re.sub(r"\((?:[IVXІ]+|\d+)\)", " ", raw)
    parts = re.split(r"\s*[—]\s*|\s*\(\s*|\s*\)\s*", s)
    return [p for p in (x.strip() for x in parts) if len(key(p)) >= 3]


TYPE_RULES = [  # тип по первому упоминанию в описании
    ("hillfort", r"городищ|земляное укреплени|укрепленн\w+ поселени|замчищ|замок"),
    ("barrow", r"курган"),
    ("settlement", r"селищ|поселени"),
    ("camp", r"стоянк"),
    ("cemetery", r"могильник|погребени|захоронени|трупосожжени|трупоположени"),
    ("stray_find", r"клад|случайн|найден|обнаружен|выявлен"),
]

CULTURES = {  # ориентировочные границы, годы (до н.э. < 0)
    "милоградская": (r"милоградск", -700, 50),
    "зарубинецкая": (r"зарубинецк", -200, 400),
    "штрихованной керамики": (r"штрихованн", -700, 400),
    "днепро-двинская": (r"днепро-двинск", -800, 400),
    "юхновская": (r"юхновск", -500, 300),
    "лужицкая": (r"лужицк", -1300, -400),
    "поморская": (r"поморск", -600, -100),
    "вельбарская": (r"вельбарск", 100, 400),
    "киевская": (r"киевской культур", 200, 500),
    "пражская": (r"пражск", 500, 750),
    "колочинская": (r"колочинск", 400, 750),
    "банцеровская": (r"банцеровск", 500, 800),
    "тушемлинская": (r"тушемлинск", 500, 800),
    "хотомельско-петриковская": (r"хотомел|петриковск\w+ культур", 500, 900),
    "Киевская Русь": (r"Киевской Руси|древнерусск|раннефеодальн", 900, 1240),
}

FIND_RULES = [
    ("ceramics", "керамика", r"керамик|черепк|сосуд|горш"),
    ("coins", "монеты", r"монет|динари|дирхем|денари|клад"),
    ("weapons", "оружие", r"наконечник|меч[аи]?\b|копь|кинжал|шпор|булав\w+ боев"),
    ("jewelry", "украшения", r"браслет|бус[аыи]|гривн|височн|булавк|подвеск|фибул|пряжк|серьг|перстн"),
    ("tools", "орудия труда", r"серп|нож|шил[оа]|пряслиц|долот|тесл|грузил|рыболов|топор"),
    ("flint", "кремень", r"кремн|кремен"),
    ("glass", "стекло", r"стекл"),
    ("osteology", "остеология", r"кост[иье]|челюст|остеолог"),
    ("household", "предметы быта", r"ключ|замок висяч|ведр|жернов|котел|котл"),
]
MATERIALS = [("железо", r"желез"), ("бронза", r"бронз"), ("серебро", r"серебр"),
             ("стекло", r"стекл"), ("кость", r"кост"), ("кремень", r"кремн"), ("глина", r"глин|керамик|пряслиц")]

ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"]


def century(y):
    if y < 0:
        c = (-y - 1) // 100 + 1
        return f"{ROMAN[c] if c < len(ROMAN) else c} в. до н.э."
    c = (y - 1) // 100 + 1
    return f"{ROMAN[c] if c < len(ROMAN) else c} в. н.э."


def dating_text(a, b):
    if a is None:
        return None
    return f"{century(a)} – {century(b)}" if century(a) != century(b) else century(a)


def load_gazetteer(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path, encoding="utf-8")]
    districts = {}
    for r in rows:
        if r[7] == "ADM2":
            ru = [a for a in r[3].split(",") if re.search("[А-Яа-я]", a)]
            for a in ru:
                m = re.match(r"([А-ЯЁІЎ][а-яёіў\-]+)", a)
                if m:
                    districts.setdefault(key(m.group(1))[:-2], (float(r[4]), float(r[5])))
    places = collections.defaultdict(list)  # district_id → [(key, place)]
    by_oblast = collections.defaultdict(list)
    for r in rows:
        if r[6] != "P":
            continue
        names = {a for a in r[3].split(",") if re.search("[А-Яа-яЁёІіЎў]", a)}
        if not names:
            continue
        ru = sorted(a for a in names if not re.search("[ІіЎў]", a))
        be = sorted(a for a in names if re.search("[ІіЎў]", a))
        p = {"gid": r[0], "lat": float(r[4]), "lon": float(r[5]), "code": r[7],
             "ru": ru[0] if ru else sorted(names)[0], "be": be[0] if be else None,
             "abandoned": r[7] == "PPLQ", "names": sorted(names)}
        for n in names:
            k = key(n)
            if len(k) >= 3:
                places[r[11]].append((k, p))
                by_oblast[r[10]].append((k, p))
    return districts, places, by_oblast


OBLAST_GN = {"Брестская": "01", "Гомельская": "02", "Гродненская": "03", "Минская": "05",
             "Могилевская": "06", "Витебская": "07"}
OBLAST_CODE = {"Брестская": "BR", "Витебская": "VI", "Гомельская": "HO", "Гродненская": "HR",
               "Минская": "MN", "Могилевская": "MA"}


def km(a, b):
    import math
    dy = (a[0] - b[0]) * 111.2
    dx = (a[1] - b[1]) * 111.2 * math.cos(math.radians((a[0] + b[0]) / 2))
    return (dx * dx + dy * dy) ** 0.5


def geocode(entry, districts, places, by_oblast):
    """В GeoNames у деревень нет района, поэтому из одноимённых деревень
    области берём ближайшую к центру района (в пределах 55 км)."""
    dkey = key(entry["district"] or "")[:-2]
    center = districts.get(dkey)
    if not center:
        cands = [v for k, v in districts.items() if k[:6] == dkey[:6]]
        center = cands[0] if len(cands) == 1 else None
    obl_pool = by_oblast.get(OBLAST_GN.get(entry["oblast"]), [])
    variants = name_variants(entry["name"])
    for v in variants:
        k = key(v)
        hit = list({p["gid"]: p for pk, p in obl_pool if pk == k}.values())
        if not hit:
            continue
        if center:
            hit.sort(key=lambda p: km((p["lat"], p["lon"]), center))
            d = km((hit[0]["lat"], hit[0]["lon"]), center)
            if d <= 55:
                return hit[0], "district", round(d)
        elif len(hit) == 1:
            return hit[0], "oblast", None
    if center:  # опечатки OCR: близкое написание рядом с центром района
        near = [(pk, p) for pk, p in obl_pool if km((p["lat"], p["lon"]), center) <= 45]
        for v in variants:
            k = key(v)
            if len(k) < 5:
                continue
            scored = sorted(((difflib.SequenceMatcher(None, k, pk).ratio(), p) for pk, p in near
                             if pk[:3] == k[:3]), key=lambda x: -x[0])
            if scored and scored[0][0] >= 0.9:
                second = next((sc for sc, p in scored[1:] if p["gid"] != scored[0][1]["gid"]), 0)
                if second < scored[0][0] - 0.03:
                    return scored[0][1], "fuzzy", None
    return None, None, None


def first_type(body):
    best = None
    for t, rx in TYPE_RULES:
        m = re.search(rx, body, re.I)
        if m and (best is None or m.start() < best[1]):
            best = (t, m.start())
    return best[0] if best else "stray_find"


def extract_finds(body, site_id, start_id):
    finds = []
    sentences = re.split(r"(?<=[.;])\s+(?=[А-ЯЁA-Z])", body)
    for s in sentences:
        s_clean = re.sub(r"\([^()]*\d{4}[^()]*\)", "", s).strip(" .;")
        for cat, cat_ru, rx in FIND_RULES:
            m = re.search(rx, s_clean, re.I)
            if not m:
                continue
            if len(s_clean) <= 150:
                frag = s_clean
            else:
                a, b = max(0, m.start() - 50), min(len(s_clean), m.end() + 100)
                frag = s_clean[a:b]
                if a > 0:
                    frag = "…" + frag.split(" ", 1)[-1]
                if b < len(s_clean):
                    frag = frag.rsplit(" ", 1)[0] + "…"
            years = [int(y) for y in re.findall(r"\b(1[89]\d\d)\b", s)]
            res = re.findall(r"([А-ЯЁ]\. ?[А-ЯЁ]\. ?[А-ЯЁ][а-яё]+(?:ой|ий|ич|ко|ов|ев|ин|ая|ский|ук|юк)?)", s)
            mat = next((name for name, mrx in MATERIALS if re.search(mrx, frag, re.I)), None)
            finds.append({
                "id": start_id + len(finds), "item": frag[:1].upper() + frag[1:],
                "material": mat, "category": cat, "categoryName": cat_ru,
                "datingText": None, "excavationYear": years[0] if years else None,
                "researcher": res[0] if res else None, "quantity": None, "auto": True,
            })
            break  # одна строка на предложение
    return finds


def main():
    src, gaz, out = sys.argv[1:4]
    districts, places, by_oblast = load_gazetteer(gaz)
    entries = [json.loads(l) for l in open(src, encoding="utf-8")]
    sites, stats = [], collections.Counter()
    find_id = 100000
    seq = collections.Counter()
    for e in entries:
        body = tidy(e["text"])
        place, how, _ = geocode(e, districts, places, by_oblast)
        name = display_name(e["name"], place)
        stats[how or "none"] += 1
        stype = first_type(body)
        cults = [c for c, (rx, a, b) in CULTURES.items() if re.search(rx, body, re.I)]
        if cults:
            y_from = min(CULTURES[c][1] for c in cults)
            y_to = max(CULTURES[c][2] for c in cults)
            dtext = dating_text(y_from, y_to)
            dsrc = "по культурам в описании"
        else:
            y_from, y_to, dtext, dsrc = -800, 1240, "железный век – древнерусское время", "культура не указана: весь охват каталога"
        seq[e["oblast"]] += 1
        sid = len(sites) + 1
        finds = extract_finds(body, sid, find_id)
        find_id += len(finds) + 1
        sel = e.get("selsovet")
        loc = f"{'д. ' + place['ru'] if place else name}" + (f", {sel} с/с" if sel else "")
        alt = []
        if place:
            if place["be"]:
                alt.append(place["be"] + " (бел.)")
            if key(place["ru"]) != key(name.split(" — ")[0].split(" (")[0]):
                alt.append(place["ru"])
        type_ru = {"hillfort": "Городище", "barrow": "Курганный могильник", "settlement": "Селище",
                   "camp": "Стоянка", "cemetery": "Грунтовый могильник", "stray_find": "Находки"}[stype]
        sites.append({
            "id": sid,
            "code": f"BY-{OBLAST_CODE[e['oblast']]}-{e['num']:04d}",
            "type": stype,
            "name": f"{type_ru} {name}",
            "placeName": name,
            "altNames": alt,
            "dating": {"from": y_from, "to": y_to, "text": dtext, "cultures": cults, "source": dsrc},
            "coords": ({"lat": round(place["lat"], 5), "lon": round(place["lon"], 5),
                        "accuracy": "settlement", "accuracyM": 1500} if place else None),
            "geocode": {"method": how, "gid": place["gid"] if place else None,
                        "abandoned": bool(place and place["abandoned"])},
            "gazetteerNames": place["names"] if place else [],
            "region": {"raion": f"{e['district']} р-н", "oblast": f"{e['oblast'].replace('Могилевская','Могилёвская')} обл."},
            "locationText": loc,
            "protectionStatus": None,
            "description": body,
            "catalog": {"num": e["num"], "numTo": e.get("num_to"), "mapNum": e.get("map_num"), "page": e["page"]},
            "finds": finds,
            "refs": [tidy(r) for r in e["refs"]],
            "updatedAt": "2026-10-20T00:00:00+03:00",
        })
    json.dump(sites, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    total = len(sites)
    print(f"памятников {total}; геокодинг: {dict(stats)}; "
          f"с координатами {sum(1 for s in sites if s['coords'])} ({100*sum(1 for s in sites if s['coords'])/total:.1f}%)",
          file=sys.stderr)
    print("типы:", collections.Counter(s["type"] for s in sites), file=sys.stderr)


if __name__ == "__main__":
    main()
