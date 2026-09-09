# -*- coding: utf-8 -*-
"""
core/mechanic.py — وحدة الميكانيك: تصنيف + تجميع وجوه (group_faces_v2) + قواعد التحقق + VIN ISO 3779.
المصدر: الخطة الحاكمة v7.1 — الجزء 7 + 15.1 + 15.2 + 15.3 + 15.5 + عقد API.

⚠⚠ بند 15.1 — قاعدة ملزمة لا تخالفها هذه الوحدة:
تحقق VIN (vin_check_digit_valid) تُستخدم نتيجتها **فقط** لتعيين عمود جانبي
`chassis_no_vin_valid` و/أو علم REVIEW. ممنوع منعاً باتاً تعديل/استبدال/تصحيح
قيمة chassis_no المستخرجة بناءً على نتيجة التحقق (مبدأ "انقل ولا تصحّح").
"""
import re
from typing import List, Optional, Tuple

import cv2
import numpy as np

from core.pdfio import decode_b64_to_bgr
from core.glossary import (CLASSIFY_LABELS, FUEL, GOVERNORATES, MECHANIC_KEYS,
                           NUMERIC_CROSS_FIELDS)

# ═══ 15.1 — تحقق رياضي من رقم الهيكل (VIN Check Digit — ISO 3779) ═══
VIN_MAP = {**{c: v for c, v in zip("ABCDEFGH", [1, 2, 3, 4, 5, 6, 7, 8])},
           **{c: v for c, v in zip("JKLMNPRSTUVWXYZ",
                                   [1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9])},
           **{str(d): d for d in range(10)}}
WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]


def vin_check_digit_valid(vin: str) -> bool:
    """
    فحص خانة التحقق (الموضع 9) — تُستخدم للنتيجة Boolean فقط.
    القيم المؤقتة لـ VIN_MAP متغيرات محلية داخل الحساب؛ تُرمى فور انتهاء الدالة
    ولا تُكتب أبداً في أي عمود أو تقرير (توضيح 15.1 الإلزامي).
    """
    vin = (vin or "").strip()
    if len(vin) != 17 or not vin.isalnum():
        return False
    if any(c.upper() in "IOQ" for c in vin):  # محظورة رسمياً بمعيار VIN
        return False
    total = sum(VIN_MAP.get(c.upper(), 0) * w for c, w in zip(vin, WEIGHTS))
    remainder = total % 11
    expected = "X" if remainder == 10 else str(remainder)
    return vin[8].upper() == expected


# ═══ 7.5 + 15.5 — قواعد التحقق (بلا تصحيح صامت — مخالفة = علم REVIEW مُعلَّم السبب) ═══
PLATE_PATTERN = re.compile(r"^\d{1,2}/\d{3,6}$")

CONFUSABLE_SUGGEST_FIELDS = ("chassis_no", "engine_no", "plate_no",
                             "engine_capacity", "vehicle_symbol")


def _conf_suggestion(v: str) -> Optional[str]:
    """اقتراح CONF (O→0, I→1...) في reasons فقط — لا يُطبَّق على القيمة إطلاقاً."""
    from core.glossary import CONF
    hits = sorted({c for c in v if c in CONF})
    if hits:
        mapping = ", ".join(f"{c}→{CONF[c]}" for c in hits)
        return f"اقتراح غير مُطبَّق: محارف قد تُلبس بأرقام ({mapping})"
    return None


def _validate_field(key: str, v: str) -> Tuple[str, List[str]]:
    """قاعدة حقل واحد → (confidence, reasons) — القيم '' و'UNCLEAR' = LOW."""
    reasons: List[str] = []
    if v.strip() in ("", "UNCLEAR"):
        return "LOW", ["غير موجود/غير مقروء"]

    if key == "chassis_no":
        if len(v) >= 11:
            reasons.append("طول سليم (≥11 خانة)")
            conf = "HIGH"
        else:
            reasons.append("طول رقم الهيكل أقل من 11 خانة")
            conf = "REVIEW"
    elif key == "passengers":
        if v.isdigit():
            conf = "HIGH"
        else:
            reasons.append("قيمة غير رقمية لعدد الركاب")
            conf = "REVIEW"
    elif key == "manufacture_date":
        if re.match(r"\d{4}", v):
            conf = "HIGH"
        else:
            reasons.append("تاريخ الصنع لا يبدأ بسنة رباعية")
            conf = "REVIEW"
    elif key == "plate_no":
        if PLATE_PATTERN.match(v):
            conf = "HIGH"
        else:
            # مخالفة النمط = REVIEW بلا رفض (لوحات دبلوماسية/خاصة قد تخرج عن النمط)
            reasons.append("نمط لوحة غير معتاد")
            conf = "REVIEW"
    elif key == "fuel":
        if v in FUEL:
            conf = "HIGH"
        else:
            reasons.append("قيمة الوقود خارج القائمة البيضاء (بنزين/مازوت/غاز/كهرباء/هجين)")
            conf = "REVIEW"
    elif key == "governorate":
        if v in GOVERNORATES:
            conf = "HIGH"
        else:
            reasons.append("محافظة خارج القائمة المعتمدة (15 محافظة)")
            conf = "REVIEW"
    elif key == "engine_capacity":
        if v.isdigit():
            conf = "HIGH"
        else:
            reasons.append("قيمة سعة المحرك غير رقمية بحتة")
            conf = "MED"
    else:
        conf = "HIGH"  # vehicle_symbol/engine_no/category/maker/model/type — نقل حرفي

    if key in CONFUSABLE_SUGGEST_FIELDS:
        sugg = _conf_suggestion(v)
        if sugg:
            reasons.append(sugg)
    return conf, reasons


