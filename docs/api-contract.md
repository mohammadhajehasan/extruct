# عقد API الموحد — نظام المستخرج الأسطوري v7.1 (المرجع الملزم للوكيلين)

> هذا العقد يحدد بدقة كل نقطة اتصال بين الواجهة (Next.js/React) وخدمة Python.
> أي تغيير يجب موافقة الطرفين وتوثيقه في worklog.md.

## 0) قواعد عامة
- خدمة Python: FastAPI على المنفذ **8000**، مجلد `mini-services/py-extractor/`.
- الواجهة تستدعي Python **دائماً** بصيغة: `fetch('/api/<path>?XTransformPort=8000', {...})` — ممنوع ذكر المنفذ أو localhost في كود الواجهة.
- كل الاستجابات JSON بالشكل: `{ ok: boolean, ...data | error: string }`.
- الصور تُنقل base64 **بدون** بادئة `data:image/...` (بيانات خام فقط) — الحقل اسمه `image_b64` دائماً (أو `images_b64: string[]`).
- إعدادات المستخدم (provider/base_url/model/api_key) تُرسل من الواجهة مع كل طلب استخراج؛ الخدمة **لا تحفظ المفاتيح أبداً** في أي ملف (بند 15.6).
- مزود خاص `"zai"` = المزود المجاني المدمج؛ خدمة Python توجّه الطلبات له إلى `http://127.0.0.1:3000/api/ai/vlm` عبر httpx.

## 1) Next.js route: `POST /api/ai/vlm` (يُنشأ من main agent)
Request: `{ image_b64: string, prompt: string, model?: string }`
Response: `{ ok: true, text: string }` | `{ ok: false, error: string }`
- يستخدم z-ai-web-dev-sdk `chat.completions.createVision` في السيرفر فقط.
- model الافتراضي: `"glm-4.5v"`.

## 2) نقاط نهاية خدمة Python (كلها تحت /api على المنفذ 8000)

### GET /api/health
→ `{ ok:true, service:"py-extractor", version:"7.1", modules:[...أسماء الوحدات], capabilities:{ barcode:bool, ocr:bool } }`

### POST /api/providers/models
Body: `{ base_url:string, api_key?:string, timeout?:number }`
- يستخدم openai SDK: `OpenAI(api_key or "ollama", base_url).models.list()`
- `free` حسب: ALWAYS_FREE_URLS=("http://localhost:11434/v1","https://api.groq.com/openai/v1") أو الاسم يحوي ":free" أو ينتهي "-free" أو تسعير OpenRouter صفر (model_extra.pricing.prompt==0 و completion==0).
- `vision` حسب VISION_HINTS=("vl","vision","gemini","gpt-4o","gpt-4.1","pixtral","llava","minicpm","internvl","molmo","claude-3").
- الفرز: مجاني أولاً ثم رؤيوي ثم الاسم.
→ `{ ok:true, models:[{name:string, free:bool, vision:bool}], source:"live" }`
عند الفشل: `{ ok:false, error:string, models:[...قائمة احتياطية مدمجة], source:"fallback" }`

### POST /api/providers/health (15.10.3 — المرونة الإقليمية)
Body: `{ base_url:string, api_key?:string, timeout?:number = 8 }`
- فحص توفر خفيف جداً: GET واحد على `{root}/models` عبر httpx مع ترويسة Authorization Bearer عند وجود مفتاح (بدون مفتاح لـ ollama).
- `suggested_model` = أول نموذج رؤيوي من قائمة الاستجابة (VISION_HINTS) أو أول معرف — best-effort.
- لا يُخزَّن أي شيء على القرص ولا يُسجَّل المفتاح إطلاقاً.
→ `{ ok:true, available:bool, status:int|null, error_type:string|null, error_ar:string|null, host:string, suggested_model:string|null }`

### POST /api/providers/health_batch (15.10.3)
Body: `{ providers:[{id:string, base_url:string, api_key?:string}], timeout?:number = 8 }`
- فحوص متوازية (asyncio.gather) — فشل عنصر لا يُسقط البقية (يظهر داخل نتيجته network_down/unknown).
→ `{ ok:true, results:{ <id>: نفس حمولة health الفردية } }`

