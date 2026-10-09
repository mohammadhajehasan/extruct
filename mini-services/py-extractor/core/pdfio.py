# -*- coding: utf-8 -*-
"""
core/pdfio.py — معالج PDF: PDF نصي (find_tables → دقة 100% بلا نموذج) أم مسح (render dpi).
المصدر: الخطة الحاكمة v7.1 — الجزء 4 + عقد API (/api/pdf/parse).
تحسين الأداء: معالجة الصفحات بالتوازي عبر thread pool.
"""
import base64
import io
import os

from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import cv2
import fitz  # PyMuPDF
import numpy as np

DEFAULT_DPI = 300
DETECT_DPI = int(os.environ.get("PDF_DETECT_DPI", "150"))
# A4: 8.27 × 11.69 بوصة — تُستخدم لتقدير dpi من عرض الصورة
A4_WIDTH_INCH = 8.27

# عدد العمال المتوازية — توازن سرعة/ذاكرة:
# - كل عامل يُنتج صورة صفحة كاملة في الذاكرة ثم يحررها فور الترميز (del img,pix).
# - 2 هو التوازن الآمن على Render free (512MB): تسريع ~2x عن التسلسلي بذروة مقبولة.
# - 1 تسلسلي (الأكثر أماناً، PyMuPDF غير مضمون الخيوط) — اضبط PDF_PARSE_WORKERS=1 عند OOM.
_PARALLEL_WORKERS = max(1, int(os.environ.get("PDF_PARSE_WORKERS", "2")))

# دقة render الصفحات الممسوحة — منفصلة عن dpi الطلب (الذي يُستخدم للتحذيرات فقط).
# خفض 300→200 يقلّص البكسلات ~2.25x (وقت render+ترميز+حجم base64 معاً) مع بقاء
# الدقة كافية للاستخراج (الواجهة تسوّي لـ2048px قبل النموذج على أي حال).
# يُتجاوز عبر PDF_RENDER_DPI، ودpi الطلب يُثبَّت عليه إن لم يُضبط المتغير.
RENDER_DPI_DEFAULT = int(os.environ.get("PDF_RENDER_DPI", "200"))
RENDER_DPI_MAX = 300

# سقف عدد الصفحات المُصيَّرة في الطلب الواحد (حماية من نفاد الذاكرة). 0 = بلا سقف.
MAX_PAGES = max(0, int(os.environ.get("PDF_MAX_PAGES", "60")))

# جودة JPEG لصفحات المسح — PNG يضخّم الحمولة والذاكرة ~10 مرات.
JPEG_QUALITY = int(os.environ.get("PDF_JPEG_QUALITY", "88"))

# ملاحظة: أُزيل تخزين _PAGE_CACHE المؤقت — كان dict عالميًا غير محدود يحتفظ بمصفوفات
# كل صفحات كل ملف PDF مرفوع مدى حياة العملية (تسريب ذاكرة مؤكد → OOM/503).


def _parse_single_page(args: tuple) -> dict:
    """حلل صفحة PDF واحدة (تُستدعى من thread pool)
    detect_dpi للكشف (نص/رسومات) — رخيص.
    render_dpi هو دقة الـ pixmap للصفحات الممسوحة."""
    i, pg, detect_dpi, render_dpi = args
    text = pg.get_text().strip()
    # مسار سريع أول: صفحة بلا نص إطلاقاً = مسح يقيناً — تخطَّ get_drawings/find_tables
    # (استدعاءان مكلفان بلا فائدة هنا) وانتقل للـrender مباشرة.
    if not text:
        return _render_scan_page(i, pg, render_dpi)
    # 15.9.1 — مرشّح رخيص قبل find_tables() المكلف: جدول PDF حقيقي يحتاج
    # رسومات متجهة كافية؛ صفحة مسح + OCR نصي تُستبعد فوراً.
    tables = []
    has_enough_drawings = len(pg.get_drawings()) >= 4
    if has_enough_drawings:
        try:
            tables = pg.find_tables().tables
        except Exception:
            tables = []
    if has_enough_drawings and tables:
        native = []
        for t in tables:
            try:
                rows = t.extract()
                native.append([[("" if c is None else str(c)) for c in row]
                               for row in rows])
            except Exception:
                continue
        return {"index": i, "kind": "native", "tables": native,
                "text": text, "image_b64": None, "needs_render": False}
    else:
        return _render_scan_page(i, pg, render_dpi, text=text)


def _render_scan_page(i: int, pg, render_dpi: int, text: str = "") -> dict:
    """render صفحة مسح + ترميز JPEG داخل العامل — تُحرَّر المصفوفة فوراً."""
    zoom = max(render_dpi, 72) / 72.0
    try:
        pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img = _pix_to_bgr(pix)
    except Exception:
        pix = pg.get_pixmap(alpha=False)
        img = _pix_to_bgr(pix)
    b64 = encode_bgr_to_b64_jpeg(img)
    del img, pix
    return {"index": i, "kind": "image", "tables": [],
            "text": text, "image_b64": b64, "mime": "image/jpeg",
            "needs_render": True}


