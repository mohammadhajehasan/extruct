# -*- coding: utf-8 -*-
"""
core/extractor.py — المستخرج: استدعاء نموذج الرؤية + base64 + retry أسّي ×3
+ 15.10.5 فشل ذكي: ProviderError مصنّف يمنع المحاولات العبثية (حظر جغرافي/مفتاح
خاطئ يُرفعان فوراً بلا استكمال ×3) ويسمح بتسلسل تراجع واعٍ (/api/extract/failover).
المصدر: الخطة الحاكمة v7.1 — 7.4 + 15.10 + الملاحق (أ) + عقد API (/api/extract).

⚠ مبدأ "انقل ولا تصحّح" ملزم: هذه الوحدة تنقل ما يعيده النموذج حرفياً.
لا يوجد أي تصحيح صامت لقيمة مستخرجة في أي مسار هنا (CONF تُستخدم كاقتراح فقط).
"""
import asyncio
import base64
import csv
import io
import json
import re
import time
from typing import Any, List, Optional, Tuple

import openai

from core.providers import ProviderErrorType, classify_exception, normalize_base_url

# ═══ البرومبتات حرفياً كما في العقد/الخطة ═══

# tables — برومبت CSV حرفي (عقد API §/api/extract)
TABLES_PROMPT = (
    "انسخ الجدول كما هو مكتوب تماماً بدون أي تصحيح، أعد CSV فقط بفواصل، "
    "الخلية الفارغة تبقى فارغة، غير المقروء = UNCLEAR، حافظ على النص العربي كما هو."
)

# mechanic — برومبت 7.4 حرفياً (JSON ثابت المفاتيح)
MECHANIC_PROMPT = (
    "أنت خبير وثائق المركبات السورية. استخرج من الصورة/الصورتين الحقول كما هي "
    "مكتوبة تماماً وأعد JSON فقط بالمفاتيح:\n"
    "vehicle_symbol, chassis_no, engine_no, engine_capacity, manufacture_date,\n"
    "category, plate_no, maker, model, fuel, governorate, passengers, type\n"
    "قواعد: غير موجود=\"\" | غير مقروء=\"UNCLEAR\" | انقل ولا تصحّح | أرقام لاتينية."
)

# classify — تصنيف الصورة (عقد API)
CLASSIFY_PROMPT = (
    "صنّف هذه الصورة إلى واحدة من الفئات فقط: mechanic_card_front | mechanic_card_back | "
    "registration_statement | temp_driving_license | transfer_deed | table_document | unknown. "
    'أعد JSON فقط بالشكل {"label": "...", "confidence": 0.0} دون أي نص آخر.'
)


# ═══ أدوات تحليل متسامحة ═══

def strip_data_prefix(b64: str) -> str:
    """قص بادئة data:image/...;base64, إن وُجدت (الصور تُنقل خاماً حسب العقد)."""
    s = (b64 or "").strip()
    if s.startswith("data:"):
        idx = s.find(",")
        if idx != -1:
            s = s[idx + 1:]
    return s


def parse_json_tolerant(text: str) -> Optional[Any]:
    """
    تحليل JSON متسامح: قص أسوار ```json، ثم أول { وآخر }.
    يعيد None عند الفشل (لا تخمين — الغموض يُعلَّم).
    """
    if not text:
        return None
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s).strip()
    for candidate in (s,):
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            pass
    start, end = s.find("{"), s.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(s[start:end + 1])
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def parse_csv_tolerant(text: str) -> List[List[str]]:
    """تحليل CSV متسامح من رد النموذج (يتجاهل أسوار الكود والأسطر الفارغة الطرفية)."""
    if not text:
        return []
    s = text.strip()
    s = re.sub(r"^```(?:csv)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s).strip()
    rows = []
    for row in csv.reader(io.StringIO(s)):
        if any((c or "").strip() for c in row):
            rows.append([(c or "").strip() for c in row])
    # حذف سطور ترويسة/شرح شائعة من النماذج ("CSV", "Row 1" ...)
    while rows and len(rows[0]) == 1 and rows[0][0].lower().startswith(("csv", "row", "```")):
        rows.pop(0)
    return rows


# ═══ استدعاء مزودات OpenAI-compatible (openai SDK) — كل المزودات بلا استثناء ═══

class ProviderError(RuntimeError):
    """خطأ مزود مصنف — يمنع إعادة المحاولات العبثية ويسمح بتسلسل تراجع واعٍ (15.10.5)."""
    def __init__(self, message, error_type):
        super().__init__(message)
        self.error_type = error_type  # ProviderErrorType


def _call_openai_compat(images_b64: List[str], prompt: str, model: str,
                        base_url: Optional[str], api_key: Optional[str],
                        timeout: float) -> str:
    """chat.completions مع عناصر نص + صور متعددة (يدعم الصورتين في رسالة واحدة).
    يُسوَّى الرابط أولاً: إن لصق المستخدم نقطة نهاية كاملة (مثل
    https://api.unorouter.com/v1/images/generations) نستخرج جذر الـ API (/v1)
    وإلا فسيُبنى POST /v1/images/generations/chat/completions → 404."""
    client = openai.OpenAI(
        api_key=api_key or "ollama",
        base_url=normalize_base_url(base_url) or "http://localhost:11434/v1",
        timeout=timeout,
    )
    content: List[dict] = [{"type": "text", "text": prompt}]
    for b64 in images_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64," + strip_data_prefix(b64)},
        })
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
    )
    return getattr(resp.choices[0].message, "content", "") or ""


