# -*- coding: utf-8 -*-
"""
core/evaluator.py — المقيّم: درجة جودة نتيجة CSV (صفوف/خلايا/اتساق أعمدة).
المصدر: الخطة الحاكمة v7.1 — الجزء 2 (المقيّم) + 3.2 (score لنتائج المقارنة).
"""
from typing import List


def score_rows(rows: List[List[str]]) -> dict:
    """
    تقييم جدول مُستخرج:
    - rows_count: عدد الصفوف
    - cells_nonempty: خلايا غير فارغة
    - col_consistency: اتساق عدد الأعمدة (نسبة العمود الغالب)
    - score: درجة 0..1 = 0.2*(وجود صفوف) + 0.4*(امتلاء الخلايا) + 0.4*(اتساق الأعمدة)
    + cells: عدد الخلايا الكلي (يستهلكه benchmark)
    """
    rows = [r for r in (rows or []) if isinstance(r, list)]
    rows_count = len(rows)
    cells = sum(len(r) for r in rows)
    nonempty = sum(1 for r in rows for c in r if (c or "").strip())
    fill = (nonempty / cells) if cells else 0.0
    consistency = 0.0
    if rows_count:
        widths = [len(r) for r in rows]
        counts = {}
        for w in widths:
            counts[w] = counts.get(w, 0) + 1
        mode_w = max(counts.values())
        consistency = mode_w / rows_count
    score = 0.0
    if rows_count >= 1:
        score += 0.2
        score += 0.4 * fill
        score += 0.4 * consistency
    return {
        "rows_count": rows_count,
        "cells": cells,
        "cells_nonempty": nonempty,
        "col_consistency": round(consistency, 4),
        "fill_ratio": round(fill, 4),
        "score": round(score, 4),
    }


def score_csv_text(text: str) -> dict:
    """تقييم مباشر لنص CSV (بلا تحليل معقد — يستخدم parse_csv_tolerant)."""
    from core.extractor import parse_csv_tolerant
    return score_rows(parse_csv_tolerant(text))