def validate_record(record: dict) -> dict:
    """
    تحقق السجل كاملاً →
    {fields:{k:{value,confidence,reasons}}, chassis_no_vin_valid?:bool}
    ⚠ لا يُعدَّل chassis_no إطلاقاً — نتيجة VIN عمود جانبي/علم فقط (15.1).
    """
    fields_out = {}
    for k in MECHANIC_KEYS:
        v = str((record or {}).get(k, "") or "")
        conf, reasons = _validate_field(k, v)
        fields_out[k] = {"value": v, "confidence": conf, "reasons": reasons}

    # ── VIN check digit: عمود جانبي فقط — ممنوع أي تعديل على القيمة ──
    chassis = fields_out["chassis_no"]["value"].strip()
    chassis_no_vin_valid = None
    if len(chassis) == 17 and chassis.isalnum():
        chassis_no_vin_valid = vin_check_digit_valid(chassis)
        if chassis_no_vin_valid:
            fields_out["chassis_no"]["reasons"].append(
                "تحقق VIN ناجح (ISO 3779)")
        else:
            fields_out["chassis_no"]["confidence"] = "REVIEW"
            fields_out["chassis_no"]["reasons"].append(
                "فشل خانة التحقق VIN (ISO 3779) — يُنصح بمراجعة/إعادة قراءة مكبّرة "
                "(القيمة منقولة كما استُخرجت بلا تعديل)")
    return {"fields": fields_out, "chassis_no_vin_valid": chassis_no_vin_valid}


# ═══ 15.2 — مطابقة الوجوه عبر الباركود + fallback التجاور (7.3) ═══

def barcode_key_from_bgr(img: np.ndarray) -> Optional[str]:
    """قراءة باركود/QR من صورة (pyzbar) — None عند الفشل."""
    try:
        from pyzbar.pyzbar import decode
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
        codes = decode(gray)
        if codes:
            return codes[0].data.decode("utf-8", "ignore")
    except Exception:
        return None
    return None


def barcode_key_b64(image_b64: str) -> Optional[str]:
    try:
        return barcode_key_from_bgr(decode_b64_to_bgr(image_b64))
    except Exception:
        return None


def _norm_barcode(s: str) -> str:
    """مفتاح مطابقة: أرقام فقط إن وُجدت وإلا أبجدي-رقمي كبير."""
    digits = re.sub(r"\D", "", s or "")
    if digits:
        return digits
    return re.sub(r"[^A-Za-z0-9]", "", (s or "")).upper()


SINGLE_CATEGORIES = ("registration_statement", "temp_driving_license",
                     "transfer_deed")
CATEGORY_AR = {
    "mechanic_card": "كرت الميكانيك",
    "registration_statement": "بيان قيد المركبة",
    "temp_driving_license": "رخصة سير مؤقتة",
    "transfer_deed": "سند التمليك",
}


def group_faces(labeled: List[Tuple[str, str]]) -> List[Tuple[str, List[str]]]:
    """7.3 — التجميع بالتجاور بأي ترتيب (خلفي ثم أمامي مقبول، الفردي = سجل)."""
    recs, i = [], 0
    while i < len(labeled):
        lab, img = labeled[i]
        if lab == "mechanic_card_front":
            nxt = labeled[i + 1] if i + 1 < len(labeled) else None
            if nxt and nxt[0] == "mechanic_card_back":
                recs.append(("mechanic_card", [img, nxt[1]])); i += 2; continue
            recs.append(("mechanic_card", [img])); i += 1
        elif lab == "mechanic_card_back":          # ★ خلفي ثم أمامي مقبول
            nxt = labeled[i + 1] if i + 1 < len(labeled) else None
            if nxt and nxt[0] == "mechanic_card_front":
                recs.append(("mechanic_card", [nxt[1], img])); i += 2; continue
            recs.append(("mechanic_card", [img])); i += 1
        elif lab in SINGLE_CATEGORIES:
            recs.append((lab, [img])); i += 1
        else:
            i += 1  # unknown/table_document تُتجاهل في تجميع الميكانيك (كما في الخطة)
    return recs