# ═══ نقطة الدخول الموحدة مع retry أسّي ×3 (1s, 2s, 4s) ═══

def call_vl(images_b64: List[str], provider: str, model: str,
            base_url: Optional[str] = None, api_key: Optional[str] = None,
            prompt: str = "", timeout: float = 120.0,
            max_attempts: int = 3) -> Tuple[str, int]:
    """
    استدعاء VL عبر مزودات OpenAI-compatible (كل المزودات بما فيها Z.ai — مزود عادي
    مثل غيره: base_url + api_key) مع إعادة المحاولة الأسية ×3 (1s, 2s, 4s).
    يدعم عناصر صور متعددة في رسالة واحدة (openai SDK)؛ دمج وجهي كرت الميكانيك
    يتم في Python عند الحاجة (انظر merge_faces).
    يعيد (text, attempts). يرفع ProviderError (مصنّفاً بـ error_type) عند فشل
    المحاولات، وفوراً بلا ×3 إن كان النوع GEO_BLOCKED/AUTH_INVALID (لا فائدة من إعادة المحاولة).
    """
    images_b64 = [strip_data_prefix(b) for b in (images_b64 or []) if (b or "").strip()]
    if not images_b64:
        raise ValueError("لا توجد صورة صالحة في images_b64")
    if not prompt:
        raise ValueError("البرومبت مطلوب")

    last_err: Optional[Exception] = None
    for attempt in range(1, max_attempts + 1):
        try:
            text = _call_openai_compat(images_b64, prompt, model,
                                       base_url, api_key, timeout)
            if (text or "").strip():
                return text, attempt
            raise ValueError("استجابة فارغة من النموذج")
        except (TimeoutError, RuntimeError, ValueError,
                openai.APIConnectionError, openai.RateLimitError,
                openai.InternalServerError) as e:
            last_err = e
        except Exception as e:  # noqa: BLE001 — أي خطأ آخر يدخل حلقة إعادة المحاولة
            last_err = e
        # 15.10.5: صنّف الخطأ — الحظر الجغرافي/المفتاح الخاطئ بلا فائدة من إعادة
        # المحاولة على نفس المزود، يُرفع فوراً (بلا استكمال ×3 وبلا نوم).
        et = classify_exception(last_err)
        if et in (ProviderErrorType.GEO_BLOCKED, ProviderErrorType.AUTH_INVALID):
            raise ProviderError(
                f"فشل استدعاء النموذج (المحاولة {attempt}/{max_attempts}) — "
                f"[{et.value}]: {last_err}", et)
        if attempt < max_attempts:
            time.sleep(2 ** (attempt - 1))  # 1s, 2s, 4s
    raise ProviderError(
        f"فشل استدعاء النموذج بعد {max_attempts} محاولات: {last_err}",
        classify_exception(last_err))


# ═══ تحليل نتائج الحقول للميكانيك (وجهين أو أكثر) ═══

def normalize_fields(obj: Any) -> dict:
    """تطبيع رد JSON إلى {13 مفتاح: string} — نقل حرفي بلا تصحيح."""
    fields = {k: "" for k in [
        "vehicle_symbol", "chassis_no", "engine_no", "engine_capacity",
        "manufacture_date", "category", "plate_no", "maker", "model",
        "fuel", "governorate", "passengers", "type"]}
    if isinstance(obj, dict):
        for k in fields:
            v = obj.get(k, "")
            if v is None:
                v = ""
            fields[k] = str(v)
    return fields


def merge_faces(face_fields: List[dict]) -> dict:
    """
    دمج وجهي كرت الميكانيك: اتحاد الحقول؛ تعارض بين وجهين ← علم تعارض (7.4).
    يُختار أول قيمة غير فارغة — لا تصحيح ولا تخمين أبداً.
    """
    merged = {k: "" for k in [
        "vehicle_symbol", "chassis_no", "engine_no", "engine_capacity",
        "manufacture_date", "category", "plate_no", "maker", "model",
        "fuel", "governorate", "passengers", "type"]}
    conflicts: List[str] = []
    for k in merged:
        vals = []
        for f in face_fields:
            v = (f.get(k, "") or "").strip()
            if v and v not in vals:
                vals.append(v)
        if len(vals) == 1:
            merged[k] = vals[0]
        elif len(vals) > 1:
            merged[k] = vals[0]
            conflicts.append(k)
    return {"fields": merged, "conflicts": conflicts}


def async_retry_sleep(attempt: int) -> None:
    """نوم غير حاجب بين المحاولات (للاستخدام المستقبلي داخل asyncio)."""
    asyncio.sleep(2 ** (attempt - 1))
