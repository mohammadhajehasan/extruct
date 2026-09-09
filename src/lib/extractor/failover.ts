"use client";

// 15.10 المرونة الإقليمية — استخراج واعٍ للأخطاء وسلسلة التراجع
// smartExtract: تقرأ الإعدادات وحالة المزودات من المخزن وتختار المسار المباشر
// أو سلسلة التراجع (Ollama المحلي آخر حلقة) وفق عقد /api/py/extract/failover

import { toast } from "sonner";
import { extract, extractWithFailover, PyApiError } from "./api";
import type { FailoverChainItem } from "./api";
import { useExtractorStore, getProviderKey } from "./store";
import type { FailoverAttemptDetail, FailoverLogEntry } from "./types";

/** جذر Ollama المحلي — خط الدفاع الأخير المستقل عن أي قيود جغرافية (15.10.6) */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

export interface SmartExtractResult {
  text: string;
  parsed?: unknown;
  attempts: number;
  model: string;
  elapsed_ms: number;
  /** متاحة فقط في مسار السلسلة: المزود الذي نجح فعلياً */
  used_provider?: string;
  used_model?: string;
  /** حلقات فاشلة قبل النجاح — فارغة = نجاح مباشر بلا تراجع */
  failover_log?: FailoverLogEntry[];
}

/**
 * الاستخراج الموحّد للتبويبات (الجداول/الميكانيك):
 * - failoverEnabled=false → extract المباشرة كما كانت (السلوك الافتراضي).
 * - failoverEnabled=true  → سلسلة: المزود النشط أولاً، ثم Ollama المحلي (إن فُحص
 *   متاحاً ولديه suggested_model) عبر extractWithFailover.
 * الفشل يُرمى كما هو (PyApiError عند تصنيف الخلفية) — العرض في المستدعي.
 */
export function smartExtract(args: {
  mode: "tables" | "mechanic" | "classify" | "verify";
  imagesB64: string[];
  timeout?: number;
}): Promise<SmartExtractResult> {
  const { settings, providerStatuses } = useExtractorStore.getState();
  const { provider, model, baseUrl, failoverEnabled } = settings;
  // تخصيص المفاتيح: مفتاح المزود النشط هو مفتاحه هو فقط (persist v2)
  const apiKey = getProviderKey(settings, provider);

  if (failoverEnabled) {
    const chain: FailoverChainItem[] = [
      {
        provider,
        model,
        base_url: baseUrl || undefined,
        api_key: apiKey || undefined,
      },
    ];
    // 15.10.6: Ollama المحلي آخر حلقة — فقط إن أثبت الفحص الإقليمي توفره ولديه نموذج مقترح
    if (provider !== "ollama") {
      const ollama = providerStatuses["ollama"];
      if (ollama?.available && ollama.suggested_model) {
        chain.push({
          provider: "ollama",
          model: ollama.suggested_model,
          base_url: OLLAMA_BASE_URL,
        });
      }
    }
    return extractWithFailover({
      mode: args.mode,
      imagesB64: args.imagesB64,
      chain,
      timeout: args.timeout,
    });
  }

  return extract({
    mode: args.mode,
    imagesB64: args.imagesB64,
    provider,
    model,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
  });
}

/** نص تنبيه التراجع عند النجاح بعد حلقات فاشلة — null إن كان النجاح مباشراً */
export function failoverNotice(res: SmartExtractResult): string | null {
  const log = res.failover_log ?? [];
  if (log.length === 0) return null;
  const parts = log.map((l) => `${l.provider} (${l.error_ar ?? l.error_type ?? "فشل"})`);
  const used = res.used_provider ?? res.model;
  return `تم التراجع تلقائياً: ${parts.join("، ")} ← نجح ${used}`;
}

/** تفاصيل attempts_detail من خطأ all_failed (provider: error_ar لكل مزود) */
function attemptsDetailLines(e: PyApiError): string[] {
  const raw = e.payload?.attempts_detail;
  if (!Array.isArray(raw)) return [];
  const details = raw as FailoverAttemptDetail[];
  return details.map(
    (d) => `${d.provider}: ${d.error_ar ?? d.error_type ?? d.detail ?? "فشل"}`
  );
}

/**
 * عرض خطأ الاستخراج واعياً للتصنيف (15.10.2 — لا رسالة عامة):
 * - PyApiError مع error_ar → تُعرض الرسالة المفصلة كما هي (والسياق اختياري قبله).
 * - error_type === "all_failed" → toast إضافي بتفاصيل كل مزود سطراً لسطر.
 * - غير ذلك → السلوك القديم (رسالة الاستثناء، أو الصمت إذا fallback === null).
 */
export function showExtractError(
  e: unknown,
  opts: { fallback?: string | null; context?: string } = {}
): void {
  if (e instanceof PyApiError && e.errorAr) {
    toast.error(opts.context ? `${opts.context}: ${e.errorAr}` : e.errorAr);
    if (e.errorType === "all_failed") {
      const lines = attemptsDetailLines(e);
      if (lines.length > 0) {
        toast.error(lines.join("\n"), { duration: 15000 });
      }
    }
    return;
  }
  if (opts.fallback === null) return; // السلوك القديم: صمت لغير الأخطاء المصنفة
  const msg = e instanceof Error ? e.message : (opts.fallback ?? "فشل العملية");
  toast.error(opts.context ? `${opts.context}: ${msg}` : msg);
}
