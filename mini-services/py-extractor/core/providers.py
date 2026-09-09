# -*- coding: utf-8 -*-
"""
core/providers.py — جلب ديناميكي للنماذج بالمفتاح + فرز مجاني-أولاً + Fallback مدمج
+ 15.10 المرونة الإقليمية: تصنيف أخطاء المزودين (حظر جغرافي/مفتاح/حد معدل/شبكة)
وفحص توفر خفيف (ping) وترتيب واعٍ بالتوفر الإقليمي.
المصدر: الخطة الحاكمة v7.1 — 3.1 + 15.10 + عقد API (/api/providers/models, /api/providers/health).
"""
from enum import Enum
from typing import Optional
from urllib.parse import urlsplit

import httpx
import openai

# روابط المجانية الدائمة (الخطة 3.1)
ALWAYS_FREE_URLS = ("http://localhost:11434/v1", "https://api.groq.com/openai/v1")

# لواحق نقاط النهاية الشائعة — تُزال لاستخراج جذر الـ API قبل /models أو /chat/completions
# (مثال خطأ شائع: لصق https://api.unorouter.com/v1/images/generations كـ base_url
#  فيُبنى GET /v1/images/generations/models عند client.models.list() → 404)
ENDPOINT_SUFFIXES = (
    "/images/generations", "/images/edits", "/images/variations",
    "/chat/completions", "/completions", "/embeddings", "/responses",
    "/moderations", "/models",
    "/audio/speech", "/audio/transcriptions", "/audio/translations",
)

# إشارات الرؤيوية في اسم النموذج (تشمل عائلة GLM الرؤيوية: glm-4.5v/glm-4v/…)
VISION_HINTS = ("vl", "vision", "gemini", "gpt-4o", "gpt-4.1", "pixtral",
                "llava", "minicpm", "internvl", "molmo", "claude-3",
                "glm-4.5v", "glm-4v", "glm-4.1v", "glm-4.6v")

# القائمة الاحتياطية المدمجة عند فشل الجلب (عقد API — source:"fallback")
FALLBACK_MODELS = [
    {"name": "qwen2.5-vl-7b-instruct:free (openrouter)", "free": True, "vision": True},
    {"name": "llama-3.2-90b-vision-instruct (groq)", "free": True, "vision": True},
    {"name": "gpt-4o-mini", "free": False, "vision": True},
    {"name": "gemini-2.0-flash", "free": False, "vision": True},
]

# قوائم احتياطية موجهة حسب المزود — تُختار بمطابقة المضيف في base_url
# (بعض المزودات مثل Z.ai قد لا تعيد قائمة /models فتُعرض نماذجها الحقيقية المعروفة)
_GLM_FALLBACK = [
    {"name": "glm-4.5v", "free": False, "vision": True},
    {"name": "glm-4v-plus", "free": False, "vision": True},
    {"name": "glm-4v-flash", "free": True, "vision": True},
    {"name": "glm-4.6", "free": False, "vision": False},
]
FALLBACK_BY_HOST = (
    ("api.z.ai", _GLM_FALLBACK),
    ("open.bigmodel.cn", _GLM_FALLBACK),
)


def normalize_base_url(base_url: Optional[str]) -> str:
    """
    تسوية base_url: إزالة الفراغات والشرطات الطرفية ولواحق نقاط النهاية الكاملة
    للوصول إلى جذر الـ API الصحيح الذي تُبنى عليه /models و /chat/completions.
    مثال: https://api.unorouter.com/v1/images/generations → https://api.unorouter.com/v1
    """
    u = (base_url or "").strip().rstrip("/")
    changed = True
    while changed:
        changed = False
        low = u.lower()
        for suf in ENDPOINT_SUFFIXES:
            if low.endswith(suf) and len(u) > len(suf):
                u = u[: -len(suf)].rstrip("/")
                changed = True
                break
    return u


