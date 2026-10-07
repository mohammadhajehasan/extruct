# -*- coding: utf-8 -*-
"""
core/tuner.py — الضابط: إن كان التحليل سيئاً بعد التحسين يجرّب بروفايلات بديلة (≤3).
المصدر: الخطة الحاكمة v7.1 — 6.4 ("Tuner يجرب ≤3 سلاسل ويتوقف عند العتبة ويحفظ الأفضل في KB").
"""
from core import analyzer, enhancer, kb, planner

QUALITY_THRESHOLD = 0.8   # تحت هذه الدرجة نجرّب بدائل
MAX_CHAINS = 3            # ≤3 سلاسل إجمالاً (البداية + بديلان)

# بدائل مقترحة حسب أبرز مشكلة متبقية
_ALTERNATIVES_BY_PROBLEM = {
    "blurry": ["low_res", "darken_clarity"],
    "low_contrast": ["darken_clarity", "strong_shadow"],
    "noisy": ["high_noise_safe", "manual_safe"],
    "skewed": ["darken_clarity"],
    "perspective_distorted": ["darken_clarity"],
}


def _candidate_profiles(first_analysis: dict, exclude: str) -> list:
    """ترشيح بديلين على الأكثر حسب أول مشكلة متبقية."""
    problems = [k for k, v in first_analysis.get("flags", {}).items() if v]
    cands = []
    for p in problems:
        for c in _ALTERNATIVES_BY_PROBLEM.get(p, []):
            if c != exclude and c not in cands:
                cands.append(c)
    for c in planner.PROFILES_ORDER:
        if c not in ("none", exclude) and c not in cands:
            cands.append(c)
    return cands[: MAX_CHAINS - 1]


def tune(img_bgr, profile: str, analysis_first: dict, target: str = "tables") -> dict:
    """
    يطبّق سلسلة البروفايل المطلوب، ثم إن بقيت الجودة تحت العتبة جرّب بدائل (إجمالاً ≤3).
    يعيد: {image, profile_used, plan, analysis, tuned, tried}
    ويحفظ أفضل سلسلة في KB (6.4).
    """
    tried = []
    plan = planner.build_plan(analysis_first, profile)
    out = enhancer.apply(img_bgr, plan, analysis_first)
    analysis_after = analyzer.analyze(out)
    score = analyzer.quality_score(analysis_after)
    tried.append({"profile": profile, "score": round(score, 3)})
    best = {"profile_used": profile, "image": out, "plan": plan,
            "analysis": analysis_after, "score": score}

    if score >= QUALITY_THRESHOLD or profile == "none":
        if score >= QUALITY_THRESHOLD:
            kb.record_chain(target, [i["step"] for i in plan], score)
        return {"tuned": False, "tried": tried, **best}

    for cand in _candidate_profiles(analysis_after, best["profile_used"]):
        plan_c = planner.build_plan(analysis_first, cand)
        out_c = enhancer.apply(img_bgr, plan_c, analysis_first)
        an_c = analyzer.analyze(out_c)
        sc_c = analyzer.quality_score(an_c)
        tried.append({"profile": cand, "score": round(sc_c, 3)})
        if sc_c > best["score"]:
            best = {"profile_used": cand, "image": out_c, "plan": plan_c,
                    "analysis": an_c, "score": sc_c}
        if best["score"] >= QUALITY_THRESHOLD:
            break  # يتوقف عند العتبة
    kb.record_chain(target, [i["step"] for i in best["plan"]], best["score"])
    return {"tuned": True, "tried": tried, **best}
