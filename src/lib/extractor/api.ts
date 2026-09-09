// عميل خدمة Python — المستخرج الأسطوري v7.1
// وفق عقد API: كل الاستدعاءات عبر مسار /api/py/... (وكيل شفاف في Next.js — بدون منفذ صريح أو localhost في كود العميل)

import type { FailoverLogEntry, ProviderStatus } from "./types";

export const PY = "";

type Json = Record<string, unknown>;

/**
 * خطأ مصنّف من الخلفية (15.10 المرونة الإقليمية):
 * عند ok:false ووجود error_type نصي تُرمى بدل Error العادي حتى تعرض الواجهة
 * الرسالة العربية المفصلة (error_ar) كما هي، وتصل تفاصيل إضافية (failover_log/attempts_detail) عبر payload.
 */
export class PyApiError extends Error {
  readonly errorType?: string;
  readonly errorAr?: string;
  readonly payload?: Json;
  constructor(
    message: string,
    opts: { errorType?: string; errorAr?: string; payload?: Json } = {}
  ) {
    super(message);
    this.name = "PyApiError";
    this.errorType = opts.errorType;
    this.errorAr = opts.errorAr;
    this.payload = opts.payload;
  }
}

async function pyFetch<T = Json>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${PY}/api/py/${path}`;
  const res = await fetch(url, options);
  let json: Json | null = null;
  try {
    json = (await res.json()) as Json;
  } catch {
    // استجابة ليست JSON
  }
  if (!res.ok || !json || json.ok === false) {
    const msg =
      (json && typeof json.error === "string" && json.error) ||
      `فشل الاتصال بخدمة الاستخراج (${res.status})`;
    // 15.10: خطأ مزود مصنّف (geo_blocked/auth_invalid/...) — نحمل error_ar وتفاصيل السلسلة للواجهة
    if (json && json.ok === false && typeof json.error_type === "string") {
      throw new PyApiError(msg, {
        errorType: json.error_type,
        errorAr: typeof json.error_ar === "string" ? json.error_ar : undefined,
        payload: json,
      });
    }
    throw new Error(msg);
  }
  return json as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------- الصور والتحويلات ----------

/** dataUrl → base64 خام بدون البادئة (كما يتطلب العقد) */
export function dataUrlToB64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** base64 خام → dataUrl للعرض في <img> */
export function b64ToDataUrl(b64: string, mime = "image/png"): string {
  return `data:${mime};base64,${b64}`;
}

/** تنظيف نص CSV من أسوار Markdown إن وُجدت */
export function cleanCsvText(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:csv)?\s*\n([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();
  return t;
}

// ---------- نقاط النهاية ----------

export async function getHealth(): Promise<{
  service: string;
  version: string;
  modules: string[];
  capabilities: { barcode: boolean; ocr: boolean };
}> {
  return pyFetch("health");
}

export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  timeout = 20
): Promise<{ models: { name: string; free: boolean; vision: boolean }[]; source: "live" | "fallback"; error?: string }> {
  // ملاحظة: استجابة {ok:false, source:"fallback", models:[...]} ليست خطأ اتصال —
  // إنما قائمة احتياطية مقصودة من الخدمة مع رسالة السبب، فتُعاد كما هي
  // لتعرضها الواجهة (قائمة + تحذير). الخطأ يُرمى فقط عند فشل HTTP/الاتصال.
  const res = await fetch(`${PY}/api/py/providers/models`, jsonInit("POST", { base_url: baseUrl, api_key: apiKey || undefined, timeout }));
  let json: Json | null = null;
  try {
    json = (await res.json()) as Json;
  } catch {
    // استجابة ليست JSON
  }
  if (!res.ok || !json) {
    const msg =
      (json && typeof json.error === "string" && json.error) ||
      `فشل الاتصال بخدمة الاستخراج (${res.status})`;
    throw new Error(msg);
  }
  const models = Array.isArray(json.models)
    ? (json.models as { name: string; free: boolean; vision: boolean }[])
    : [];
  return {
    models,
    source: json.source === "live" ? "live" : "fallback",
    error: typeof json.error === "string" ? json.error : undefined,
  };
}

export async function getProfiles(): Promise<{
  profiles: { id: string; name_ar: string; desc_ar: string; steps: string[] }[];
}> {
  return pyFetch("enhance/profiles");
}

export async function enhance(
  imageB64: string,
  profile: string
): Promise<{ image_b64: string; analysis: Record<string, unknown>; plan: { step: string; reason_ar: string }[]; profile_used: string; elapsed_ms: number }> {
  return pyFetch("enhance", jsonInit("POST", { image_b64: imageB64, profile }));
}

export async function parsePdf(file: File, dpi = 300): Promise<{
  is_pdf: boolean;
  pages: { kind: "native"; index: number; tables: string[][][] }[] | { kind: "image"; index: number; image_b64: string }[];
  warning?: string;
}> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("dpi", String(dpi));
  return pyFetch("pdf/parse", { method: "POST", body: fd });
}

export async function extract(args: {
  mode: "tables" | "mechanic" | "classify" | "verify";
  imagesB64: string[];
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  extra?: Record<string, unknown>;
}): Promise<{ text: string; parsed?: unknown; attempts: number; model: string; elapsed_ms: number }> {
  return pyFetch(
    "extract",
    jsonInit("POST", {
      mode: args.mode,
      images_b64: args.imagesB64,
      provider: args.provider,
      model: args.model,
      base_url: args.baseUrl || undefined,
      api_key: args.apiKey || undefined,
      extra: args.extra || undefined,
    })
  );
}

// ---------- 15.10 المرونة الإقليمية: فحص توفر المزودين (Health Check) ----------

/** فحص مزود واحد — {base_url, api_key?, timeout=8} → حالة مصنّفة (geo_blocked/auth_invalid/...) */
export async function healthCheck(
  baseUrl: string,
  apiKey?: string,
  timeout = 8
): Promise<ProviderStatus> {
  return pyFetch(
    "providers/health",
    jsonInit("POST", { base_url: baseUrl, api_key: apiKey || undefined, timeout })
  );
}

/** فحص دفعة مزودات مرة واحدة → results/{id}: نفس كائن الفحص (بلا مفتاح ولا حالة تُخزّن بالخادم) */
export async function healthBatch(
  items: { id: string; base_url: string; api_key?: string }[],
  timeout = 8
): Promise<{ results: Record<string, ProviderStatus> }> {
  return pyFetch(
    "providers/health_batch",
    jsonInit("POST", {
      providers: items.map((it) => ({
        id: it.id,
        base_url: it.base_url,
        api_key: it.api_key || undefined,
      })),
      timeout,
    })
  );
}

// ---------- 15.10.5 سلسلة التراجع التلقائي (Automatic Failover Chain) ----------

export interface FailoverChainItem {
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
}

/**
 * استخراج عبر سلسلة مزودات — عند فشل حلقة تنتقل للتالية (حظر جغرافي/حد معدل)
 * وتتوقف فوراً عند مفتاح غير صحيح (auth_invalid).
 * الفشل يعود PyApiError (errorType/errorAr + payload يحوي failover_log أو attempts_detail).
 */
export async function extractWithFailover(args: {
  mode: "tables" | "mechanic" | "classify" | "verify";
  imagesB64: string[];
  chain: FailoverChainItem[];
  timeout?: number;
}): Promise<{
  text: string;
  parsed?: unknown;
  attempts: number;
  model: string;
  elapsed_ms: number;
  used_provider: string;
  used_model: string;
  failover_log: FailoverLogEntry[];
}> {
  return pyFetch(
    "extract/failover",
    jsonInit("POST", {
      mode: args.mode,
      images_b64: args.imagesB64,
      chain: args.chain.map((c) => ({
        provider: c.provider,
        model: c.model,
        base_url: c.base_url || undefined,
        api_key: c.api_key || undefined,
      })),
      timeout: args.timeout ?? 120,
    })
  );
}

export async function groupFaces(items: { label: string; image_b64: string }[]): Promise<{
  groups: { category_ar: string; category_key: string; faces: string[]; method: "barcode" | "adjacency" }[];
}> {
  return pyFetch("mechanic/group", jsonInit("POST", { items }));
}

export async function validateRecord(record: Record<string, string>): Promise<{
  fields: Record<string, { value: string; confidence: string; reasons: string[] }>;
  chassis_no_vin_valid?: boolean;
}> {
  return pyFetch("mechanic/validate", jsonInit("POST", { record }));
}

export async function ocrCross(field: string, imageB64: string, vlValue: string): Promise<{
  status: "HIGH" | "REVIEW" | "SKIPPED";
  ocr_value?: string;
  reason_ar?: string;
}> {
  return pyFetch("mechanic/ocr_cross", jsonInit("POST", { field, image_b64: imageB64, vl_value: vlValue }));
}

export async function consensus(results: { source: string; fields: Record<string, string> }[]): Promise<{
  fields: Record<string, { value: string; confidence: string; votes: { source: string; value: string }[] }>;
  review_count: number;
}> {
  return pyFetch("consensus", jsonInit("POST", { results }));
}

export async function runBenchmark(args: {
  imageB64: string;
  models: string[];
  provider: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<{
  results: { model: string; csv: string; cells: number; score: number; elapsed_ms: number }[];
  agreement_matrix: Record<string, number>;
  winner: string;
  csv_report: string;
}> {
  return pyFetch(
    "benchmark",
    jsonInit("POST", {
      image_b64: args.imageB64,
      models: args.models,
      provider: args.provider,
      base_url: args.baseUrl || undefined,
      api_key: args.apiKey || undefined,
    })
  );
}

export async function mergeRows(
  rows: string[][],
  headers?: string[],
  mode: "boundary" | "global" = "boundary"
): Promise<{ rows: string[][]; removed: number }> {
  return pyFetch("merge", jsonInit("POST", { rows, headers, mode }));
}

export async function exportFile(
  kind: "tables" | "mechanic",
  format: "csv" | "xlsx",
  headers: string[],
  rows: string[][]
): Promise<void> {
  const res = await fetch(`${PY}/api/py/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, format, headers, rows }),
  });
  if (!res.ok) {
    let err = `فشل التصدير (${res.status})`;
    try {
      const j = (await res.json()) as Json;
      if (typeof j.error === "string") err = j.error;
    } catch {
      // تجاهل
    }
    throw new Error(err);
  }
  const blob = await res.blob();
  // اسم الملف من Content-Disposition أو timestamps
  let filename = `${kind}_${Date.now()}.${format}`;
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (m && m[1]) {
    try {
      filename = decodeURIComponent(m[1].replace(/"/g, ""));
    } catch {
      filename = m[1].replace(/"/g, "");
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function kbLearn(entry: {
  scope: "tables" | "mechanic";
  field: string;
  wrong: string;
  right: string;
  context?: string;
}): Promise<{ entry_count: number }> {
  return pyFetch("kb/learn", jsonInit("POST", entry));
}

export async function kbStats(): Promise<{ entries: number; by_field: Record<string, number>; chains: unknown[] }> {
  return pyFetch("kb/stats");
}

export async function kbFewshot(field: string, wrong?: string): Promise<{
  shots: { wrong: string; right: string; count: number }[];
}> {
  return pyFetch("kb/fewshot", jsonInit("POST", { field, wrong }));
}

export async function getAudit(limit = 50): Promise<{
  entries: { ts: string; action: string; target: string; model?: string; details?: unknown }[];
}> {
  return pyFetch(`audit?limit=${limit}`);
}

export async function getGlossary(): Promise<{
  fuel: string[];
  governorates: string[];
  categories: { key: string; name_ar: string; faces: number; rule_ar: string }[];
  fields: { key: string; label_ar: string }[];
}> {
  return pyFetch("glossary");
}