def _is_free(name: str, meta, url: str) -> bool:
    """حكم المجانية: رابط دائم المجانية، أو :free/-free، أو تسعير OpenRouter صفر."""
    try:
        if any(url.startswith(u) for u in ALWAYS_FREE_URLS):
            return True
        n = (name or "").lower()
        if ":free" in n or n.endswith("-free"):
            return True
        if meta:  # OpenRouter يعرض التسعير ضمن /models
            pr = meta.get("pricing", {}) or {}
            if float(pr.get("prompt", 1)) == 0 and float(pr.get("completion", 1)) == 0:
                return True
    except (TypeError, ValueError):
        pass
    return False


def _is_vision(name: str) -> bool:
    n = (name or "").lower()
    return any(h in n for h in VISION_HINTS)


def fetch_models(base_url: str, api_key: Optional[str] = None,
                 timeout: int = 20) -> list:
    """جلب كل النماذج المتاحة للمفتاح عبر openai SDK (live) — بعد تسوية الرابط."""
    root = normalize_base_url(base_url)
    client = openai.OpenAI(api_key=api_key or "ollama", base_url=root,
                           timeout=timeout)
    models = []
    for m in getattr(client.models.list(), "data", []):
        meta = getattr(m, "model_extra", None) or {}
        models.append({
            "name": m.id,
            "free": _is_free(m.id, meta, root),
            "vision": _is_vision(m.id),
        })
    return models


def sort_models(models: list) -> list:
    """★ مجاني رؤيوي أولاً دائماً ثم رؤيوي ثم الاسم (الخطة 3.1)."""
    return sorted(models, key=lambda m: (not m.get("free", False),
                                         not m.get("vision", False),
                                         m.get("name", "")))


# ═══ 15.10 المرونة الإقليمية: تصنيف الأخطاء + فحص التوفر + الترتيب الواعي ═══

class ProviderErrorType(Enum):
    """تصنيفات أخطاء المزودين (15.10.2) — لا رسالة عامة "فشل الاتصال"."""
    GEO_BLOCKED  = "geo_blocked"    # 403/451 أو "unsupported_country_region_territory"
    AUTH_INVALID = "auth_invalid"   # 401 مفتاح خاطئ/منتهي
    RATE_LIMITED = "rate_limited"   # 429
    NETWORK_DOWN = "network_down"   # timeout/DNS/اتصال مقطوع
    UNKNOWN      = "unknown"


# رسائل الواجهة العربية الملزمة — تُعرض كما هي حرفياً (تعتمد عليها الواجهة 10-b)
ERROR_TYPE_AR = {
    ProviderErrorType.GEO_BLOCKED:
        "هذا المزود غير متاح بمنطقتك حالياً — جرّب مزوداً آخر أو نموذجاً محلياً",
    ProviderErrorType.AUTH_INVALID:
        "مفتاح API غير صحيح أو منتهٍ — تحقق من الإعدادات",
    ProviderErrorType.RATE_LIMITED:
        "🟠 تجاوزت حد معدل الطلبات أو الحصة المتاحة لدى المزود (429/402) — انتظر قليلاً، أو غيّر النموذج، أو أضف رصيداً ثم أعد المحاولة",
    ProviderErrorType.NETWORK_DOWN:
        "تعذر الوصول إلى المزود (مهلة أو اتصال مقطوع) — تحقق من الشبكة أو الرابط",
    ProviderErrorType.UNKNOWN:
        "فشل غير متوقع لدى المزود",
}

# أنماط نصية للحظر الجغرافي — إضافة إلى 403/451 حرفية الخطة (15.10.2)
# تكمل نية 15.10.1: Google Gemini المحجوب جغرافياً يرجع 400
# "User location is not supported" وليس 403/451.
_GEO_TEXT_PATTERNS = (
    "unsupported_country",                 # صيغة OpenAI الرسمية
    "user location is not supported",      # صيغة Gemini الفعلية
    "location is not supported",
)
# 16: أنماط نصية لحد المعدل/الحصة — OpenRouter وغيره يرجعون 429/402 بنصوص
# متغيرة (free-models-per-day، insufficient credits، quota) قد تصل بلا status_code
_RATE_TEXT_PATTERNS = (
    "rate limit",
    "ratelimit",
    "too many requests",
    "quota",
    "free-models-per-day",
    "insufficient credits",
    "monthly limit",
)


