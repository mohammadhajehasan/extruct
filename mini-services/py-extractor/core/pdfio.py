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

import cv2
import fitz  # PyMuPDF
import numpy as np

DEFAULT_DPI = 300
# A4: 8.27 × 11.69 بوصة — تُستخدم لتقدير dpi من عرض الصورة
A4_WIDTH_INCH = 8.27

# عدد العمال المتوازية — يقرأ من البيئة مع افتراضي 4
_PARALLEL_WORKERS = int(os.environ.get("PDF_PARSE_WORKERS", "4"))

# مفتاح عالمي لمنع تكرار معالجة الصفحات في الذاكرة
_PAGE_CACHE = {}


def _cache_key(data: bytes, dpi: int) -> str:
    """مفتاح فريد للتخزين المؤقت."""
    return f"{len(data)}:{dpi}:{hash(data)}"


def _parse_single_page(args: tuple) -> dict:
    """حلل صفحة PDF واحدة (تُستدعى من thread pool)."""
    i, pg, dpi = args
    text = pg.get_text().strip()
    # 15.9.1 — مرشّح رخيص قبل find_tables() المكلف: جدول PDF حقيقي يحتاج
    # رسومات متجهة كافية؛ صفحة مسح + OCR نصي تُستبعد فوراً.
    tables = []
    has_enough_drawings = len(pg.get_drawings()) >= 4
    if text and has_enough_drawings:
        try:
            tables = pg.find_tables().tables
        except Exception:
            tables = []
    if text and has_enough_drawings and tables:
        native = []
        for t in tables:
            try:
                rows = t.extract()
                native.append([[("" if c is None else str(c)) for c in row]
                               for row in rows])
            except Exception:
                continue
        return {"index": i, "kind": "native", "tables": native,
                "text": text, "img": None, "needs_render": False}
    else:
        zoom = max(dpi, 72) / 72.0
        try:
            pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            img = _pix_to_bgr(pix)
        except Exception:
            # فشل في الـ rendering — حاول مرة أخرى بـ DPI كامل
            pix = pg.get_pixmap(alpha=False)
            img = _pix_to_bgr(pix)
        return {"index": i, "kind": "image", "tables": [],
                "text": text, "img": img, "needs_render": True}


def pdf_pages_from_bytes(data: bytes, dpi: int = DEFAULT_DPI) -> list:
    """
    لكل صفحة PDF:
      - نص أصلي + جداول find_tables → ("native", index, tables)
      - وإلا render pixmap بدقة dpi → ("image", index, BGR ndarray)
    (الجزء 4 من الخطة — pdf_pages)
    تحسين الأداء: معالجة الصفحات بالتوازي عبر thread pool.
    """
    key = _cache_key(data, dpi)
    if key in _PAGE_CACHE:
        return _PAGE_CACHE[key]
    out = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        pages = list(doc)
        args = [(i, pg, dpi) for i, pg in enumerate(pages)]
        results = []
        with ThreadPoolExecutor(max_workers=_PARALLEL_WORKERS) as ex:
            for r in ex.map(_parse_single_page, args):
                results.append(r)
        # ترتيب النتائج حسب الفهرس
        results.sort(key=lambda x: x["index"])
        for r in results:
            if r["needs_render"]:
                out.append({"kind": "image", "index": r["index"],
                            "img": r["img"]})
            else:
                out.append({"kind": "native", "index": r["index"],
                            "tables": r["tables"], "text": r.get("text", "")})
    _PAGE_CACHE[key] = out
    return out


def image_page_from_bytes(data: bytes) -> dict:
    """ملف صورة غير PDF → صفحة واحدة kind=image."""
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
    # محاولة عبر Pillow لدعم صيغ إضافية
    from PIL import Image
    pil = Image.open(io.BytesIO(data)).convert("RGB")
    img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    return {"kind": "image", "index": 0, "img": img}


def parse_file(data: bytes, filename: str = "", dpi: int = DEFAULT_DPI) -> dict:
    """
    نقطة الدخول الموحدة لـ /api/pdf/parse.
    يعيد: {is_pdf, pages:[{kind, index, tables?|img?}], warning?}
    (img تُستبدل لاحقاً بـ image_b64 في main.py)
    """
    warning: Optional[str] = None
    if dpi < 200:
        warning = f"dpi={dpi} أقل من 200 — جودة الصفحات الممسوحة قد تكون ضعيفة (يُنصح بـ 300)"
    name = (filename or "").lower()
    is_pdf = data[:5] == b"%PDF-" or name.endswith(".pdf")
    if is_pdf:
        pages = pdf_pages_from_bytes(data, dpi=dpi)
    else:
        pages = [image_page_from_bytes(data)]
    return {"is_pdf": is_pdf, "pages": pages, "warning": warning}
