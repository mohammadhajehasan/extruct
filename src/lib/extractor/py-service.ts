// إعداد الوصول إلى خدمة الاستخراج (FastAPI) — المستخرج الأسطوري v7.1
//
// محلياً: الخدمة على http://127.0.0.1:8000 (كما في README).
// على Netlify: لا يوجد منفذ 8000، فيجب ضبط الخدمة المستضافة عبر متغيرات البيئة:
//   PY_EXTRACTOR_URL        أصل الخدمة المستضافة، مثل https://extractor.example.com
//                           (يُقبل مع أو بدون لاحقة /api — تُطبَّع تلقائياً)
//   PY_EXTRACTOR_TOKEN      سر مشترك اختياري يُرسل كـ Authorization: Bearer
//   PY_EXTRACTOR_TIMEOUT_MS مهلة الطلب بالمللي ثانية (افتراضي 60000)
//
// المفاتيح لا تُسجَّل ولا تُعاد في أي استجابة (بند 15.6 من العقد).

const LOCAL_BASE = "http://127.0.0.1:8000/api";

const DEFAULT_TIMEOUT_MS = 60_000;

function rawServiceUrl(): string {
  return (process.env.PY_EXTRACTOR_URL || "").trim();
}

/** جذر الخدمة منتهياً بـ /api — يقبل الأصل وحده أو الرابط المتضمّن /api */
export function pyServiceBase(): string {
  const raw = rawServiceUrl();
  if (!raw) return LOCAL_BASE;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return LOCAL_BASE;
  }

  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/api") ? path : `${path}/api`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** السر المشترك للخدمة المستضافة — undefined إن لم يُضبط */
export function pyServiceToken(): string | undefined {
  const token = (process.env.PY_EXTRACTOR_TOKEN || "").trim();
  return token || undefined;
}

export function pyServiceTimeoutMs(): number {
  const parsed = Number(process.env.PY_EXTRACTOR_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** وصف آمن للعرض في نقطة الصحة — المضيف فقط، بلا مفاتيح أو مسارات كاملة */
export function pyServiceInfo(): {
  configured: boolean;
  hosted: boolean;
  host: string;
  authenticated: boolean;
  timeout_ms: number;
} {
  const base = pyServiceBase();
  let host = "";
  try {
    host = new URL(base).host;
  } catch {
    host = "";
  }
  return {
    configured: rawServiceUrl().length > 0,
    hosted: base !== LOCAL_BASE,
    host,
    authenticated: Boolean(pyServiceToken()),
    timeout_ms: pyServiceTimeoutMs(),
  };
}

/** رسالة عربية موحّدة عند تعذر الوصول — تُرشد إلى الضبط الناقص على Netlify */
export function pyServiceUnreachableError(detail: string): string {
  if (!rawServiceUrl()) {
    return `خدمة الاستخراج غير متاحة (${detail}) — اضبط PY_EXTRACTOR_URL على رابط الخدمة المستضافة`;
  }
  return `خدمة الاستخراج غير متاحة (${detail}) — تحقق من الخدمة المستضافة على ${pyServiceInfo().host}`;
}
