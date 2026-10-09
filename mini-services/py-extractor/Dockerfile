FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# مكتبات النظام: OpenCV/PyMuPDF + pyzbar (libzbar0) + OCR (tesseract مع العربية والإنجليزية).
# ملاحظة: python:3.12-slim مبني على Debian bookworm — تُستخدم أسماء حزم bookworm
# (مثل libjpeg62-turbo) لا أسماء Ubuntu (libjpeg-turbo8) وإلا يفشل apt.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libxkbcommon0 \
    libjpeg62-turbo libpng16-16 libtiff6 libwebp7 libbz2-1.0 \
    libzbar0 \
    tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Render يحقن PORT — نربط عليه، مع 8000 كافتراضي محلي.
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