def group_faces_v2(items: List[dict]) -> List[dict]:
    """
    15.2 — مطابقة بالباركود كلما توفر، وإلا fallback التجاور (7.3) دون كسر التوافق.
    items: [{label, image_b64}]
    يعيد (groups, matched_by_barcode) حيث:
      groups: [{category_key, category_ar, faces:[image_b64], method:"barcode"|"adjacency"}]
      matched_by_barcode: عدد المطابقات التي تمت عبر الباركود (للتدقيق)
    """
    labeled = [(str(it.get("label", "unknown") or "unknown"),
                str(it.get("image_b64", "") or "")) for it in (items or [])]

    # 1) قراءة باركود الأوجه الخلفية (والأمامية إن وُجد) كمفاتيح مستقلة عن الترتيب
    back_keys = {}
    front_keys = {}
    for idx, (lab, b64) in enumerate(labeled):
        if lab == "mechanic_card_back":
            key = barcode_key_b64(b64)
            if key:
                back_keys.setdefault(_norm_barcode(key), (idx, b64))
        elif lab == "mechanic_card_front":
            key = barcode_key_b64(b64)
            if key:
                front_keys.setdefault(_norm_barcode(key), idx)

    used = set()
    groups: List[Tuple[str, List[str], str]] = []
    matched_by_barcode = 0
    # 2) مطابقة الأمامي بالخلفي عبر مفتاح الباركود المشترك
    for key, f_idx in front_keys.items():
        hit = back_keys.get(key)
        if hit and f_idx not in used and hit[0] not in used:
            groups.append(("mechanic_card", [labeled[f_idx][1], hit[1]], "barcode"))
            used.update([f_idx, hit[0]])
            matched_by_barcode += 1
    # 3) الباقي ← التجاور الأصلي (7.3)
    remaining = [(lab, b64) for idx, (lab, b64) in enumerate(labeled)
                 if idx not in used]
    for cat, faces in group_faces(remaining):
        groups.append((cat, faces, "adjacency"))

    return [{"category_key": cat,
             "category_ar": CATEGORY_AR.get(cat, cat),
             "faces": faces, "method": method}
            for cat, faces, method in groups], matched_by_barcode


# ═══ 15.3 — طبقة تحقق مزدوجة بمحرك OCR تقليدي للحقول الرقمية ═══

OCR_WHITELIST = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ-/"


def _ocr_normalize(v: str) -> str:
    """تطبيع للمقارنة فقط — لا يُعدّل أي قيمة مخزنة."""
    return re.sub(r"\s+", "", (v or "").upper())


def cross_verify_numeric(field: str, image_b64: str, vl_value: str) -> dict:
    """
    Tesseract كمصدر تحقق ثانٍ (وليس بديلاً) — للحقول الرقمية البحتة فقط.
    → {status: HIGH|REVIEW|SKIPPED, ocr_value?, reason_ar?}
    """
    if field not in NUMERIC_CROSS_FIELDS:
        return {"status": "SKIPPED",
                "reason_ar": "التحقق المتقاطع OCR يُطبَّق على الحقول الرقمية فقط "
                             "(chassis_no, engine_no, plate_no, engine_capacity)"}
    try:
        img = decode_b64_to_bgr(image_b64)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        if max(h, w) < 900:
            gray = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        gray = cv2.threshold(gray, 0, 255,
                             cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        import pytesseract
        ocr_raw = pytesseract.image_to_string(
            gray, config=f"--psm 6 -c tessedit_char_whitelist={OCR_WHITELIST}")
        ocr_value = _ocr_normalize(ocr_raw).replace("\n", "")
    except Exception as e:  # noqa: BLE001
        return {"status": "REVIEW", "ocr_value": "",
                "reason_ar": f"تعذر تشغيل OCR: {e}"}
    if not ocr_value:
        return {"status": "REVIEW", "ocr_value": "",
                "reason_ar": "OCR لم يعُد قيمة — تعذر التحقق المتقاطع"}
    if _ocr_normalize(vl_value) == ocr_value:
        return {"status": "HIGH", "ocr_value": ocr_value,
                "reason_ar": "اتفاق VL/OCR — تُرفع الثقة"}
    return {"status": "REVIEW", "ocr_value": ocr_value,
            "reason_ar": "تعارض VL/OCR — يُعلَّم للمراجعة (بلا تصحيح صامت)"}
