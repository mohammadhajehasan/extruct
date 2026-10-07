# -*- coding: utf-8 -*-
"""
core/audit.py — السجل التدقيقي: audit.jsonl داخل data/.
يُكتب تلقائياً من: extract / enhance / export / benchmark / learn (وحسب الحاجة group/merge).
كل سطر: {ts, action, target, model, details}
لا يُخزَّن أي مفتاح API هنا أبداً (بند 15.6).
"""
import json
import os
import threading
import time
from typing import Any, Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
AUDIT_PATH = os.path.join(DATA_DIR, "audit.jsonl")

_lock = threading.Lock()


def _ensure_dir() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)


def log(action: str, target: str = "", model: Optional[str] = None,
        details: Any = None) -> dict:
    """إلحاق سطر تدقيق واحد بالملف JSONL (thread-safe)."""
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
              + f".{int((time.time() % 1) * 1000):03d}",
        "action": action,
        "target": target,
        "model": model,
        "details": details if details is not None else {},
    }
    _ensure_dir()
    line = json.dumps(entry, ensure_ascii=False)
    with _lock:
        try:
            with open(AUDIT_PATH, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass  # لا نُفشل العملية الأساسية أبداً بسبب التدقيق
    return entry


def read(limit: int = 50) -> list:
    """آخر `limit` أسطر تدقيق (الأحدث أولاً)."""
    _ensure_dir()
    try:
        with open(AUDIT_PATH, "r", encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if ln.strip()]
    except OSError:
        return []
    out = []
    for ln in reversed(lines[-max(1, int(limit)):]):
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out
