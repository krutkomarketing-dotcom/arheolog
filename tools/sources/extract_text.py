"""PDF → постраничный текст для базы и поиска.

На каждую страницу: индекс в PDF, печатный номер страницы (из колонтитула),
очищенный текст (склеены переносы, убран повторяющийся колонтитул).
Страницы без текстового слоя помечаются needs_ocr.

Запуск: python3 extract_text.py library/ text/
"""
import collections
import json
import os
import re
import sys

import pymupdf

NUM = re.compile(r"^\s*(\d{1,4})\s*$")


def printed_number(lines):
    """Печатный номер: отдельная строка-число в первых/последних строках."""
    for ln in lines[:3] + lines[-3:]:
        m = NUM.match(ln)
        if m:
            return int(m.group(1))
    return None


def fix_numbers(nums):
    """Заполняет пропуски по соседям: печатный = индекс + смещение."""
    offs = collections.Counter(n - i for i, n in enumerate(nums) if n)
    if not offs:
        return nums, None
    off, cnt = offs.most_common(1)[0]
    if cnt < max(3, len(nums) // 10):
        return nums, None
    return [n if n and n - i == off else i + off for i, n in enumerate(nums)], off


def clean(text, header_lines):
    lines = [l for l in text.splitlines()
             if l.strip() and l.strip() not in header_lines
             and not NUM.match(l)]
    t = "\n".join(lines)
    t = re.sub(r"(\w)[-­]\n(\w)", r"\1\2", t)   # пера-\nнос → перанос
    t = re.sub(r"(?<![.:;!?])\n(?=[a-zа-яёіўґ])", " ", t)  # склейка строк абзаца
    return t


def process(pdf_path, out_path):
    d = pymupdf.open(pdf_path)
    raw = [p.get_text() for p in d]
    split = [[l.strip() for l in t.splitlines() if l.strip()] for t in raw]
    # колонтитулы: строки, которые повторяются на многих страницах
    edge = collections.Counter(
        l for ls in split for l in set(ls[:2] + ls[-2:]) if not NUM.match(l))
    header_lines = {l for l, c in edge.items() if c >= max(3, len(d) // 5)}
    nums, offset = fix_numbers([printed_number(ls) for ls in split])
    with open(out_path, "w", encoding="utf-8") as out:
        for i, t in enumerate(raw):
            body = clean(t, header_lines)
            out.write(json.dumps({
                "pdf_page": i + 1, "printed_page": nums[i] if offset is not None else None,
                "needs_ocr": len(t.strip()) < 100, "text": body,
            }, ensure_ascii=False) + "\n")
    return len(d), offset


def main():
    lib, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    for root, _, files in os.walk(lib):
        for f in files:
            if not f.endswith(".pdf"):
                continue
            dst = os.path.join(outdir, f[:-4] + ".pages.jsonl")
            if os.path.exists(dst):
                continue
            try:
                n, off = process(os.path.join(root, f), dst)
                print(f"{f}: {n} стр., смещение нумерации {off}", file=sys.stderr)
            except Exception as e:
                print(f"{f}: ошибка {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