### تصنيفات الأخطاء الموحدة (15.10.2) — error_type/error_ar
`error_type` ∈ `geo_blocked | auth_invalid | rate_limited | network_down | unknown` و`error_ar` رسالة عربية ملزمة تعرض كما هي:
- geo_blocked: «هذا المزود غير متاح بمنطقتك حالياً — جرّب مزوداً آخر أو نموذجاً محلياً» (403/451 أو "unsupported_country")
- auth_invalid: «مفتاح API غير صحيح أو منتهٍ — تحقق من الإعدادات» (401)
- rate_limited: «تجاوزت حد معدل الطلبات لدى المزود — انتظر قليلاً ثم أعد المحاولة» (429)
- network_down: «تعذر الوصول إلى المزود (مهلة أو اتصال مقطوع) — تحقق من الشبكة أو الرابط»
- unknown: «فشل غير متوقع لدى المزود»

### GET /api/enhance/profiles
→ `{ ok:true, profiles:[{id, name_ar, desc_ar, steps:[string]}] }`
المعرفات: `none | darken_clarity | manual_safe | strong_shadow | high_noise_safe | low_res | stamped | official_document`
(official_document = gray→shadow σ60→clahe_micro→close→stretch بلا sharpen حماية للأختام؛ darken_clarity = upscale→gray→shadow→clahe(≤1.2)→close(2×2)→micro-unsharp→stretch(2–98))

### POST /api/enhance
Body: `{ image_b64:string, profile:string }`
- Analyzer يقيس: blur (Laplacian var، عتبة 120)، contrast_std (عتبة 45)، skew_angle (>1°)، perspective، noise (>0.35)، dpi_est (<1600)، stamp_ratio (>0.5%).
- Planner يبني السلسلة من RULES مرتبة بالأولوية مع **سبب** لكل خطوة. profile=none يطبق stretch الختام فقط.
→ `{ ok:true, image_b64:string (المحسّنة), analysis:{...}, plan:[{step, reason_ar}], profile_used, elapsed_ms }`

### POST /api/pdf/parse
multipart/form-data: `file` + `dpi` (افتراضي 300)
- PDF نصي (نص + جداول find_tables): صفحة `{kind:"native", index, tables:[[{cell}]] }` — بدقة 100% بلا نموذج.
- PDF ممسوح: `{kind:"image", index, image_b64}` بكسل الخريطة dpi.
- تحذير إن dpi<200 (`warning`).
- ملف صورة غير PDF: صفحة واحدة kind=image.
→ `{ ok:true, is_pdf:bool, pages:[...] }`

### POST /api/extract
Body: `{ mode:"tables"|"mechanic"|"classify"|"verify",
        images_b64:[string], provider:string, model:string,
        base_url?:string, api_key?:string, extra?:object }`
- استدعاء VL مع retry أسّي ×3 (1s,2s,4s).
- provider=="zai": httpx POST إلى `http://127.0.0.1:3000/api/ai/vlm` بـ `{image_b64, prompt, model}` (أول صورة فقط للتصنيف).
- غير ذلك: openai SDK chat.completions مع `image_url: {"url": "data:image/png;base64,"+b64}`.
- البرومبتات:
  * tables: برومبت CSV حرفي — "انسخ الجدول كما هو مكتوب تماماً بدون أي تصحيح، أعد CSV فقط بفواصل، الخلية الفارغة تبقى فارغة، غير المقروء = UNCLEAR، حافظ على النص العربي كما هو."
  * mechanic: برومبت 7.4 حرفياً (JSON بالمفاتيح الـ13: vehicle_symbol, chassis_no, engine_no, engine_capacity, manufacture_date, category, plate_no, maker, model, fuel, governorate, passengers, type) — مع دمج وجهين عند توفر صورتين (اتحاد الحقول، تعارض → قيمة مع علم تعارض).
  * classify: تصنيف الصورة إلى واحدة: mechanic_card_front | mechanic_card_back | registration_statement | temp_driving_license | transfer_deed | table_document | unknown — أعد JSON `{label, confidence}`.
  * verify: مرور ثانٍ — أعيد JSON تصحيحات لكل حقل مع confidence HIGH/MED/LOW.
→ `{ ok:true, text:string, parsed?:any, attempts:int, model, elapsed_ms }`
- mechanic parsed = `{ fields:{<13 key>:string}, conflicts:[key...], face_values:[...] }`
- عند فشل المزود (15.10): `{ ok:false, error:string, error_type:string, error_ar:string }` — المفتاح الخاطئ/الحظر الجغرافي يفشلان فوراً بلا استكمال retry ×3 (15.10.5).