def pdf_pages_from_bytes(data: bytes, dpi: int = DEFAULT_DPI) -> tuple:
    """
    لكل صفحة PDF:
      - كشف مبدئي بـ DETECT_DPI (150 افتراضياً) لتحديد ما إذا كانت الصفحة
        نصية (جداول native) أم مسح — الكشف رخيص ولا يحتاج rendering.
      - الصفحات الممسوحة فقط تُrender بدقة RENDER (افتراضي 200، سقف 300)
        وتُرمَّز JPEG فوراً. دقة الطلب dpi تُستخدم للتحذيرات فقط.
    يعيد: (pages, warning). الصفحات الممسوحة تحمل image_b64 + mime مباشرة
    (لا مصفوفات BGR محتجزة)، فلا تتراكم صور كاملة في الذاكرة ولا تُسرَّب بين الطلبات.
    """
    warning: Optional[str] = None
    out = []
    # دقة الـrender الفعلية: PDF_RENDER_DPI (افتراضي 200) يثبّت الدقة بغض النظر عن dpi
    # الطلب — الأخير يُستخدم للتحذيرات فقط. السقف 300 دائماً.
    render_dpi = min(max(RENDER_DPI_DEFAULT, 72), RENDER_DPI_MAX)
    with fitz.open(stream=data, filetype="pdf") as doc:
        total = doc.page_count
        limit = total if MAX_PAGES <= 0 else min(total, MAX_PAGES)
        if limit < total:
            warning = (f"الملف يحتوي {total} صفحة — عُولجت أول {limit} صفحة فقط "
                       f"لحماية الخدمة من نفاد الذاكرة (يمكن رفع الحد عبر PDF_MAX_PAGES).")
        args = [(i, doc.load_page(i), DETECT_DPI, render_dpi) for i in range(limit)]
        results = []
        with ThreadPoolExecutor(max_workers=_PARALLEL_WORKERS) as ex:
            for r in ex.map(_parse_single_page, args):
                results.append(r)
        # ترتيب النتائج حسب الفهرس
        results.sort(key=lambda x: x["index"])
        for r in results:
            if r["needs_render"]:
                out.append({"kind": "image", "index": r["index"],
                            "image_b64": r["image_b64"],
                            "mime": r.get("mime", "image/jpeg")})
            else:
                out.append({"kind": "native", "index": r["index"],
                            "tables": r["tables"], "text": r.get("text", "")})
    return out, warning


def decode_b64_to_bgr(image_b64: str) -> np.ndarray:
    """فك تشفير base64 إلى مصفوفة BGR مفتوحة بـ OpenCV."""
    try:
        data = base64.b64decode(image_b64)
    except Exception as e:
        raise ValueError(f"تنسيق الصورة غير صالح: {e}")
    if len(data) < 10:
        raise ValueError("الصورة فارغة")
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        # محاولة عبر Pillow لدعم صيغ إضافية
        try:
            from PIL import Image
            pil = Image.open(io.BytesIO(data)).convert("RGB")
            img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
        except Exception as e:
            raise ValueError(f"فك الصورة فشل: {e}")
    return img


def encode_bgr_to_b64(img: np.ndarray) -> str:
    """تحويل مصفوفة BGR مفتوحة إلى base64 (PNG بلا فقد)."""
    _, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode()


def encode_bgr_to_b64_jpeg(img: np.ndarray, quality: int = JPEG_QUALITY) -> str:
    """base64 لصورة JPEG — أصغر من PNG بنحو 10 مرات لصفحات المسح."""
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:  # احتياط نادر
        _, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode()


def _pix_to_bgr(pix) -> np.ndarray:
    """تحويل PyMuPDF Pixmap إلى numpy.ndarray BGR."""
    # PyMuPDF pixmap RGBA → تحويل إلى RGB ثم BGR
    s = pix.samples
    if pix.alpha:
        # has alpha channel
        w, h = pix.width, pix.height
        rgba = np.frombuffer(s, dtype=np.uint8).reshape(h, w, 4)
        rgb = rgba[..., :3]
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    else:
        # no alpha
        w, h = pix.width, pix.height
        rgb = np.frombuffer(s, dtype=np.uint8).reshape(h, w, 3)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    return bgr


def image_page_from_bytes(data: bytes) -> dict:
    """ملف صورة غير PDF → صفحة واحدة kind=image."""
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        # محاولة عبر Pillow لدعم صيغ إضافية
        from PIL import Image
        pil = Image.open(io.BytesIO(data)).convert("RGB")
        img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    b64 = encode_bgr_to_b64_jpeg(img)
    return {"kind": "image", "index": 0, "image_b64": b64, "mime": "image/jpeg"}


def parse_file(data: bytes, filename: str = "", dpi: int = DEFAULT_DPI) -> dict:
    """
    نقطة الدخول الموحدة لـ /api/pdf/parse.
    يعيد: {is_pdf, pages:[{kind, index, tables?|image_b64?, mime?}], warning?}
    (الصفحات الممسوحة تأتي مُرمَّزة JPEG مسبقًا — لا مصفوفات صور محتجزة)
    """
    warning: Optional[str] = None
    name = (filename or "").lower()
    is_pdf = data[:5] == b"%PDF-" or name.endswith(".pdf")
    if is_pdf:
        pages, cap_warning = pdf_pages_from_bytes(data, dpi=dpi)
        warning = cap_warning
    else:
        pages = [image_page_from_bytes(data)]
    if dpi < 200:
        dpi_warning = f"dpi={dpi} أقل من 200 — جودة الصفحات الممسوحة قد تكون ضعيفة (يُنصح بـ 300)"
        warning = f"{warning} {dpi_warning}" if warning else dpi_warning
    return {"is_pdf": is_pdf, "pages": pages, "warning": warning}
