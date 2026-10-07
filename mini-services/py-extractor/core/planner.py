# -*- coding: utf-8 -*-
"""
core/planner.py — المخطِّط: يبني سلسلة معالجة مُسبَّبة (step + reason_ar) لكل خطوة.
المصدر: الخطة الحاكمة v7.1 — 6.2 / 6.3 (البروفايلات الثمانية) + عقد API (/api/enhance).
"""
from core.analyzer import TH

# ── البروفايلات الثمانية (6.3) ──
PROFILES = {
    "none": {
        "name_ar": "بدون",
        "desc_ar": "لا تحسين — يُطبَّق الاختتام Stretch فقط",
        "steps": ["stretch"],
    },
    "darken_clarity": {
        "name_ar": "تغميق ووضوح ⭐",
        "desc_ar": "الافتراضي الذكي: upscale→gray→shadow→clahe(≤1.2)→close(2×2)→micro-unsharp→stretch(2–98)",
        "steps": ["upscale", "gray", "shadow", "clahe", "close", "micro", "stretch"],
    },
    "manual_safe": {
        "name_ar": "يدوي آمن",
        "desc_ar": "سلسلة خفيفة آمنة: bilateral→micro_soft→stretch",
        "steps": ["bilateral", "micro_soft", "stretch"],
    },
    "strong_shadow": {
        "name_ar": "ظل قوي",
        "desc_ar": "قسمة خلفية σ75→clahe→stretch",
        "steps": ["gray", "shadow", "clahe", "stretch"],
    },
    "high_noise_safe": {
        "name_ar": "ضجيج عالي آمن",
        "desc_ar": "bilateral→close→stretch (بلا NLM قوي)",
        "steps": ["bilateral", "close", "stretch"],
    },
    "low_res": {
        "name_ar": "دقة منخفضة",
        "desc_ar": "تكبير×2→gray→micro-unsharp→stretch",
        "steps": ["upscale", "gray", "micro", "stretch"],
    },
    "stamped": {
        "name_ar": "مختوم",
        "desc_ar": "قناع HSV + Inpaint للختم ثم clahe→stretch",
        "steps": ["inpaint_stamp", "gray", "clahe", "stretch"],
    },
    "official_document": {
        "name_ar": "وثيقة رسمية",
        "desc_ar": "gray→shadow σ60→clahe_micro→close→stretch — بلا sharpen حمايةً للأختام",
        "steps": ["gray", "shadow60", "clahe_micro", "close", "stretch"],
    },
}

PROFILES_ORDER = ["none", "darken_clarity", "manual_safe", "strong_shadow",
                  "high_noise_safe", "low_res", "stamped", "official_document"]

# أسباب ثابتة لكل خطوة (reason_ar)
STEP_REASONS = {
    "upscale": "تكبير ×2 لرفع دقة الحروف الصغيرة",
    "gray": "تحويل إلى تدرج رمادي لتوحيد المعالجة",
    "shadow": "إزالة الظل/التدرج بقسمة الخلفية (σ75)",
    "shadow60": "إزالة الظل بقسمة الخلفية (σ60) بحماية الأختام",
    "clahe": "CLAHE بحد 1.2 لرفع التباين دون مبالغة",
    "clahe_micro": "CLAHE خفيف (1.1) لتفادي تفعيل نصوص الأختام",
    "close": "Close(2×2) لتغميق الحروف ووصل المتكسر منها",
    "micro": "Micro-Unsharp (1.3/σ1.5) لحدة خفيفة آمنة",
    "micro_soft": "Unsharp خفيف جداً (0.6) مع الحفاظ على الأختام",
    "bilateral": "Bilateral لإزالة الضجيج مع الحفاظ على الحواف",
    "inpaint_stamp": "قناع HSV + Inpaint لإزالة الختم",
    "stretch": "الاختتام: Stretch(2–98) لتوسيع التباين",
    "deskew": "تصحيح الميل بالدوران",
    "perspective": "تصحيح المنظور (توحيد زوايا الصفحة)",
}

# أولوية قواعد المشاكل (الأعلى أولاً) — RULES مرتبة بالأولوية
def _problem_rules(analysis: dict) -> list:
    """قواعد المشاكل مرتبة بالأولوية؛ كل قاعدة تعيد (خطوة، سبب ديناميكي)."""
    f = analysis.get("flags", {}) if isinstance(analysis, dict) else {}
    rules = []
    if f.get("perspective_distorted"):
        rules.append(("perspective",
                      f"انحراف منظور {analysis.get('perspective', 0)}° يتجاوز "
                      f"{TH['perspective_deg']:.0f}°"))
    if f.get("skewed"):
        rules.append(("deskew",
                      f"ميل النص {analysis.get('skew_angle', 0)}° يتجاوز "
                      f"{TH['skew_deg']:.0f}°"))
    return rules


def build_plan(analysis: dict, profile: str) -> list:
    """
    يبني [{step, reason_ar}] مرتبة:
    خطوات المشاكل (بالأولوية) ← خطوات البروفايل ← الشرح الديناميكي لكل خطوة.
    profile=none ⇒ stretch فقط (حسب العقد) دون أي خطوة إضافية.
    """
    prof = PROFILES.get(profile, PROFILES["darken_clarity"])
    plan = []
    if profile != "none":
        for step, dyn_reason in _problem_rules(analysis):
            if step in prof["steps"]:
                continue  # البروفايل يعالجها أصلاً — يبقى سببه الثابت
            plan.append({"step": step, "reason_ar": dyn_reason})
    for step in prof["steps"]:
        reason = dict(STEP_REASONS).get(step, f"خطوة {step} ضمن بروفايل {prof['name_ar']}")
        # سبب ديناميكي أدق لخطوات التباين/الضجيج/الدقة إن توفر قياس
        if step in ("clahe", "clahe_micro", "stretch") and analysis.get("flags", {}).get("low_contrast"):
            reason = (f"باهت (std={analysis.get('contrast_std', 0)} أقل من "
                      f"{TH['contrast_std_min']:.0f}) — {reason}")
        if step in ("bilateral",) and analysis.get("flags", {}).get("noisy"):
            reason = f"ضجيج مرتفع ({analysis.get('noise', 0)} > {TH['noise_max']}) — {reason}"
        if step == "upscale" and analysis.get("flags", {}).get("low_dpi"):
            reason = f"دقة منخفضة (dpi_est={analysis.get('dpi_est', 0)} < {TH['dpi_min']:.0f}) — {reason}"
        if step == "inpaint_stamp" and analysis.get("flags", {}).get("stamped"):
            reason = f"ختم يغطي {analysis.get('stamp_ratio', 0) * 100:.2f}% من الصورة — {reason}"
        plan.append({"step": step, "reason_ar": reason})
    return plan


def profiles_payload() -> list:
    """حمولة GET /api/enhance/profiles حسب العقد."""
    out = []
    for pid in PROFILES_ORDER:
        p = PROFILES[pid]
        out.append({"id": pid, "name_ar": p["name_ar"],
                    "desc_ar": p["desc_ar"], "steps": p["steps"]})
    return out
