"""Поиск упоминаний памятников правилами (без LLM).

Ловит конструкции «<тип памятника> каля/паблізу/у вёсцы/около д. <Название>
(<Район> раён)» на бел. и рус. На выходе кандидаты с точной цитатой и
страницей. Всё, что не поймалось шаблоном, но содержит тип памятника,
уходит в отдельный список для Jev/LLM.

Запуск: python3 extract_sites.py text/ catalog_dir/ out.csv
"""
import csv
import json
import os
import re
import sys

TYPES = {
    "гарадзішча": r"гарадзішч\w*|городищ\w*",
    "селішча": r"селішч\w*|селищ\w*|паселішч\w*|поселени\w*",
    "курганны могільнік": r"курганн\w+\s+могільнік\w*|курганн\w+\s+могильник\w*|курган\w*",
    "грунтавы могільнік": r"грунтав\w+\s+могільнік\w*|грунтов\w+\s+могильник\w*|могільнік\w*|могильник\w*",
    "стаянка": r"стаянк\w*|стоянк\w*",
    "замчышча": r"замчышч\w*|замчищ\w*",
    "скарб": r"скарб\w*|клад\b|клада\b",
}
TYPE_RE = "(?i:" + "|".join(f"(?P<t{i}>{p})" for i, p in enumerate(TYPES.values())) + ")"
TYPE_NAMES = list(TYPES)

PREP = (r"каля|паблізу|непадалёк\s+ад|ля|у\s+ваколіцах|ва\s+ўрочышчы|"
        r"у\s+вёсцы|у\s+в\.|в\s+д\.|у\s+д\.|около|близ|возле|в\s+окрестностях|"
        r"в\s+урочище|у\s+деревни|в\s+деревне|в\s+с\.")
VILLAGE_WORD = (r"(?:(?:былой\s+)?(?:вёск[іаіу]|вёсак|в\.|д\.|дер\.|деревн[иея]|деревень|сёл\w*|сел[аоe]|"
                r"пас\.|г\.\s*п\.|гарадскога\s+пасёлка|пасёлка|горада|города|г\.|ст\.|станцыі|хутар\w*|хутор\w*)\s*)?")
NAME = r"(?P<name>[А-ЯЁІЎ][а-яёіўґ'’-]{2,}(?:[ \t]+(?:[А-ЯЁІЎ][а-яёіўґ'’-]+|\d+))?)"
DISTRICT = (r"(?:\s*\((?P<district>[А-ЯЁІЎ][а-яёіўґ'’-]+(?:\s+[а-яёіўґ]+)?"
            r"\s+(?:р-на|р-н|раёна?|района?|раён|район)[^)]*)\))?")

PATTERN = re.compile(
    rf"(?P<type>{TYPE_RE})\s+(?:\S+\s+){{0,2}}?(?i:{PREP})\s+{VILLAGE_WORD}{NAME}{DISTRICT}")
# «Засвірскае селішча», «Гаранскае гарадзішча» — прыметнікавая форма
ADJ = re.compile(
    rf"(?P<name>[А-ЯЁІЎ][а-яёіўґ-]+(?:ск|цк|зк)(?:ае|ое|ага|ого|ім|ом|ая|ий|і|ы)\w*)\s+(?P<type>{TYPE_RE})")
# «городище Кострица», «городищ Бураково (2), Загорцы» — название сразу за типом
DIRECT = re.compile(rf"(?P<type>{TYPE_RE})\s+(?P<name>[А-ЯЁІЎ][а-яёіўґ'’-]{{2,}}(?:[ \t]+[IVX]{{1,4}}\b|[ \t]+\d\b)?)")
YEAR = re.compile(r"\b(1[89]\d{2}|20[0-2]\d)\b")


def type_of(m):
    for i, name in enumerate(TYPE_NAMES):
        if m.group(f"t{i}"):
            return name
    return "?"


def sentence_around(text, start, end):
    a = max(text.rfind(". ", 0, start), text.rfind("\n", 0, start)) + 1
    b_dot = text.find(". ", end)
    b = len(text) if b_dot == -1 else b_dot + 1
    return re.sub(r"\s+", " ", text[a:b]).strip()[:600]


def main():
    text_dir, lib_dir, out_csv = sys.argv[1], sys.argv[2], sys.argv[3]
    meta = {}
    for f in os.listdir(lib_dir):
        if f.startswith("catalog") and f.endswith(".jsonl"):
            for l in open(os.path.join(lib_dir, f), encoding="utf-8"):
                r = json.loads(l)
                if r.get("file"):
                    meta[os.path.basename(r["file"])[:-4]] = r
    w = csv.writer(open(out_csv, "w", encoding="utf-8", newline=""))
    w.writerow(["file", "source_title", "citation", "pdf_page", "printed_page",
                "rule", "site_type", "name", "district", "years", "quote"])
    stats = {"hits": 0, "pages": 0}
    for f in sorted(os.listdir(text_dir)):
        key = f.replace(".pages.jsonl", "")
        m = meta.get(key, {})
        for l in open(os.path.join(text_dir, f), encoding="utf-8"):
            p = json.loads(l)
            stats["pages"] += 1
            t = p["text"]
            seen = set()
            for rule, rx in (("prep", PATTERN), ("adj", ADJ), ("direct", DIRECT)):
                for mm in rx.finditer(t):
                    name = mm.group("name")
                    if rule == "direct" and re.search(
                            r"(?:ск|цк|н|ш)(?:ого|его|ой|ая|ие|ых|ым)$|щины$|ья$", name.split()[0]):
                        continue  # «Белорусского Поднепровья», «Смоленщины» — не пункт
                    typ = type_of(mm)
                    if (name, typ) in seen:
                        continue
                    seen.add((name, typ))
                    q = sentence_around(t, mm.start(), mm.end())
                    district = mm.groupdict().get("district") or ""
                    w.writerow([key, m.get("title", ""), m.get("citation", ""),
                                p["pdf_page"], p["printed_page"], rule, typ,
                                name, district,
                                " ".join(sorted(set(YEAR.findall(q)))), q])
                    stats["hits"] += 1
    print(stats, file=sys.stderr)


if __name__ == "__main__":
    main()
