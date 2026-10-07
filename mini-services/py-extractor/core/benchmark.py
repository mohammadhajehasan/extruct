# -*- coding: utf-8 -*-
"""
core/benchmark.py — محرك المقارنة: سباق نماذج + مصفوفة توافق pairwise + فائز + تقرير CSV.
المصدر: الخطة الحاكمة v7.1 — 3.2 + عقد API (/api/benchmark).
"""
import io
import time
from typing import Callable, List

from core.evaluator import score_rows
from core.extractor import TABLES_PROMPT, call_vl, parse_csv_tolerant
from core.merger import normalize_cell


def _grid(rows: List[List[str]]) -> List[str]:
    return [normalize_cell(c) for r in rows for c in r]


def pairwise_agreement(rows_a: List[List[str]], rows_b: List[List[str]]) -> float:
    """نسبة تشابه الخلايا بين نتيجتين (على الخلايا المُطبَّعة، طول الاتحاد)."""
    ga, gb = _grid(rows_a), _grid(rows_b)
    if not ga and not gb:
        return 1.0
    n = max(len(ga), len(gb))
    if n == 0:
        return 0.0
    same = sum(1 for i in range(min(len(ga), len(gb))) if ga[i] == gb[i])
    return round(same / n, 4)


def run_benchmark(image_b64: str, models: List[str], provider: str,
                  base_url: str = None, api_key: str = None,
                  timeout: float = 120.0) -> dict:
    """
    سباق استخراج الجداول لكل نموذج + درجة لكل نتيجة + مصفوفة توافق + فائز + تقرير CSV.
    (المقارنة تعمل على كل المزودات عبر openai-compatible — Z.ai مزود عادي مثل غيره:
    base_url + api_key، فلا يوجد استثناء لسباق متعدد النماذج.)
    """
    results = []
    grids = {}
    for model in models:
        t0 = time.time()
        try:
            text, _att = call_vl([image_b64], provider=provider, model=model,
                                 base_url=base_url, api_key=api_key,
                                 prompt=TABLES_PROMPT, timeout=timeout)
            rows = parse_csv_tolerant(text)
            ev = score_rows(rows)
            results.append({"model": model, "csv": text, "cells": ev["cells"],
                            "score": ev["score"], "elapsed_ms": int((time.time() - t0) * 1000),
                            "error": ""})
            grids[model] = rows
        except Exception as e:  # noqa: BLE001 — نموذج فاشل لا يُفشل السباق
            results.append({"model": model, "csv": "", "cells": 0, "score": 0.0,
                            "elapsed_ms": int((time.time() - t0) * 1000),
                            "error": str(e)})
            grids[model] = []

    agreement_matrix = {}
    ok_models = [r["model"] for r in results if not r["error"]]
    for i, a in enumerate(ok_models):
        for b in ok_models[i + 1:]:
            agreement_matrix[f"{a}|{b}"] = pairwise_agreement(grids[a], grids[b])

    winner = ""
    scored = [r for r in results if not r["error"]]
    if scored:
        best = max(scored, key=lambda r: (r["score"], r["cells"]))
        winner = best["model"]

    # تقرير CSV
    buf = io.StringIO()
    buf.write("model,score,cells,elapsed_ms,error\n")
    for r in results:
        buf.write(f'"{r["model"]}",{r["score"]},{r["cells"]},{r["elapsed_ms"]},"{r["error"]}"\n')
    buf.write("\nagreement_matrix\n")
    for k, v in agreement_matrix.items():
        buf.write(f'"{k}",{v}\n')
    if winner:
        buf.write(f'\nwinner,"{winner}"\n')

    return {"results": results, "agreement_matrix": agreement_matrix,
            "winner": winner, "csv_report": buf.getvalue()}
