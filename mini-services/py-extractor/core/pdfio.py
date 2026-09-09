# -*- coding: utf-8 -*-
"""
core/pdfio.py — معالج PDF: PDF نصي (find_tables → دقة 100% بلا نموذج) أم مسح (render dpi).
المصدر: الخطة الحاكمة v7.1 — الجزء 4 + عقد API (/api/pdf/parse).
"""
import base64
import io
from typing import Optional

import cv2
import fitz  # PyMuPDF
import numpy as np

DEFAULT_DPI = 300
# A4: 8.27 × 11.69 بوصة — تُستخدم لتقدير dpi من عرض الصورة
A4_WIDTH_INCH = 8.27


def decode_b64_to_bgr(image_b64: str) -> np.ndarray:
    """فك base64 (مع قص بادئة data: إن وُجدت دفاعياً) إلى صورة BGR."""
    raw = (image_b64 or "").strip()
    if raw.startswith("data:"):
        idx = raw.find(",")
        if idx != -1:
            raw = raw[idx + 1:]
    buf = np.frombuffer(base64.b64decode(raw), np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("تعذّر فك ترميز الصورة (base64 غير صالح)")
    return img


def encode_bgr_to_b64(img: np.ndarray, ext: str = ".png") -> str:
    """ترميز صورة BGR/رمادية إلى base64 خام (بدون بادئة data:) PNG افتراضياً."""
    if img.ndim == 2:
        ok, buf = cv2.imencode(ext, img)
    else:
        ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise ValueError("فشل ترميز الصورة")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _pix_to_bgr(pix: "fitz.Pixmap") -> np.ndarray:
    if pix.alpha:
        pix = fitz.Pixmap(pix, 0)  # إسقاط ألفا
    arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 1:
        return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    if pix.n >= 3:
        return cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2BGR)
    return arr


def pdf_pages_from_bytes(data: bytes, dpi: int = DEFAULT_DPI) -> list:
    """
    لكل صفحة PDF:
      - نص أصلي + جداول find_tables → ("native", index, tables)
      - وإلا render pixmap بدقة dpi → ("image", index, BGR ndarray)
    (الجزء 4 من الخطة — pdf_pages)
    """
    out = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for i, pg in enumerate(doc):
            text = pg.get_text().strip()
            try:
                tables = pg.find_tables().tables
            except Exception:
                tables = []
            if text and tables:
                native = []
                for t in tables:
                    try:
                        rows = t.extract()
                        native.append([[("" if c is None else str(c)) for c in row]
                                       for row in rows])
                    except Exception:
                        continue
                out.append({"kind": "native", "index": i, "tables": native,
                            "text": text})
            else:
                zoom = max(dpi, 72) / 72.0
                pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
                out.append({"kind": "image", "index": i, "img": _pix_to_bgr(pix)})
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
