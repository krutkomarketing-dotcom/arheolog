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

    out_sites = []
    for s in sites:
        d = {k: s[k] for k in ("id", "code", "type", "name", "placeName", "altNames", "dating", "coords", "region",
                               "locationText", "catalog", "finds", "refs", "updatedAt", "geocode")}
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
