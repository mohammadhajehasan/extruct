# -*- coding: utf-8 -*-
"""
core/verifier.py — المدقِّق: برومبت مرور ثانٍ يؤكد/يصحّح كل حقل مع ثقة HIGH/MED/LOW.
المصدر: الخطة الحاكمة v7.1 — 8.2 + عقد API (mode=verify في /api/extract).
المدقِّق يقترح تصحيحات مُعلَّمة بالثقة — لا يعدّل القيم المخزنة تلقائياً أبداً.
"""
import json
from typing import Optional

from core.extractor import parse_json_tolerant
from core.glossary import MECHANIC_KEYS

VERIFY_PROMPT_TEMPLATE = (
    "أنت مدقّق دقيق لوثائق المركبات السورية. هذه قيم الحقول المستخرجة في المرور الأول:\n"
    "{fields_json}\n"
    "قارن كل قيمة بالصورة المرفقة حرفياً. أعد JSON فقط بالشكل:\n"
    '{{"corrections": {{"<field>": {{"value": "<القيمة كما هي مكتوبة في الصورة>", '
    '"confidence": "HIGH"|"MED"|"LOW"}}}}}}, "notes": "<ملاحظة قصيرة أو فرغ>"\n'
    "قواعد: أدرج فقط الحقول التي تحتاج تأكيداً أو تصحيحاً | انقل ولا تصحّح من معرفتك | "
    "غير المقروء = UNCLEAR | أرقام لاتينية."
)

VERIFY_PROMPT_GENERIC = (
    "أنت مدقّق دقيق لوثائق المركبات/الجداول. افحص الصورة وأكّد أو صحّح القيم النصية "
    "الظاهرة فيها. أعد JSON فقط بالشكل "
    '{{"corrections": {"<field>": {"value": "...", "confidence": "HIGH"|"MED"|"LOW"}}}} '
    "قواعد: انقل ولا تصحّح من معرفتك | غير المقروء = UNCLEAR."
)


def build_verify_prompt(current_fields: Optional[dict] = None,
                        current_text: Optional[str] = None) -> str:
    """بناء برومبت المرور الثاني — حقول الميكانيك أو نص جدول."""
    if current_fields:
        slim = {k: current_fields.get(k, "") for k in MECHANIC_KEYS
                if k in current_fields}
        if not slim:
            slim = {k: str(v) for k, v in list(current_fields.items())[:15]}
        return VERIFY_PROMPT_TEMPLATE.format(
            fields_json=json.dumps(slim, ensure_ascii=False))
    if current_text:
        return VERIFY_PROMPT_TEMPLATE.format(fields_json=current_text[:2000])
    return VERIFY_PROMPT_GENERIC


def parse_verify_response(text: str) -> Optional[dict]:
    """تحليل رد المدقّق: {corrections:{field:{value,confidence}}, notes?} متسامح."""
    data = parse_json_tolerant(text)
    if not isinstance(data, dict):
        return None
    corrections = data.get("corrections")
    if not isinstance(corrections, dict):
        return None
    out = {"corrections": {}, "notes": str(data.get("notes", "") or "")}
    for k, v in corrections.items():
        if isinstance(v, dict):
            out["corrections"][str(k)] = {
                "value": str(v.get("value", "")),
                "confidence": str(v.get("confidence", "LOW")).upper(),
            }
        else:
            out["corrections"][str(k)] = {"value": str(v), "confidence": "MED"}
    return out
