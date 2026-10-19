"""Подложка «Схема»: граница Беларуси, области, реки, озёра, областные центры.
Источники: Natural Earth (world-atlas, @geo-maps), geo-insight adm1, GeoNames."""
import json, re, sys
NPM = "/home/claude/geo/npm"
BBOX = (23.0, 51.1, 33.0, 56.3)

def topo_decode(topo, obj):
    tr = topo.get("transform")
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0; pts = []
        for p in arc:
            if tr:
                x += p[0]; y += p[1]
                pts.append([x * tr["scale"][0] + tr["translate"][0], y * tr["scale"][1] + tr["translate"][1]])
            else:
                pts.append(p)
        arcs.append(pts)
    def ring(ids):
        out = []
        for i in ids:
            a = arcs[i] if i >= 0 else arcs[~i][::-1]
            out += a if not out else a[1:]
        return out
    for g in topo["objects"][obj]["geometries"]:
        if g["type"] == "Polygon":
            yield g, {"type": "Polygon", "coordinates": [ring(r) for r in g["arcs"]]}
        elif g["type"] == "MultiPolygon":
            yield g, {"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in g["arcs"]]}

def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 4), round(coords[1], 4)]
    return [rnd(c) for c in coords]

def in_bbox(geom):
    def walk(c):
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for x in c: yield from walk(x)
    return any(BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3] for x, y in walk(geom["coordinates"]))

topo = json.load(open(f"{NPM}/world-atlas/package/countries-10m.json"))
country = None; neighbours = []
for g, geom in topo_decode(topo, "countries"):
    name = g.get("properties", {}).get("name")
    if name == "Belarus":
        country = geom
    elif in_bbox(geom) or name in ("Poland", "Lithuania", "Latvia", "Russia", "Ukraine"):
        neighbours.append({"name": name, "geom": geom})

obl_names = {"Brest": "Брестская", "Vitebsk": "Витебская", "Gomel": "Гомельская", "Homyel": "Гомельская",
             "Grodno": "Гродненская", "Hrodna": "Гродненская", "Minsk": "Минская", "Mogilev": "Могилёвская",
             "Mahilyow": "Могилёвская", "Minsk City": "г. Минск", "City of Minsk": "г. Минск"}
oblasts = []
for f in json.load(open(f"{NPM}/data/package/dist/assets/adm1/112.json"))["features"]:
    n = f["properties"]["name"]
    oblasts.append({"name": obl_names.get(n, n), "en": n, "geom": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}})

def clip_lines(path, minlen=0):
    out = []
    d = json.load(open(path))
    geoms = d.get("geometries") or [f["geometry"] for f in d.get("features", [])]
    parts = []
    for g in geoms:
        if not g: continue
        if g["type"] == "MultiPolygon":
            parts += [{"type": "Polygon", "coordinates": c} for c in g["coordinates"]]
        else:
            parts.append(g)
    for g in parts:
        if in_bbox(g):
            out.append({"type": g["type"], "coordinates": rnd(g["coordinates"])})
    return out
rivers = clip_lines(f"{NPM}/earth-rivers-10m/package/map.geo.json")
lakes = clip_lines(f"{NPM}/earth-lakes-10m/package/map.geo.json")

cities = []
for l in open("/home/claude/geo/BY.txt", encoding="utf-8"):
    r = l.rstrip("\n").split("\t")
    if r[7] in ("PPLC", "PPLA"):
        ru = [a for a in r[3].split(",") if re.fullmatch(r"[А-ЯЁ][а-яё\-]+", a)]
        name = {"Mahilyow": "Могилёв", "Homyel'": "Гомель", "Hrodna": "Гродно", "Vitsyebsk": "Витебск", "Minsk": "Минск", "Brest": "Брест"}.get(r[2], ru[0] if ru else r[1])
        cities.append({"name": name, "lat": float(r[4]), "lon": float(r[5]), "capital": r[7] == "PPLC"})

def keep_near(geom, pad=2.5):
    """Оставить только части мультиполигона рядом с Беларусью."""
    bx = (BBOX[0]-pad, BBOX[1]-pad, BBOX[2]+pad, BBOX[3]+pad)
    def near(poly):
        return any(bx[0] <= x <= bx[2] and bx[1] <= y <= bx[3] for x, y in poly[0])
    if geom["type"] == "Polygon":
        return geom if near(geom["coordinates"]) else None
    parts = [p for p in geom["coordinates"] if near(p)]
    return {"type": "MultiPolygon", "coordinates": parts} if parts else None

def area(poly):
    r = poly[0]
    return abs(sum(r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1] for i in range(len(r)-1)))/2

def inside(g):
    pts = g["coordinates"][0]
    return all(BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3] for x, y in pts)

neighbours = [dict(n, geom=keep_near(n["geom"])) for n in neighbours]
neighbours = [n for n in neighbours if n["geom"]]
lakes = [g for g in lakes if g["type"] == "Polygon" and inside(g) and area(g["coordinates"]) > 0.0015]
rivers = [g for g in rivers if g["type"] == "Polygon" and inside(g) and len(g["coordinates"][0]) >= 6]

out = {"country": {"type": country["type"], "coordinates": rnd(country["coordinates"])},
       "neighbours": [{"name": n["name"], "geom": {"type": n["geom"]["type"], "coordinates": rnd(n["geom"]["coordinates"])}} for n in neighbours],
       "oblasts": oblasts, "rivers": rivers, "lakes": lakes, "cities": cities}
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print({k: (len(v) if isinstance(v, list) else "ok") for k, v in out.items()})
