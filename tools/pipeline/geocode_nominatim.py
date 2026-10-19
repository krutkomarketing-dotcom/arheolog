"""Второй проход геокодинга для того, что не нашлось в GeoNames:
Nominatim (OpenStreetMap), 1 запрос в секунду, с кешем.
Принимаем только населённые пункты, чей район в адресе совпадает с районом каталога."""
import json, re, sys, time, urllib.parse, urllib.request
sites_path, cache_path = sys.argv[1], sys.argv[2]
UA = "ArchMapBelarus/0.1 (non-commercial scholarly prototype)"
try:
    cache = json.load(open(cache_path))
except Exception:
    cache = {}
sites = json.load(open(sites_path))
todo = [s for s in sites if not s["coords"]]
print("запросов:", len(todo), file=sys.stderr)
for i, s in enumerate(todo):
    village = re.sub(r"\s*\((?:[IVX]+)\)", "", s["placeName"]).split(" — ")[0]
    raion = s["region"]["raion"].replace(" р-н", "")
    q = f"{village}, {raion} район, Беларусь"
    if q in cache:
        continue
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "jsonv2", "addressdetails": 1, "limit": 5, "countrycodes": "by", "accept-language": "ru"})
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            cache[q] = json.load(r)
    except Exception as e:
        print("err", q, e, file=sys.stderr)
        time.sleep(5)
        continue
    time.sleep(1.1)
    if i % 50 == 0:
        json.dump(cache, open(cache_path, "w"), ensure_ascii=False)
        print(i, file=sys.stderr)
json.dump(cache, open(cache_path, "w"), ensure_ascii=False)
