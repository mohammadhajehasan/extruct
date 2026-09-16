# -*- coding: utf-8 -*-
"""
core/analyzer.py — المحلِّل: تشخيص رقمي بأعتبارات الخطة (6.4 / عقد API /api/enhance).
العتبات: blur<120، std<45، زاوية>1°، منظور>3°، ضجيج>0.35، دقة<1600، ختم>0.5%.
"""
import cv2
import numpy as np

from core.pdfio import A4_WIDTH_INCH

TH = {
    "blur_min": 120.0,          # أقل من هذا = ضبابية
    "contrast_std_min": 45.0,   # أقل من هذا = باهت
    "skew_deg": 1.0,            # أكثر من هذا = ميل
    "perspective_deg": 3.0,     # أكثر من هذا = منظور
    "noise_max": 0.35,          # أكثر من هذا = ضجيج
    "dpi_min": 1600.0,          # تقدير أقل من هذا = دقة منخفضة
    "stamp_ratio_max": 0.005,   # أكثر من 0.5% = مختوم
}


def _skew_angle(gray: np.ndarray) -> float:
    """ميل النص بالدرجات عبر الوسط الحسابي لزوايا الخطوط الأفقية (Hough)."""
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=120,
                            minLineLength=gray.shape[1] // 4,
                            maxLineGap=12)
    if lines is None:
        return 0.0
    angles = []
    for line in lines:
        # Flatten the line to handle both (n,1,4) and (n,4) shapes
        flat_line = np.asarray(line).flatten()
        if flat_line.size < 4:
            continue
        x1, y1, x2, y2 = int(flat_line[0]), int(flat_line[1]), int(flat_line[2]), int(flat_line[3])
        dx, dy = float(x2 - x1), float(y2 - y1)
        if abs(dx) < 1e-6:
            continue
        ang = np.degrees(np.arctan2(dy, dx))
        if abs(ang) <= 15:  # خطوط شبه أفقية فقط
            angles.append(ang)
    return float(np.median(angles)) if angles else 0.0


def _perspective_deg(gray: np.ndarray) -> float:
    """تقدير انحراف المنظور من أكبر كنتور رباعي (انحراف زواياه عن 90°)."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h_img, w_img = gray.shape
    area_min = 0.25 * w_img * h_img
    best = None
    for c in contours:
        if cv2.contourArea(c) < area_min:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            best = approx
            break
    if best is None:
        return 0.0
    pts = best.reshape(4, 2).astype(np.float64)
    devs = []
    for i in range(4):
        p0, p1, p2 = pts[i], pts[(i + 1) % 4], pts[(i + 2) % 4]
        v1, v2 = p1 - p0, p2 - p1
        cosang = abs(float(np.dot(v1, v2)) /
                     (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))
        devs.append(abs(90.0 - np.degrees(np.arccos(min(1.0, cosang)))))
    return float(max(devs))


def _noise_ratio(gray: np.ndarray) -> float:
    """تقدير الضجيج بطريقة Immerkær مُطبَّعة 0..1."""
    img = gray.astype(np.float32)
    h = img.shape[0]
    if h < 3:
        return 0.0
    m = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], np.float32)
    resp = cv2.filter2D(img, -1, m)
    sigma = np.sqrt(np.pi / 2.0) * (np.sum(np.abs(resp)) / (6.0 * (img.shape[0] - 2)
                                                           * (img.shape[1] - 2)))
    return float(min(sigma / 255.0, 1.0))


def _stamp_ratio(bgr: np.ndarray) -> float:
    """نسبة بكسلات الأختام (أحمر/بنفسجي مشبع) من إجمالي الصورة عبر قناع HSV."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    red1 = ((h <= 10) | (h >= 170)) & (s >= 80) & (v >= 60)
    purple = (h >= 130) & (h <= 169) & (s >= 80) & (v >= 60)
    mask = red1 | purple
    return float(np.count_nonzero(mask)) / float(mask.size)


def analyze(img_bgr: np.ndarray) -> dict:
    """قياس كل المقاييس + أعلام تجاوز العتبات (لا يعدّل الصورة)."""
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if img_bgr.ndim == 3 else img_bgr
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    contrast_std = float(gray.std())
    skew = _skew_angle(gray)
    perspective = _perspective_deg(gray)
    noise = _noise_ratio(gray)
    dpi_est = float(w) / A4_WIDTH_INCH
    stamp = _stamp_ratio(img_bgr if img_bgr.ndim == 3
                         else cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
    return {
        "width": int(w), "height": int(h),
        "blur": round(blur, 2),
        "contrast_std": round(contrast_std, 2),
        "skew_angle": round(skew, 2),
        "perspective": round(perspective, 2),
        "noise": round(noise, 3),
        "dpi_est": round(dpi_est, 1),
        "stamp_ratio": round(stamp, 5),
        "flags": {
            "blurry": blur < TH["blur_min"],
            "low_contrast": contrast_std < TH["contrast_std_min"],
            "skewed": abs(skew) > TH["skew_deg"],
            "perspective_distorted": perspective > TH["perspective_deg"],
            "noisy": noise > TH["noise_max"],
            "low_dpi": dpi_est < TH["dpi_min"],
            "stamped": stamp > TH["stamp_ratio_max"],
        },
    }


def quality_score(analysis: dict) -> float:
    """درجة جودة 0..1 بعد المعالجة (يستهلكها tuner): كل عطل متبقٍ يخصم 0.2."""
    f = analysis.get("flags", {})
    pen = sum(1 for k in ("blurry", "low_contrast", "skewed",
                          "perspective_distorted", "noisy") if f.get(k))
    return float(max(0.0, 1.0 - 0.2 * pen))
