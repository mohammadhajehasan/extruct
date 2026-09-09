# -*- coding: utf-8 -*-
"""
core/merger.py — الدمج: تطبيع عربي→لاتيني للمقارنة + كشف تكرار boundary/global.
المصدر: الخطة الحاكمة v7.1 — الجزء 9 + عقد API (/api/merge).
التطبيع للمقارنة فقط — القيم المُعادة تبقى كما هي حرفياً.
"""
import re
import unicodedata
from typing import List, Tuple

# خريطة تطبيع عربي→لاتيني (للمقارنة فقط)
AR2LAT = {
    "ا": "a", "أ": "a", "إ": "a", "آ": "a", "ء": "", "ئ": "y", "ؤ": "w",
    "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
    "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh",
    "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh",
    "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n",
    "ه": "h", "و": "w", "ي": "y", "ة": "h", "ى": "a", "ٱ": "a",
}
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u0640]")  # تشكيل + تطويل


def normalize_cell(text: str) -> str:
    """تطبيع خلية للمقارنة: تشكيل، أرقام عربية→لاتينية، عربي→لاتيني، صغير، فراغات."""
    s = str(text or "")
    s = DIACRITICS.sub("", s)
    s = s.translate(ARABIC_DIGITS)
    s = unicodedata.normalize("NFKC", s)
    s = "".join(AR2LAT.get(ch, ch) for ch in s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _row_key(row: List[str]) -> str:
    return "¦".join(normalize_cell(c) for c in row)


def merge_rows(rows: List[List[str]], mode: str = "boundary") -> Tuple[List[List[str]], int]:
    """
    mode="boundary": يزيل التكرار المتلاصق فقط (مقارنة بالصف المحفوظ السابق).
    mode="global": يزيل كل تكرار في أي مكان مع إبقاء أول ظهور.
    يعيد (rows_after, removed_count) — الترتيب الأصلي محفوظ.
    """
    out: List[List[str]] = []
    removed = 0
    if mode == "global":
        seen = set()
        for row in rows or []:
            key = _row_key(row)
            if key in seen:
                removed += 1
                continue
            seen.add(key)
            out.append(row)
    else:  # boundary
        prev_key = None
        for row in rows or []:
            key = _row_key(row)
            if key == prev_key:
                removed += 1
                continue
            out.append(row)
            prev_key = key
    return out, removed