### POST /api/extract/failover (15.10.5 — سلسلة التراجع)
Body: `{ mode:"tables"|"mechanic"|"classify"|"verify", images_b64:[string],
        chain:[{provider:string, model?:string, base_url?:string, api_key?:string}], timeout?:number = 120 }`
- تجربة الحلقات بالترتيب (كل حلقة = استدعاء extract كامل): geo_blocked/network_down/unknown → التالي فوراً، rate_limited → انتظار 2s ثم التالي، auth_invalid → **توقف فوراً بلا انتقال صامت**.
→ نجاح: `{ ok:true, text, parsed, attempts, model, elapsed_ms, used_provider, used_model, failover_log:[{provider, error_type, error_ar, elapsed_ms}] }`
→ مفتاح خاطئ: `{ ok:false, error_type:"auth_invalid", error, error_ar, failover_log:[...] }`
→ استنفاد السلسلة: `{ ok:false, error_type:"all_failed", error:"فشلت جميع مزودات السلسلة (N)", error_ar, attempts_detail:[{provider, error_type, error_ar, detail}], failover_log:[...] }` — تفصيل لكل مزود، لا رسالة عامة أبداً.
- ValueError (سلسلة فارغة/لا صور/mode غير معروف) → `{ ok:false, error:string }` كالعادة.

### POST /api/mechanic/group
Body: `{ items:[{label:string, image_b64:string}] }`
- group_faces_v2: مطابقة بالباركود (pyzbar) إن توفر، وإلا fallback التجاور (7.3 بأي ترتيب: أمامي+خلفي متجاوران = سجل، خلفي ثم أمامي مقبول، الفردي = سجل).
→ `{ ok:true, groups:[{category_ar:string, category_key:string, faces:[image_b64], method:"barcode"|"adjacency"}] }`

### POST /api/mechanic/validate
Body: `{ record:{ <field>:string } }`
- RULES: chassis_no (طول ≥11 أو ""/UNCLEAR)، passengers (أرقام)، manufacture_date (\d{4})، plate_no (^\d{1,2}/\d{3,6}$ — مخالفة = REVIEW "نمط لوحة غير معتاد" بلا رفض)، fuel ∈ {"بنزين","مازوت","غاز","كهرباء","هجين",""}، governorate ∈ قائمة المحافظات الـ15 + "".
- VIN check digit ISO 3779 (15.1): عمود جانبي فقط `chassis_no_vin_valid:bool` — **ممنوع منعاً باتاً تعديل قيمة chassis_no نفسها**.
- CONF map (O→0, I→1, l→1, S→5, B→8, Z→2, G→6) يُستخدم فقط لاقتراح في reasons وليس لتعديل القيمة.
→ `{ ok:true, fields:{ <field>:{ value:string, confidence:"HIGH"|"MED"|"LOW"|"REVIEW", reasons:[string_ar] } }, chassis_no_vin_valid?:bool }`
- القيم "" و "UNCLEAR" = LOW مع سبب "غير موجود/غير مقروء".

### POST /api/mechanic/ocr_cross
Body: `{ field:string, image_b64:string, vl_value:string }`
- 15.3: Tesseract whitelist "0123456789ABCDEFGHJKLMNPRSTUVWXYZ-/" للحقول الرقمية فقط (chassis_no, engine_no, plate_no, engine_capacity).
→ `{ ok:true, status:"HIGH"|"REVIEW"|"SKIPPED", ocr_value?:string, reason_ar?:string }`

### POST /api/consensus
Body: `{ results:[{ source:string, fields:{ <field>:string } }] }`
- تصويت لكل حقل: اتفاق كامل → HIGH؛ خلاف → REVIEW مع ذكر القيم.
→ `{ ok:true, fields:{ <field>:{ value, confidence, votes:[{source,value}] } }, review_count:int }`

### POST /api/benchmark
Body: `{ image_b64:string, models:[string], provider, base_url?, api_key? }`
- سباق جداول لكل نموذج (extract tables)، score لكل نتيجة (جودة تحليل CSV: عدد صفوف/خلايا غير فارغة/غياب أخطاء)، pairwise agreement matrix بين النماذج (نسبة تشابه الخلايا).
→ `{ ok:true, results:[{model, csv, cells:int, score:float, elapsed_ms}], agreement_matrix:{ "modelA|modelB": float }, winner:string, csv_report:string }`

### POST /api/export
Body: `{ kind:"tables"|"mechanic", format:"csv"|"xlsx",
        headers:[string], rows:[[string]] }`