def classify_provider_error(status_code, text: str = "") -> ProviderErrorType:
    """تصنيف من (رمز HTTP، نص الاستجابة) حسب 15.10.2 حرفياً.
    إضافة موثقة لنية 15.10.1 (التي تذكر Gemini صراحة ضمن المحظورين جغرافياً):
    Google ترجع 400 "User location is not supported" بدل 403 — نفس الحظر الجغرافي.
    """
    low = (text or "").lower()
    if status_code in (403, 451) or any(p in low for p in _GEO_TEXT_PATTERNS):
        return ProviderErrorType.GEO_BLOCKED
    if status_code == 401:
        return ProviderErrorType.AUTH_INVALID
    if status_code in (429, 402):  # 402 = رصيد/حصة مستنزفة — نفس عائلة الحد
        return ProviderErrorType.RATE_LIMITED
    if status_code is None:
        return ProviderErrorType.NETWORK_DOWN
    return ProviderErrorType.UNKNOWN


def classify_exception(e: BaseException) -> ProviderErrorType:
    """تصنيف استثناء فعلي (استثناءات openai غالباً — e.status_code + نصها).
    النص يُفحص أولاً بحثاً عن أنماط الحظر الجغرافي (قد تأتي مع 403/400)،
    ثم أخطاء الشبكة، ثم رمز الحالة إن وُجد، وإلا UNKNOWN."""
    text = str(e) or ""
    low = text.lower()
    if any(p in low for p in _GEO_TEXT_PATTERNS):
        return ProviderErrorType.GEO_BLOCKED
    if any(p in low for p in _RATE_TEXT_PATTERNS):
        return ProviderErrorType.RATE_LIMITED
    if isinstance(e, (openai.APITimeoutError, openai.APIConnectionError,
                      TimeoutError, ConnectionError,
                      httpx.TimeoutException, httpx.NetworkError)):
        return ProviderErrorType.NETWORK_DOWN
    status = getattr(e, "status_code", None)
    if status is not None:
        return classify_provider_error(status, text)
    return ProviderErrorType.UNKNOWN


def _host_of(root: str) -> str:
    """مضيف جذر الـ API بعد التسوية (مثل api.z.ai أو localhost:11434)."""
    try:
        return urlsplit(root).netloc or root
    except ValueError:
        return root


def ping_provider(base_url: str, api_key: Optional[str] = None,
                  timeout: float = 8.0) -> dict:
    """فحص توفر خفيف جداً (15.10.3): GET واحد على {root}/models عبر httpx
    مع ترويسة Authorization Bearer عند وجود مفتاح (بدون مفتاح لـ ollama).
    يعيد {available, status, error_type, error_ar, host, suggested_model}.
    لا يُخزَّن أي شيء على القرص ولا يُسجَّل المفتاح إطلاقاً."""
    root = normalize_base_url(base_url)
    out = {"available": False, "status": None, "error_type": None,
           "error_ar": None, "host": _host_of(root), "suggested_model": None}
    if not root:
        et = ProviderErrorType.UNKNOWN
        out["error_type"] = et.value
        out["error_ar"] = "رابط المزود فارغ أو غير صالح"
        return out
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        resp = httpx.get(root + "/models", headers=headers, timeout=timeout)
        out["status"] = resp.status_code
        if resp.status_code == 200:
            out["available"] = True
            try:  # استخراج أول نموذج رؤيوي — best-effort لا يفشل الفحص كله
                data = resp.json()
                items = None
                if isinstance(data, dict):
                    items = data.get("data")
                    if not isinstance(items, list):
                        items = data.get("models")
                ids = []
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, dict) and it.get("id"):
                            ids.append(str(it["id"]))
                        elif isinstance(it, str) and it.strip():
                            ids.append(it.strip())
                if ids:
                    vision = [i for i in ids if _is_vision(i)]
                    out["suggested_model"] = vision[0] if vision else ids[0]
            except Exception:  # noqa: BLE001 — تحليل best-effort
                pass
        else:
            et = classify_provider_error(resp.status_code, resp.text)
            out["error_type"] = et.value
            out["error_ar"] = ERROR_TYPE_AR[et]
        return out
    except (httpx.TimeoutException, httpx.NetworkError):
        et = ProviderErrorType.NETWORK_DOWN
        out["error_type"] = et.value
        out["error_ar"] = ERROR_TYPE_AR[et]
        return out
    except Exception as e:  # noqa: BLE001 — أي فحص فاشل يبقى استجابة لا رمياً
        et = ProviderErrorType.UNKNOWN
        out["error_type"] = et.value
        out["error_ar"] = f"{ERROR_TYPE_AR[et]} ({type(e).__name__}: {str(e)[:120]})"
        return out


