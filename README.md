# extruct — المستخرج الأسطوري / Legendary Extractor v7.1

نظام استخراج ذكي للبيانات من الصور وملفات PDF باستخدام نماذج الذكاء الاصطناعي (رؤية + لغة)، مع مراجعة بشرية، وتصدير CSV/Excel، وتدقيق تلقائي.

An AI-powered data extraction system for images and PDFs (Vision + LLM), with human review, CSV/Excel export, and automatic auditing.

## المزايا / Features

- 🖼️ رفع الصور و PDF مع تحسين تلقائي للصورة (تطبيع، تدوير، قص)
- 🤖 استخراج جداول وعناصر عبر مزودات متعددة (Z.ai، OpenRouter، OpenAI، Gemini، DashScope، Groq، مخصص)
- 🔁 Failover تلقائي بين المزودات + إجماع (Consensus) + تحقق (Verifier)
- ✏️ محرر مراجعة بشري مع شبكة CSV قابلة للتعديل
- 📊 قياس أداء (Benchmark) وقاعدة معرفة (KB) وتدقيق (Audit)
- 🌙 واجهة Material Design بالعربية RTL مع وضع ليلي

## التقنيات / Tech Stack

- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Backend**: FastAPI (Python) — خدمة استخراج مستقلة `mini-services/py-extractor`
- **Database**: Prisma ORM + SQLite
- **AI**: OpenAI-compatible Vision/LLM providers

## التشغيل / Getting Started

```bash
# 1) تثبيت الحزم (npm يعمل على Windows — bun غير مطلوب)
npm install            # أو: bun install

# 2) قاعدة البيانات (اختياري: الواجهة لا تستدعي Prisma وقت التشغيل)
npm run db:push

# 3) خدمة الاستخراج (FastAPI على المنفذ 8000)
cd mini-services/py-extractor
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
# أو من جذر المشروع:  npm run dev:py   (Windows)

# 4) الواجهة (منفذ 3000)
npm run dev
```

الأدوار عبر الوكيل: `/api/py/*` → `localhost:8000`

### Windows — ملاحظات تشغيل ملزمة

- **لا تستخدم `| tee dev.log` ولا صيغة `VAR=value cmd` في سكربتات npm**: على Windows يكون صدفة npm هي `cmd.exe` حيث `tee` غير موجود وصيغة المتغيرات غير مدعومة، فيتعطّل السكربت.
- لذلك يعتمد `npm run dev` على `scripts/dev.js` و`npm start` على `scripts/start-web.js` (يمرّران الخرج إلى الطرفية وإلى `dev.log`/`server.log` معاً عبر Node، وتعمل على Windows و Linux/macOS).
- `npm start` يحتاج بناءً أولاً: `npm run build` ثم `npm start` (يقرأ `.next/standalone/server.js`).
- تحقق سريع: `http://localhost:3000` للواجهة و`http://127.0.0.1:8000/api/health` للخدمة، والوكيل عبر `http://localhost:3000/api/py/health`.
- القدرات الاختيارية: OCR يحتاج Tesseract مثبتاً على النظام، والباركود يحتاج DLL الخاصة بـ zbar. عند غيابها يظهر `capabilities: { ocr:false, barcode:false }` في نقطة الصحة ويبقى النظام يعمل.

## الإعداد / Configuration

من تبويب **الإعدادات** داخل التطبيق:
1. اختر المزود (Provider) والصق مفتاح API الخاص بك
2. اضغط **حفظ المفتاح** (يُحفظ محليًا في المتصفح لكل مزود على حدة)
3. اختر النموذج من القائمة (سحب مباشر أو قائمة احتياطية)

> ⚠️ لا تُخزَّن المفاتيح على الخادم — تُحفظ في متصفحك فقط (localStorage).

## البنية / Structure

```
src/app/                 # Next.js App Router
src/components/extractor # مكونات النظام
src/lib/extractor        # منطق الواجهة (store, api, failover)
mini-services/py-extractor  # خدمة الاستخراج FastAPI
prisma/                  # مخطط قاعدة البيانات
docs/                    # عقود API
```

---

© mohammadhajehasan