- CSV: `utf-8-sig`. XLSX: RTL، ترويسة fill `1F4E78` خط أبيض عريض، حدود، عرض أعمدة تلقائي، تجميد A2. kind=mechanic: ورقة موحدة + عمود الفئة والمصدر.
Response: ملف ثنائي مباشر مع `Content-Disposition` (الواجهة تحوله Blob لتحميل).
→ ملف: `tables_<ts>.csv|xlsx` أو `mechanic_<ts>.csv|xlsx`

### POST /api/merge
Body: `{ rows:[[string]], headers?:[string], mode:"boundary"|"global" }`
- Merger: تطبيع عربي→لاتيني للمقارنة، كشف تكرار صفوف، إبقاء الترتيب.
→ `{ ok:true, rows:[[string]], removed:int }`

### GET /api/kb/stats   |   POST /api/kb/learn   |   POST /api/kb/fewshot
- learn Body: `{ scope:"tables"|"mechanic", field:string, wrong:string, right:string, context?:string }` → `{ ok:true, entry_count:int }`
- fewshot Body: `{ field:string, wrong?:string }` → `{ ok:true, shots:[{wrong,right,count}] }` (أقرب التصحيحات للعرض)
- stats → `{ ok:true, entries:int, by_field:{field:count}, chains:[سلاسل ناجحة] }`

### GET /api/audit?limit=50
→ `{ ok:true, entries:[{ts, action, target, model?, details}] }` (تُكتب تلقائياً من extract/export/enhance/benchmark/learn)

### GET /api/glossary
→ `{ ok:true, fuel:[...], governorates:[...], categories:[{key, name_ar, faces:int, rule_ar}], fields:[{key, label_ar}] }`

## 3) حالات الاستخدام الأساسية من الواجهة
1. الجداول: رفع صور/PDF → (اختياري) pdf/parse أو تعديل بالمحرر → enhance → extract(mode=tables) → عرض CSV كشبكة → export.
2. الميكانيك: رفع وجوه → classify كل صورة (تأكيد بصري) → mechanic/group → extract(mode=mechanic) لكل مجموعة → mechanic/validate لكل سجل → عرض جدول الـ13 حقل + عمودا الفئة والمصدر → review للـREVIEW → export.
3. مقارنة: benchmark → عرض درجات + مصفوفة التوافق + فائز 🏆 → اعتماد النموذج → تنزيل تقرير CSV.
4. التدقيق: عرض عناصر REVIEW/MED من آخر جلسة (تُحفظ في store الواجهة) مع الصورة المكبرة → تصحيح يدوي → kb/learn.
5. الإعدادات: provider/base_url/api_key/model + جلب النماذج (تلقائي بعد 700ms من إدخال المفتاح + زر 🔄) + free_first + فلتر رؤيوي فقط + البروفايلات + dpi.

## 4) مخزن الواجهة (zustand) — الحالات المشتركة
- settings: { provider:"zai", model, baseUrl, apiKey(localStorage فقط), freeFirst:true, visionOnly:false, profile:"darken_clarity", dpi:300 }
- models: [{name, free, vision}] + fetching state
- images: [{ id, name, dataUrl(الأصل), ops:[...] (مكدس غير إتلافي), enhancedB64?, analysis?, plan? }]
- tableResults: [{ imageId, csv, rows, model, elapsed_ms }]
- mechanicRecords: [{ id, category_key, category_ar, faces:[dataUrl], fields:{13}, vin_valid?, flags:{field:{confidence,reasons[]}} }]
- reviewQueue: [{ id, scope, field, value, confidence, reasons, imageId? }]
- benchmark: { running, results, agreement_matrix, winner }

## 5) ملاحظات ملزمة
- مبدأ "انقل ولا تصحّح": لا يوجد أي تصحيح صامت للقيم المستخرجة في أي طرف.
- مبدأ "الغموض يُعلَّم": كل قيمة غير واثقة → REVIEW ولا تُخمَّن.
- مكدس المحرر غير إتلافي: ops تُطبَّق لحظة الاستخراج فقط، الأصل سليم دائماً (canvas في الواجهة).
- كل الأزرار أثناء العمليات الطويلة: disabled + Progress/spinner حقيقي.
- الواجهة عربية RTL بالكامل، خط عربي (Cairo أو Tajawal)، ألوان محايدة + accent أخضر زمردي/كهرماني — ممنوع الأزرق/النيلي.
- Footer ثابت أسفل الشاشة (min-h-screen flex flex-col + mt-auto).