def sort_models_regional(models: list, provider_status: dict) -> list:
    """ترتيب 15.10.4: المتاح فعلياً بمنطقتك أولاً ثم المجاني ثم الأرخص.
    (تُطبق فعلياً على مستوى المزود في الواجهة — جاهزة للعقد.)"""
    return sorted(models, key=lambda m: (
        not provider_status.get(m.get("provider", ""), {}).get("available", True),
        not m.get("free", False),
        m.get("cost", 0)))


def models_payload(base_url: str, api_key: Optional[str] = None,
                   timeout: int = 20) -> dict:
    """حمولة POST /api/providers/models — live أو fallback.
    الخطأ العربي مُصنَّف وواضح (يجيب «لماذا هذا الخطأ؟»):
    - بلا مفتاح + 401/400 → «لا يوجد مفتاح محفوظ — الصق مفتاحك واضغط حفظ المفتاح»
    - بمفتاح + 401       → «المفتاح المحفوظ مرفوض — غير صحيح أو منتهٍ»
    - حظر جغرافي (403/451/unsupported_country) → «محظور بمنطقة الخادم — استخدم مزوداً آخر أو وسيطاً»
    """
    try:
        models = sort_models(fetch_models(base_url, api_key, timeout))
        if not models:
            raise ValueError("لم يُرجع المزود أي نموذج")
        return {"ok": True, "models": models, "source": "live"}
    except Exception as e:  # noqa: BLE001 — أي فشل → fallback واضح
        root = normalize_base_url(base_url)
        hint = ""
        if root != (base_url or "").strip().rstrip("/"):
            hint = f" (جُرِّب جذر الـ API المُسوَّى: {root})"
        low = root.lower()
        fallback = FALLBACK_MODELS
        for host, host_models in FALLBACK_BY_HOST:
            if host in low:
                fallback = host_models
                break
        # ---- رسالة عربية مُصنَّفة حسب السبب الفعلي (بدل الخطأ الخام المخل) ----
        et = classify_exception(e)
        has_key = bool((api_key or "").strip())
        status = getattr(e, "status_code", None)
        raw = str(e)[:180]
        if et == ProviderErrorType.GEO_BLOCKED:
            error = ("🔴 هذا المزود محظور جغرافياً في منطقة الخادم — لا يمكن جلب نماذجه من هنا. "
                     "اختر مزوداً 🟢 متاحاً أو أدخل رابط خادم وسيط عبر مزود «مخصص».")
        elif not has_key and status in (400, 401):
            error = ("🔑 لا يوجد مفتاح API محفوظ لهذا المزود — الصق مفتاحك في حقل api_key "
                     "ثم اضغط «حفظ المفتاح» لجلب النماذج الحقيقية. (عُرضت قائمة احتياطية)")
        elif et == ProviderErrorType.AUTH_INVALID:
            error = ("🟡 المفتاح المحفوظ مرفوض من المزود — غير صحيح أو منتهٍ. "
                     "تأكد من نسخه كاملاً ثم احفظه من جديد. (عُرضت قائمة احتياطية)")
        elif et == ProviderErrorType.RATE_LIMITED:
            error = "🟠 تجاوزت حد معدل الطلبات لدى المزود — انتظر قليلاً ثم أعد «جلب النماذج»."
        elif et == ProviderErrorType.NETWORK_DOWN:
            error = f"⚫ تعذر الوصول إلى المزود (مهلة أو شبكة) — تحقق من base_url والاتصال{hint}."
        else:
            error = f"فشل جلب النماذج من {base_url}{hint}: {raw}"
        return {
            "ok": False,
            "error": error,
            "detail": raw,
            "models": fallback,
            "source": "fallback",
        }
