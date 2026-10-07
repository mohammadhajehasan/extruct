# -*- coding: utf-8 -*-
"""
core/glossary.py — المسرّح: القوائم البيضاء وخرائط اللبس والتصنيفات والحقول.
المصدر: الخطة الحاكمة v7.1 — 7.2 / 7.4 / 7.5 / 15.5
ممنوع تصحيح صامت: CONF يُستخدم فقط كاقتراح داخل reasons — لا يعدّل أي قيمة.
"""

# نوع الوقود (7.5)
FUEL = ["بنزين", "مازوت", "غاز", "كهرباء", "هجين", ""]

# المحافظات الـ15 + فارغ (7.5)
GOVERNORATES = [
    "دمشق", "ريف دمشق", "حلب", "حمص", "حماة",
    "اللاذقية", "طرطوس", "درعا", "السويداء", "القنيطرة",
    "إدلب", "الرقة", "دير الزور", "الحسكة", "",
]

# خريطة لبس حرف/رقم — للـ"اقتراح فقط" في reasons (7.5). لا تُطبَّق على القيم أبداً.
CONF = {"O": "0", "o": "0", "I": "1", "l": "1", "S": "5", "B": "8", "Z": "2", "G": "6"}

# فئات الميكانيك (7.1) — key كما تعيدها mode=classify
CATEGORIES = [
    {"key": "mechanic_card", "name_ar": "كرت الميكانيك", "faces": 2,
     "rule_ar": "الوجهان = سجل واحد = صفحة واحدة"},
    {"key": "private_driving_license", "name_ar": "رخصة سير خاصة", "faces": 2,
     "rule_ar": "الوجهان = سجل واحد = صفحة واحدة (بدون باركود على الخلفي)"},
    {"key": "registration_statement", "name_ar": "بيان قيد المركبة", "faces": 1,
     "rule_ar": "صورة = صفحة"},
    {"key": "temp_driving_license", "name_ar": "رخصة سير مؤقتة", "faces": 1,
     "rule_ar": "صورة = صفحة"},
    {"key": "transfer_deed", "name_ar": "سند التمليك", "faces": 1,
     "rule_ar": "صورة = صفحة"},
]

# الحقول الثلاثة عشر (7.2 / 7.4) بالترتيب الرسمي
MECHANIC_FIELDS = [
    {"key": "vehicle_symbol", "label_ar": "رمز المركبة/النقل"},
    {"key": "chassis_no", "label_ar": "رقم الهيكل"},
    {"key": "engine_no", "label_ar": "رقم المحرك"},
    {"key": "engine_capacity", "label_ar": "سعة المحرك"},
    {"key": "manufacture_date", "label_ar": "تاريخ الصنع"},
    {"key": "category", "label_ar": "الفئة/فئة المركبة"},
    {"key": "plate_no", "label_ar": "رقم اللوحة"},
    {"key": "maker", "label_ar": "الصانع"},
    {"key": "model", "label_ar": "الطراز"},
    {"key": "fuel", "label_ar": "نوع الوقود"},
    {"key": "governorate", "label_ar": "المحافظة"},
    {"key": "passengers", "label_ar": "عدد الركاب"},
    {"key": "type", "label_ar": "النوع"},
]
MECHANIC_KEYS = [f["key"] for f in MECHANIC_FIELDS]

# تسميات التصنيف الممكنة (عقد API — mode=classify)
CLASSIFY_LABELS = [
    "mechanic_card_front", "mechanic_card_back",
    "private_driving_license_front", "private_driving_license_back",
    "registration_statement", "temp_driving_license",
    "transfer_deed", "table_document", "unknown",
]

# الترجمة العربية لتسميات التصنيف (للعرض)
CLASSIFY_AR = {
    "mechanic_card_front": "كرت ميكانيك - أمامي",
    "mechanic_card_back": "كرت ميكانيك - خلفي",
    "private_driving_license_front": "رخصة سير خاصة - أمامي",
    "private_driving_license_back": "رخصة سير خاصة - خلفي",
    "registration_statement": "بيان قيد المركبة",
    "temp_driving_license": "رخصة سير مؤقتة",
    "transfer_deed": "سند التمليك",
    "table_document": "وثيقة جداول",
    "unknown": "غير معروف",
}

# حقول رقمية بحتة تُخضع للتحقق المتقاطع OCR (15.3)
NUMERIC_CROSS_FIELDS = ("chassis_no", "engine_no", "plate_no", "engine_capacity")


def glossary_payload() -> dict:
    """حمولة GET /api/glossary حرفياً حسب العقد."""
    return {
        "fuel": FUEL,
        "governorates": GOVERNORATES,
        "categories": CATEGORIES,
        "fields": MECHANIC_FIELDS,
    }
