# -*- coding: utf-8 -*-
"""
core/kb.py — قاعدة المعرفة: تعلم التصحيحات + خبرة سلاسل التحسين + few-shot.
الملف: data/kb.json — لا يُخزَّن أي مفتاح API (بند 15.6).
"""
import json
import os
import threading
import time
from typing import Optional

from core.audit import DATA_DIR

KB_PATH = os.path.join(DATA_DIR, "kb.json")

_lock = threading.Lock()

_EMPTY = {"entries": [], "chains": []}


def _load() -> dict:
    try:
        with open(KB_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return json.loads(json.dumps(_EMPTY))
        data.setdefault("entries", [])
        data.setdefault("chains", [])
        return data
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(_EMPTY))


def _save(data: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = KB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, KB_PATH)


def learn(scope: str, field: str, wrong: str, right: str,
          context: Optional[str] = None) -> int:
    """تسجيل تصحيح (خطأ → صواب). التكرار نفسه يرفع count (وزن أعلى في few-shot)."""
    with _lock:
        kb = _load()
        for e in kb["entries"]:
            if (e.get("scope") == scope and e.get("field") == field
                    and e.get("wrong") == wrong and e.get("right") == right):
                e["count"] = int(e.get("count", 1)) + 1
                e["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                if context:
                    e["context"] = context
                _save(kb)
                return len(kb["entries"])
        kb["entries"].append({
            "scope": scope, "field": field, "wrong": wrong, "right": right,
            "context": context or "", "count": 1,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        _save(kb)
        return len(kb["entries"])


def _similarity(a: str, b: str) -> float:
    """تشابه بسيط 0..1 (difflib) لترتيب الأقرب."""
    import difflib
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def fewshot(field: str, wrong: Optional[str] = None, limit: int = 5) -> list:
    """أقرب/أقوى التصحيحات للعرض (few-shot)."""
    with _lock:
        kb = _load()
    shots = [e for e in kb["entries"] if e.get("field") == field]
    if wrong:
        shots.sort(key=lambda e: (0.7 * _similarity(wrong, e.get("wrong", ""))
                                  + 0.3 * min(float(e.get("count", 1)) / 10.0, 1.0)),
                   reverse=True)
    else:
        shots.sort(key=lambda e: int(e.get("count", 1)), reverse=True)
    return [{"wrong": e.get("wrong", ""), "right": e.get("right", ""),
             "count": int(e.get("count", 1))} for e in shots[:limit]]


def stats() -> dict:
    """عدد المدخلات + توزيعها على الحقول + سلاسل التحسين الناجحة."""
    with _lock:
        kb = _load()
    by_field = {}
    for e in kb["entries"]:
        by_field[e.get("field", "?")] = by_field.get(e.get("field", "?"), 0) + 1
    return {
        "entries": len(kb["entries"]),
        "by_field": by_field,
        "chains": kb["chains"][-20:],
    }


def record_chain(scope: str, chain: list, score: float) -> None:
    """حفظ سلسلة تحسين ناجحة (يستدعيها tuner عند تجاوز العتبة)."""
    with _lock:
        kb = _load()
        kb["chains"].append({
            "scope": scope,
            "chain": chain,
            "score": round(float(score), 4),
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })
        kb["chains"] = kb["chains"][-50:]
        _save(kb)
