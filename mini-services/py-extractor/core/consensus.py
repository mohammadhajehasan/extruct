# -*- coding: utf-8 -*-
"""
core/consensus.py — محرك الإجماع: تصويت نماذج لكل حقل.
المصدر: الخطة الحاكمة v7.1 — 8.4 + عقد API (/api/consensus).
اتفاق كامل → HIGH؛ خلاف → REVIEW مع ذكر القيم. لا تصحيح صامت أبداً.
"""
from collections import Counter
from typing import List

from core.glossary import MECHANIC_KEYS


def consensus_fields(results: List[dict]) -> dict:
    """
    results: [{source:string, fields:{field:string}}]
    يعيد {fields:{field:{value, confidence, votes:[{source,value}]}}, review_count}
    - القيمة المختارة = القيمة الغالبة (الأكثر تكراراً؛ التعادل → أول قيمة غير فارغة).
    - "" تُهمل في التصويت ما دامت هناك قيمة غير فارغة، لكنها تظهر في votes.
    """
    fields_out = {}
    review_count = 0
    all_keys = []
    for r in results:
        for k in (r.get("fields") or {}):
            if k not in all_keys:
                all_keys.append(k)
    for k in MECHANIC_KEYS:  # ثبّت ترتيب الحقول الـ13 أولاً
        if k not in all_keys:
            all_keys.append(k)

    for k in all_keys:
        votes = []
        present = False
        for r in results:
            f = r.get("fields") or {}
            if k in f:
                present = True
            v = str(f.get(k, "") or "")
            votes.append({"source": r.get("source", "?"), "value": v})
        non_empty = [v["value"] for v in votes
                     if v["value"].strip() and v["value"].strip() != "UNCLEAR"]
        distinct = set(non_empty)
        if len(results) == 0:
            continue
        if not non_empty:
            if not present:
                # لا أحد ذكر الحقل إطلاقاً — ليس خلافاً يُدرج في طابور المراجعة
                fields_out[k] = {"value": "", "confidence": "LOW", "votes": votes,
                                 "reason_ar": "غير مذكور في أي مصدر"}
            else:
                # كل المصادر ذكرته لكنه فارغ/UNCLEAR — قيمة "" بثقة LOW
                fields_out[k] = {"value": "", "confidence": "LOW", "votes": votes,
                                 "reason_ar": "كل المصادر فارغة أو غير مقروءة"}
                review_count += 1
        elif len(distinct) == 1:
            fields_out[k] = {"value": non_empty[0], "confidence": "HIGH",
                             "votes": votes}
        else:
            # خلاف — الغالبة أولاً ثم REVIEW مع ذكر القيم (لا اختيار صامت للصواب)
            cnt = Counter(non_empty)
            best_val, best_n = cnt.most_common(1)[0]
            total = len(non_empty)
            conf = "MED" if best_n > total / 2 else "REVIEW"
            reason = ("خلاف بين المصادر: " + " | ".join(sorted(distinct))
                      + (f" — الغالبة ({best_n}/{total})" if conf == "MED" else ""))
            if conf == "REVIEW":
                review_count += 1
            fields_out[k] = {"value": best_val, "confidence": conf,
                             "votes": votes, "reason_ar": reason}
    return {"fields": fields_out, "review_count": review_count}
