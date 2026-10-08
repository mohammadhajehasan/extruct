# إعدادات النشر على Railway — Backend (FastAPI)

## الخطوات

### 1. تثبيت Railway CLI
```bash
npm i -g @railway/cli
```

### 2. تسجيل الدخول
```bash
railway login
```

### 3. إنشاء مشروع جديد
```bash
cd mini-services/py-extractor
railway init
```

### 4. إضافة إضافة Redis
```bash
railway services link
```
اختر **Redis** من القائمة. سيتم ملء متغير `REDIS_URL` تلقائياً.

### 5. نشر الباك
```bash
railway up
```

### 6. الحصول على عنوان الباك
بعد النشر، احصل على العنوان من:
```bash
railway variable get RAILWAY_PUBLIC_DOMAIN
```
أو من لوحة تحكم Railway.
العنوان النهائي: `https://your-app.up.railway.app`

### 7. تحديث متغير PY_BASE (اختياري - للتعرف الداخلي للباك)
```bash
railway variable set PY_BASE=https://your-app.up.railway.app/api
```

### 8. تحديث متغير الباك من الفرونت (Netlify)
بعد الحصول على العنوان، اذهب إلى Netlify:
- Settings → Environment variables
- أضف: `NEXT_PUBLIC_PY_BASE=https://your-app.up.railway.app/api`
- إعادة بناء الفرونت (Redeploy)

## إعدادات Railway

### ملف التكوين (railway.toml) في `mini-services/py-extractor/`
- `builder: python`
- `buildCommand: pip install -r requirements.txt`
- `startCommand: python -m uvicorn main:app --host 0.0.0.0 --port $PORT`

### Railway UI (عند إنشاء المشروع يدوياً)
- **Builder**: Python
- **Build command**: `pip install -r requirements.txt`
- **Start command**: `python -m uvicorn main:app --host 0.0.0.0 --port $PORT`
- **Environment variables**:
  - `PY_BASE=https://your-app.up.railway.app/api` (بعد الحصول على العنوان)
  - Redis: اربط إضافة Redis وسيتم ملء `REDIS_URL` تلقائياً

### الملاحظات
- Railway **لا ينام** في الـ free tier (عكس Render)
- المنفذ `PORT` مهيأ تلقائياً من Railway
- الـ CORS مهيأ لقبول `localhost:3000` والـ Netlify domain (يُضبط يدوياً)
- الـ health check: `GET /api/health`

## إصلاحات الـ 502 على الـ free tier

- معالجة كل صورة بشكل منفرد (tables-tab.tsx)
- تحديد الوجوه بـ 2 كحد أقصى (mechanic-tab.tsx)
- Railway free tier لا ينام، لكن يفضل مراقبة الـ memory
- إذا حدث 502، راجع السجلات من Railway Dashboard
