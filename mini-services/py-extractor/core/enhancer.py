# -*- coding: utf-8 -*-
"""
core/enhancer.py — المحسّن: مكتبة التقنيات الآمنة + تطبيق سلسلة المخطِّط.
المصدر: الخطة الحاكمة v7.1 — الجزء 6 (قواعد الأمان + مصفوفة القرار + البروفايلات).

قواعد الأمان: CLAHE ≤1.2 • التغميق=Close(2×2) • الاختتام=Stretch(2–98) •
بلا equalizeHist • بلا NLM قوي • بلا Unsharp قوي على الوثائق الرسمية.
"""
import cv2
import numpy as np


def _ensure_bgr(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    return img


def s_upscale(img, analysis=None, **kw):
    """تكبير ×2 ثنائي تكعيبي (للدقة المنخفضة)."""
    h, w = img.shape[:2]
    if max(h, w) * 2 > 6000:  # حماية من تضخم الحجم/الذاكرة
        return img
    return cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)


def s_gray(img, **kw):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)


def _bg_divide(img, sigma: float) -> np.ndarray:
    """إزالة الظل/التدرج: قسمة الخلفية (تمويه غاوسي واسع) ثم إعادة التمدد."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    g = g.astype(np.float32) + 1.0
    bg = cv2.GaussianBlur(g, (0, 0), sigmaX=sigma, sigmaY=sigma)
    norm = np.clip(g / bg * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(norm, cv2.COLOR_GRAY2BGR)


def s_shadow(img, **kw):
    return _bg_divide(img, sigma=75.0)


def s_shadow60(img, **kw):
    return _bg_divide(img, sigma=60.0)


def _clahe(img, clip: float) -> np.ndarray:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    out = clahe.apply(g)
    return cv2.cvtColor(out, cv2.COLOR_GRAY2BGR)


def s_clahe(img, **kw):
    return _clahe(img, clip=1.2)          # ≤1.2 حصراً (قاعدة أمان)


def s_clahe_micro(img, **kw):
    return _clahe(img, clip=1.1)


def s_close(img, **kw):
    """Close(2×2): يوصل الحروف المتكسرة ويثبّت النص (بلا NLM/Otsu)."""
    k = np.ones((2, 2), np.uint8)
    if img.ndim == 2:
        return cv2.morphologyEx(img, cv2.MORPH_CLOSE, k)
    b, g, r = cv2.split(img)
    merged = cv2.merge([cv2.morphologyEx(c, cv2.MORPH_CLOSE, k) for c in (b, g, r)])
    return merged


def _unsharp(img, amount: float, sigma: float) -> np.ndarray:
    blur = cv2.GaussianBlur(img, (0, 0), sigmaX=sigma)
    return cv2.addWeighted(img, 1.0 + amount, blur, -amount, 0)


def s_micro(img, **kw):
    return _unsharp(img, amount=1.3, sigma=1.5)   # Micro-Unsharp (1.3/σ1.5)


def s_micro_soft(img, **kw):
    return _unsharp(img, amount=0.6, sigma=1.2)


def s_bilateral(img, **kw):
    return cv2.bilateralFilter(img, d=9, sigmaColor=75, sigmaSpace=75)


def s_inpaint_stamp(img, **kw):
    """قناع HSV للأختام (أحمر/بنفسجي مشبع) + Inpaint (TELEA)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    red = ((h <= 10) | (h >= 170)) & (s >= 80) & (v >= 60)
    purple = (h >= 130) & (h <= 169) & (s >= 80) & (v >= 60)
    mask = ((red | purple).astype(np.uint8)) * 255
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
    if cv2.countNonZero(mask) == 0 or cv2.countNonZero(mask) > 0.30 * mask.size:
        return img  # لا ختم أو قناع مفرط — لا مجازفة
    return cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)


def s_stretch(img, **kw):
    """الاختتام: Stretch لمئينات 2–98 لكل قناة."""
    out = np.empty_like(img)
    for c in range(3):
        ch = img[:, :, c]
        lo, hi = np.percentile(ch, 2), np.percentile(ch, 98)
        if hi - lo < 1:
            out[:, :, c] = ch
        else:
            out[:, :, c] = np.clip((ch.astype(np.float32) - lo) * 255.0 / (hi - lo),
                                   0, 255).astype(np.uint8)
    return out


def s_deskew(img, analysis=None, **kw):
    """تصحيح الميل بدوران -الزاوية المقاسة حول المركز (خلفية بيضاء)."""
    angle = float((analysis or {}).get("skew_angle", 0.0) or 0.0)
    if abs(angle) < 0.05:
        return img
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))


def s_perspective(img, **kw):
    """تصحيح منظور بسيط: توحيد أكبر كنتور رباعي إلى مستطيل."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h_img, w_img = gray.shape
    best = None
    best_area = 0.25 * w_img * h_img
    for c in contours:
        area = cv2.contourArea(c)
        if area < best_area:
            continue
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) == 4:
            best, best_area = approx.reshape(4, 2).astype(np.float32), area
    if best is None:
        return img
    rect = np.zeros((4, 2), np.float32)
    ssum = best.sum(axis=1)
    rect[0] = best[np.argmin(ssum)]   # أعلى-يسار
    rect[2] = best[np.argmax(ssum)]   # أسفل-يمين
    sdiff = best[:, 0].astype(np.float32) - best[:, 1].astype(np.float32)
    rect[1] = best[np.argmin(sdiff)]  # أعلى-يمين
    rect[3] = best[np.argmax(sdiff)]  # أسفل-يسار
    wA = np.linalg.norm(rect[2] - rect[3]); wB = np.linalg.norm(rect[1] - rect[0])
    hA = np.linalg.norm(rect[1] - rect[2]); hB = np.linalg.norm(rect[0] - rect[3])
    mw, mh = int(max(wA, wB)), int(max(hA, hB))
    if mw < 40 or mh < 40:
        return img
    dst = np.array([[0, 0], [mw - 1, 0], [mw - 1, mh - 1], [0, mh - 1]], np.float32)
    m = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, m, (mw, mh),
                               borderMode=cv2.BORDER_CONSTANT,
                               borderValue=(255, 255, 255))


STEPS = {
    "upscale": s_upscale,
    "gray": s_gray,
    "shadow": s_shadow,
    "shadow60": s_shadow60,
    "clahe": s_clahe,
    "clahe_micro": s_clahe_micro,
    "close": s_close,
    "micro": s_micro,
    "micro_soft": s_micro_soft,
    "bilateral": s_bilateral,
    "inpaint_stamp": s_inpaint_stamp,
    "stretch": s_stretch,
    "deskew": s_deskew,
    "perspective": s_perspective,
}


def apply(img: np.ndarray, plan: list, analysis: dict = None) -> np.ndarray:
    """تطبيق سلسلة المخطِّط على الصورة (كل خطوة دالة آمنة معروفة)."""
    out = _ensure_bgr(img)
    analysis = analysis or {}
    for item in plan:
        fn = STEPS.get(item.get("step"))
        if fn is None:
            continue
        try:
            out = fn(out, analysis=analysis)
        except cv2.error:
            continue  # خطوة فاشلة لا تُفشل السلسلة — نُكمل بأمان
    return out
